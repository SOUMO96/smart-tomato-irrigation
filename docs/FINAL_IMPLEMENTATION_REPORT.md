# Final Implementation Report

## 1. Dataset (verified)
| Item | Value |
|---|---|
| Name | Soil Moisture, Irrigation Actuator and Weather Dataset from a Multi-Sector Precision-Irrigation |
| Source | Mendeley Data, DOI 10.17632/c837v6p8ph.2 (https://data.mendeley.com/datasets/c837v6p8ph/2), published 2026-09-14 |
| Licence | CC BY 4.0 (attribution required; changes indicated) |
| Site / period | Arnesano (Lecce, Italy), Feb–Sep 2025; 10-min grid, 33,259 rows per sector |
| Used | Sectors 1 & 2 (open-field tomato, same soil model). Excluded: sector 3 (potted tomato; probe mostly invalid, median 0 %), 4 (zucchini), 5 (blueberry) |
| Files | `merged/dataset_zone_{1,2}.csv`, `final_irrigation_events.csv` (789 validated events, 176 standard irrigations in sectors 1–2), README, data dictionary |
| Water label | Valve-open time × nominal flow (1.1 L/min). **Not flow-meter data.** Events were reconstructed by the dataset authors from valve telemetry |
| Weather columns | ERA5 reanalysis via Open-Meteo (air temp, humidity, rain, wind, direct radiation, soil temp) — not on-site sensors |

Search effort: 3 targeted searches; 1 candidate inspected in depth (Arnesano multi-sector dataset — selected; its metadata, licence, data dictionary and files were checked). The Parma tomato irrigation-regimes dataset (35wh56287y) was only identified from search results and not inspected or used.
**"EcoIrrigate" could not be found** on Mendeley/Kaggle/Zenodo in the search; no dataset by that name was used. No data were fabricated or synthesised for training.
The bulk download endpoint returned a truncated zip stream (missing the pre-processed layer and zone 4); `ml/scripts/download_dataset.py` parses the stream tolerantly and keeps only the files needed. This is why the dataset's own `preprocessed/` tables were not used — targets are rebuilt from the merged layer with exact timestamp offsets (the dataset README itself warns its 144-row "24 h" horizon is not always 24 h).

Key data finding: irrigation events were logged only until early July, while most valid tomato soil-moisture readings (Jul–Sep) are a flat, dry period with no irrigation. Training windows were therefore restricted to each sector's logged-irrigation period for the classifier; for forecasting, the last 30 % of the active season is the test set.

Processed tables: `clf_samples.csv` (3,398 rows, 6.4 % positive), `reg_events.csv` (176 events), `fc_samples.csv` (17,129 rows).

## 2. Models and measured results (chronological held-out test sets; seed 42; no hyper-parameter search)
**A. Irrigation classification** — "will the valve open within 60 min (given it is closed now)?" Train 1,984 rows (151 starts) / test 1,414 rows (66 starts), cut 2025-06-18.

| Model | Accuracy | Precision | Recall | F1 | ROC-AUC | Confusion [[TN,FP],[FN,TP]] |
|---|---|---|---|---|---|---|
| **Random Forest (selected)** | 0.880 | 0.162 | 0.379 | 0.227 | 0.758 | [[1219,129],[41,25]] |
| HistGradientBoosting | 0.811 | 0.118 | 0.470 | 0.188 | 0.737 | [[1116,232],[35,31]] |
| Reference rule: moisture < 40 % | 0.929 | 0.157 | 0.121 | 0.137 | – | [[1305,43],[58,8]] |

Interpretation: skill is **weak but above the simple threshold rule on F1/recall**; accuracy is misleading because 95 % of rows are negatives (the rule's higher accuracy comes from rarely predicting "yes"). Labels reflect the farm's threshold controller (start 40 %, stop 60 %, 06:00–18:00 window), not a crop-physiology optimum. Treat the output as advisory.

**B. Water requirement regression** — litres per irrigation event. Train 132 / test 44 events.

| Model | MAE (L) | RMSE (L) | R² |
|---|---|---|---|
| **Random Forest (selected)** | 57.3 | 62.9 | 0.034 |
| Gradient Boosting | 59.7 | 66.1 | −0.070 |
| Training-mean baseline | 84.2 | 94.6 | −1.19 |

Interpretation: beats the mean baseline on error but explains essentially none of the variance (R² ≈ 0.03; event range 18.5–568.9 L). With 176 events, event length is dominated by controller rules (stop at 60 % or 18:00) rather than conditions. **Do not rely on this number for scheduling**; the separate FAO-56 calculation is provided alongside it.

**C. Soil-moisture forecast** — HistGradientBoosting per horizon vs persistence; MAE/RMSE in moisture percentage points; test = 2025-06-27…07-15.

| Horizon | Model MAE | Model RMSE | Persistence MAE | Persistence RMSE | Test rows |
|---|---|---|---|---|---|
| 1 h | 5.77 | 7.41 | 11.40 | 12.96 | 616 |
| 6 h | 8.80 | 10.38 | 9.80 | 12.96 | 289 |
| 12 h | 15.25 | 19.08 | 10.37 | 12.29 | **18** |
| 24 h | 6.31 | 7.98 | 7.64 | 10.48 | 605 |

Interpretation: better than persistence at 1, 6 and 24 h, worse at 12 h — but the 12 h test set has only 18 rows (not reliable), all tests come from one short, noisy period of two sensors, and persistence errors are unusually large (probe jumps). Results are indicative, not conclusive. Forecasts assume unknown future weather and irrigation. LSTM was not used (data volume does not justify it); XGBoost was not used (no demonstrated need; scikit-learn gradient boosting is the comparison model).

## 3. Agronomy (separate from ML)
FAO-56 ETc = Kc × ET0, with ET0 from Open-Meteo's `et0_fao_evapotranspiration`. Kc: seedling 0.60 (Kc_ini), flowering/fruit development 1.15 (Kc_mid), ripening 0.80 (Kc_end; table range 0.70–0.90), **vegetative 0.88 = assumed midpoint (not tabulated)**. Values follow FAO-56 Table 12 as recalled — **verify against the source before publication**. Effective rain (0 if ≤ 5 mm/day else 80 %) is a project assumption. No soil-water-balance carry-over. Crop-stage is not an ML feature because the dataset has no stage labels.

## 4. Completed features
- Dashboard (8 sections), responsive, loading/error/empty states, source badges (SIMULATED / SENSOR / PREDICTED / AGRONOMIC / OPEN-METEO), prediction explanations (occlusion + permutation importance), model-training info, charts for history and forecast.
- FastAPI + SQLite: sensors, predictions, history, irrigation events, pump state, settings, model/dataset info; models loaded once; "unavailable" responses instead of fabricated values.
- Open-Meteo (configurable coordinates, 15-min cache, stale-cache fallback, degraded-mode predictions when offline).
- ESP32 ingestion (API key, validation, optional rainfall), simulator (labelled), simulated pump, hardware adapter with physical control disabled.
- Four control modes; emergency stop, max runtime, invalid/stale detection, saturation gate, rest period, ML-failure fallback, manual override.

## 5. Test results
`cd backend && python -m pytest -q` → **32 passed**. Covers: dataset loading and manifest, soil-moisture preprocessing, raw loader, saved-model reproduction of reported F1, prediction shapes; ingestion auth/validation/optional fields/invalid and future-dated readings, simulated vs device separation, settings validation, missing-data and weather-outage degradation, model-unavailable honesty, pump start/stop, runtime cap (even for manual), emergency stop, stale and invalid sensors, fail-safe stop of a running pump, AI saturation gate, ML-down fallback, recommend-only mode, rest period, physical hardware refusal. Frontend: `tsc -b` and `vite build` pass; a live run (backend + built UI, real Open-Meteo) was smoke-tested with a headless-browser screenshot of the Overview page; there is no automated browser test suite. The frontend was not tested against a physical ESP32 or a real pump (none available).

## 6. Limitations
1. Model skill is modest (see §2); A and B mimic one farm's controller and small samples — validate on your own farm's data before any automation.
2. Training used ERA5 values for air temp/humidity/soil temp, whereas live inference uses your sensors; soil-moisture is a relative probe scale that must be calibrated to the dataset's 0–100 scale. Sensor-vs-reanalysis mismatch is not quantified.
3. Water labels are valve-time × nominal flow; the ML litres are in the study farm's units and not scaled by zone area. Zone area default (20 m²) is a placeholder.
4. Forecast test sets are small and from one period; no cross-season validation. Ripening/fruiting seasonality is not represented.
5. The sensors in the dataset's 'merged' layer are unfiltered; the project's cleaning (range filter, despike, ≤20-min gap fill) is simple.
6. Physical pump control, solar-power management and ESP32 firmware are not implemented (out of scope until hardware is specified). Rain gauge input is stored but not yet used by models.
7. Single-user, no authentication on dashboard endpoints (only the device ingest key); suitable for local/demo use.
8. FAO-56 Kc values and effective-rain assumptions need verification against the source.
