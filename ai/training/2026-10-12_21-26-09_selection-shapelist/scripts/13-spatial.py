# nearest, within, facing, at on solids
bar = Box(100, 10, 10)
F = bar.faces()
p = (49, 0, 6)  # 1 mm above the top face, near the right end
print("[13] true distances:", [(round(f.center().x, 1), round(f.center().z, 1), round(f.distance_to(p), 3)) for f in F])
n = F.nearest(p)
print("[13] nearest face to", p, "->", n, " distance", round(n.distance_to(p), 3))
print("[13] true nearest:", F.sort_by(lambda f: f.distance_to(p)).first)
print("[13] edges nearest (49,5,6):", bar.edges().nearest((49, 5, 6)))
print("[13] nearest returns:", type(n).__name__)
# within
bb = BoundBox((0, -100, -100), (100, 100, 100))
print("[13] faces within x>=0 half:", len(F.within(bb)), [round(f.center().x, 1) for f in F.within(bb)])
print("[13] edges within:", len(bar.edges().within(bb)), " vertices within:", len(bar.vertices().within(bb)))
print("[13] within bar.bbox() (all):", len(F.within(bar.bbox())))
try:
    print("[13] within(tuple):", F.within(((0, -100, -100), (100, 100, 100))))
except Exception as ex:
    print("[13] within(tuple):", type(ex).__name__, ex)
# facing on planar and curved faces
part = Box(40, 30, 20) - Cylinder(6, 30)
print("[13] facing(Z):", part.faces().facing(Z), " facing(-Z):", len(part.faces().facing(-Z)))
print("[13] facing((0,0,5)):", len(part.faces().facing((0, 0, 5))), " facing(Axis):", len(part.faces().facing(Axis((9, 9, 9), (0, 0, 1)))))
cyl = Cylinder(10, 20)
cf = cyl.faces().cylinders().one()
print("[13] full cylinder face center:", cf.center().to_tuple(), " normal_at():", cf.normal_at().to_tuple())
for d in (X, -X, Y, -Y):
    print(f"[13] cylinder facing {d.direction.to_tuple()} max_angle 1:", len(cyl.faces().cylinders().facing(d, max_angle=1)))
half = Cylinder(10, 20) & Box(20, 20, 20, align=(Align.CENTER, Align.MIN, Align.CENTER))
print("[13] half cylinder faces:", half.faces().cylinders(), " edges:", half.edges())
hf = half.faces().cylinders().largest()
print("[13] half cylinder face center:", tuple(round(c, 3) for c in hf.center()), " normal_at():", tuple(round(c, 3) for c in hf.normal_at()))
print("[13] half cyl facing(Y):", len(half.faces().facing(Y)), " planar facing(-Y):", len(half.faces().facing(-Y)))
# facing with an angle range: a 30 degree draft-like face
w = Wedge(20, 20, 10)
print("[13] wedge faces normals:", [tuple(round(c, 3) for c in f.normal_at()) for f in w.faces()])
print("[13] wedge facing(Z) default:", len(w.faces().facing(Z)), " max_angle=60:", len(w.faces().facing(Z, max_angle=60)))
print("[13] edges facing:", len(part.edges().facing(Z)))
sph = Sphere(5)
print("[13] sphere normal_at():", sph.faces()[0].normal_at().to_tuple())
# at() on solids: inside vs boundary
two = Box(10, 10, 10) + Box(10, 10, 10).translate(30, 0, 0)
print("[13] solids distance_to inside point (0,0,0):", [round(s.distance_to((0, 0, 0)), 3) for s in two.solids()])
print("[13] solids at((0,0,0)):", len(two.solids().at((0, 0, 0))), " at((5,0,0)):", len(two.solids().at((5, 0, 0))))
