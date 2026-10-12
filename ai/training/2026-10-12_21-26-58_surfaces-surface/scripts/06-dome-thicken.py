# Thicken a dome with a pole: which signs and sizes work?
import math
R = 10
def ring(r, z, n=13):
    return [(r * math.cos(2 * math.pi * k / (n - 1)), r * math.sin(2 * math.pi * k / (n - 1)), z) for k in range(n)]
rows = [ring(R * math.cos(math.radians(a)), R * math.sin(math.radians(a))) for a in np.linspace(0, 90, 7)]
dome = surface(rows)
for t in (1, -1, 0.5, -0.5, 3, -3):
    try:
        s = dome.thicken(t)
        print(f"[06] thicken({t}): vol {s.volume:.3f} valid {s.is_valid()} z {s.bbox().min.z:.3f}..{s.bbox().max.z:.3f} r {s.bbox().max.x:.3f}")
    except Exception as e:
        print(f"[06] thicken({t}): {type(e).__name__}: {e}")
# the same dome without a pole: stop at 80 degrees
rows2 = [ring(R * math.cos(math.radians(a)), R * math.sin(math.radians(a))) for a in np.linspace(0, 80, 7)]
cap = surface(rows2)
for t in (1, -1):
    try:
        s = cap.thicken(t)
        print(f"[06] no-pole thicken({t}): vol {s.volume:.3f} valid {s.is_valid()}")
    except Exception as e:
        print(f"[06] no-pole thicken({t}): {type(e).__name__}: {e}")
# exact sphere half for comparison: revolve an arc
arc = CenterArc((0, 0, 0), R, 0, 90).on(Plane.XZ) if hasattr(CenterArc((0,0,0),R,0,90), 'on') else None
