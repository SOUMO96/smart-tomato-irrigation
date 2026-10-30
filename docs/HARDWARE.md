# Connecting real hardware

1. On Render set `HARDWARE_MODE=device` and keep `DEVICE_API_KEY` secret. Locally: `HARDWARE_MODE=device uvicorn app.main:app`.
2. In Settings choose sensor source **device** (a physical pump refuses to run on simulated data).
3. Flash `firmware/esp32_pump_controller.ino` (set Wi-Fi, URL, key, and calibrate `ADC_DRY` / `ADC_WET`).
4. Wire: soil probe to GPIO34, DHT22 to GPIO4, relay module to GPIO26 (pump on the relay's NO contact, own supply, flyback protection).

## How control works
The cloud cannot reach into a farm network, so the ESP32 polls `GET /api/device/command` every 5 s and sends readings to
`POST /api/sensors/readings`. Starting the pump grants a short **lease**; the firmware keeps the relay on only while a valid lease
is held. Wi-Fi loss, a server crash or a redeploy therefore switch the pump off by itself. All existing safety gates still apply
(emergency stop, max runtime, stale sensor, saturation, minimum rest), plus: no start if the device has not checked in for 45 s.

Not yet verified on physical hardware; test with the pump disconnected (watch the relay click) before connecting water.
