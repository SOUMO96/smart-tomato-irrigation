"""Hardware adapter layer. SimulatedPump (default) or DevicePump (HARDWARE_MODE=device): a real ESP32 relay that POLLS for commands.

Why polling: the website runs in the cloud and cannot reach into a farm network. The ESP32 calls GET /api/device/command every few
seconds. Every "pump on" command carries an expiry (valid_until), so if the backend, the network or the Wi-Fi dies the firmware
turns the pump off by itself: the system fails closed."""
import threading
import time
from typing import Protocol


class HardwareDisabled(RuntimeError):
    pass


class PumpAdapter(Protocol):
    name: str
    simulated: bool

    def start(self, duration_s: float | None = None) -> None: ...
    def stop(self) -> None: ...


class SimulatedPump:
    name, simulated = "simulated-pump", True

    def start(self, duration_s: float | None = None) -> None:  # no physical effect
        pass

    def stop(self) -> None:
        pass


class DevicePump:
    """Commands a physical relay through the polling protocol. start() is refused unless the device has checked in recently."""
    name, simulated = "esp32-relay (polling)", False
    ONLINE_WITHIN_S = 45
    COMMAND_LEASE_S = 30  # one command is only valid this long unless renewed; the backend renews it on every poll while the pump should run

    def __init__(self):
        self._lock = threading.Lock()
        self.on_until = 0.0
        self.seq = 0
        self.last_seen = 0.0
        self.reported_on: bool | None = None

    def online(self) -> bool:
        return time.time() - self.last_seen < self.ONLINE_WITHIN_S

    def start(self, duration_s: float | None = None) -> None:
        if not self.online():
            raise HardwareDisabled("the pump controller (ESP32) has not contacted the server in the last %d s" % self.ONLINE_WITHIN_S)
        with self._lock:
            self.on_until = time.time() + float(duration_s or 600)
            self.seq += 1

    def stop(self) -> None:
        with self._lock:
            self.on_until = 0.0
            self.seq += 1

    def poll(self, reported_on: bool | None) -> dict:
        """Called by the device. Returns what the relay must do now; the lease keeps the command short-lived."""
        with self._lock:
            self.last_seen = time.time()
            self.reported_on = reported_on
            left = self.on_until - self.last_seen
            return {"pump": left > 0, "seconds": int(min(max(left, 0), self.COMMAND_LEASE_S)), "seq": self.seq}

    def status(self) -> dict:
        return {"online": self.online(), "last_seen_s_ago": None if not self.last_seen else round(time.time() - self.last_seen, 1),
                "relay_reported_on": self.reported_on}


_adapter: PumpAdapter = SimulatedPump()


def get_pump() -> PumpAdapter:
    return _adapter


def set_pump(adapter: PumpAdapter) -> None:  # used by tests / future hardware wiring
    global _adapter
    _adapter = adapter
