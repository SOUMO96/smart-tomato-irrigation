from datetime import timedelta

from app import controller, hardware, services, weather
from app.db import IrrigationEvent, SensorReading, utcnow
from app.ml_service import ml

from .conftest import KEY, post_reading


def use_device(client, **settings):
    r = client.put("/api/farm", json={"sensor_source": "device", **settings})
    assert r.status_code == 200, r.text


# ------------------------------------------------------------ ingestion / validation / DB
def test_ingest_valid_and_stored_as_device(client):
    r = post_reading(client, rainfall=0.2)
    assert r.status_code == 200 and r.json()["valid"] is True
    use_device(client)
    latest = client.get("/api/sensors/latest").json()
    assert latest["reading"]["source"] == "device" and latest["reading"]["rainfall"] == 0.2


def test_ingest_requires_api_key(client):
    r = client.post("/api/sensors/readings", json={"device_id": "x", "soil_moisture": 1, "air_temp": 1, "humidity": 1, "soil_temp": 1})
    assert r.status_code == 401


def test_ingest_missing_field_rejected(client):
    r = client.post("/api/sensors/readings", json={"device_id": "x", "soil_moisture": 30}, headers=KEY)
    assert r.status_code == 422


def test_ingest_rainfall_optional(client):
    assert post_reading(client).json()["valid"] is True


def test_invalid_reading_flagged_not_trusted(client):
    r = post_reading(client, soil_moisture=250.0).json()
    assert r["valid"] is False and "soil_moisture" in r["invalid_reason"]
    use_device(client)
    assert client.get("/api/sensors/latest").json()["state"]["status"] == "invalid"
    p = client.post("/api/predictions/run").json()
    assert p["irrigation"]["status"] == "unavailable" and p["forecast"]["status"] == "unavailable"


def test_future_timestamp_invalid(client):
    r = post_reading(client, timestamp=(utcnow() + timedelta(hours=2)).isoformat() + "Z").json()
    assert r["valid"] is False


def test_simulated_and_device_sources_never_mix(client):
    client.post("/api/simulator/tick")
    post_reading(client, soil_moisture=33.0)
    assert client.get("/api/sensors/latest").json()["reading"]["source"] == "simulated"
    use_device(client)
    assert client.get("/api/sensors/latest").json()["reading"]["source"] == "device"
    sim = client.get("/api/sensors/readings", params={"source": "simulated"}).json()
    assert all(x["source"] == "simulated" for x in sim["readings"])


def test_settings_validation(client):
    assert client.put("/api/farm", json={"latitude": 123}).status_code == 422
    assert client.put("/api/farm", json={"growth_stage": "banana"}).status_code == 422
    assert client.put("/api/farm", json={"start_threshold": 70, "stop_threshold": 50}).status_code == 422
    assert client.put("/api/farm", json={"timezone": "Mars/Base"}).status_code == 422
    assert client.put("/api/farm", json={"growth_stage": "flowering", "latitude": 22.5, "longitude": 88.3}).json()["growth_stage"] == "flowering"


# ------------------------------------------------------------ predictions
def test_predictions_without_readings_are_unavailable(client):
    p = client.post("/api/predictions/run").json()
    assert p["irrigation"]["status"] == "unavailable" and p["water"]["status"] == "unavailable"


def test_predictions_with_simulated_input(client):
    client.post("/api/simulator/backfill", params={"hours": 30})
    client.post("/api/simulator/tick")
    p = client.post("/api/predictions/run").json()
    assert p["input_source"] == "simulated"
    assert p["irrigation"]["status"] in ("ok", "degraded") and 0 <= p["irrigation"]["probability"] <= 1
    assert p["irrigation"]["explanation"]["drivers"]
    assert p["water"]["litres"] >= 0
    fc = p["forecast"]
    assert [f["horizon_h"] for f in fc["forecasts"]] == [1, 6, 12, 24] and fc["status"] == "ok"
    assert all(0 <= f["soil_moisture"] <= 100 for f in fc["forecasts"])
    assert p["agronomy"]["litres_per_day"] > 0 and "not an ML prediction" in p["agronomy"]["method"]
    hist = client.get("/api/predictions/history").json()["predictions"]
    assert {h["kind"] for h in hist} == {"irrigation", "water", "forecast"}


def test_forecast_degraded_without_history(client):
    post_reading(client)
    use_device(client)
    fc = client.get("/api/predictions/forecast").json()
    assert fc["status"] == "degraded" and "sm_lag_24h" in fc["inputs_missing"]


