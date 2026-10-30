"""Train and evaluate the three models on ml/data/processed (chronological train/test splits, no tuning search).

Outputs: ml/models/{irrigation_classifier,water_regressor,moisture_forecaster}.joblib and ml/reports/metrics.json
"""
import json
import warnings
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import (GradientBoostingRegressor, HistGradientBoostingClassifier,
                              HistGradientBoostingRegressor, RandomForestClassifier, RandomForestRegressor)
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score, mean_absolute_error,
                             precision_score, r2_score, recall_score, roc_auc_score)
from sklearn.pipeline import make_pipeline

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from features import CLF_FEATURES, FC_FEATURES, FEATURE_LABELS, HORIZONS_H, REG_FEATURES  # noqa: E402

PROC, MODELS, REPORTS = ROOT / "data" / "processed", ROOT / "models", ROOT / "reports"
SEED = 42
warnings.filterwarnings("ignore", message=".*delayed.*")
rmse = lambda y, p: float(np.sqrt(np.mean((np.asarray(y) - np.asarray(p)) ** 2)))


def split_by_time(df, frac):
    df = df.sort_index()
    cut = df.index[int(len(df) * frac)]
    return df[df.index < cut], df[df.index >= cut], cut


def top_importance(model, X, y, feats, n=8):
    imp = permutation_importance(model, X, y, n_repeats=5, random_state=SEED, n_jobs=1).importances_mean
    order = np.argsort(imp)[::-1][:n]
    return [{"feature": feats[i], "label": FEATURE_LABELS.get(feats[i], feats[i]), "importance": round(float(imp[i]), 5)} for i in order]


def train_classifier():
    d = pd.read_csv(PROC / "clf_samples.csv", index_col=0, parse_dates=True)
    d = d.sort_index()
    cut = d.index[d["irrigate_next_hour"].to_numpy().nonzero()[0][int(0.7 * d["irrigate_next_hour"].sum())]]  # 70% of irrigation starts before cut
    tr, te = d[d.index < cut], d[d.index >= cut]
    Xtr, ytr, Xte, yte = tr[CLF_FEATURES], tr["irrigate_next_hour"], te[CLF_FEATURES], te["irrigate_next_hour"]
    cands = {
        "RandomForest": make_pipeline(SimpleImputer(strategy="median"), RandomForestClassifier(
            n_estimators=300, min_samples_leaf=5, class_weight="balanced_subsample", random_state=SEED, n_jobs=-1)),
        "HistGradientBoosting": make_pipeline(SimpleImputer(strategy="median"), HistGradientBoostingClassifier(
            max_iter=200, learning_rate=0.05, max_depth=4, class_weight="balanced", random_state=SEED)),
    }

    def metrics(y, pred, proba=None):
        m = {"accuracy": accuracy_score(y, pred), "precision": precision_score(y, pred, zero_division=0),
             "recall": recall_score(y, pred, zero_division=0), "f1": f1_score(y, pred, zero_division=0),
             "confusion_matrix": confusion_matrix(y, pred, labels=[0, 1]).tolist()}
        if proba is not None and y.nunique() > 1:
            m["roc_auc"] = roc_auc_score(y, proba)
        return {k: (round(float(v), 4) if not isinstance(v, list) else v) for k, v in m.items()}

    results, fitted = {}, {}
    for name, p in cands.items():
        p.fit(Xtr, ytr)
        results[name] = metrics(yte, p.predict(Xte), p.predict_proba(Xte)[:, 1])
        fitted[name] = p
    # Reference: the farm's own start rule (soil moisture below 40%) -- not a trained model
    results["Rule: moisture < 40% (reference)"] = metrics(yte, (Xte["soil_moisture"] < 40).astype(int))
    best = max(cands, key=lambda n: results[n]["f1"])
    med = Xtr.median().to_dict()
    bundle = {"model": fitted[best], "features": CLF_FEATURES, "medians": med, "name": best, "threshold": 0.5}
    joblib.dump(bundle, MODELS / "irrigation_classifier.joblib")
    return {
        "task": "Irrigation classification: will the valve open within the next 60 min (given it is closed now)?",
        "selected": best, "compared": list(cands),
        "split": {"type": "chronological", "train_rows": len(tr), "test_rows": len(te), "cutoff": str(cut),
                  "train_positives": int(ytr.sum()), "test_positives": int(yte.sum())},
        "metrics_test": results, "feature_importance": top_importance(fitted[best], Xte, yte, CLF_FEATURES),
        "features": CLF_FEATURES,
        "notes": "Positive class = irrigation start. Labels follow the farm's threshold-based controller (start 40%, stop 60%).",
    }


