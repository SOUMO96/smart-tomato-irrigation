from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from . import config


def utcnow() -> datetime:
    """Naive UTC timestamp (all DB times are UTC)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat(timespec="seconds") + "Z" if dt else None


class Base(DeclarativeBase):
    pass


class SensorReading(Base):
    __tablename__ = "sensor_readings"
    id: Mapped[int] = mapped_column(primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, index=True)
    soil_moisture: Mapped[float | None] = mapped_column(Float)
    air_temp: Mapped[float | None] = mapped_column(Float)
    humidity: Mapped[float | None] = mapped_column(Float)
    soil_temp: Mapped[float | None] = mapped_column(Float)
    rainfall: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(16), index=True)  # "device" (physical) | "simulated"
    device_id: Mapped[str | None] = mapped_column(String(64))
    valid: Mapped[bool] = mapped_column(Boolean, default=True)
    invalid_reason: Mapped[str | None] = mapped_column(String(200))

    def as_dict(self):
        return {"id": self.id, "timestamp": iso(self.timestamp), "soil_moisture": self.soil_moisture,
                "air_temp": self.air_temp, "humidity": self.humidity, "soil_temp": self.soil_temp,
                "rainfall": self.rainfall, "source": self.source, "device_id": self.device_id,
                "valid": self.valid, "invalid_reason": self.invalid_reason}


class PredictionRecord(Base):
    __tablename__ = "predictions"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    kind: Mapped[str] = mapped_column(String(24), index=True)  # irrigation | water | forecast
    status: Mapped[str] = mapped_column(String(16))
    input_source: Mapped[str | None] = mapped_column(String(16))
    reading_id: Mapped[int | None] = mapped_column(Integer)
    payload: Mapped[dict] = mapped_column(JSON)

    def as_dict(self):
        return {"id": self.id, "created_at": iso(self.created_at), "kind": self.kind, "status": self.status,
                "input_source": self.input_source, "reading_id": self.reading_id, "payload": self.payload}


class IrrigationEvent(Base):
    __tablename__ = "irrigation_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    start: Mapped[datetime] = mapped_column(DateTime, index=True)
    end: Mapped[datetime | None] = mapped_column(DateTime)
    trigger: Mapped[str] = mapped_column(String(24))  # manual | sensor_auto | ai_auto
    stop_reason: Mapped[str | None] = mapped_column(String(80))
    planned_minutes: Mapped[float | None] = mapped_column(Float)
    simulated: Mapped[bool] = mapped_column(Boolean, default=True)
    moisture_at_start: Mapped[float | None] = mapped_column(Float)

    def minutes(self, now=None):
        end = self.end or now or utcnow()
        return max(0.0, (end - self.start).total_seconds() / 60)

    def as_dict(self, flow_l_per_min: float):
        m = self.minutes()
        return {"id": self.id, "start": iso(self.start), "end": iso(self.end), "running": self.end is None,
                "trigger": self.trigger, "stop_reason": self.stop_reason, "duration_min": round(m, 2),
                "estimated_litres": round(m * flow_l_per_min, 1), "litres_basis": "runtime x configured flow rate (not metered)",
                "simulated": self.simulated, "moisture_at_start": self.moisture_at_start}


class PumpState(Base):
    __tablename__ = "pump_state"
    id: Mapped[int] = mapped_column(primary_key=True)
    running: Mapped[bool] = mapped_column(Boolean, default=False)
    event_id: Mapped[int | None] = mapped_column(Integer)
    emergency_stop: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class FarmSettings(Base):
    __tablename__ = "farm_settings"
    id: Mapped[int] = mapped_column(primary_key=True)
    farm_name: Mapped[str] = mapped_column(String(80), default="Demo tomato farm")
    latitude: Mapped[float] = mapped_column(Float, default=40.33)   # default = dataset site (Arnesano, Italy); change to your farm
    longitude: Mapped[float] = mapped_column(Float, default=18.10)
    timezone: Mapped[str] = mapped_column(String(48), default="Europe/Rome")
    zone_name: Mapped[str] = mapped_column(String(40), default="Zone 1")
    zone_area_m2: Mapped[float] = mapped_column(Float, default=20.0)  # placeholder: set your real zone area
    growth_stage: Mapped[str] = mapped_column(String(24), default="vegetative")
    control_mode: Mapped[str] = mapped_column(String(24), default="manual")  # manual | sensor_auto | ai_recommend | ai_auto
    sensor_source: Mapped[str] = mapped_column(String(16), default="simulated")  # simulated | device
    start_threshold: Mapped[float] = mapped_column(Float, default=40.0)  # % probe scale (dataset tomato sectors)
    stop_threshold: Mapped[float] = mapped_column(Float, default=60.0)
    max_pump_runtime_min: Mapped[float] = mapped_column(Float, default=30.0)
    min_rest_min: Mapped[float] = mapped_column(Float, default=30.0)
    stale_after_min: Mapped[float] = mapped_column(Float, default=15.0)
    flow_l_per_min: Mapped[float] = mapped_column(Float, default=1.1)
    irrigation_efficiency: Mapped[float] = mapped_column(Float, default=0.9)
    ai_threshold: Mapped[float] = mapped_column(Float, default=0.5)


engine = create_engine(config.DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def init_db():
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if not db.get(FarmSettings, 1):
            db.add(FarmSettings(id=1))
        if not db.get(PumpState, 1):
            db.add(PumpState(id=1))
        db.commit()


def get_db():
    with SessionLocal() as db:
        yield db
