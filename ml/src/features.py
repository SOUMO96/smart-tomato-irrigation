"""Feature definitions shared by training (ml/scripts) and live inference (backend)."""
import numpy as np
import pandas as pd

STEP_MIN = 10  # dataset grid resolution
HORIZONS_H = [1, 6, 12, 24]
TOMATO_SECTORS = [1, 2]  # open-field tomato, same soil model (dataset README, sector table)

CLF_FEATURES = ["soil_moisture", "air_temp", "humidity", "soil_temp", "rain_6h",
                "wind_speed", "solar_radiation", "irrigated_min_6h", "hour_sin", "hour_cos"]
REG_FEATURES = ["soil_moisture", "air_temp", "humidity", "soil_temp", "rain_24h",
                "wind_speed", "solar_radiation", "irrigated_l_24h", "hours_since_irrigation",
                "hour_sin", "hour_cos"]
FC_FEATURES = ["soil_moisture", "sm_lag_1h", "sm_lag_3h", "sm_lag_6h", "sm_lag_24h",
               "irrigated_min_1h", "irrigated_min_6h", "irrigated_min_24h",
               "air_temp", "humidity", "soil_temp", "rain_24h", "wind_speed", "solar_radiation",
               "hour_sin", "hour_cos"]

FEATURE_LABELS = {
    "soil_moisture": "Soil moisture (%)", "air_temp": "Air temperature (°C)", "humidity": "Air humidity (%)",
    "soil_temp": "Soil temperature (°C)", "rain_6h": "Rain, past 6 h (mm)", "rain_24h": "Rain, past 24 h (mm)",
    "wind_speed": "Wind speed (km/h)", "solar_radiation": "Direct solar radiation (W/m²)",
    "irrigated_min_1h": "Irrigated minutes, past 1 h", "irrigated_min_6h": "Irrigated minutes, past 6 h",
    "irrigated_min_24h": "Irrigated minutes, past 24 h", "irrigated_l_24h": "Water applied, past 24 h (L)",
    "hours_since_irrigation": "Hours since last irrigation", "hour_sin": "Time of day (sin)",
    "hour_cos": "Time of day (cos)", "sm_lag_1h": "Soil moisture 1 h ago (%)",
    "sm_lag_3h": "Soil moisture 3 h ago (%)", "sm_lag_6h": "Soil moisture 6 h ago (%)",
    "sm_lag_24h": "Soil moisture 24 h ago (%)",
}


def clean_soil_moisture(s: pd.Series) -> pd.Series:
    """Range filter (0-115, clip >100), 9-sample median despike (>15 pts), short-gap fill (<=2 bins)."""
    s = s.where(s.between(0, 115)).clip(upper=100)
    med = s.rolling(9, center=True, min_periods=3).median()
    s = s.where((s - med).abs() <= 15)
    return s.interpolate(limit=2, limit_area="inside")


def load_zone(path, sector: int) -> pd.DataFrame:
    """Read a merged per-sector table and return a clean 10-min frame with project column names."""
    d = pd.read_csv(path, parse_dates=["ts"]).set_index("ts").sort_index()
    out = pd.DataFrame(index=d.index)
    out["sector"] = sector
    out["soil_moisture"] = clean_soil_moisture(d["soil_moisture"])
    out["air_temp"] = d["weather_temp"]
    out["humidity"] = d["weather_humidity"]
    out["soil_temp"] = d["soil_temperature_0-7cm"]
    out["rain_rate"] = d["weather_rain"]  # hourly rate (mm/h) linearly interpolated onto the 10-min grid
    out["wind_speed"] = d["weather_wind_speed"]
    out["solar_radiation"] = d["weather_radiation"]
    out["irr_min"] = d["irrigation_duration_minutes"]
    out["irr_l"] = d["liters_total"]
    return out


def add_time_features(df: pd.DataFrame) -> pd.DataFrame:
    h = df.index.hour + df.index.minute / 60
    df["hour_sin"] = np.sin(2 * np.pi * h / 24)
    df["hour_cos"] = np.cos(2 * np.pi * h / 24)
    return df


def add_history_features(df: pd.DataFrame) -> pd.DataFrame:
    """Backward-looking features on the regular grid (only past data -> no leakage)."""
    n = lambda hours: int(hours * 60 / STEP_MIN)
    df["rain_6h"] = df["rain_rate"].rolling(n(6), min_periods=n(6)).mean() * 6
    df["rain_24h"] = df["rain_rate"].rolling(n(24), min_periods=n(24)).mean() * 24
    for w in (1, 6, 24):
        df[f"irrigated_min_{w}h"] = df["irr_min"].rolling(n(w), min_periods=1).sum()
    df["irrigated_l_24h"] = df["irr_l"].rolling(n(24), min_periods=1).sum()
    for lag in (1, 3, 6, 24):
        df[f"sm_lag_{lag}h"] = df["soil_moisture"].shift(n(lag))
    last = df.index.to_series().where(df["irr_min"] > 0).ffill()
    df["hours_since_irrigation"] = ((df.index.to_series() - last).dt.total_seconds() / 3600).clip(upper=240)
    return add_time_features(df)