def test_weather_failure_degrades_gracefully(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no internet")
    monkeypatch.setattr(weather, "_fetch", boom)
    weather._cache.clear()
    client.post("/api/simulator/tick")
    p = client.post("/api/predictions/run").json()
    assert p["weather"]["status"] == "unavailable"
    assert p["irrigation"]["status"] == "degraded" and "rain_6h" in p["irrigation"]["inputs_missing"]
    assert p["agronomy"]["status"] == "unavailable"


def test_model_unavailable_is_honest(client, monkeypatch):
    monkeypatch.delitem(ml.bundles, "irrigation")
    client.post("/api/simulator/tick")
    p = client.post("/api/predictions/run").json()
    assert p["irrigation"]["status"] == "unavailable" and "probability" not in p["irrigation"]


def test_model_performance_and_dataset_endpoints(client):
    m = client.get("/api/models/performance").json()
    assert m["status"] == "ok" and "classification" in m and "forecast" in m
    d = client.get("/api/dataset/info").json()
    assert d["license"] == "CC BY 4.0" and d["doi"].startswith("10.17632")


# ------------------------------------------------------------ pump safety
def test_manual_start_stop_and_history(client):
    assert client.post("/api/irrigation/start", json={"duration_min": 5}).status_code == 200
    st = client.get("/api/irrigation/status").json()["pump"]
    assert st["running"] and st["simulated"] and not st["physical_control_enabled"]
    client.post("/api/irrigation/stop")
    ev = client.get("/api/irrigation/history").json()["events"][0]
    assert ev["simulated"] and not ev["running"] and ev["stop_reason"] == "manual stop"


def test_max_runtime_enforced_even_for_manual(db):
    t0 = utcnow()
    res = controller.start_pump(db, "manual", duration_min=9999, now=t0)
    assert res["planned_minutes"] == 30  # capped by max_pump_runtime_min
    out = controller.control_step(db, now=t0 + timedelta(minutes=31))
    assert out["action"] == "stop" and "maximum runtime" in out["reason"]
    assert not services.get_pump_state(db).running


def test_emergency_stop_blocks_all_starts(client):
    client.post("/api/irrigation/start")
    client.post("/api/irrigation/emergency-stop")
    assert not client.get("/api/irrigation/status").json()["pump"]["running"]
    assert client.post("/api/irrigation/start").status_code == 409
    client.post("/api/irrigation/emergency-reset")
    assert client.post("/api/irrigation/start").status_code == 200


def test_auto_mode_starts_on_dry_soil_and_stops_at_target(client, db):
    post_reading(client, soil_moisture=25.0)
    use_device(client, control_mode="sensor_auto")
    out = client.post("/api/control/evaluate").json()
    assert out["action"] == "start"
    post_reading(client, soil_moisture=65.0)
    out = client.post("/api/control/evaluate").json()
    assert out["action"] == "stop" and "target moisture" in out["reason"]


def test_auto_blocked_by_stale_sensor(client, db):
    post_reading(client, soil_moisture=20.0, timestamp=(utcnow() - timedelta(minutes=60)).isoformat() + "Z")
    use_device(client, control_mode="sensor_auto")
    out = client.post("/api/control/evaluate").json()
    assert out["action"] == "none" and "stale" in out["reason"]
    assert not client.get("/api/irrigation/status").json()["pump"]["running"]


def test_auto_blocked_by_invalid_sensor(client):
    post_reading(client, soil_moisture=-40.0)
    use_device(client, control_mode="sensor_auto")
    out = client.post("/api/control/evaluate").json()
    assert out["action"] == "none" and "invalid" in out["reason"]


def test_running_auto_pump_fails_safe_when_sensor_goes_stale(client, db):
    post_reading(client, soil_moisture=20.0)
    use_device(client, control_mode="sensor_auto", stale_after_min=10)
    assert client.post("/api/control/evaluate").json()["action"] == "start"
    out = controller.control_step(db, now=utcnow() + timedelta(minutes=20))
    assert out["action"] == "stop" and "fail-safe" in out["reason"]


def test_ai_cannot_override_saturation_gate(client):
    post_reading(client, soil_moisture=75.0)
    use_device(client, control_mode="ai_auto")
    out = client.post("/api/control/evaluate").json()
    assert out["action"] != "start"
    assert not client.get("/api/irrigation/status").json()["pump"]["running"]


def test_ai_auto_falls_back_to_sensor_rule_when_ml_down(client, monkeypatch):
    monkeypatch.delitem(ml.bundles, "irrigation")
    post_reading(client, soil_moisture=20.0)
    use_device(client, control_mode="ai_auto")
    out = client.post("/api/control/evaluate").json()
    assert out["action"] == "start" and "ML unavailable" in out["reason"]


def test_ai_recommend_never_actuates(client):
    post_reading(client, soil_moisture=15.0)
    use_device(client, control_mode="ai_recommend")
    out = client.post("/api/control/evaluate").json()
    assert out["action"] == "none" and out["recommendation"] in ("irrigate", "wait", "unavailable")
    assert not client.get("/api/irrigation/status").json()["pump"]["running"]


def test_rest_period_between_runs(client, db):
    post_reading(client, soil_moisture=20.0)
    use_device(client, control_mode="sensor_auto")
    client.post("/api/control/evaluate")
    client.post("/api/irrigation/stop")
    post_reading(client, soil_moisture=20.0)
    out = client.post("/api/control/evaluate").json()
    assert out["action"] == "blocked" and "rest period" in out["reason"]


def test_physical_hardware_stays_disabled(db):
    hardware.set_pump(hardware.Esp32Pump())
    try:
        res = controller.start_pump(db, "manual")
        assert res["started"] is False and "disabled" in res["blocked_by"][0]
    finally:
        hardware.set_pump(hardware.SimulatedPump())


def test_what_if_and_dataset_samples(client):
    body = {"soil_moisture": 30, "air_temp": 25, "humidity": 50, "soil_temp": 22, "hour": 10, "rain_6h": 0, "wind_speed": 5, "solar_radiation": 400}
    r = client.post("/api/predictions/what-if", json=body).json()
    assert 0 <= r["irrigation"]["probability"] <= 1 and r["water"]["litres"] >= 0
    assert r["forecast"]["status"] == "degraded"  # lag inputs not supplied -> honestly flagged
    assert client.post("/api/predictions/what-if", json={**body, "soil_moisture": 150}).status_code == 422
    s = client.get("/api/dataset/samples", params={"table": "reg", "n": 3}).json()
    assert len(s["samples"]) == 3 and "water_l" in s["stats"]
    assert client.get("/api/dataset/samples", params={"table": "x"}).status_code == 422


# ------------------------------------------------------------ user-supplied dataset (batch)
def _csv(rows, header="timestamp,Soil Moisture,Temperature,Humidity,Soil Temperature,Rainfall"):
    return header + chr(10) + chr(10).join(rows)


def test_batch_predicts_with_aliases_and_time_features(client):
    rows = [f"2026-06-01 {h:02d}:00,{50 - h},{20 + h},60,18,0" for h in range(0, 24)]
    r = client.post("/api/predictions/batch", json={"csv": _csv(rows)}).json()
    assert r["summary"]["valid_rows"] == 24 and r["summary"]["invalid_rows"] == 0
    assert r["columns"]["detected"]["soil_moisture"] == "Soil Moisture" and r["columns"]["has_time"]
    p = r["predictions"][12]
    assert 0 <= p["irrigation_probability"] <= 1 and p["litres_if_irrigated"] >= 0 and 0 <= p["forecast_6h"] <= 100
    assert "sm_lag_1h" not in r["features_not_supplied"]["forecast"]  # derived from timestamps


def test_batch_flags_invalid_rows_and_never_predicts_them(client):
    rows = ["2026-06-01 06:00,40,20,60,18,0", "2026-06-01 07:00,999,20,60,18,0", "2026-06-01 08:00,,20,60,18,0"]
    r = client.post("/api/predictions/batch", json={"csv": _csv(rows)}).json()
    assert [x["status"] for x in r["predictions"]] == ["ok", "invalid", "invalid"]
    assert r["predictions"][1]["irrigation_probability"] is None and "soil_moisture" in r["predictions"][1]["reason"]


def test_batch_rejects_missing_columns_and_bad_input(client):
    bad = client.post("/api/predictions/batch", json={"csv": "a,b\n1,2\n3,4\n"})
    assert bad.status_code == 422 and "Required column" in bad.json()["detail"]
    assert client.post("/api/predictions/batch", json={"csv": "short"}).status_code == 422
    big = _csv([f"2026-01-01 00:00,40,20,60,18,0" for _ in range(5001)])
    assert client.post("/api/predictions/batch", json={"csv": big}).status_code == 422


def test_batch_without_timestamp_is_degraded_but_works(client):
    r = client.post("/api/predictions/batch", json={"csv": "moisture,temp,rh,soil_temp\n30,25,50,20\n60,18,70,15\n"}).json()
    assert r["summary"]["valid_rows"] == 2 and not r["columns"]["has_time"]
    assert "sm_lag_1h" in r["features_not_supplied"]["forecast"] and r["columns"]["notes"]


def test_batch_template_endpoint(client):
    t = client.get("/api/predictions/batch/template").json()
    assert client.post("/api/predictions/batch", json={"csv": t["csv"]}).json()["summary"]["invalid_rows"] == 0
