# is_planar on flat faces whose surface is a bspline
flat = surface([[(x, y, 0) for x in (0, 4, 8, 12)] for y in (0, 4, 8, 12)])
f = flat.faces().one()
print("[03] flat surface:", f.geom_type, "is_planar", f.is_planar, "normal", f.normal_at().to_tuple(), "bbox z", f.bbox().min.z, f.bbox().max.z)
r = ruled(Line((0, 0, 0), (10, 0, 0)), Line((0, 5, 0), (10, 5, 0)))
g = r.faces().one()
print("[03] flat ruled:", g.geom_type, "is_planar", g.is_planar, "normal", g.normal_at().to_tuple())
nb = Box(10, 10, 10).to_nurbs()
h = nb.faces().top().one()
print("[03] to_nurbs top:", h.geom_type, "is_planar", h.is_planar, "bbox z", h.bbox().min.z, h.bbox().max.z, "normal", h.normal_at().to_tuple())
e = nb.edges()[0]
print("[03] to_nurbs edge:", e.geom_type, "length", e.length, "chord", e.start.distance_to(e.end))
