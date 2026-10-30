"""Dataset loading, preprocessing and saved-model checks (uses ml/data/processed and ml/models)."""
import json

import joblib
import numpy as np
import pandas as pd
import pytest
from sklearn.metrics import f1_score

from app import config
from features import CLF_FEATURES, FC_FEATURES, REG_FEATURES, clean_soil_moisture, load_zone

P = config.PROCESSED_DIR


def test_processed_tables_load_and_have_expected_columns():
    clf = pd.read_csv(P / "clf_samples.csv", index_col=0, parse_dates=True)
    reg = pd.read_csv(P / "reg_events.csv", index_col=0, parse_dates=True)
    fc = pd.read_csv(P / "fc_samples.csv", index_col=0, parse_dates=True)
    assert set(CLF_FEATURES + ["irrigate_next_hour"]) <= set(clf.columns) and clf[CLF_FEATURES].notna().all().all()
    assert set(REG_FEATURES + ["water_l"]) <= set(reg.columns) and (reg.water_l > 0).all()
    assert set(FC_FEATURES + ["target_1h", "target_24h"]) <= set(fc.columns)
    assert set(clf["irrigate_next_hour"].unique()) == {0, 1}
    assert clf["soil_moisture"].between(0, 100).all()


def test_manifest_records_source_and_license():
    m = json.loads((P / "dataset_manifest.json").read_text(encoding="utf-8"))
    assert m["license"] == "CC BY 4.0" and m["source"].startswith("https://data.mendeley.com")
    assert m["processed"]["clf_samples.csv"]["rows"] > 0


def test_soil_moisture_cleaning_removes_spikes_and_out_of_range():
    s = pd.Series([30.0] * 6 + [717.0, 30, 30, 95.0, 30, 30, -50.0, 30, 30, 30.0, 30, 30])
    out = clean_soil_moisture(s)
    assert out.max() <= 100 and out.min() >= 0
    assert out.iloc[6] == pytest.approx(30.0) and out.iloc[9] == pytest.approx(30.0)  # spikes replaced by short-gap interpolation


def test_raw_zone_loader_if_present():
    path = config.ML_DIR / "data" / "raw" / "arnesano" / "merged" / "dataset_zone_1.csv"
    if not path.exists():
        pytest.skip("raw dataset not downloaded")
    z = load_zone(path, 1)
    assert z.index.is_monotonic_increasing and z["soil_moisture"].dropna().between(0, 100).all()


def test_saved_classifier_reproduces_reported_f1():
    rep = json.loads((config.REPORTS_DIR / "metrics.json").read_text(encoding="utf-8"))["classification"]
    b = joblib.load(config.MODELS_DIR / "irrigation_classifier.joblib")
    d = pd.read_csv(P / "clf_samples.csv", index_col=0, parse_dates=True).sort_index()
    te = d[d.index >= pd.Timestamp(rep["split"]["cutoff"])]
    f1 = f1_score(te["irrigate_next_hour"], b["model"].predict(te[CLF_FEATURES]))
    assert f1 == pytest.approx(rep["metrics_test"][b["name"]]["f1"], abs=1e-3)


def test_model_predictions_shapes_and_ranges():
    b = joblib.load(config.MODELS_DIR / "irrigation_classifier.joblib")
    X = pd.DataFrame([{f: 30.0 for f in CLF_FEATURES}])
    p = b["model"].predict_proba(X)[0, 1]
    assert 0 <= p <= 1
    r = joblib.load(config.MODELS_DIR / "water_regressor.joblib")
    assert np.isfinite(r["model"].predict(pd.DataFrame([{f: 30.0 for f in REG_FEATURES}]))[0])
    f = joblib.load(config.MODELS_DIR / "moisture_forecaster.joblib")
    assert sorted(f["models"]) == [1, 6, 12, 24]
