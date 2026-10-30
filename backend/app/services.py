"""Builds model inputs from the DB + weather and orchestrates predictions."""
import math
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import agronomy, weather
from .db import FarmSettings, IrrigationEvent, PredictionRecord, PumpState, SensorReading, iso, utcnow
from .ml_service import ml

# Physical plausibility limits for incoming readings
LIMITS = {"soil_moisture": (0.0, 100.0), "air_temp": (-10.0, 60.0), "humidity": (0.0, 100.0), "soil_temp": (-5.0, 60.0)}


def get_settings(db: Session) -> FarmSettings:
    return db.get(FarmSettings, 1)


def get_pump_state(db: Session) -> PumpState:
    return db.get(PumpState, 1)


def validate_values(v: dict) -> str | None:
    for k, (lo, hi) in LIMITS.items():
        if v.get(k) is None or not math.isfinite(v[k]) or not lo <= v[k] <= hi:
            return f"{k} missing or outside plausible range [{lo}, {hi}]"
    return None


def to_local(ts_utc: datetime, tz: str) -> datetime:
    try:
        return ts_utc.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(tz)).replace(tzinfo=None)
    except Exception:
        return ts_utc


def active_reading(db: Session, s: FarmSettings) -> SensorReading | None:
    return db.scalars(select(SensorReading).where(SensorReading.source == s.sensor_source)
                      .order_by(SensorReading.timestamp.desc()).limit(1)).first()


def reading_state(r: SensorReading | None, s: FarmSettings, now: datetime | None = None) -> dict:
    now = now or utcnow()
    if r is None:
        return {"status": "none", "reason": f"no {s.sensor_source} readings received yet", "age_s": None}
    age = (now - r.timestamp).total_seconds()
    if not r.valid:
        return {"status": "invalid", "reason": r.invalid_reason, "age_s": age}
    if age > s.stale_after_min * 60:
        return {"status": "stale", "reason": f"last reading is {age / 60:.0f} min old (limit {s.stale_after_min:.0f})", "age_s": age}
    return {"status": "ok", "reason": None, "age_s": age}


def irrigation_stats(db: Session, now: datetime) -> dict:
    ev = db.scalars(select(IrrigationEvent).where(IrrigationEvent.start >= now - timedelta(hours=240))
                    .order_by(IrrigationEvent.start.desc())).all()
    s = db.get(FarmSettings, 1)

    def minutes_within(hours):
        lo = now - timedelta(hours=hours)
        return sum(max(0.0, ((e.end or now) - max(e.start, lo)).total_seconds() / 60) for e in ev if (e.end or now) > lo)

    last_end = max(((e.end or now) for e in ev), default=None)
    return {"min_1h": minutes_within(1), "min_6h": minutes_within(6), "min_24h": minutes_within(24),
            "l_24h": minutes_within(24) * s.flow_l_per_min,
            "hours_since": 240.0 if last_end is None else min(240.0, (now - last_end).total_seconds() / 3600)}


def lag_value(db: Session, source: str, anchor: datetime, hours: float):
    target = anchor - timedelta(hours=hours)
    rows = db.scalars(select(SensorReading).where(
        SensorReading.source == source, SensorReading.valid.is_(True),
        SensorReading.timestamp.between(target - timedelta(minutes=20), target + timedelta(minutes=20)))).all()
    if not rows:
        return None
    return min(rows, key=lambda r: abs((r.timestamp - target).total_seconds())).soil_moisture


def build_inputs(db: Session, s: FarmSettings, r: SensorReading, w: dict) -> dict:
    local = to_local(r.timestamp, s.timezone)
    h = local.hour + local.minute / 60
    st = irrigation_stats(db, r.timestamp)
    wx = lambda k: w.get(k) if w.get("status") != "unavailable" else None
    return {
        "soil_moisture": r.soil_moisture, "air_temp": r.air_temp, "humidity": r.humidity, "soil_temp": r.soil_temp,
        "rain_6h": wx("rain_6h"), "rain_24h": wx("rain_24h"), "wind_speed": wx("wind_speed"),
        "solar_radiation": wx("solar_radiation"),
        "irrigated_min_1h": st["min_1h"], "irrigated_min_6h": st["min_6h"], "irrigated_min_24h": st["min_24h"],
        "irrigated_l_24h": st["l_24h"], "hours_since_irrigation": st["hours_since"],
        "hour_sin": math.sin(2 * math.pi * h / 24), "hour_cos": math.cos(2 * math.pi * h / 24),
        "sm_lag_1h": lag_value(db, r.source, r.timestamp, 1), "sm_lag_3h": lag_value(db, r.source, r.timestamp, 3),
        "sm_lag_6h": lag_value(db, r.source, r.timestamp, 6), "sm_lag_24h": lag_value(db, r.source, r.timestamp, 24),
    }


_pred_cache: dict = {}
PRED_CACHE_SECONDS = 30


def compute_predictions(db: Session, s: FarmSettings | None = None) -> dict:
    """Cached for a few seconds: repeated page loads reuse the result for the same reading, settings and model set.
    Sensor freshness is always recomputed so the age shown is current."""
    s = s or get_settings(db)
    r = active_reading(db, s)
    state = reading_state(r, s)
    key = (s.sensor_source, r.id if r else None, s.growth_stage, s.zone_area_m2, s.irrigation_efficiency, s.latitude, s.longitude,
           s.timezone, get_pump_state(db).running, tuple(sorted(ml.bundles)))
    hit = _pred_cache.get("v")
    if hit and hit[0] == key and time.time() - hit[1] < PRED_CACHE_SECONDS:
        return {**hit[2], "sensor_state": state}
    result = _compute_predictions(db, s)
    _pred_cache["v"] = (key, time.time(), result)
    return result


def _compute_predictions(db: Session, s: FarmSettings) -> dict:
    """Run all predictions on the latest reading of the active source. Nothing is fabricated when inputs are missing."""
    r = active_reading(db, s)
    state = reading_state(r, s)
    w = weather.get_weather(s.latitude, s.longitude, s.timezone, to_local(utcnow(), s.timezone))
    base = {"computed_at": iso(utcnow()), "input_source": s.sensor_source, "sensor_state": state,
            "reading": r.as_dict() if r else None, "weather": w}
    agro = agronomy.requirement(w, s.growth_stage, s.zone_area_m2, s.irrigation_efficiency)
    if r is None or state["status"] in ("none", "invalid"):
        unavailable = {"status": "unavailable", "reason": state["reason"]}
        return {**base, "irrigation": unavailable, "water": unavailable, "forecast": unavailable, "agronomy": agro}
    x = build_inputs(db, s, r, w)
    irrigation = ml.predict_irrigation(x)
    if get_pump_state(db).running:
        irrigation = {**irrigation, "note": "Pump is currently running; the model was trained for moments when the valve is closed."}
    note = {"stale_sensor": state["reason"]} if state["status"] == "stale" else {}
    return {**base, "irrigation": {**irrigation, **note}, "water": {**ml.predict_water(x), **note},
            "forecast": {**ml.predict_forecast(x), "anchor_time": iso(r.timestamp), **note}, "agronomy": agro,
            "inputs": {k: (None if v is None else round(float(v), 4)) for k, v in x.items()}}


def store_predictions(db: Session, result: dict):
    rid = (result.get("reading") or {}).get("id")
    for kind in ("irrigation", "water", "forecast"):
        p = result[kind]
        db.add(PredictionRecord(kind=kind, status=p.get("status", "unknown"), input_source=result["input_source"],
                                reading_id=rid, payload=p))
    db.commit()
