"""Clearly-labelled simulated sensor generator (source="simulated"). Never stored as device data.

A simple toy model for development/demo only: diurnal temperature, evaporation-driven moisture decay,
pump-driven moisture rise. It is not agronomic ground truth.
"""
import math
import random
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import services
from .db import SensorReading, utcnow


def next_reading(prev: SensorReading | None, ts: datetime, tz: str, pump_running: bool, rng: random.Random) -> SensorReading:
    local = services.to_local(ts, tz)
    h = local.hour + local.minute / 60
    diurnal = math.sin(math.pi * (h - 6) / 12) if 6 <= h <= 18 else -0.3
    air = 21 + 8 * diurnal + rng.gauss(0, 0.4)
    hum = max(25, min(95, 70 - 25 * diurnal + rng.gauss(0, 1.5)))
    soil_t = 20 + 5 * diurnal + rng.gauss(0, 0.2)
    sm = prev.soil_moisture if prev and prev.valid else 55.0
    dt_min = max(0.1, min(60.0, (ts - prev.timestamp).total_seconds() / 60)) if prev else 1.0
    sm += (-0.012 * max(0.0, diurnal + 0.4) * dt_min) + (0.35 * dt_min if pump_running else 0.0) + rng.gauss(0, 0.05)
    return SensorReading(timestamp=ts, soil_moisture=round(max(0.0, min(100.0, sm)), 2), air_temp=round(air, 2),
                         humidity=round(hum, 1), soil_temp=round(soil_t, 2), rainfall=None,
                         source="simulated", device_id="simulator", valid=True)


def tick(db: Session, rng: random.Random | None = None) -> SensorReading:
    rng = rng or random.Random()
    s = services.get_settings(db)
    prev = db.scalars(select(SensorReading).where(SensorReading.source == "simulated")
                      .order_by(SensorReading.timestamp.desc()).limit(1)).first()
    r = next_reading(prev, utcnow(), s.timezone, services.get_pump_state(db).running, rng)
    db.add(r)
    db.commit()
    return r


def backfill(db: Session, hours: int, step_min: int = 10, seed: int | None = None) -> int:
    """Generate `hours` of simulated history ending now (used to populate charts / lag features in demos)."""
    rng = random.Random(seed)
    s = services.get_settings(db)
    now = utcnow()
    prev = None
    n = 0
    for i in range(int(hours * 60 / step_min), 0, -1):
        prev = next_reading(prev, now - timedelta(minutes=i * step_min), s.timezone, False, rng)
        db.add(prev)
        n += 1
    db.commit()
    return n
