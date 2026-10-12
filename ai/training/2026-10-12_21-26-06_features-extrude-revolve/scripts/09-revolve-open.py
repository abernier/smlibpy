# open curve -> surface of revolution
arc = CenterArc((0, 0), 10, -90, 180, plane=Plane.front)
b = arc.bbox(); print("arc bbox", b.min.to_tuple(), b.max.to_tuple())
s = revolve(arc, Z)
bb = s.bbox()
print("[open arc] type", type(s).__name__, "area", round(s.area, 4), "sphere", 4*math.pi*100, bb.min.to_tuple(), bb.max.to_tuple())
l = Line((10, 0, 0), (10, 0, 20))
s2 = revolve(l, Z, 180)
print("[line half] area", round(s2.area, 4), "expected", math.pi*10*20)
try:
    s3 = revolve(Line((-5, 0, 0), (10, 0, 20)), Z)
    print("[crossing line] area", round(s3.area, 4), type(s3).__name__)
except Exception as e:
    print(f"[crossing line] {type(e).__name__}: {e}")
# revolve a planar face of a part
box = Box(10, 10, 10).translate(20, 0, 0)
fr = box.faces().facing(-Y)[0]
p = fr.to_sketch().revolve(Z, 90)
print("[face revolve] vol", round(p.volume, 3), "valid", p.is_valid())
try:
    p2 = revolve(box.faces().facing(-Y), Z, 90)
    print("[revolve(ShapeList)] vol", round(p2.volume, 3))
except Exception as e:
    print(f"[revolve(ShapeList)] {type(e).__name__}: {e}")
