import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ML_DIR = ROOT / "ml"
MODELS_DIR = Path(os.getenv("MODELS_DIR", ML_DIR / "models"))
REPORTS_DIR = Path(os.getenv("REPORTS_DIR", ML_DIR / "reports"))
PROCESSED_DIR = Path(os.getenv("PROCESSED_DIR", ML_DIR / "data" / "processed"))
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{ROOT / 'backend' / 'data' / 'app.db'}")

DEVICE_API_KEY = os.getenv("DEVICE_API_KEY", "dev-device-key")  # sent by the ESP32 in X-API-Key
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
CONTROL_LOOP_SECONDS = int(os.getenv("CONTROL_LOOP_SECONDS", "30"))  # 0 disables the background loop
SIMULATOR_SECONDS = int(os.getenv("SIMULATOR_SECONDS", "30"))
WEATHER_TTL_SECONDS = int(os.getenv("WEATHER_TTL_SECONDS", "3600"))

# Feature code is shared with the training scripts
sys.path.insert(0, str(ML_DIR / "src"))

AUTO_SEED = os.getenv("AUTO_SEED", "1") == "1"  # add simulated demo history when the database is empty
PREDICTION_SNAPSHOT_SECONDS = int(os.getenv("PREDICTION_SNAPSHOT_SECONDS", "600"))  # how often a prediction snapshot is stored for history; 0 disables
WARM_UP = os.getenv("WARM_UP", "1") == "1"  # prime weather and prediction caches at startup

HARDWARE_MODE = os.getenv("HARDWARE_MODE", "simulated")  # "device" = real ESP32 relay via /api/device/command
WEATHER_CACHE_FILE = os.getenv("WEATHER_CACHE_FILE", "/tmp/weather_cache.json")
