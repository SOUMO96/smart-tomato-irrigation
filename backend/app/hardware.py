"""Hardware adapter layer. Only the simulated pump exists; physical control is disabled until supplied hardware config."""
from typing import Protocol


class HardwareDisabled(RuntimeError):
    pass


class PumpAdapter(Protocol):
    name: str
    simulated: bool

    def start(self) -> None: ...
    def stop(self) -> None: ...


class SimulatedPump:
    name, simulated = "simulated-pump", True

    def start(self) -> None:  # no physical effect
        pass

    def stop(self) -> None:
        pass


class Esp32Pump:
    """Placeholder for a future ESP32 relay/pump endpoint. Intentionally raises: physical control is not enabled."""
    name, simulated = "esp32-relay", False

    def start(self) -> None:
        raise HardwareDisabled("Physical pump control is disabled until ESP32 hardware configuration is supplied.")

    def stop(self) -> None:
        raise HardwareDisabled("Physical pump control is disabled until ESP32 hardware configuration is supplied.")


_adapter: PumpAdapter = SimulatedPump()


def get_pump() -> PumpAdapter:
    return _adapter


def set_pump(adapter: PumpAdapter) -> None:  # used by tests / future hardware wiring
    global _adapter
    _adapter = adapter
