# largest/smallest, min_by/max_by, first/last/one, at
part = Box(40, 30, 20) - Cylinder(6, 30)
F, E, V = part.faces(), part.edges(), part.vertices()
print("[12] largest face:", F.largest(), " type", type(F.largest()).__name__)
print("[12] smallest face:", F.smallest())
print("[12] largest edge:", E.largest(), " smallest edge:", E.smallest())
print("[12] largest vertex:", V.largest(), "(all measure 0 -> first)", V.largest() == V[0])
print("[12] max_by('area'):", len(F.max_by("area")), [round(f.area, 1) for f in F.max_by("area")], type(F.max_by("area")).__name__)
print("[12] min_by('length'):", len(E.min_by("length")), [round(e.length, 2) for e in E.min_by("length")])
print("[12] max_by() default Z:", len(F.max_by()), F.max_by()[0].center().z)
print("[12] max_by(lambda):", F.max_by(lambda f: f.center().x)[0].center().x)
print("[12] max_by tol:", len(F.max_by("area", tol=300)))
two = Box(10, 10, 10) + Sphere(4).translate(30, 0, 0)
S_ = two.solids()
print("[12] solids largest:", round(S_.largest().volume, 3), " smallest:", round(S_.smallest().volume, 3))
print("[12] solids max_by('volume'):", [round(s.volume, 2) for s in S_.max_by("volume")])
print("[12] solids top():", len(S_.top()), [round(s.center().x, 2) for s in S_.top()])
# mixed list: faces and edges
mixed = ShapeList([F.largest(), E.largest()])
print("[12] mixed largest:", mixed.largest())
# first / last / one / indexing
print("[12] first:", E.first, " last:", E.last, " [-1]==last:", E[-1] == E.last)
print("[12] one():", F.top().one())
try:
    F.parallel_to(Z).one()
except ValueError as ex:
    print("[12] one() on 2:", ex)
# at(point)
print("[12] V.at corner:", V.at((20, 15, 10)))
print("[12] E.at corner:", len(E.at((20, 15, 10))), [e.geom_type for e in E.at((20, 15, 10))])
print("[12] F.at corner:", len(F.at((20, 15, 10))))
print("[12] F.at mid of top:", F.at((10, 10, 10)))
print("[12] F.at hole rim point:", [f.geom_type for f in F.at((6, 0, 10))])
print("[12] F.at off by 1e-5:", len(F.at((10, 10, 10.00001))), " by 1e-3:", len(F.at((10, 10, 10.001))), " tol=0.01:", len(F.at((10, 10, 10.001), tol=0.01)))
print("[12] F.at inside the hole (0,0,10):", len(F.at((0, 0, 10))), "(point is not on any face)")
print("[12] E.at hole center (0,0,10):", len(E.at((0, 0, 10))))
try:
    print("[12] solids at:", len(S_.at((5, 0, 0))))
except Exception as ex:
    print("[12] solids at:", type(ex).__name__, ex)
try:
    print("[12] wires at:", len(F.top().wires().at((20, 15, 10))))
except Exception as ex:
    print("[12] wires at:", type(ex).__name__, ex)