def train_regressor():
    d = pd.read_csv(PROC / "reg_events.csv", index_col=0, parse_dates=True)
    tr, te, cut = split_by_time(d, 0.75)
    Xtr, ytr, Xte, yte = tr[REG_FEATURES], tr["water_l"], te[REG_FEATURES], te["water_l"]
    cands = {
        "RandomForest": make_pipeline(SimpleImputer(strategy="median"), RandomForestRegressor(
            n_estimators=300, min_samples_leaf=3, random_state=SEED, n_jobs=-1)),
        "GradientBoosting": make_pipeline(SimpleImputer(strategy="median"), GradientBoostingRegressor(
            n_estimators=150, learning_rate=0.05, max_depth=2, subsample=0.8, random_state=SEED)),
    }
    ev = lambda p: {"mae_l": round(float(mean_absolute_error(yte, p)), 3), "rmse_l": round(rmse(yte, p), 3),
                    "r2": round(float(r2_score(yte, p)), 4)}
    results, fitted = {}, {}
    for name, p in cands.items():
        p.fit(Xtr, ytr)
        results[name] = ev(p.predict(Xte))
        fitted[name] = p
    results["Baseline: training mean (reference)"] = ev(np.full(len(yte), ytr.mean()))
    best = max(cands, key=lambda n: results[n]["r2"])
    bundle = {"model": fitted[best], "features": REG_FEATURES, "medians": Xtr.median().to_dict(), "name": best,
              "train_min_l": float(ytr.min()), "train_max_l": float(ytr.max())}
    joblib.dump(bundle, MODELS / "water_regressor.joblib")
    return {
        "task": "Water requirement per irrigation event (litres per zone) from conditions at valve opening",
        "selected": best, "compared": list(cands),
        "split": {"type": "chronological", "train_rows": len(tr), "test_rows": len(te), "cutoff": str(cut)},
        "metrics_test": results, "feature_importance": top_importance(fitted[best], Xte, yte, REG_FEATURES),
        "features": REG_FEATURES, "target_range_l": [round(float(d.water_l.min()), 1), round(float(d.water_l.max()), 1)],
        "notes": "Labels are valve-open time x 1.1 L/min nominal flow (not flow-meter readings). Small sample: interpret R2 with caution.",
    }


def train_forecaster():
    d = pd.read_csv(PROC / "fc_samples.csv", index_col=0, parse_dates=True)
    d = d.sort_index()
    # Irrigation was logged only until July and moisture is flat afterwards, so the test set is the last 30% of the
    # *active season* (before LATE); the flat late season (>= LATE) is used for training only.
    LATE = pd.Timestamp("2025-07-15")
    active = d[d.index < LATE]
    cut = active.index[int(len(active) * 0.7)]
    models, results = {}, {}
    for h in HORIZONS_H:
        col = f"target_{h}h"
        s = d.dropna(subset=[col])
        # blocked split: hold out the last 30% of the active season; the flat late season stays in training
        tr, te = s[(s.index < cut) | (s.index >= LATE)], s[(s.index >= cut) & (s.index < LATE)]
        m = HistGradientBoostingRegressor(max_iter=250, learning_rate=0.05, max_depth=5, min_samples_leaf=20, random_state=SEED)
        m.fit(tr[FC_FEATURES], tr[col])
        p = np.clip(m.predict(te[FC_FEATURES]), 0, 100)
        pers = te["soil_moisture"].values
        results[f"{h}h"] = {
            "model": {"mae": round(float(mean_absolute_error(te[col], p)), 3), "rmse": round(rmse(te[col], p), 3)},
            "persistence_baseline": {"mae": round(float(mean_absolute_error(te[col], pers)), 3), "rmse": round(rmse(te[col], pers), 3)},
            "train_rows": len(tr), "test_rows": len(te),
        }
        models[h] = m
    joblib.dump({"models": models, "name": "HistGradientBoosting", "features": FC_FEATURES, "medians": d[FC_FEATURES].median().to_dict(),
                 "horizons_h": HORIZONS_H}, MODELS / "moisture_forecaster.joblib")
    return {
        "task": "Soil-moisture forecast at +1/+6/+12/+24 h from lagged moisture, past irrigation and current weather",
        "algorithm": "HistGradientBoostingRegressor (one model per horizon); baseline = persistence (moisture stays unchanged)",
        "split": {"type": "chronological", "cutoff": str(cut), "test": f"{cut:%Y-%m-%d} to {LATE:%Y-%m-%d} (held-out end of active season); rows from {LATE:%Y-%m-%d} onward are training-only"},
        "metrics_test": results, "features": FC_FEATURES,
        "notes": "Future weather and future irrigation are NOT inputs: forecasts assume neither is known and reflect typical behaviour in the training season.",
    }


def main():
    MODELS.mkdir(exist_ok=True)
    REPORTS.mkdir(exist_ok=True)
    report = {
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "environment": {"python": platform.python_version(), "scikit-learn": sklearn.__version__,
                        "pandas": pd.__version__, "numpy": np.__version__, "random_seed": SEED},
        "dataset": json.loads((PROC / "dataset_manifest.json").read_text(encoding="utf-8")),
        "classification": train_classifier(),
        "water_regression": train_regressor(),
        "forecast": train_forecaster(),
    }
    (REPORTS / "metrics.json").write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    c, r, f = report["classification"], report["water_regression"], report["forecast"]
    print("A", c["selected"], json.dumps(c["metrics_test"], default=str)[:900])
    print("B", r["selected"], json.dumps(r["metrics_test"]))
    print("C", json.dumps({k: [v["model"], v["persistence_baseline"], v["test_rows"]]  for k, v in f["metrics_test"].items()}))
    print(c["split"])


if __name__ == "__main__":
    main()
