"""Batch predictions for a user-supplied CSV. Nothing is stored; rows with impossible values are reported, never predicted."""
import io
import math
import re

import numpy as np
import pandas as pd

from .ml_service import MLService
from .services import LIMITS

MAX_ROWS = 5000
MAX_CHARS = 3_000_000

# canonical name -> accepted column names (after lower-casing and replacing spaces/dashes with "_")
ALIASES = {
    "soil_moisture": ["soil_moisture", "moisture", "soilmoisture", "sm", "soil_moisture_pct", "soil_moisture_percent", "soil_humidity", "humidity_percentage"],
    "air_temp": ["air_temp", "air_temperature", "temperature", "temp", "temperature_c", "airtemp"],
    "humidity": ["humidity", "air_humidity", "relative_humidity", "rh", "humidity_pct"],
    "soil_temp": ["soil_temp", "soil_temperature", "soiltemp", "soil_temperature_c"],
    "timestamp": ["timestamp", "time", "datetime", "date_time", "date", "ts"],
    "rain": ["rainfall", "rain", "precipitation", "rain_mm"],
    "wind_speed": ["wind_speed", "wind", "windspeed"],
    "solar_radiation": ["solar_radiation", "radiation", "solar", "shortwave_radiation"],
    "irrigation_minutes": ["irrigation_minutes", "irrigated_min", "pump_minutes", "irrigation_duration_minutes"],
}
REQUIRED = ["soil_moisture", "air_temp", "humidity", "soil_temp"]
TEMPLATE = ("timestamp,soil_moisture,air_temp,humidity,soil_temp,rainfall,wind_speed,solar_radiation,irrigation_minutes\n"
            "2026-06-01 06:00,48.2,19.5,72,18.1,0,6,40,0\n2026-06-01 07:00,46.9,21.0,66,18.6,0,8,180,0\n"
            "2026-06-01 08:00,45.1,23.4,58,19.4,0,9,350,0\n2026-06-01 09:00,43.0,25.8,50,20.5,0,10,520,0\n"
            "2026-06-01 10:00,41.2,27.9,45,21.7,0,11,660,0\n")


class BatchError(ValueError):
    pass


def _norm(c: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(c).strip().lower()).strip("_")


def _map_columns(cols) -> tuple[dict, list]:
    normalized = {c: _norm(c) for c in cols}
    found, used = {}, set()
    for canon, names in ALIASES.items():
        for n in names:
            hit = next((c for c, nc in normalized.items() if nc == n and c not in used), None)
            if hit is not None:
                found[canon] = hit
                used.add(hit)
                break
    return found, [c for c in cols if c not in used]


