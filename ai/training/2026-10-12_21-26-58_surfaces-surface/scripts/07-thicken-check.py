# Is the thickened volume right? Closed tube from a grid vs revolved tube vs open half tube.
import math
R = 10
def arcpts(r, z, a0, a1, n):
    return [(r * math.cos(math.radians(a)), r * math.sin(math.radians(a)), z) for a in np.linspace(a0, a1, n)]
def report(label, sh, t, exact):
    try:
        s = sh.thicken(t)
        print(f"[07] {label}.thicken({t}): vol {s.volume:.3f} exact {exact:.3f} valid {s.is_valid()} faces {len(s.faces())} x {s.bbox().min.x:.3f}..{s.bbox().max.x:.3f}")
        return s
    except Exception as e:
        print(f"[07] {label}.thicken({t}): {type(e).__name__}: {e}")
grid_tube = surface([arcpts(R, z, 0, 360, 25) for z in np.linspace(0, 30, 5)])
rev_tube = revolve(Line((R, 0, 0), (R, 0, 30)), Z)
half = surface([arcpts(R, z, 0, 180, 13) for z in np.linspace(0, 30, 5)])
print("[07] normals at (10,0,15):", grid_tube.faces()[0].normal_at((R, 0, 15)), rev_tube.faces()[0].normal_at((R, 0, 15)),
      half.faces()[0].normal_at((R, 0, 15)))
for t in (1, -1):
    out = math.pi * ((R + 1)**2 - R**2) * 30
    inn = math.pi * (R**2 - (R - 1)**2) * 30
    report("grid_tube", grid_tube, t, inn if t > 0 else out)
    report("rev_tube", rev_tube, t, out if rev_tube.faces()[0].normal_at((R, 0, 15)).x * t > 0 else inn)
    s = report("half", half, t, (inn if t > 0 else out) / 2)
