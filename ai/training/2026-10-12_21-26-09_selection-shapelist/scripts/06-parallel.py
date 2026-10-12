# parallel_to / perpendicular_to / filter_by for faces and edges
part = Box(40, 30, 20) - Cylinder(6, 30)
F, E = part.faces(), part.edges()
print("[06] faces parallel_to(Z):", [(f.geom_type, f.center().z.__round__(3)) for f in F.parallel_to(Z)])
print("[06] faces perpendicular_to(Z):", [(f.geom_type, tuple(round(c, 2) for c in f.center())) for f in F.perpendicular_to(Z)])
print("[06] edges parallel_to(Z):", len(E.parallel_to(Z)), " perpendicular_to(Z):", len(E.perpendicular_to(Z)), [e.geom_type for e in E.perpendicular_to(Z)])
print("[06] parallel_to(-Z) faces:", len(F.parallel_to(-Z) if hasattr(Z, '__neg__') else []))
print("[06] parallel_to((0,0,-1)) faces:", len(F.parallel_to((0, 0, -1))), " edges:", len(E.parallel_to((0, 0, -5))))
print("[06] parallel_to(Axis offset) edges:", len(E.parallel_to(Axis((100, 100, 0), (0, 0, 1)))))
print("[06] facing(Z) vs parallel_to(Z):", len(F.facing(Z)), len(F.parallel_to(Z)))
# filter_by dispatch
print("[06] filter_by(Z) edges:", len(E.filter_by(Z)), " filter_by('circle'):", len(E.filter_by("circle")), " filter_by(callable):", len(E.filter_by(lambda e: e.length > 35)))
print("[06] filter_by('CYLINDER') faces:", len(F.filter_by("CYLINDER")))
try:
    print("[06] filter_by((0,0,1)):", F.filter_by((0, 0, 1)))
except Exception as ex:
    print("[06] filter_by((0,0,1)):", type(ex).__name__, ex)
try:
    print("[06] filter_by(Plane.XY):", F.filter_by(Plane.XY))
except Exception as ex:
    print("[06] filter_by(Plane.XY):", type(ex).__name__, ex)
print("[06] filter(lambda f: f.area>700):", len(F.filter(lambda f: f.area > 700)))
# tolerance: rotate a box by tiny angles about X
for ang in (1e-5, 5e-5, 1e-4, 2e-4, 1e-3, 0.01):
    b = Box(10, 10, 10).rotate(X, ang)
    print(f"[06] rot {ang} deg: edges parZ {len(b.edges().parallel_to(Z))} faces parZ {len(b.faces().parallel_to(Z))} facing(Z) {len(b.faces().facing(Z))}")
# curved faces never count
cyl = Cylinder(5, 10)
print("[06] cylinder faces parallel_to(Z):", len(cyl.faces().parallel_to(Z)), " perpendicular_to(Z):", len(cyl.faces().perpendicular_to(Z)))
# a 45 degree chamfer face: perpendicular to what?
ch = Box(10, 10, 10).chamfer(Box(10, 10, 10).edges().top().right(), 2)
print("[06] chamfer faces:", len(ch.faces()), " planar perpendicular_to(Y):", len(ch.faces().perpendicular_to(Y)), " parallel_to((1,0,1)):", [f.normal_at().to_tuple() for f in ch.faces().parallel_to((1, 0, 1))])
# Sketches in a list
sks = ShapeList([Rectangle(2, 2), Rectangle(2, 2).on(Plane.XZ)])
print("[06] sketches parallel_to(Z):", len(sks.parallel_to(Z)), " perpendicular_to(Z):", len(sks.perpendicular_to(Z)))
# Vertices in parallel_to: silently dropped
print("[06] vertices parallel_to(Z):", len(part.vertices().parallel_to(Z)))
