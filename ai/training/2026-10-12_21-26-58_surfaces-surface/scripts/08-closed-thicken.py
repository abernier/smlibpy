# Closed grid tube thickened: what are the faces of the zero-volume result? Deterministic?
import math
R = 10
def ring(z, n=25):
    return [(R * math.cos(2 * math.pi * k / (n - 1)), R * math.sin(2 * math.pi * k / (n - 1)), z) for k in range(n)]
tube = surface([ring(z) for z in np.linspace(0, 30, 5)])
for attempt in range(3):
    for t in (1, -1):
        try:
            s = tube.thicken(t)
            print(f"[08] try {attempt} thicken({t}): vol {s.volume:.4f} valid {s.is_valid()} faces {[(f.geom_type, round(f.area, 2)) for f in s.faces()]}")
        except Exception as e:
            print(f"[08] try {attempt} thicken({t}): {type(e).__name__}: {e}")
s = tube.thicken(-1)
print("[08] edges", len(s.edges()), "solids", len(s.solids()), "area", round(s.area, 3))
mp = s.mass_properties()
print("[08] mass props", mp)
snapshot("tube-thick", s, view="sheet")
