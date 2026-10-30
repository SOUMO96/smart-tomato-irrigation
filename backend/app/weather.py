"""Open-Meteo client with TTL cache and stale-cache fallback. Coordinates come from farm settings."""
import threading
import time
from datetime import datetime, timedelta

import httpx

from . import config

URL = "https://api.open-meteo.com/v1/forecast"
HOURLY = "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,direct_radiation,soil_temperature_0cm,et0_fao_evapotranspiration"
_cache: dict[tuple, tuple[float, dict]] = {}
_cooldown_until = 0.0  # after a 429 / failure, do not call Open-Meteo again until then (shared hosting IPs hit the free limit quickly)
STALE_OK_S = 48 * 3600


def _load_disk():
    try:
        import json, pathlib
        p = pathlib.Path(config.WEATHER_CACHE_FILE)
        if p.exists():
            for k, t, raw in json.loads(p.read_text()):
                _cache[tuple(k)] = (t, raw)
    except Exception:
        pass


def _save_disk():
    try:
        import json, pathlib
        pathlib.Path(config.WEATHER_CACHE_FILE).write_text(json.dumps([[list(k), t, raw] for k, (t, raw) in _cache.items()]))
    except Exception:
        pass


def _fetch(lat: float, lon: float, tz: str) -> dict:
    global _cooldown_until
    if time.time() < _cooldown_until:
        raise RuntimeError("Open-Meteo is rate-limiting this server; waiting before retrying")
    r = httpx.get(URL, timeout=6.0, params={
        "latitude": lat, "longitude": lon, "timezone": tz, "past_days": 2, "forecast_days": 2,
        "hourly": HOURLY, "wind_speed_unit": "kmh",
        "daily": "et0_fao_evapotranspiration,precipitation_sum"})
    if r.status_code == 429:
        _cooldown_until = time.time() + 15 * 60
    r.raise_for_status()
    data = r.json()
    data["source"] = "Open-Meteo"
    return data


def _fetch_any(lat: float, lon: float, tz: str) -> dict:
    try:
        return _fetch(lat, lon, tz)
    except Exception:
        return _fetch_metno(lat, lon, tz)


def _fetch_metno(lat: float, lon: float, tz: str) -> dict:
    """MET Norway fallback (free, no key, tolerant of shared hosts). Converted to the Open-Meteo layout so everything downstream is unchanged.
    It has no solar radiation, soil temperature or ET0: radiation is estimated from sun position and cloud cover (flagged as estimated)."""
    import math
    from datetime import timezone
    r = httpx.get("https://api.met.no/weatherapi/locationforecast/2.0/compact", timeout=8.0, params={"lat": round(lat, 4), "lon": round(lon, 4)},
                  headers={"User-Agent": "TomatoIQ-irrigation-student-project/1.0 github.com/smart-tomato-irrigation"})
    r.raise_for_status()
    try:
        from zoneinfo import ZoneInfo
        zone = ZoneInfo(tz)
    except Exception:
        zone = timezone(timedelta(hours=round(lon / 15 * 2) / 2))
    hourly = {k: [] for k in ("time", "temperature_2m", "relative_humidity_2m", "precipitation", "wind_speed_10m", "direct_radiation",
                              "soil_temperature_0cm", "et0_fao_evapotranspiration")}
    for e in r.json()["properties"]["timeseries"][:72]:
        t = datetime.fromisoformat(e["time"].replace("Z", "+00:00"))
        loc = t.astimezone(zone).replace(tzinfo=None)
        d = e["data"]["instant"]["details"]
        n1 = e["data"].get("next_1_hours") or e["data"].get("next_6_hours") or {}
        rain = n1.get("details", {}).get("precipitation_amount", 0.0)
        cloud = (d.get("cloud_area_fraction", 50.0)) / 100.0
        doy = t.timetuple().tm_yday
        decl = math.radians(23.45) * math.sin(2 * math.pi * (284 + doy) / 365)
        hour_utc = t.hour + t.minute / 60 + lon / 15
        ha = math.radians(15 * (hour_utc - 12))
        sin_el = math.sin(math.radians(lat)) * math.sin(decl) + math.cos(math.radians(lat)) * math.cos(decl) * math.cos(ha)
        clear = 1000.0 * max(sin_el, 0) ** 1.15
        ghi = clear * (1 - 0.75 * cloud ** 3.4)
        hourly["time"].append(loc.strftime("%Y-%m-%dT%H:%M"))
        hourly["temperature_2m"].append(d.get("air_temperature"))
        hourly["relative_humidity_2m"].append(d.get("relative_humidity"))
        hourly["precipitation"].append(rain)
        hourly["wind_speed_10m"].append(None if d.get("wind_speed") is None else d["wind_speed"] * 3.6)
        hourly["direct_radiation"].append(round(ghi * 0.7, 1))  # rough direct share of global radiation
        hourly["soil_temperature_0cm"].append(None)
        hourly["et0_fao_evapotranspiration"].append(None)
    return {"latitude": lat, "longitude": lon, "hourly": hourly, "daily": {}, "source": "MET Norway (radiation estimated)"}


_refreshing: set = set()


def _refresh_in_background(key: tuple, lat: float, lon: float, tz: str) -> None:
    if key in _refreshing:
        return
    _refreshing.add(key)

    def run():
        try:
            _cache[key] = (time.time(), _fetch_any(lat, lon, tz)); _save_disk()
        except Exception:
            pass  # keep serving the older copy
        finally:
            _refreshing.discard(key)

    threading.Thread(target=run, daemon=True).start()


def get_weather(lat: float, lon: float, tz: str, now_local: datetime | None = None) -> dict:
    """Returns {"status": ok|stale|unavailable, ...}. Never raises. Older cached data is served instantly while a fresh copy loads in the background."""
    if not _cache:
        _load_disk()
    key = (round(lat, 3), round(lon, 3), tz)
    hit = _cache.get(key)
    age = time.time() - hit[0] if hit else None
    if hit and age < config.WEATHER_TTL_SECONDS:
        return summarize(hit[1], "ok", now_local, cached=True)
    if hit and age < STALE_OK_S:
        _refresh_in_background(key, lat, lon, tz)
        return summarize(hit[1], "ok", now_local, cached=True)
    try:
        raw = _fetch_any(lat, lon, tz)
        _cache[key] = (time.time(), raw); _save_disk()
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
        "source": raw.get("source", "Open-Meteo"),
        "units": {"temp": "°C", "wind": "km/h", "radiation": "W/m² (direct)", "rain": "mm"},
    }
