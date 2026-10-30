# IoT-Enabled Solar-Powered Adaptive Drip Irrigation for Tomato (TomatoIQ)

React + FastAPI dashboard with three ML models trained on a real, public tomato-irrigation dataset, an ESP32-ready
ingestion API, a simulated pump, and safety-first control logic.

```
smart-tomato-irrigation/
  frontend/   React + TypeScript + Vite + Recharts dashboard (8 sections)
  backend/    FastAPI + SQLAlchemy + SQLite (app/, tests/)
  ml/         data/raw, data/processed, models/, reports/, src/ (shared features), scripts/
  docs/       FINAL_IMPLEMENTATION_REPORT.md
```

## Install
Requires Python 3.11+ (tested on 3.14) and Node 20+.

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows   (Linux/macOS: source .venv/bin/activate)
pip install -r backend/requirements.txt
cd frontend && npm install
```

## Run
```bash
# terminal 1 - backend (http://127.0.0.1:8000, docs at /docs)
cd backend && uvicorn app.main:app --port 8000

# terminal 2 - frontend (http://localhost:5173)
cd frontend && npm run dev
```
Set `VITE_API_URL` if the backend is elsewhere. Backend env vars: `DEVICE_API_KEY` (default `dev-device-key`),
`CONTROL_LOOP_SECONDS` (30; 0 disables), `SIMULATOR_SECONDS` (30; 0 disables), `DATABASE_URL`, `CORS_ORIGINS`.

## Train the ML models
Trained models and `ml/reports/metrics.json` are included. To reproduce:
```bash
python ml/scripts/download_dataset.py     # ~42 MB from Mendeley Data (CC BY 4.0) -> ml/data/raw/arnesano
python ml/scripts/prepare_data.py         # -> ml/data/processed (+ dataset_manifest.json)
python ml/scripts/train_models.py         # -> ml/models/*.joblib, ml/reports/metrics.json
```
Fixed seed, no hyper-parameter search. Results are in `docs/FINAL_IMPLEMENTATION_REPORT.md` and the *Model Performance* page.

## Tests
```bash
cd backend && python -m pytest -q        # 38 tests: dataset/preprocessing, saved models, API, DB, invalid/missing data, weather outage, pump safety
cd frontend && npx tsc -b && npm run build
```

## Dataset
**Soil Moisture, Irrigation Actuator and Weather Dataset from a Multi-Sector Precision-Irrigation** — Adamo, Colizzi, Dimauro, Guerriero, Lomonte
(Univ. of Salento / Univ. of Bari). Arnesano (Lecce, Italy), Feb–Sep 2025. DOI [10.17632/c837v6p8ph.2](https://data.mendeley.com/datasets/c837v6p8ph/2),
**CC BY 4.0** (attribution required). Used: open-field tomato sectors 1 and 2. Details, record counts and caveats: `ml/data/processed/dataset_manifest.json`.

## API (selection; full schema at `/docs`)
| Method & path | Purpose |
|---|---|
| `POST /api/sensors/readings` | ESP32 ingestion (`X-API-Key`), stored as `device` |
| `GET /api/sensors/latest`, `/api/sensors/readings?hours=24&source=` | Latest/history for the active source |
| `POST /api/predictions/run` | Compute + store irrigation, water, forecast (+ FAO-56 calc) |
| `POST /api/predictions/batch` | Predict every row of an uploaded CSV (`{"csv": "..."}`; template at `GET /api/predictions/batch/template`) |
| `GET /api/predictions/{irrigation,water,forecast,history}` | Compute-only / stored predictions |
| `GET /api/irrigation/status`, `/history` | Pump + limits / event log |
| `POST /api/irrigation/{start,stop,emergency-stop,emergency-reset}` | Manual control (always available; capped runtime) |
| `POST /api/control/evaluate` | One control-loop iteration (also runs every 30 s) |
| `GET/PUT /api/farm` | Farm configuration, coordinates, mode, safety limits |
| `GET /api/models/performance`, `/api/dataset/info`, `/api/health` | Metrics, dataset info, health |

## Simulated mode
Default `sensor_source = simulated`. Use *Live Sensors → Backfill 48 h / Add one reading*, or let the background generator run.
Simulated rows are stored with `source="simulated"`, shown with an orange **SIMULATED** badge everywhere, and are never mixed with device data;
only the source chosen in *Settings* drives predictions and control. The pump is always a **simulated pump**.

## Control modes and safety
Modes: `manual`, `sensor_auto` (start < start threshold, stop ≥ stop threshold), `ai_recommend` (never actuates), `ai_auto` (ML must agree *and* moisture must be below the stop threshold; falls back to the sensor rule if ML is unavailable).
Gates that apply to every automatic start/stop and that ML cannot bypass: emergency stop, maximum runtime (also caps manual runs), invalid/stale sensor data
(running automatic irrigation is stopped fail-safe), saturation gate, minimum rest period. Manual start/stop remains available (except during emergency stop).

## Future ESP32 integration
Send every N minutes:
```http
POST /api/sensors/readings
X-API-Key: <DEVICE_API_KEY>
{"device_id":"esp32-zone1","soil_moisture":41.5,"air_temp":27.3,"humidity":58.0,"soil_temp":24.1,
 "timestamp":"2026-06-01T10:15:00Z","rainfall":0.0}
```
`timestamp` and `rainfall` are optional. Out-of-range values are stored but flagged invalid and never used. Then set *Sensor source = Physical device* in Settings.
Calibrate the capacitive probe to the dataset's 0–100 % relative scale before using thresholds or ML. Physical pump control is intentionally disabled:
`backend/app/hardware.py` contains the adapter interface and an `Esp32Pump` placeholder that refuses to run until real hardware configuration (relay endpoint, fail-closed wiring) is implemented.

## Deployment (Render, auto-updating)
`render.yaml` defines one Docker web service (API + built dashboard). Connect the repository once at
https://render.com/deploy?repo=https://github.com/SOUMO96/smart-tomato-irrigation and every push to `main` redeploys the site
(tests and build also run in GitHub Actions). On the free plan the service sleeps when idle (first load takes about a minute) and the SQLite
database resets on each deploy; demo history is re-seeded as clearly-labelled simulated data. Use a persistent disk or a hosted database for real data.
Set `DEVICE_API_KEY` in the Render dashboard (generated automatically) and use it in the ESP32 firmware.
