# is bbox tight for body edges vs standalone edges?
sp = Spline((30, 0), (20, 15), (0, 0))
dense = max(sp.point_at(i / 4000).y for i in range(4001))
print("[02] standalone spline bbox max y:", sp.bbox().max.y, "dense:", dense)
sk = make_face(Polyline((0, 0), (30, 0)) + sp)
print("[02] sketch bbox max y:", sk.bbox().max.y)
e = [x for x in sk.edges() if x.geom_type != "line"][0]
print("[02] edge from sketch bbox max y:", e.bbox().max.y, "type", e.geom_type)
sp2 = Spline((0, 0), (10, 10), (20, -10), (30, 0))
d2 = max(sp2.point_at(i / 4000).y for i in range(4001))
print("[02] spline2 standalone bbox max y:", sp2.bbox().max.y, "dense:", d2, "short by", d2 - sp2.bbox().max.y)
part = make_face(sp2 + Line((30, 0), (0, 0))) if False else None
w = Wire([CenterArc((0, 0), 10, 10, 90)])
print("[02] wire of arc bbox max y:", w.bbox().max.y)
pr = Rectangle(4, 4).extrude(2).translate(0, 0, 0)
ex = (Circle(10) & Rectangle(40, 40).translate(0, -20 + 1.7364817766693)).extrude(3)  # cut circle
print("[02] extruded partial circle bbox:", ex.bbox())
