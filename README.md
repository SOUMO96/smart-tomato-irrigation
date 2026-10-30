# IoT-Enabled Solar-Powered Adaptive Drip Irrigation System for Tomato Crops

B.Tech major project. A web dashboard and API that watch soil and weather conditions for a tomato plot, predict when and how much
to irrigate, and drive a drip-irrigation pump through an ESP32, with safety limits that the machine-learning part cannot override.

Live demo: https://smart-tomato-irrigation.onrender.com (free hosting, so the first load after idle can take about a minute)

## What it does

- Reads soil moisture, air temperature, humidity and soil temperature from an ESP32 (or a clearly labelled simulator when no hardware is connected).
- Pulls weather for the farm's location (Open-Meteo, with MET Norway and NASA POWER as fallbacks).
- Three models: whether irrigation is needed in the next hour, how many litres one irrigation event needs, and soil moisture 1, 6, 12 and 24 hours ahead.
- An FAO-56 crop-water calculation shown next to the ML estimate, so the two can be compared.
- Four control modes: manual, sensor threshold, AI recommend-only, and AI automatic.
- Upload your own CSV or JSON of readings and get a prediction for every row.
- Pages that explain the data, the inputs each model sees, and the real test scores, including where the models are weak.

## Repository layout

```
frontend/   React + TypeScript + Vite dashboard
backend/    FastAPI, SQLAlchemy, SQLite; tests in backend/tests
ml/         dataset download/prep, training scripts, saved models, reports
firmware/   ESP32 sketch (sensor upload + pump command polling)
docs/       final report, hardware notes
```

## Running it locally

Needs Python 3.11 or newer and Node 20 or newer.

```bash
python -m venv .venv
.venv\Scripts\activate                 # Linux/macOS: source .venv/bin/activate
pip install -r backend/requirements.txt
cd frontend && npm install && cd ..

# terminal 1: API on http://127.0.0.1:8000 (API docs at /docs)
cd backend && uvicorn app.main:app --port 8000

# terminal 2: dashboard on http://localhost:5173
cd frontend && npm run dev
```

Backend settings are environment variables: `DEVICE_API_KEY`, `DATABASE_URL`, `CORS_ORIGINS`, `CONTROL_LOOP_SECONDS`,
`SIMULATOR_SECONDS`, `HARDWARE_MODE` (`simulated` by default, `device` for a real pump) and `WEATHER_TTL_SECONDS`.
The farm location (default: Assam, 24.6848 N, 92.7510 E) and all safety limits are changed in the Settings page.

## Dataset and models

Training data is the public Mendeley dataset *Soil Moisture, Irrigation Actuator and Weather Dataset from a Multi-Sector
Precision-Irrigation* (Adamo, Colizzi, Dimauro, Guerriero, Lomonte), collected near Arnesano, Italy in 2025.
DOI 10.17632/c837v6p8ph.2, licence CC BY 4.0. Only the two open-field tomato sectors are used. Water volumes in it are valve time multiplied by
a flow rate, not metered, and the models inherit that limitation.

Results on held-out data (time-ordered splits, fixed seed, no hyper-parameter search):

| Model | Result |
|---|---|
| Irrigation needed (classifier) | F1 0.23, recall 0.38, ROC-AUC 0.76. A plain "moisture below 40 %" rule scores F1 0.14. |
| Water per event (regressor) | MAE about 57 L, R² 0.03. Weak: treat it as a rough guide next to the FAO-56 figure. |
| Moisture forecast | Beats "same as now" at 1, 6 and 24 h. The 12 h horizon has only 18 test rows and is not reliable. |

These numbers are modest and are shown as they are on the Model Performance page. The models learned from one Italian farm, so predictions for another
climate are an extrapolation.

To retrain: `python ml/scripts/download_dataset.py`, then `prepare_data.py`, then `train_models.py`. Trained models and `ml/reports/metrics.json` are already in the repo.

## Control and safety

Modes: `manual`, `sensor_auto`, `ai_recommend` (never switches the pump) and `ai_auto`. These checks apply to every automatic start and stop,
and the ML output cannot bypass them: emergency stop, maximum runtime (30 min by default, also applied to manual runs), stale or invalid sensor data,
a saturation limit, and a minimum rest time between runs. A physical pump will also refuse to start on simulated sensor data.

## Connecting the real hardware

The ESP32 sends readings to `POST /api/sensors/readings` (header `X-API-Key`) and polls `GET /api/device/command` every few seconds.
Every pump-on command is a short lease, so if the Wi-Fi or the server goes away the relay switches off by itself.
Wiring, calibration and setup are in [docs/HARDWARE.md](docs/HARDWARE.md); the sketch is [firmware/esp32_pump_controller.ino](firmware/esp32_pump_controller.ino).
The hardware path has been tested in software only. Test with the pump disconnected first.

Reading payload:

```json
{"device_id": "esp32-zone1", "soil_moisture": 41.5, "air_temp": 27.3, "humidity": 58.0, "soil_temp": 24.1,
 "timestamp": "2026-06-01T10:15:00Z", "rainfall": 0.0}
```

## Uploading your own data

On the Predict Your Data page, upload a CSV or JSON file (up to 5,000 rows, 3 MB). Needed: soil moisture, air temperature, humidity.
Optional: soil temperature, timestamp, rainfall, wind speed, solar radiation, irrigation minutes. Common column names are recognised automatically.
Soil moisture can be a percentage, or raw sensor counts (above 100, high = dry), which are converted with 100 x (1 - raw / 1023).
Rows with impossible values are reported and not predicted. A template is available from the page.

## Tests

```bash
cd backend && python -m pytest -q          # 38 tests: data, models, API, weather outage, pump safety
cd frontend && npx tsc -b && npm run build
```

## Deployment

`render.yaml` describes one Docker web service that serves the API and the built dashboard. Every push to `main` redeploys it, and GitHub Actions runs the tests.
On the free plan the service sleeps when idle and the SQLite database resets on each deploy; demo history is regenerated as simulated data.
Use a persistent disk or a hosted database for real data. Set `DEVICE_API_KEY` in the Render dashboard.

## Known limits

- Models are trained on Italian data; the water-volume model in particular is weak.
- Weather solar radiation is estimated when Open-Meteo is unavailable.
- No flow meter: litres are runtime times a configured flow rate.
- The dashboard has no login; anyone with the link can see it and use manual controls on a deployed instance.

## Credits

Dataset: Adamo et al., Mendeley Data, CC BY 4.0. Weather: Open-Meteo, MET Norway, NASA POWER.
