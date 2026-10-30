"""Pump control with safety interlocks. ML output is only ever an additional *condition*; it can never bypass a gate."""
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import hardware, services
from .db import FarmSettings, IrrigationEvent, iso, utcnow
from .ml_service import ml

MODES = ("manual", "sensor_auto", "ai_recommend", "ai_auto")


def pump_status(db: Session, s: FarmSettings, now: datetime | None = None) -> dict:
    now = now or utcnow()
    ps = services.get_pump_state(db)
    ev = db.get(IrrigationEvent, ps.event_id) if ps.running and ps.event_id else None
    adapter = hardware.get_pump()
    return {"running": ps.running, "emergency_stop": ps.emergency_stop, "simulated": adapter.simulated,
            "adapter": adapter.name, "physical_control_enabled": not adapter.simulated,
            "started_at": iso(ev.start) if ev else None, "runtime_s": round(ev.minutes(now) * 60) if ev else 0,
            "max_runtime_s": round(s.max_pump_runtime_min * 60), "trigger": ev.trigger if ev else None,
            "updated_at": iso(ps.updated_at)}


def stop_pump(db: Session, reason: str, now: datetime | None = None) -> dict:
    now = now or utcnow()
    ps = services.get_pump_state(db)
    if ps.running:
        try:
            hardware.get_pump().stop()
        except Exception:
            pass  # fail-safe: record as stopped in software; the hardware layer must also fail closed
        ev = db.get(IrrigationEvent, ps.event_id)
        if ev and ev.end is None:
            ev.end, ev.stop_reason = now, reason
    ps.running, ps.event_id, ps.updated_at = False, None, now
    db.commit()
    return {"stopped": True, "reason": reason}


def start_blockers(db: Session, s: FarmSettings, trigger: str, now: datetime) -> list[str]:
    """Reasons a start must be refused. Manual starts are an operator override of sensor/ML conditions,
    but never of emergency stop, runtime cap or a running pump."""
    ps = services.get_pump_state(db)
    out = []
    if ps.emergency_stop:
        out.append("emergency stop is active")
    if ps.running:
        out.append("pump already running")
    if trigger != "manual":
        r = services.active_reading(db, s)
        st = services.reading_state(r, s, now)
        if st["status"] != "ok":
            out.append(f"sensor data unusable ({st['status']}: {st['reason']})")
        elif r.soil_moisture >= s.stop_threshold:
            out.append(f"soil moisture {r.soil_moisture:.0f}% is at/above the stop threshold {s.stop_threshold:.0f}%")
        last = db.scalars(select(IrrigationEvent).where(IrrigationEvent.end.is_not(None)).order_by(IrrigationEvent.end.desc()).limit(1)).first()
        if last and (now - last.end) < timedelta(minutes=s.min_rest_min):
            out.append(f"minimum rest period of {s.min_rest_min:.0f} min not elapsed")
    return out


def start_pump(db: Session, trigger: str, duration_min: float | None = None, now: datetime | None = None) -> dict:
    now = now or utcnow()
    s = services.get_settings(db)
    blockers = start_blockers(db, s, trigger, now)
    if blockers:
        return {"started": False, "blocked_by": blockers}
    planned = min(duration_min or s.max_pump_runtime_min, s.max_pump_runtime_min)  # runtime cap always applies
    try:
        hardware.get_pump().start()
    except Exception as exc:
        return {"started": False, "blocked_by": [f"hardware refused: {exc}"]}
    r = services.active_reading(db, s)
    ev = IrrigationEvent(start=now, trigger=trigger, planned_minutes=planned, simulated=hardware.get_pump().simulated,
                         moisture_at_start=r.soil_moisture if r and r.valid else None)
    db.add(ev)
    db.flush()
    ps = services.get_pump_state(db)
    ps.running, ps.event_id, ps.updated_at = True, ev.id, now
    db.commit()
    return {"started": True, "event_id": ev.id, "planned_minutes": planned, "simulated": ev.simulated}


