"""Prepare shared source tabs for the isolated Wokwi project; never access serial."""
from pathlib import Path

root = Path(__file__).resolve().parent
for name in ("Control.h",):
    (root / "WokwiSim" / name).write_bytes((root / "AgroControl" / name).read_bytes())
print("WokwiSim/Control.h synchronized. No physical GPIO driver or credentials included.")
