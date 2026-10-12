# Wire.fillet: all corners, selected corners, open wire, too large radius, arcs next to corners
sq = Polyline((0, 0), (20, 0), (20, 10), (0, 10), close=True)
f = sq.fillet(2)
print("[08] closed square:", f, [e.geom_type for e in f.edges()])
arcs = [e for e in f.edges() if e.geom_type == "circle"]
print("[08] arc radii:", [round(e.radius, 6) for e in arcs], "centers", [e.arc_center.to_tuple() for e in arcs])
print("[08] length:", f.length, "expected", 60 - 8 * 2 + 4 * math.pi * 2 / 2)
print("[08] face area:", make_face(f).area, "expected", 200 - 4 * (4 - math.pi))
o = Polyline((0, 0), (20, 0), (20, 10), (0, 10))
fo = o.fillet(3)
print("[08] open:", fo, "start", fo.start, "end", fo.end, [e.geom_type for e in fo.edges()])
sel = sq.fillet(4, vertices=[(20, 0), Vertex(20, 10)])
print("[08] selected 2 corners:", [e.geom_type for e in sel.edges()], "area", round(make_face(sel).area, 6), "expected", round(200 - 2 * 16 * (1 - math.pi / 4), 6))
none = sq.fillet(2, vertices=[(5, 5)])
print("[08] vertex not on corner -> unchanged:", none, [e.geom_type for e in none.edges()])
# radius limits on a 20x10 rectangle: the 10 side carries two setbacks of r
for r in (4.999, 5.0, 5.001, 6):
    try:
        x = sq.fillet(r)
        print(f"[08] r={r}: {x}, edges {[e.geom_type for e in x.edges()]}")
    except Exception as ex:
        print(f"[08] r={r} ->", type(ex).__name__, ex)
for r in (0, -1):
    try:
        x = sq.fillet(r)
        print(f"[08] r={r}: {x}, {[e.geom_type for e in x.edges()]}, length {x.length}")
    except Exception as ex:
        print(f"[08] r={r} ->", type(ex).__name__, ex)
# obtuse and acute corners
tri = Polyline((0, 0), (30, 0), (0, 10), close=True)
ft = tri.fillet(1)
print("[08] triangle:", ft, "area", round(make_face(ft).area, 4))
# corner between a line and an arc is skipped
la = Wire([Line((0, 0), (10, 0)), CenterArc((10, 5), 5, -90, 180), Line((10, 10), (0, 10))]).close()
fla = la.fillet(1)
print("[08] line/arc wire:", [e.geom_type for e in la.edges()], "->", [e.geom_type for e in fla.edges()])
snapshot("fillet", f, fo.translate(30, 0), sel.translate(0, 20), ft.translate(30, 20), view="top")
