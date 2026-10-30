"""Agronomic (non-ML) water requirement: FAO-56 crop evapotranspiration ETc = Kc x ET0.

This module is deliberately separate from the ML models. ET0 comes from Open-Meteo's FAO-56 Penman-Monteith
field (`et0_fao_evapotranspiration`); it is not recomputed here.
"""
STAGES = ["seedling", "vegetative", "flowering", "fruit_development", "ripening"]

# Kc values. "tabulated" = FAO-56 Table 12 tomato values (Allen et al., 1998; verify against the source before
# publication). "assumed" = this project's mapping of FAO's 3 tabulated points onto 5 stages.
KC = {
    "seedling": {"kc": 0.60, "basis": "tabulated: Kc_ini (FAO-56 Table 12, tomato)"},
    "vegetative": {"kc": 0.88, "basis": "assumed: midpoint of Kc_ini 0.60 and Kc_mid 1.15 (not tabulated)"},
    "flowering": {"kc": 1.15, "basis": "tabulated: Kc_mid (FAO-56 Table 12, tomato)"},
    "fruit_development": {"kc": 1.15, "basis": "tabulated: Kc_mid (FAO-56 Table 12, tomato)"},
    "ripening": {"kc": 0.80, "basis": "tabulated: Kc_end (FAO-56 Table 12 gives 0.70-0.90 for tomato; midpoint used)"},
}
REFERENCE = "Allen, R.G. et al. (1998). FAO Irrigation and Drainage Paper 56, Crop evapotranspiration."
RAIN_IGNORE_MM = 5.0   # assumption: daily rain <= 5 mm is treated as not effective (interception/evaporation)
RAIN_EFFICIENCY = 0.8  # assumption: 80% of larger daily rain is effective


def effective_rain(mm: float) -> float:
    return 0.0 if mm <= RAIN_IGNORE_MM else RAIN_EFFICIENCY * mm


def requirement(weather: dict, stage: str, area_m2: float, efficiency: float) -> dict:
    if stage not in KC:
        return {"status": "unavailable", "reason": f"unknown growth stage '{stage}'"}
    if weather.get("status") == "unavailable" or weather.get("et0_today_mm") is None:
        return {"status": "unavailable", "reason": "ET0 requires weather data (Open-Meteo unavailable)"}
    et0 = float(weather["et0_today_mm"])
    rain = float(weather.get("rain_today_mm") or 0.0)
    kc = KC[stage]["kc"]
    etc = kc * et0
    eff = effective_rain(rain)
    net = max(0.0, etc - eff)
    gross_mm = net / max(efficiency, 0.1)
    return {
        "status": weather["status"], "method": "FAO-56 ETc = Kc x ET0 (agronomic calculation, not an ML prediction)",
        "stage": stage, "kc": kc, "kc_basis": KC[stage]["basis"], "et0_mm_day": round(et0, 2),
        "etc_mm_day": round(etc, 2), "rain_mm": round(rain, 2), "effective_rain_mm": round(eff, 2),
        "net_irrigation_mm": round(net, 2), "irrigation_efficiency": efficiency,
        "gross_irrigation_mm": round(gross_mm, 2), "zone_area_m2": area_m2,
        "litres_per_day": round(gross_mm * area_m2, 1),  # 1 mm over 1 m2 = 1 L
        "assumptions": [f"Effective rain: 0 if daily rain <= {RAIN_IGNORE_MM} mm else {RAIN_EFFICIENCY:.0%} of rain (project assumption).",
                        "Daily ET0 for today as given by Open-Meteo; no soil water balance carry-over is modelled.",
                        "Zone area and application efficiency are user settings.", KC[stage]["basis"]],
        "reference": REFERENCE,
    }
