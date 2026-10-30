import os
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_tmp) / 'test.db'}"
os.environ["CONTROL_LOOP_SECONDS"] = "0"
os.environ["SIMULATOR_SECONDS"] = "0"
os.environ["AUTO_SEED"] = "0"
os.environ["WARM_UP"] = "0"
os.environ["PREDICTION_SNAPSHOT_SECONDS"] = "0"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import services, weather  # noqa: E402
from app.db import Base, SessionLocal, engine, init_db, utcnow  # noqa: E402
from app.main import app  # noqa: E402
from app.ml_service import ml  # noqa: E402

KEY = {"X-API-Key": "dev-device-key"}


def fake_weather_raw(*_a, **_k):
    start = (datetime.utcnow() - timedelta(days=3)).replace(hour=0, minute=0, second=0, microsecond=0)
    times = [start + timedelta(hours=i) for i in range(24 * 6)]
    n = len(times)
    days = sorted({t.date().isoformat() for t in times})
    return {"latitude": 40.3, "longitude": 18.1, "hourly": {
        "time": [t.strftime("%Y-%m-%dT%H:%M") for t in times], "temperature_2m": [22.0] * n, "relative_humidity_2m": [60.0] * n,
        "precipitation": [0.0] * n, "wind_speed_10m": [8.0] * n, "direct_radiation": [300.0] * n,
        "soil_temperature_0cm": [21.0] * n, "et0_fao_evapotranspiration": [0.3] * n},
        "daily": {"time": days, "et0_fao_evapotranspiration": [5.0] * len(days), "precipitation_sum": [0.0] * len(days)}}


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
    Base.metadata.drop_all(engine)
    init_db()
    ml.load()
    weather._cache.clear()
    services._pred_cache.clear()
    monkeypatch.setattr(weather, "_fetch", fake_weather_raw)
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def db():
    with SessionLocal() as s:
        yield s


def post_reading(client, **over):
    body = {"device_id": "esp32-test", "soil_moisture": 35.0, "air_temp": 24.0, "humidity": 55.0, "soil_temp": 21.0,
            "timestamp": utcnow().isoformat() + "Z"}
    body.update(over)
    return client.post("/api/sensors/readings", json=body, headers=KEY)
