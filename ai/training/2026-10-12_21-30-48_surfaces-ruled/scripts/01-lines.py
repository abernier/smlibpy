# Ruled between two lines: parallel, skew (twist), reversed (bow tie). Normals, area.
import math
a = Line((0, 0, 0), (20, 0, 0))
cases = {
    "parallel": Line((0, 10, 0), (20, 10, 0)),
    "skew": Line((0, 20, 10), (20, 20, -10)),
    "reversed": Line((20, 10, 0), (0, 10, 0)),
}
for name, b in cases.items():
    s = ruled(a, b)
    f = s.faces()[0]
    print(f"[01] {name}: {s} type {f.geom_type} edges {len(s.edges())} bbox {s.bbox().min} {s.bbox().max}")
    print(f"[01]   normal at center {f.normal_at()} at (2,1,0) {f.normal_at((2, 1, 0))}")
    print(f"[01]   verts {[tuple(round(c, 3) for c in v) for v in s.vertices()]}")
# reversed: is the middle of the surface a point (bow tie)?
s = ruled(a, cases["reversed"])
print("[01] reversed: distance to (10,5,0):", s.distance_to((10, 5, 0)), "to (2,5,0):", round(s.distance_to((2, 5, 0)), 4))
print("[01] exact skew area (hyperbolic paraboloid) reference: parallel area", 200)
snapshot("lines", ruled(a, cases["parallel"]), ruled(a, cases["skew"]).translate(30, 0, 0),
         ruled(a, cases["reversed"]).translate(60, 0, 0))
snapshot("skew-front", ruled(a, cases["skew"]), view="sheet")
