"""Open-Meteo client with TTL cache and stale-cache fallback. Coordinates come from farm settings."""
import time
from datetime import datetime, timedelta

import httpx

from . import config

URL = "https://api.open-meteo.com/v1/forecast"
HOURLY = "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,direct_radiation,soil_temperature_0cm,et0_fao_evapotranspiration"
_cache: dict[tuple, tuple[float, dict]] = {}


def _fetch(lat: float, lon: float, tz: str) -> dict:
    r = httpx.get(URL, timeout=8.0, params={
        "latitude": lat, "longitude": lon, "timezone": tz, "past_days": 2, "forecast_days": 2,
        "hourly": HOURLY, "wind_speed_unit": "kmh",
        "daily": "et0_fao_evapotranspiration,precipitation_sum"})
    r.raise_for_status()
    return r.json()


def get_weather(lat: float, lon: float, tz: str, now_local: datetime | None = None) -> dict:
    """Returns {"status": ok|stale|unavailable, ...}. Never raises."""
    key = (round(lat, 3), round(lon, 3), tz)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < config.WEATHER_TTL_SECONDS:
        return summarize(hit[1], "ok", now_local, cached=True)
    try:
        raw = _fetch(lat, lon, tz)
        _cache[key] = (time.time(), raw)
        return summarize(raw, "ok", now_local)
    except Exception as exc:  # network down, rate limit, bad coordinates...
        if hit:
            return summarize(hit[1], "stale", now_local, cached=True, error=str(exc)[:120])
        return {"status": "unavailable", "error": str(exc)[:160] or exc.__class__.__name__}


def summarize(raw: dict, status: str, now_local: datetime | None, cached=False, error=None) -> dict:
    h = raw["hourly"]
    times = [datetime.fromisoformat(t) for t in h["time"]]
    now = (now_local or datetime.now()).replace(minute=0, second=0, microsecond=0, tzinfo=None)
    idx = max((i for i, t in enumerate(times) if t <= now), default=0)

    def val(name, i=idx):
        v = h[name][i]
        return None if v is None else float(v)

    def acc(name, hours):  # sum of the `hours` hourly values ending at the current hour
        vals = [h[name][i] for i in range(max(0, idx - hours + 1), idx + 1) if h[name][i] is not None]
        return float(sum(vals)) if vals else None

    d = raw.get("daily", {})
    today = now.date().isoformat()
    di = d.get("time", []).index(today) if today in d.get("time", []) else None
    return {
        "status": status, "cached": cached, "error": error, "observed_hour": times[idx].isoformat(),
        "latitude": raw.get("latitude"), "longitude": raw.get("longitude"),
        "air_temp": val("temperature_2m"), "humidity": val("relative_humidity_2m"),
        "wind_speed": val("wind_speed_10m"), "solar_radiation": val("direct_radiation"),
        "soil_temp": val("soil_temperature_0cm"), "rain_1h": val("precipitation"),
        "rain_6h": acc("precipitation", 6), "rain_24h": acc("precipitation", 24),
        "et0_today_mm": None if di is None else d["et0_fao_evapotranspiration"][di],
        "rain_today_mm": None if di is None else d["precipitation_sum"][di],
        "forecast_rain_next_24h": float(sum(x or 0 for x in h["precipitation"][idx + 1: idx + 25])),
        "units": {"temp": "°C", "wind": "km/h", "radiation": "W/m² (direct)", "rain": "mm"},
    }
