import asyncio
import json
import math
import logging
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import batch, config, controller, hardware, schemas, services, simulator
from .db import FarmSettings, IrrigationEvent, PredictionRecord, SensorReading, SessionLocal, get_db, init_db, iso, utcnow
from .ml_service import ml

log = logging.getLogger("app")


async def _loop(seconds: int, fn):
    while True:
        await asyncio.sleep(seconds)
        try:
            await asyncio.to_thread(fn)
        except Exception:
            log.exception("background task failed")  # a failure must never stop the loop (or leave the pump on unmonitored)


def _sim_tick():
    with SessionLocal() as db:
        if services.get_settings(db).sensor_source == "simulated":
            simulator.tick(db)


def _control_tick():
    with SessionLocal() as db:
        controller.control_step(db)


def _store_predictions_tick():
    """Periodically store a prediction snapshot for the history page (page loads no longer write to the database)."""
    with SessionLocal() as db:
        services.store_predictions(db, services.compute_predictions(db))


def _warm_up():
    """Runs once in the background at startup: fetch weather and prime the prediction cache so the first visitor is fast."""
    try:
        with SessionLocal() as db:
            services.store_predictions(db, services.compute_predictions(db))
    except Exception:
        log.exception("warm-up failed")


def _seed_demo():
    """Fresh deployments (ephemeral disks) start empty: add clearly-labelled SIMULATED history so the demo works immediately."""
    with SessionLocal() as db:
        has = db.scalars(select(SensorReading).where(SensorReading.source == "simulated").limit(1)).first()
        if not has and services.get_settings(db).sensor_source == "simulated":
            simulator.backfill(db, 36, seed=1)
            simulator.tick(db)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    ml.load()
    if config.AUTO_SEED:
        _seed_demo()
    tasks = []
    if config.WARM_UP:
        tasks.append(asyncio.create_task(asyncio.to_thread(_warm_up)))
    if config.PREDICTION_SNAPSHOT_SECONDS > 0:
        tasks.append(asyncio.create_task(_loop(config.PREDICTION_SNAPSHOT_SECONDS, _store_predictions_tick)))
    if config.SIMULATOR_SECONDS > 0:
        tasks.append(asyncio.create_task(_loop(config.SIMULATOR_SECONDS, _sim_tick)))
    if config.CONTROL_LOOP_SECONDS > 0:
        tasks.append(asyncio.create_task(_loop(config.CONTROL_LOOP_SECONDS, _control_tick)))
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="Smart Tomato Irrigation API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=1000)  # JS/CSS/JSON shrink about 4x on the wire


