# thicken: zero, curvature limits (half tube R=10), multi-face shells, open box.
import math
def tk(label, sh, t, expect=None):
    try:
        p = sh.thicken(t)
        print(f"[03] {label} thicken({t}): vol {p.volume:.3f} expect {expect} valid {p.is_valid()} faces {len(p.faces())}")
        return p
    except Exception as e:
        print(f"[03] {label} thicken({t}): {type(e).__name__}: {e}")
flat = ruled(Line((0, 0, 0), (20, 0, 0)), Line((0, 10, 0), (20, 10, 0)))
tk("flat", flat, 0)
tk("flat", flat, 1e-4, 200 * 1e-4)
tk("flat", flat, 100, 20000)
# half tube from a revolve: R=10, normal outward
half = revolve(Line((10, 0, 0), (10, 0, 30)), Z, 180)
print("[03] half normal at (0,10,15):", half.faces()[0].normal_at((0, 10, 15)))
for t in (1, 5, 9.9, 10, 12, -1, -20):
    if t > 0:
        exp = round(math.pi / 2 * ((10 + t) ** 2 - 100) * 30, 3)
    else:
        exp = round(math.pi / 2 * (100 - (10 + t) ** 2) * 30, 3) if 10 + t > 0 else "collapse"
    tk("half tube", half, -t if False else t, exp)
# inward: the normal points out, so negative goes inward
for t in (-5, -9.9, -10, -11):
    exp = round(math.pi / 2 * (100 - (10 + t) ** 2) * 30, 3) if 10 + t > 0 else "collapse"
    tk("half tube inward", half, t, exp)
# open box (5 faces stitched) thicken: a cup?
box = Box(20, 20, 20)
cup = stitch([f for f in box.faces() if f.normal_at().z < 0.5])
print("[03] cup:", cup, "normal of bottom", cup.faces().bottom()[0].normal_at())
for t in (1, -1):
    p = tk("open box", cup, t, 20 * 20 * 20 - 18 * 18 * 19 if t < 0 else 22 * 22 * 21 - 8000)
    if p is not None:
        print(f"[03]   bbox {p.bbox().min} {p.bbox().max}")
# two separate faces not stitched
two = Shell._wrap.__self__ if False else stitch(box.faces().top(), box.faces().bottom())
tk("two disjoint faces", two, 1, 800)
