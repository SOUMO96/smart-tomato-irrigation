// ESP32 firmware: sends sensor readings and obeys the server's pump commands.
// Needs: ESP32 Arduino core, ArduinoJson, DHT sensor library. Wiring (edit pins below):
//   capacitive soil probe -> GPIO34 (analog), DHT22 -> GPIO4, relay IN -> GPIO26 (active HIGH), DS18B20/soil temp optional.
// SAFETY: the relay turns ON only while the server's lease is valid. If Wi-Fi/server is lost the lease expires and the pump stops.
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASSWORD";
const char* BASE_URL  = "https://smart-tomato-irrigation.onrender.com";
const char* API_KEY   = "YOUR_DEVICE_API_KEY";   // the DEVICE_API_KEY set on Render
const char* DEVICE_ID = "esp32-zone1";
const int PIN_SOIL = 34, PIN_RELAY = 26, PIN_DHT = 4;
const int ADC_DRY = 3300, ADC_WET = 1400;        // CALIBRATE: raw reading in dry air / in water
const unsigned long POLL_MS = 5000, SEND_MS = 60000, MAX_ON_MS = 35000; // relay never stays on longer than one lease

DHT dht(PIN_DHT, DHT22);
unsigned long relayOnUntil = 0, lastSend = 0;

void relay(bool on) { digitalWrite(PIN_RELAY, on ? HIGH : LOW); }
bool relayIsOn() { return digitalRead(PIN_RELAY) == HIGH; }

bool http(const String& method, const String& path, const String& body, String& out) {
  WiFiClientSecure c; c.setInsecure();           // for a viva demo; pin the certificate for production
  HTTPClient h; h.begin(c, String(BASE_URL) + path);
  h.addHeader("X-API-Key", API_KEY); h.addHeader("Content-Type", "application/json");
  int code = method == "GET" ? h.GET() : h.POST(body);
  if (code > 0) out = h.getString();
  h.end(); return code == 200;
}

void sendReading() {
  int raw = analogRead(PIN_SOIL);
  float pct = constrain(100.0 * (ADC_DRY - raw) / (ADC_DRY - ADC_WET), 0, 100);
  float t = dht.readTemperature(), rh = dht.readHumidity();
  if (isnan(t) || isnan(rh)) return;             // never send garbage
  JsonDocument d;
  d["device_id"] = DEVICE_ID; d["soil_moisture"] = pct; d["air_temp"] = t; d["humidity"] = rh; d["soil_temp"] = t - 2; // replace with a real soil-temp probe
  String body, out; serializeJson(d, body);
  http("POST", "/api/sensors/readings", body, out);
}

void pollCommand() {
  String out;
  if (!http("GET", String("/api/device/command?pump_on=") + (relayIsOn() ? 1 : 0), "", out)) return; // no answer: leave the lease to expire
  JsonDocument d; if (deserializeJson(d, out)) return;
  if (d["pump"].as<bool>()) { relayOnUntil = millis() + min((unsigned long)(d["seconds"].as<int>() * 1000UL), MAX_ON_MS); relay(true); }
  else { relayOnUntil = 0; relay(false); }
}

void setup() {
  pinMode(PIN_RELAY, OUTPUT); relay(false);     // boots OFF
  dht.begin(); WiFi.begin(WIFI_SSID, WIFI_PASS);
}

void loop() {
  if (relayIsOn() && (long)(millis() - relayOnUntil) >= 0) relay(false);  // lease expired: fail closed
  if (WiFi.status() != WL_CONNECTED) { relay(false); delay(500); return; }
  pollCommand();
  if (millis() - lastSend > SEND_MS) { sendReading(); lastSend = millis(); }
  delay(POLL_MS);
}