@app.middleware("http")
async def cache_headers(request, call_next):
    resp = await call_next(request)
    if request.url.path.startswith("/assets/"):
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"  # hashed filenames: safe to cache for a year
    elif request.url.path == "/" or request.url.path.endswith(".html"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


def settings_dict(s: FarmSettings) -> dict:
    return {c.name: getattr(s, c.name) for c in FarmSettings.__table__.columns if c.name != "id"}


# ---------------------------------------------------------------- system
@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(select(1))
    return {"status": "ok", "time": iso(utcnow()), "models": ml.availability(),
            "pump": {"adapter": hardware.get_pump().name, "physical_control_enabled": not hardware.get_pump().simulated}}


@app.get("/api/farm")
def get_farm(db: Session = Depends(get_db)):
    return settings_dict(services.get_settings(db))


@app.put("/api/farm")
def update_farm(body: schemas.SettingsUpdate, db: Session = Depends(get_db)):
    s = services.get_settings(db)
    changes = body.model_dump(exclude_none=True)
    start, stop = changes.get("start_threshold", s.start_threshold), changes.get("stop_threshold", s.stop_threshold)
    if start >= stop:
        raise HTTPException(422, "start_threshold must be lower than stop_threshold")
    for k, v in changes.items():
        setattr(s, k, v)
    db.commit()
    return settings_dict(s)


@app.get("/api/dataset/info")
def dataset_info():
    try:
        return json.loads((config.PROCESSED_DIR / "dataset_manifest.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise HTTPException(404, "dataset manifest not found - run ml/scripts/prepare_data.py")


TABLES = {"clf": ("clf_samples.csv", "irrigation"), "reg": ("reg_events.csv", "water"), "fc": ("fc_samples.csv", "forecast")}


@app.get("/api/dataset/samples")
def dataset_samples(table: str = Query("clf", pattern="^(clf|reg|fc)$"), n: int = Query(8, ge=1, le=30)):
    """Random rows + per-column ranges of the processed training tables (what the models actually saw)."""
    import pandas as pd
    path = config.PROCESSED_DIR / TABLES[table][0]
    if not path.exists():
        raise HTTPException(404, "processed table not found - run ml/scripts/prepare_data.py")
    d = pd.read_csv(path, index_col=0)
    num = d.select_dtypes("number")
    stats = {c: {"min": round(float(num[c].min()), 3), "median": round(float(num[c].median()), 3), "max": round(float(num[c].max()), 3)} for c in num}
    rows = d.sample(min(n, len(d)), random_state=7).sort_index()
    rows = rows.round(3).reset_index().rename(columns={d.index.name or "index": "time"})
    return {"table": TABLES[table][0], "rows_total": len(d), "columns": list(rows.columns), "stats": stats,
            "samples": json.loads(rows.to_json(orient="records"))}


@app.post("/api/predictions/what-if")
def what_if(body: schemas.WhatIf):
    """Run the trained models on user-supplied inputs. Not stored; not tied to any sensor."""
    x = body.model_dump()
    h = x.pop("hour")
    x["hour_sin"], x["hour_cos"] = math.sin(2 * math.pi * h / 24), math.cos(2 * math.pi * h / 24)
    return {"inputs": body.model_dump(), "irrigation": ml.predict_irrigation(x), "water": ml.predict_water(x),
            "forecast": ml.predict_forecast(x)}


@app.get("/api/predictions/batch/template")
def batch_template():
    return {"csv": batch.TEMPLATE, "required_columns": batch.REQUIRED, "accepted_names": batch.ALIASES, "max_rows": batch.MAX_ROWS}


@app.post("/api/predictions/batch")
def batch_predict(body: schemas.BatchRequest, db: Session = Depends(get_db)):
    """Predict for every row of an uploaded CSV. Nothing is stored."""
    try:
        return batch.run(ml, body.csv, services.get_settings(db).flow_l_per_min)
    except batch.BatchError as exc:
        raise HTTPException(422, str(exc))


@app.get("/api/models/performance")
def model_performance():
    if ml.metrics is None:
        return {"status": "unavailable", "reason": "ml/reports/metrics.json not found - train the models", "models": ml.availability()}
    return {"status": "ok", "models": ml.availability(), **ml.metrics}


# ---------------------------------------------------------------- sensors
@app.post("/api/sensors/readings")
def ingest_reading(p: schemas.SensorPayload, x_api_key: str | None = Header(None), db: Session = Depends(get_db)):
    """ESP32 ingestion. Stored with source='device'."""
    if x_api_key != config.DEVICE_API_KEY:
        raise HTTPException(401, "invalid or missing X-API-Key")
    now = utcnow()
    values = {k: getattr(p, k) for k in ("soil_moisture", "air_temp", "humidity", "soil_temp")}
    reason = services.validate_values(values)
    ts = p.timestamp or now
    if not reason and ts > now + timedelta(minutes=5):
        reason = "timestamp is in the future"
    r = SensorReading(timestamp=ts, rainfall=p.rainfall, source="device", device_id=p.device_id,
                      valid=reason is None, invalid_reason=reason, **{k: (v if v == v else None) for k, v in values.items()})
    db.add(r)
    db.commit()
    return {"accepted": True, "id": r.id, "valid": r.valid, "invalid_reason": reason}


@app.get("/api/sensors/latest")
def latest(db: Session = Depends(get_db)):
    s = services.get_settings(db)
    r = services.active_reading(db, s)
    return {"source": s.sensor_source, "reading": r.as_dict() if r else None, "state": services.reading_state(r, s),
            "label": "SIMULATED data - not from a physical sensor" if s.sensor_source == "simulated" else "Physical device data"}


@app.get("/api/sensors/readings")
def readings(hours: float = Query(24, gt=0, le=720), source: str | None = Query(None, pattern="^(device|simulated)$"),
             limit: int = Query(2000, ge=1, le=10000), db: Session = Depends(get_db)):
    src = source or services.get_settings(db).sensor_source
    rows = db.scalars(select(SensorReading).where(SensorReading.source == src, SensorReading.timestamp >= utcnow() - timedelta(hours=hours))
                      .order_by(SensorReading.timestamp.desc()).limit(limit)).all()
    return {"source": src, "count": len(rows), "readings": [r.as_dict() for r in reversed(rows)]}


@app.post("/api/simulator/tick")
def sim_tick(db: Session = Depends(get_db)):
    return simulator.tick(db).as_dict()


@app.post("/api/simulator/backfill")
def sim_backfill(hours: int = Query(48, ge=1, le=720), db: Session = Depends(get_db)):
    return {"created": simulator.backfill(db, hours), "source": "simulated"}


# ---------------------------------------------------------------- predictions
@app.get("/api/predictions/irrigation")
def pred_irrigation(db: Session = Depends(get_db)):
    return services.compute_predictions(db)["irrigation"]


@app.get("/api/predictions/water")
def pred_water(db: Session = Depends(get_db)):
    r = services.compute_predictions(db)
    return {"ml": r["water"], "agronomy": r["agronomy"]}


@app.get("/api/predictions/forecast")
def pred_forecast(db: Session = Depends(get_db)):
    return services.compute_predictions(db)["forecast"]


@app.get("/api/predictions/current")
def current_predictions(db: Session = Depends(get_db)):
    """All predictions for the latest reading (cached for a few seconds, never writes). Used by the dashboard."""
    return services.compute_predictions(db)


@app.post("/api/predictions/run")
def run_predictions(db: Session = Depends(get_db)):
    """Compute all predictions from the latest reading, store them, and return them."""
    result = services.compute_predictions(db)
    services.store_predictions(db, result)
    return result


@app.get("/api/predictions/history")
def pred_history(kind: str | None = Query(None, pattern="^(irrigation|water|forecast)$"), limit: int = Query(50, ge=1, le=500),
                 db: Session = Depends(get_db)):
    q = select(PredictionRecord).order_by(PredictionRecord.created_at.desc()).limit(limit)
    if kind:
        q = q.where(PredictionRecord.kind == kind)
    return {"predictions": [p.as_dict() for p in db.scalars(q)]}


# ---------------------------------------------------------------- irrigation / pump
@app.get("/api/irrigation/status")
def irrigation_status(db: Session = Depends(get_db)):
    s = services.get_settings(db)
    r = services.active_reading(db, s)
    return {"mode": s.control_mode, "pump": controller.pump_status(db, s), "sensor_state": services.reading_state(r, s),
            "limits": {"max_pump_runtime_min": s.max_pump_runtime_min, "min_rest_min": s.min_rest_min,
                       "stale_after_min": s.stale_after_min, "start_threshold": s.start_threshold, "stop_threshold": s.stop_threshold}}


@app.post("/api/irrigation/start")
def irrigation_start(body: schemas.StartRequest | None = None, db: Session = Depends(get_db)):
    res = controller.start_pump(db, "manual", body.duration_min if body else None)
    if not res["started"]:
        raise HTTPException(409, res)
    return res


@app.post("/api/irrigation/stop")
def irrigation_stop(db: Session = Depends(get_db)):
    return controller.stop_pump(db, "manual stop")


@app.post("/api/irrigation/emergency-stop")
def irrigation_estop(db: Session = Depends(get_db)):
    return controller.emergency_stop(db)


@app.post("/api/irrigation/emergency-reset")
def irrigation_ereset(db: Session = Depends(get_db)):
    return controller.emergency_reset(db)


@app.post("/api/control/evaluate")
def control_evaluate(db: Session = Depends(get_db)):
    """Run one control-loop iteration now (the background loop does this automatically)."""
    return controller.control_step(db)


@app.get("/api/irrigation/history")
def irrigation_history(limit: int = Query(50, ge=1, le=500), db: Session = Depends(get_db)):
    s = services.get_settings(db)
    rows = db.scalars(select(IrrigationEvent).order_by(IrrigationEvent.start.desc()).limit(limit)).all()
    return {"events": [e.as_dict(s.flow_l_per_min) for e in rows],
            "note": "Litres are estimated from pump runtime x configured flow rate; there is no flow meter."}


# ---------------------------------------------------------------- serve the built dashboard (production / single-service deploy)
_dist = config.ROOT / "frontend" / "dist"
if _dist.is_dir():
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "not found")
        f = (_dist / path).resolve()
        return FileResponse(f if f.is_file() and _dist in f.parents else _dist / "index.html")
