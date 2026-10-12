# on(): planes, faces, locations, ShapeLists, offsets, local axes on faces
blk = Box(40, 30, 20)
# a marker sketch: rectangle long along local x, offset along local y
mark = Pos(0, 5) * Rectangle(10, 2)
for name in ["top", "bottom", "front", "back", "left", "right"]:
    f = getattr(blk.faces(), name)()
    s = mark.on(f)
    pl = f[0].plane
    print(f"[11] on({name:6s}) center {s.center()} local-x {pl.x_dir} local-y {pl.y_dir} normal {s.plane.z_dir} bbox size {s.bbox().size}")
# cut a pocket from each face with negative extrusion
p = blk
for name in ["top", "front", "right"]:
    p -= Rectangle(10, 6).on(getattr(blk.faces(), name)()).extrude(-4)
print("[11] pockets: vol", p.volume, "expected", 40 * 30 * 20 - 3 * 10 * 6 * 4, "valid", p.is_valid())
snapshot("pockets", p, view="iso")
# Part on a face: Z of the part goes along the normal
peg = Cylinder(2, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
on_right = peg.on(blk.faces().right())
print("[11] peg on right face bbox:", on_right.bbox())
on_bottom = peg.on(blk.faces().bottom())
print("[11] peg on bottom face bbox:", on_bottom.bbox())
# Hole on face goes inward
h = Hole(3, 8).on(blk.faces().front())
print("[11] Hole on front bbox:", h.bbox())
print("[11] blk - hole vol diff:", round(blk.volume - (blk - h).volume, 4), "expected", round(math.pi * 9 * 8, 4))
# on(Plane), on(Location), on(Sketch)
print("[11] on(Plane.XY.offset(7)):", Circle(1).on(Plane.XY.offset(7)).center())
print("[11] on(Pos(1,2,3)*Rot(x=90)):", Circle(1).on(Pos(1, 2, 3) * Rot(x=90)).plane)
base = Rectangle(20, 20).on(Plane.XZ.offset(5))
print("[11] on(sketch):", Circle(1).on(base).plane)
# on a ShapeList with 2 faces
try:
    Circle(1).on(blk.faces().filter_by(lambda f: abs(f.center().z) < 1e-6))
except Exception as e:
    print("[11] on(list of 4 faces) ->", type(e).__name__, e)
try:
    Circle(1).on(ShapeList())
except Exception as e:
    print("[11] on(empty) ->", type(e).__name__, e)
try:
    Circle(1).on([blk.faces().top()[0]])
except Exception as e:
    print("[11] on(python list) ->", type(e).__name__, e)
try:
    Circle(1).on(blk.faces().cylinders() or Cylinder(3, 5).faces().cylinders())
except Exception as e:
    print("[11] on(cylinder face) ->", type(e).__name__, e)
try:
    Circle(1).on(Pos(5, 0, 0) * Z)
except Exception as e:
    print("[11] on(Axis) ->", type(e).__name__, e)
# calling on twice composes
twice = Circle(1).on(Plane.XY.offset(5)).on(Plane.XY.offset(5))
print("[11] on twice:", twice.center())
# shape not at origin: offset kept in local coords
sh = Circle(1).translate(10, 0).on(blk.faces().front())
print("[11] translated then on(front):", sh.center())
# face on L-shaped part: centroid outside
L = Polygon((0, 0), (20, 0), (20, 4), (4, 4), (4, 20), (0, 20)).extrude(5)
c = Circle(1).on(L.faces().top())
print("[11] circle on L top face: center", c.center(), "inside face?", L.faces().top()[0].distance_to(c.center()))
try:
    LL = L - c.extrude(-2)
    print("[11] cut at centroid: vol change", round(L.volume - LL.volume, 4))
except Exception as e:
    print("[11] cut at centroid ->", type(e).__name__, e)
# ShapeList.on
pat = (GridLocations(20, 10, 2, 2) * Circle(1)).on(blk.faces().top())
print("[11] ShapeList.on centers:", [tuple(round(v, 3) for v in x.center()) for x in pat])
# tilted face
wedge = Box(20, 20, 20) - Box(40, 40, 40).rotate(Y, 45).translate(20, 0, 20)
tf = wedge.faces().filter_by(lambda f: f.is_planar and 0.1 < abs(f.normal_at().x) < 0.9).one()
tp = tf.plane
print("[11] tilted face plane: x", tp.x_dir, "y", tp.y_dir, "z", tp.z_dir)
