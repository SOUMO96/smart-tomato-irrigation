from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .agronomy import STAGES


class SensorPayload(BaseModel):
    """Standard ESP32 payload. Rainfall is optional; the four core measurements are required."""
    model_config = ConfigDict(extra="forbid")
    device_id: str = Field(min_length=1, max_length=64, examples=["esp32-zone1"])
    soil_moisture: float = Field(description="Soil moisture, % on the probe's 0-100 scale")
    air_temp: float = Field(description="Air temperature, °C")
    humidity: float = Field(description="Relative humidity, %")
    soil_temp: float = Field(description="Soil temperature, °C")
    timestamp: datetime | None = Field(default=None, description="ISO-8601; UTC assumed if no offset. Server time if omitted.")
    rainfall: float | None = Field(default=None, ge=0, description="Optional rain gauge, mm")

    @field_validator("timestamp")
    @classmethod
    def to_utc(cls, v):
        if v is None:
            return v
        return (v.astimezone(timezone.utc) if v.tzinfo else v).replace(tzinfo=None)


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    farm_name: str | None = Field(None, min_length=1, max_length=80)
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    timezone: str | None = None
    zone_name: str | None = Field(None, min_length=1, max_length=40)
    zone_area_m2: float | None = Field(None, gt=0, le=100000)
    growth_stage: Literal[tuple(STAGES)] | None = None
    control_mode: Literal["manual", "sensor_auto", "ai_recommend", "ai_auto"] | None = None
    sensor_source: Literal["simulated", "device"] | None = None
    start_threshold: float | None = Field(None, ge=0, le=100)
    stop_threshold: float | None = Field(None, ge=0, le=100)
    max_pump_runtime_min: float | None = Field(None, gt=0, le=240)
    min_rest_min: float | None = Field(None, ge=0, le=1440)
    stale_after_min: float | None = Field(None, gt=0, le=1440)
    flow_l_per_min: float | None = Field(None, gt=0, le=1000)
    irrigation_efficiency: float | None = Field(None, gt=0, le=1)
    ai_threshold: float | None = Field(None, gt=0, lt=1)

    @field_validator("timezone")
    @classmethod
    def tz_ok(cls, v):
        if v is None:
            return v
        from zoneinfo import ZoneInfo
        try:
            ZoneInfo(v)
        except Exception:
            raise ValueError("unknown IANA timezone")
        return v


class StartRequest(BaseModel):
    duration_min: float | None = Field(None, gt=0, le=240)


class WhatIf(BaseModel):
    """Manual inputs for the "try it" explorer. Omitted optional fields are imputed by the model and reported as missing."""
    model_config = ConfigDict(extra="forbid")
    soil_moisture: float = Field(ge=0, le=100)
    air_temp: float = Field(ge=-10, le=60)
    humidity: float = Field(ge=0, le=100)
    soil_temp: float = Field(ge=-5, le=60)
    hour: float = Field(12, ge=0, lt=24, description="Local hour of day")
    rain_6h: float | None = Field(None, ge=0, le=500)
    rain_24h: float | None = Field(None, ge=0, le=500)
    wind_speed: float | None = Field(None, ge=0, le=200)
    solar_radiation: float | None = Field(None, ge=0, le=1400)
    irrigated_min_6h: float | None = Field(None, ge=0, le=360)
    irrigated_l_24h: float | None = Field(None, ge=0, le=5000)
    hours_since_irrigation: float | None = Field(None, ge=0, le=240)
    sm_lag_1h: float | None = Field(None, ge=0, le=100)
    sm_lag_3h: float | None = Field(None, ge=0, le=100)
    sm_lag_6h: float | None = Field(None, ge=0, le=100)
    sm_lag_24h: float | None = Field(None, ge=0, le=100)
