"""Build model-ready tables from the raw Arnesano dataset (no synthetic rows are created).

Outputs (ml/data/processed): clf_samples.csv, reg_events.csv, fc_samples.csv, dataset_manifest.json
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from features import (CLF_FEATURES, FC_FEATURES, HORIZONS_H, REG_FEATURES, STEP_MIN,  # noqa: E402
                      TOMATO_SECTORS, add_history_features, load_zone)

RAW = ROOT / "data" / "raw" / "arnesano"
OUT = ROOT / "data" / "processed"
FLOW_L_PER_MIN = 1.1  # nominal flow of field valves (raw_nominal_flow_rates.csv)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    zones = {s: add_history_features(load_zone(RAW / "merged" / f"dataset_zone_{s}.csv", s)) for s in TOMATO_SECTORS}
    events = pd.read_csv(RAW / "final_irrigation_events.csv", parse_dates=["start", "end"])

    clf, fc = [], []
    for s, df in zones.items():
        n6 = int(60 / STEP_MIN)
        future = sum(df["irr_min"].shift(-k) for k in range(1, n6 + 1))
        # Model A: valve currently closed; label = irrigation starts within the next hour
        a = df.copy()
        a["irrigate_next_hour"] = (future > 0).astype(int)
        ev = events[(events.sector == s) & (events.type == "standard_irrigation")]
        # only the window in which irrigation events were logged: afterwards "no irrigation" is not a valid negative label
        lo, hi = ev.start.min() - pd.Timedelta(hours=6), ev.end.max()
        a = a[(a.index >= lo) & (a.index <= hi - pd.Timedelta(hours=1))]
        a = a[(a["irr_min"] == 0) & a["soil_moisture"].notna()]
        clf.append(a.dropna(subset=CLF_FEATURES + ["irrigate_next_hour"]))
        # Model C: observed future soil moisture at exact timestamp offsets
        c = df.copy()
        for h in HORIZONS_H:
            c[f"target_{h}h"] = df["soil_moisture"].shift(-int(h * 60 / STEP_MIN))
        c = c[c["soil_moisture"].notna()]
        c = c.dropna(subset=["sm_lag_1h", "rain_24h"])
        fc.append(c)
    clf = pd.concat(clf)
    fc = pd.concat(fc)

    # Model B: one row per validated standard irrigation event; label = valve-open time x nominal flow
    rows = []
    for _, e in events[(events.type == "standard_irrigation") & events.sector.isin(TOMATO_SECTORS)].iterrows():
        df = zones[int(e.sector)]
        before = e.start.floor("10min") - pd.Timedelta(minutes=STEP_MIN)  # state just before the valve opens
        if before not in df.index:
            continue
        r = df.loc[before].to_dict()
        r.update(soil_moisture=e.initial_humidity,  # sensor reading at valve opening (dataset)
                 start=e.start, sector=int(e.sector), stop_reason=e.stop_reason,
                 duration_min=e.duration_hours * 60, water_l=e.duration_hours * 60 * FLOW_L_PER_MIN)
        rows.append(r)
    reg = pd.DataFrame(rows).dropna(subset=REG_FEATURES + ["water_l"])
    reg["hours_since_irrigation"] = reg["hours_since_irrigation"].clip(upper=240)

    clf[["sector"] + CLF_FEATURES + ["irrigate_next_hour"]].to_csv(OUT / "clf_samples.csv")
    reg.set_index("start")[["sector"] + REG_FEATURES + ["stop_reason", "duration_min", "water_l"]].to_csv(OUT / "reg_events.csv")
    fc[["sector"] + FC_FEATURES + [f"target_{h}h" for h in HORIZONS_H]].to_csv(OUT / "fc_samples.csv")

    manifest = {
        "name": "Soil Moisture, Irrigation Actuator and Weather Dataset from a Multi-Sector Precision-Irrigation",
        "source": "https://data.mendeley.com/datasets/c837v6p8ph/2",
        "doi": "10.17632/c837v6p8ph.2",
        "license": "CC BY 4.0",
        "authors": "Adamo, Colizzi, Dimauro, Guerriero, Lomonte (University of Salento / University of Bari)",
        "location": "Arnesano (Lecce, Apulia, Italy); 2025-02 to 2025-09",
        "raw_path": "ml/data/raw/arnesano",
        "files_used": ["merged/dataset_zone_1.csv", "merged/dataset_zone_2.csv", "final_irrigation_events.csv"],
        "sectors_used": "1 and 2 (open-field tomato, same soil model)",
        "sectors_excluded": {"3": "potted tomato; probe returned mostly invalid readings (median 0%)",
                             "4": "zucchini", "5": "blueberry"},
        "weather_source": "Open-Meteo ERA5 reanalysis (weather columns inside the dataset)",
        "raw_grid_rows_per_sector": 33259,
        "processed": {
            "clf_samples.csv": {"rows": int(len(clf)), "positive_rate": round(float(clf.irrigate_next_hour.mean()), 4),
                                "features": CLF_FEATURES, "target": "irrigate_next_hour (valve opens within next 60 min)"},
            "reg_events.csv": {"rows": int(len(reg)), "features": REG_FEATURES,
                               "target": "water_l = valve-open minutes x 1.1 L/min nominal flow"},
            "fc_samples.csv": {"rows": int(len(fc)), "features": FC_FEATURES,
                               "targets": [f"target_{h}h" for h in HORIZONS_H]},
        },
        "caveats": [
            "Irrigation events were reconstructed by the dataset authors from valve telemetry; the farm used threshold-based control (start 40%, stop 60%) so labels reflect that policy, not a crop-physiology optimum.",
            "Water volume is valve-open time x nominal flow rate, not a flow-meter reading.",
            "Soil moisture is a relative probe output (0-100 scale), so live probes must be calibrated to the same scale.",
            "Air temperature, humidity, soil temperature and wind/radiation in the dataset are ERA5 reanalysis values, not on-site sensors.",
            "Crop growth-stage labels do not exist in the dataset, so growth stage is not an ML feature.",
        ],
    }
    (OUT / "dataset_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print({k: v["rows"] for k, v in manifest["processed"].items()}, "positive rate", manifest["processed"]["clf_samples.csv"]["positive_rate"])


if __name__ == "__main__":
    main()
