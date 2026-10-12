for args in [(0, 10, 10), (-5, 10, 10), (10, 10, -1)]:
    try:
        Box(*args)
        print("[05]", args, "accepted")
    except Exception as e:
        print("[05]", args, type(e).__name__, "|", e, "| ModelingError?", isinstance(e, ModelingError))
for args in [(1e-4, 1, 1), (1e-7, 1, 1), (1e5, 1e5, 1e5), (1e6, 1, 1)]:
    try:
        b = Box(*args)
        print("[05]", args, "valid:", b.is_valid(), "vol:", b.volume, "bbox size:", b.bbox().size)
    except Exception as e:
        print("[05]", args, type(e).__name__, e)
try:
    Box("10", 10, 10)
except Exception as e:
    print("[05] string size:", type(e).__name__, e)
try:
    Box(10, 10)
except Exception as e:
    print("[05] two args:", type(e).__name__, e)
b = Box(10, 10, 10, align=(Align.MIN, Align.MIN, Align.MIN))
print("[05] int args ok, vol:", b.volume)
import numpy as _np
print("[05] numpy float:", Box(_np.float64(3), 2, 1).volume)
