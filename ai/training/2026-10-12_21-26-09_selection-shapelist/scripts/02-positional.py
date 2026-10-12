# top/bottom/left/right/front/back on faces, edges, vertices; ties; which center
box = Box(40, 30, 20)
for name in ("top", "bottom", "left", "right", "front", "back"):
    fs = getattr(box.faces(), name)()
    es = getattr(box.edges(), name)()
    vs = getattr(box.vertices(), name)()
    print(f"[02] {name}: faces {len(fs)} {fs[0].center().to_tuple()} normal {fs[0].normal_at().to_tuple()} | edges {len(es)} | verts {len(vs)}")
# step: two top faces at different heights, and two at the same height
step = Box(40, 30, 20, align=(Align.CENTER, Align.CENTER, Align.MIN)) + Box(20, 30, 10, align=(Align.MIN, Align.CENTER, Align.MIN)).translate(0, 0, 20)
print("[02] step top faces:", [(round(f.center().z, 3), round(f.area, 1)) for f in step.faces().top()])
print("[02] step facing Z:", [(round(f.center().z, 3), round(f.area, 1)) for f in step.faces().facing(Z)])
# two separate blocks with tops at the same height -> tie
twin = Box(10, 10, 10).translate(-20, 0, 0) + Box(10, 10, 10).translate(20, 0, 0)
print("[02] twin top faces:", len(twin.faces().top()), [f.center().to_tuple() for f in twin.faces().top()])
# Edges: top() uses the edge midpoint (point_at(0.5)), not arc_center
hcyl = Cylinder(10, 40).rotate(Y, 90)   # axis along X
print("[02] hcyl bbox:", hcyl.bbox())
for e in hcyl.edges():
    print("[02] hcyl edge", e.geom_type, "center", e.center().to_tuple(), "arc_center", e.arc_center.to_tuple())
print("[02] hcyl edges top:", hcyl.edges().top())
print("[02] hcyl edges right:", hcyl.edges().right())
# Faces: center is the area centroid; a full cylinder face's centroid is on the axis
print("[02] hcyl faces top:", hcyl.faces().top())
print("[02] hcyl faces right:", hcyl.faces().right())
# sphere: centroid of a sphere face
sph = Sphere(10)
print("[02] sphere face center:", sph.faces()[0].center().to_tuple(), len(sph.faces()), len(sph.edges()), len(sph.vertices()))
# arc edges: half-cylinder (a D shape) top edges
d = Cylinder(10, 20) & Box(20, 20, 20, align=(Align.MIN, Align.CENTER, Align.CENTER))
for e in d.edges().top():
    print("[02] D top edge", e.geom_type, "mid", e.center().to_tuple())
# tolerance of ties: 1e-4 absolute
tilt = Box(10, 10, 10) + Box(10, 10, 10.00005).translate(20, 0, 0) + Box(10, 10, 10.001).translate(40, 0, 0)
print("[02] tie tolerance:", [round(f.center().z, 6) for f in tilt.faces().top()])
