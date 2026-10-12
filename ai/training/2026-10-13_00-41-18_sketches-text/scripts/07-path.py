# text along a curve
over = CenterArc((0, 0), 30, 170, -160)        # clockwise over the top: letters stand outside
under = CenterArc((0, 0), 30, 200, 140)        # counterclockwise along the bottom: letters inside, readable
top = Text("TEXT ON AN ARC", 4, path=over)
bottom = Text("READS FROM BELOW", 4, path=under, align=(Align.CENTER, Align.MAX))
print("[07] over: faces", len(top.faces()), "area", round(top.area, 4), "straight", round(Text("TEXT ON AN ARC", 4).area, 4))
h = Text("H", 4, path=CenterArc((0, 0), 30, 180, -180), align=(Align.CENTER, Align.CENTER)).bbox()
print(f"[07] H centered on the top of the arc: y {h.min.y:.6f}..{h.max.y:.6f}")
for a in (Align.MIN, Align.CENTER, Align.MAX):
    b = Text("H", 4, path=CenterArc((0, 0), 30, 180, -180), align=(Align.CENTER, a)).bbox()
    print(f"[07] across={a}: y {b.min.y:.4f}..{b.max.y:.4f}")
for a in (Align.MIN, Align.CENTER, Align.MAX):
    b = Text("AB", 4, path=Line((0, 0), (100, 0)), align=(a, Align.MIN)).bbox()
    print(f"[07] along={a} on a 100 mm line: x {b.min.x:.4f}..{b.max.x:.4f}")
wave = Spline((0, 0), (20, 8), (40, 0), (60, -8), (80, 0))
w = Text("ALONG A SPLINE", 4, path=wave)
print("[07] spline path: faces", len(w.faces()), "valid extrude", w.extrude(1).is_valid())
for bad in (dict(text="A VERY LONG TEXT FOR A SHORT ARC", path=CenterArc((0, 0), 5, 0, 90)),
            dict(text="A", path=Line((0, 0, 0), (10, 0, 5))), dict(text="A\nB", path=over)):
    try:
        Text(bad["text"], 4, path=bad["path"])
    except ValueError as e:
        print("[07] ValueError:", e)
snapshot("arcs", top, bottom, over, under, view="top", size=(900, 900))
