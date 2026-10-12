# Minimal reproductions for the TODO file.
import math
# 1. closed grid tube thicken -> zero volume, is_valid True
ring = lambda z: [(10 * math.cos(a), 10 * math.sin(a), z) for a in np.linspace(0, 2 * math.pi, 25)]
tube = surface([ring(z) for z in (0, 10, 20, 30)])
try:
    p = tube.thicken(-1)
    print("[10] tube.thicken(-1):", round(p.volume, 6), p.is_valid())
except Exception as e:
    print("[10] tube.thicken(-1):", e)
# 2. dome with a pole thicken outward -> zero volume, invalid, no exception
rows = [[(10 * math.cos(b) * math.cos(a), 10 * math.cos(b) * math.sin(a), 10 * math.sin(b))
         for a in np.linspace(0, 2 * math.pi, 13)] for b in np.linspace(0, math.pi / 2, 7)]
p = surface(rows).thicken(-1)
print("[10] dome.thicken(-1):", round(p.volume, 6), p.is_valid())
# 3. 3x3 grid
try:
    surface([[(x, y, 0) for x in (0, 1, 2)] for y in (0, 1, 2)])
except Exception as e:
    print("[10] 3x3:", type(e).__name__, e)
# 4. both ignored
s = surface([[(x, y, 0) for x in range(4)] for y in range(4)])
print("[10] both:", s.thicken(1).bbox().min.z, s.thicken(1, both=True).bbox().min.z, s.thicken(1, both=True).bbox().max.z)
# 5. NaN
print("[10] NaN:", surface([[(x, y, float('nan') if (x, y) == (1, 1) else 0) for x in range(4)] for y in range(4)]).area)