def _num(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce")


def build_features(raw: pd.DataFrame, flow_l_per_min: float) -> tuple[pd.DataFrame, dict]:
    found, ignored = _map_columns(list(raw.columns))
    missing = [r for r in REQUIRED if r not in found]
    if missing:
        raise BatchError(f"Required column(s) not found: {', '.join(missing)}. Detected columns: {', '.join(map(str, raw.columns))}. "
                         "Rename your columns or download the template.")
    df = pd.DataFrame({k: _num(raw[v]) for k, v in found.items() if k != "timestamp"})
    df["row"] = np.arange(1, len(raw) + 1)
    notes = []

    ts = None
    if "timestamp" in found:
        parsed = pd.to_datetime(raw[found["timestamp"]], errors="coerce", utc=False)
        if getattr(parsed.dt, "tz", None) is not None:
            parsed = parsed.dt.tz_localize(None)
        if parsed.notna().mean() >= 0.5:
            ts = parsed
        else:
            notes.append("Timestamp column could not be read as dates, so time-based features (hour, lags, rain totals) were skipped.")
    if ts is not None:
        df["ts"] = ts
        df = df.sort_values("ts", kind="stable").reset_index(drop=True)
        h = df["ts"].dt.hour + df["ts"].dt.minute / 60
        df["hour_sin"], df["hour_cos"] = np.sin(2 * np.pi * h / 24), np.cos(2 * np.pi * h / 24)
        ok = df["ts"].notna() & df["soil_moisture"].notna()
        ref = df.loc[ok, ["ts", "soil_moisture"]].sort_values("ts")
        for lag in (1, 3, 6, 24):
            target = (df["ts"] - pd.Timedelta(hours=lag)).rename("target")
            q = pd.DataFrame({"target": target, "i": df.index}).dropna().sort_values("target")
            m = pd.merge_asof(q, ref.rename(columns={"ts": "target", "soil_moisture": f"sm_lag_{lag}h"}), on="target",
                              direction="nearest", tolerance=pd.Timedelta(minutes=20))
            df[f"sm_lag_{lag}h"] = m.set_index("i")[f"sm_lag_{lag}h"]
        series = df.set_index("ts")
        series = series[series.index.notna()]
        if "rain" in df:
            for w in (6, 24):
                df[f"rain_{w}h"] = series["rain"].fillna(0).rolling(f"{w}h").sum().to_numpy()[: len(df)] if len(series) == len(df) else np.nan
        if "irrigation_minutes" in df:
            irr = series["irrigation_minutes"].fillna(0)
            for w in (1, 6, 24):
                df[f"irrigated_min_{w}h"] = irr.rolling(f"{w}h").sum().to_numpy() if len(irr) == len(df) else np.nan
            df["irrigated_l_24h"] = df["irrigated_min_24h"] * flow_l_per_min
            last = df["ts"].where(df["irrigation_minutes"].fillna(0) > 0).ffill()
            df["hours_since_irrigation"] = ((df["ts"] - last).dt.total_seconds() / 3600).fillna(240).clip(upper=240)
    else:
        if "rain" in found:
            notes.append("Rainfall needs a timestamp column to compute 6 h / 24 h totals, so it was ignored.")
        if "irrigation_minutes" in found:
            notes.append("Irrigation minutes need a timestamp column to compute recent-irrigation features, so they were ignored.")
        notes.append("No timestamp: hour of day and past-moisture (lag) features are unknown, so the forecast is less reliable.")
    return df, {"detected": {k: str(v) for k, v in found.items()}, "ignored_columns": [str(c) for c in ignored], "notes": notes,
                "has_time": ts is not None}


def _validate(df: pd.DataFrame) -> pd.Series:
    reasons = pd.Series("", index=df.index, dtype=object)
    for k, (lo, hi) in LIMITS.items():
        bad = df[k].isna() | ~df[k].between(lo, hi)
        reasons = reasons.where(~bad | (reasons != ""), f"{k} missing or outside [{lo:g}, {hi:g}]")
    return reasons


def _clean(v):
    return None if v is None or (isinstance(v, float) and not math.isfinite(v)) else v


def run(ml: MLService, csv_text: str, flow_l_per_min: float) -> dict:
    if len(csv_text) > MAX_CHARS:
        raise BatchError(f"File too large (limit {MAX_CHARS // 1_000_000} MB).")
    try:
        raw = pd.read_csv(io.StringIO(csv_text), sep=None, engine="python")
    except Exception as exc:
        raise BatchError(f"Could not read the file as CSV: {str(exc)[:120]}")
    if raw.empty:
        raise BatchError("The file has no data rows.")
    if len(raw) > MAX_ROWS:
        raise BatchError(f"Too many rows ({len(raw)}); the limit is {MAX_ROWS}.")

    df, info = build_features(raw, flow_l_per_min)
    reasons = _validate(df)
    valid = reasons == ""
    out = pd.DataFrame({"row": df["row"], "timestamp": df["ts"].dt.strftime("%Y-%m-%d %H:%M") if "ts" in df else None,
                        "soil_moisture": df["soil_moisture"], "status": np.where(valid, "ok", "invalid"), "reason": reasons})
    availability = {k: k in ml.bundles for k in ("irrigation", "water", "forecast")}
    absent = {}

    def frame(bundle):
        X = df.loc[valid].reindex(columns=bundle["features"])
        return X

    if valid.any():
        if availability["irrigation"]:
            b = ml.bundles["irrigation"]
            X = frame(b)
            p = b["model"].predict_proba(X)[:, 1]
            out.loc[valid, "irrigation_probability"] = p
            out.loc[valid, "irrigate"] = p >= b["threshold"]
            absent["irrigation"] = [f for f in b["features"] if X[f].isna().all()]
        if availability["water"]:
            b = ml.bundles["water"]
            X = frame(b)
            out.loc[valid, "litres_if_irrigated"] = np.clip(b["model"].predict(X), 0, None)
            absent["water"] = [f for f in b["features"] if X[f].isna().all()]
        if availability["forecast"]:
            b = ml.bundles["forecast"]
            X = frame(b)
            for h in b["horizons_h"]:
                out.loc[valid, f"forecast_{h}h"] = np.clip(b["models"][h].predict(X), 0, 100)
            absent["forecast"] = [f for f in b["features"] if X[f].isna().all()]

    for c in out.columns:
        if c not in ("row", "timestamp", "status", "reason"):
            out[c] = out[c].astype(float).round(3) if out[c].dtype != object else out[c]
    if "irrigate" in out:
        out["irrigate"] = out["irrigate"].map(lambda v: None if pd.isna(v) else bool(v))
    records = [{k: _clean(v) for k, v in r.items()} for r in out.to_dict(orient="records")]

    n_ok = int(valid.sum())
    summary = {"rows": int(len(df)), "valid_rows": n_ok, "invalid_rows": int(len(df) - n_ok)}
    if n_ok and "irrigate" in out:
        yes = out.loc[valid, "irrigate"].astype(bool)
        summary.update(irrigate_yes=int(yes.sum()), irrigate_no=int((~yes).sum()),
                       mean_probability=round(float(out.loc[valid, "irrigation_probability"].mean()), 4))
    if n_ok and "litres_if_irrigated" in out:
        summary["mean_litres"] = round(float(out.loc[valid, "litres_if_irrigated"].mean()), 1)
    return {"summary": summary, "columns": info, "models_available": availability,
            "features_not_supplied": absent, "predictions": records,
            "disclaimer": ("Predictions come from models trained on one farm's data; inputs you did not supply are replaced by typical training values. "
                           "Irrigation probability answers 'will irrigation start within an hour' for moments when the valve is closed. "
                           "Litres are for one irrigation event if irrigating at that moment. Forecast columns are moisture % at +1/+6/+12/+24 h "
                           "and are far more reliable when timestamps allow past-moisture features.")}