def emergency_stop(db: Session) -> dict:
    ps = services.get_pump_state(db)
    ps.emergency_stop = True
    db.commit()
    return stop_pump(db, "emergency stop")


def emergency_reset(db: Session) -> dict:
    ps = services.get_pump_state(db)
    ps.emergency_stop, ps.updated_at = False, utcnow()
    db.commit()
    return {"emergency_stop": False}


def control_step(db: Session, now: datetime | None = None) -> dict:
    """One iteration of the control loop. Safe to call at any time (also from tests)."""
    now = now or utcnow()
    s = services.get_settings(db)
    ps = services.get_pump_state(db)
    r = services.active_reading(db, s)
    st = services.reading_state(r, s, now)
    decision = {"mode": s.control_mode, "action": "none", "reason": "no action", "at": iso(now), "recommendation": None}

    if ps.running:  # --- stop conditions are evaluated in every mode ---
        ev = db.get(IrrigationEvent, ps.event_id)
        runtime = ev.minutes(now) if ev else 0
        cap = min(s.max_pump_runtime_min, ev.planned_minutes or s.max_pump_runtime_min) if ev else 0
        reason = None
        if ps.emergency_stop:
            reason = "emergency stop"
        elif runtime >= cap:
            reason = f"maximum runtime reached ({cap:.0f} min)"
        elif ev and ev.trigger != "manual" and st["status"] != "ok":
            reason = f"fail-safe: sensor data unusable ({st['status']})"
        elif ev and ev.trigger != "manual" and r.soil_moisture >= s.stop_threshold:
            reason = f"target moisture reached ({r.soil_moisture:.0f}% >= {s.stop_threshold:.0f}%)"
        if reason:
            stop_pump(db, reason, now)
            return {**decision, "action": "stop", "reason": reason}
        return {**decision, "reason": "pump running; no stop condition met"}

    if s.control_mode == "manual":
        return {**decision, "reason": "manual mode: no automatic action"}
    if st["status"] != "ok":
        return {**decision, "reason": f"no action: sensor data unusable ({st['status']}: {st['reason']})"}

    sensor_wants = r.soil_moisture < s.start_threshold
    ai = None
    if s.control_mode in ("ai_recommend", "ai_auto"):
        try:
            w = services.weather.get_weather(s.latitude, s.longitude, s.timezone, services.to_local(now, s.timezone))
            ai = ml.predict_irrigation(services.build_inputs(db, s, r, w))
        except Exception as exc:
            ai = {"status": "unavailable", "reason": f"prediction error: {exc.__class__.__name__}"}
    ai_ok = ai is not None and ai.get("status") in ("ok", "degraded")
    ai_yes = ai_ok and ai["probability"] >= s.ai_threshold

    if s.control_mode == "ai_recommend":
        rec = ("irrigate" if ai_yes else "wait") if ai_ok else "unavailable"
        return {**decision, "recommendation": rec, "reason": "recommendation only; pump not actuated",
                "ai": ai if ai_ok else {"status": "unavailable", "reason": (ai or {}).get("reason")}}

    if s.control_mode == "sensor_auto":
        want, why = sensor_wants, f"soil moisture {r.soil_moisture:.0f}% < start threshold {s.start_threshold:.0f}%"
        trigger = "sensor_auto"
    else:  # ai_auto: ML must agree AND the sensor must show depletion; if ML is down, fall back to the sensor rule
        trigger = "ai_auto"
        if ai_ok:
            want = ai_yes and r.soil_moisture < s.stop_threshold
            why = f"AI probability {ai['probability']:.2f} >= {s.ai_threshold:.2f} with moisture {r.soil_moisture:.0f}%"
        else:
            want, why = sensor_wants, f"ML unavailable - fallback to sensor rule (moisture {r.soil_moisture:.0f}% < {s.start_threshold:.0f}%)"
    if not want:
        return {**decision, "reason": "conditions for irrigation not met"}
    res = start_pump(db, trigger, None, now)
    if res["started"]:
        return {**decision, "action": "start", "reason": why}
    return {**decision, "action": "blocked", "reason": "; ".join(res["blocked_by"])}
