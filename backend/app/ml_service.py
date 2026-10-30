"""Loads the trained models once at startup and exposes prediction + explanation helpers.

If a model file is missing the corresponding call returns {"status": "unavailable"} - never a made-up value.
"""
import json
import logging

import joblib
import numpy as np
import pandas as pd

from . import config
from features import FEATURE_LABELS

log = logging.getLogger("ml")
FILES = {"irrigation": "irrigation_classifier.joblib", "water": "water_regressor.joblib",
         "forecast": "moisture_forecaster.joblib"}


class MLService:
    def __init__(self):
        self.bundles: dict[str, dict] = {}
        self.errors: dict[str, str] = {}
        self.metrics: dict | None = None

    def load(self):
        for key, fname in FILES.items():
            path = config.MODELS_DIR / fname
            try:
                b = joblib.load(path)
                est = b["model"][-1] if hasattr(b.get("model"), "steps") else None
                if est is not None and hasattr(est, "n_jobs"):
                    est.n_jobs = 1  # single-row requests: thread fan-out only adds latency
                self.bundles[key] = b
            except Exception as exc:
                self.errors[key] = f"{fname}: {exc.__class__.__name__}"
                log.warning("model %s unavailable (%s)", key, exc)
        try:
            self.metrics = json.loads((config.REPORTS_DIR / "metrics.json").read_text(encoding="utf-8"))
        except Exception:
            self.metrics = None

    def availability(self) -> dict:
        return {k: {"available": k in self.bundles, "error": self.errors.get(k),
                    "algorithm": self.bundles[k].get("name") if k in self.bundles else None} for k in FILES}

    @staticmethod
    def _frame(bundle, x: dict) -> tuple[pd.DataFrame, list[str]]:
        row = {f: (np.nan if x.get(f) is None else float(x[f])) for f in bundle["features"]}
        missing = [f for f, v in row.items() if np.isnan(v)]
        return pd.DataFrame([row]), missing

    @staticmethod
    def _occlusion(predict, X: pd.DataFrame, medians: dict, top=5) -> list[dict]:
        """Effect on the output of replacing each feature with its training median (local, model-agnostic)."""
        base = float(predict(X)[0])
        out = []
        for f in X.columns:
            if np.isnan(X.at[0, f]):
                continue
            X2 = X.copy()
            X2.at[0, f] = medians[f]
            out.append({"feature": f, "label": FEATURE_LABELS.get(f, f), "value": round(float(X.at[0, f]), 3),
                        "training_median": round(float(medians[f]), 3), "effect": round(base - float(predict(X2)[0]), 4)})
        out.sort(key=lambda d: abs(d["effect"]), reverse=True)
        return out[:top]

    def predict_irrigation(self, x: dict) -> dict:
        b = self.bundles.get("irrigation")
        if not b:
            return {"status": "unavailable", "reason": self.errors.get("irrigation", "model not loaded")}
        X, missing = self._frame(b, x)
        if np.isnan(X.at[0, "soil_moisture"]):
            return {"status": "unavailable", "reason": "soil moisture reading required"}
        proba = lambda d: b["model"].predict_proba(d)[:, 1]
        p = float(proba(X)[0])
        return {"status": "degraded" if missing else "ok", "irrigate": bool(p >= b["threshold"]), "probability": round(p, 4),
                "threshold": b["threshold"], "model": b["name"], "inputs_missing": missing,
                "question": "Will irrigation be needed (valve opening) within the next hour?",
                "explanation": {"method": "occlusion vs training median (effect on probability)",
                                "drivers": self._occlusion(proba, X, b["medians"])}}

    def predict_water(self, x: dict) -> dict:
        b = self.bundles.get("water")
        if not b:
            return {"status": "unavailable", "reason": self.errors.get("water", "model not loaded")}
        X, missing = self._frame(b, x)
        if np.isnan(X.at[0, "soil_moisture"]):
            return {"status": "unavailable", "reason": "soil moisture reading required"}
        pred = lambda d: b["model"].predict(d)
        v = float(pred(X)[0])
        return {"status": "degraded" if missing else "ok", "litres": round(max(v, 0.0), 1), "model": b["name"],
                "inputs_missing": missing, "training_range_l": [round(b["train_min_l"], 1), round(b["train_max_l"], 1)],
                "explanation": {"method": "occlusion vs training median (effect on litres)",
                                "drivers": self._occlusion(pred, X, b["medians"])}}

    def predict_forecast(self, x: dict) -> dict:
        b = self.bundles.get("forecast")
        if not b:
            return {"status": "unavailable", "reason": self.errors.get("forecast", "model not loaded")}
        X, missing = self._frame(b, x)
        if np.isnan(X.at[0, "soil_moisture"]):
            return {"status": "unavailable", "reason": "soil moisture reading required"}
        mets = ((self.metrics or {}).get("forecast") or {}).get("metrics_test", {})
        out = []
        for h in b["horizons_h"]:
            v = float(np.clip(b["models"][h].predict(X)[0], 0, 100))
            m = mets.get(f"{h}h", {})
            out.append({"horizon_h": h, "soil_moisture": round(v, 2),
                        "test_mae": (m.get("model") or {}).get("mae"), "test_rows": m.get("test_rows")})
        return {"status": "degraded" if missing else "ok", "forecasts": out, "inputs_missing": missing,
                "assumptions": ["Future weather and future irrigation are unknown to the model.",
                                "Values are model predictions, not observations; test_mae is the typical held-out error."]}


ml = MLService()
