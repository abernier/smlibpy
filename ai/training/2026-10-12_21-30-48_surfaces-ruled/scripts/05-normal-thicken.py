# Normal rule (swap a and b, reverse a), planar test, thicken of ruled strips.
a = Line((0, 0, 0), (20, 0, 0))
b = Line((0, 10, 0), (20, 10, 0))
for label, s in [("ruled(a,b)", ruled(a, b)), ("ruled(b,a)", ruled(b, a)),
                 ("ruled(a.reversed(), b.reversed())", ruled(a.reversed(), b.reversed()))]:
    f = s.faces()[0]
    print(f"[05] {label}: normal {f.normal_at()} is_planar {f.is_planar} geom {f.geom_type}")
s = ruled(a, b)
for t in (2, -2):
    p = s.thicken(t)
    print(f"[05] flat strip thicken({t}): z {p.bbox().min.z:.3f}..{p.bbox().max.z:.3f} vol {p.volume:.3f} valid {p.is_valid()}")
tw = ruled(Line((0, 0, 0), (20, 0, 0)), Line((0, 20, 10), (20, 20, -10)))
for t in (1, -1, 4):
    try:
        p = tw.thicken(t)
        print(f"[05] twisted thicken({t}): vol {p.volume:.3f} area*t {tw.area * abs(t):.3f} valid {p.is_valid()}")
    except Exception as e:
        print(f"[05] twisted thicken({t}): {type(e).__name__}: {e}")
# arc to line transition, thickened
arc = CenterArc((10, 0, 0), 10, 180, -180)
line = Line((0, 0, 10), (20, 0, 10))
hood = ruled(arc, line)
print("[05] arc->line normal at (10,10,0):", hood.faces()[0].normal_at((10, 10, 0)))
p = hood.thicken(1)
print(f"[05] arc->line thicken(1): vol {p.volume:.3f} area {hood.area:.3f} valid {p.is_valid()}")
snapshot("hood", p, view="sheet")
