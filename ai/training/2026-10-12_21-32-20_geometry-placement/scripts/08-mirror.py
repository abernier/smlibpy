# mirror about planes; mirror then fuse
half = Box(20, 10, 10, align=(Align.MIN, Align.MIN, Align.MIN))   # x 0..20, y 0..10
print("[08] default mirror() (Plane.XZ):", half.mirror().bbox())
print("[08] mirror(Plane.YZ):", half.mirror(Plane.YZ).bbox())
print("[08] mirror(Plane.XY):", half.mirror(Plane.XY).bbox())
print("[08] mirror(Plane.YZ.offset(30)):", half.mirror(Plane.YZ.offset(30)).bbox())
print("[08] mirror(Plane.left) same as YZ:", half.mirror(Plane.left).bbox())
m = half.mirror(Plane.YZ)
print("[08] mirrored vol", m.volume, "valid", m.is_valid())
# normals still outward?
tf = m.faces().top()[0]
print("[08] mirrored top normal:", tf.normal_at(), "right face normal:", m.faces().sort_by(X)[-1].normal_at())
whole = half + half.mirror(Plane.YZ)
print("[08] fused: vol", whole.volume, "faces", len(whole.faces()), "solids", len(whole.solids()), "valid", whole.is_valid(), "bbox", whole.bbox())
# asymmetric profile mirrored: handedness
L = Polygon((0, 0), (20, 0), (20, 4), (4, 4), (4, 12), (0, 12)).extrude(5)
Lm = L.mirror(Plane.YZ)
print("[08] L vol", round(L.volume, 6), "mirror vol", round(Lm.volume, 6), "valid", Lm.is_valid(), "center", L.center(), "->", Lm.center())
both = L + Lm
print("[08] L + mirror: vol", round(both.volume, 6), "faces", len(both.faces()), "valid", both.is_valid())
# mirror about tilted plane
tp = Plane((0, 0, 0), z_dir=(1, 1, 0))
mm = Box(2, 2, 2).translate(10, 0, 0).mirror(tp)
print("[08] mirror about plane normal (1,1,0): center", mm.center())
# curved part mirrored: fillets and cylinders
c = Box(20, 10, 10, align=Align.MIN)
c = c.fillet(c.edges().parallel_to(Z), 2) - Cylinder(3, 30).translate(10, 5, 0)
cm = c.mirror(Plane.YZ)
print("[08] filleted+hole mirror: valid", cm.is_valid(), "vol", round(c.volume, 4), round(cm.volume, 4), "types", sorted({f.geom_type for f in cm.faces()}))
cc = c + cm
print("[08] fused filleted: valid", cc.is_valid(), "vol", round(cc.volume, 4), "expected", round(2 * c.volume, 4), "solids", len(cc.solids()))
# sketch mirror: plane normal?
s = Polygon((0, 0), (10, 0), (0, 5))
sm = s.mirror(Plane.YZ)
print("[08] sketch mirror: bbox", sm.bbox(), "plane", sm.plane, "area", sm.area)
print("[08] sketch mirror extrude(3) bbox:", sm.extrude(3).bbox(), "valid", sm.extrude(3).is_valid())
sxy = Rectangle(4, 4).mirror(Plane.XY)
print("[08] sketch mirrored through its own plane XY: plane", sxy.plane, "extrude bbox", sxy.extrude(3).bbox())
s_on = Rectangle(4, 4).on(Plane.XY.offset(5)).mirror(Plane.XY)
print("[08] sketch at z=5 mirror XY: bbox", s_on.bbox(), "plane", s_on.plane, "extrude bbox", s_on.extrude(2).bbox())
# edge/vertex/wire mirror
print("[08] vertex mirror:", Vertex(1, 2, 3).mirror(Plane.XY))
print("[08] arc mirror:", CenterArc((5, 0), 2, 0, 90).mirror(Plane.YZ))
# mirror function form
print("[08] mirror(shape, plane) function:", mirror(half, Plane.YZ).bbox())
# mirror with a face as plane
try:
    print("[08] mirror(face):", half.mirror(half.faces().sort_by(X)[-1]).bbox())
except Exception as e:
    print("[08] mirror(face) ->", type(e).__name__, e)
try:
    print("[08] mirror(face.plane):", half.mirror(half.faces().sort_by(X)[-1].plane).bbox())
except Exception as e:
    print("[08] mirror(face.plane) ->", type(e).__name__, e)
print("[08] ShapeList.mirror exists:", hasattr(ShapeList, "mirror"))
snapshot("mirror", whole, view="iso")
snapshot("L", both, view="top")
