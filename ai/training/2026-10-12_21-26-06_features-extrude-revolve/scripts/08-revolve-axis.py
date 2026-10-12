def rep(tag, p):
    b = p.bbox()
    print(f"[{tag}] {type(p).__name__} valid={p.is_valid()} vol={p.volume:.4f} min={tuple(round(v,4) for v in b.min.to_tuple())} max={tuple(round(v,4) for v in b.max.to_tuple())} faces={len(p.faces())}")

def tryit(tag, fn):
    try:
        rep(tag, fn())
    except Exception as e:
        print(f"[{tag}] {type(e).__name__}: {e}")

# touching: one edge on the axis -> solid cylinder
tryit("touching edge", lambda: Rectangle(10, 20, align=(Align.MIN, Align.MIN)).on(Plane.front).revolve())
print("expected cyl", math.pi*100*20)
# touching at a single point (triangle vertex on axis)
tryit("touching point", lambda: Polygon((0, 0), (10, 5), (10, -5)).on(Plane.front).revolve())
# crossing the axis: centered rectangle
tryit("crossing (centered rect)", lambda: Rectangle(10, 20).on(Plane.front).revolve())
print("full cyl if only one side counted", math.pi*25*20)
tryit("crossing asym", lambda: Rectangle(10, 20).translate(3, 0).on(Plane.front).revolve())
tryit("crossing 90deg", lambda: Rectangle(10, 20).on(Plane.front).revolve(Z, 90))
# axis offset (not through origin): Axis((40,0,0),(0,0,1))
tryit("offset axis", lambda: Rectangle(10, 20).on(Plane.front).revolve(Axis((40, 0, 0), (0, 0, 1))))
print("expected offset", 200*2*math.pi*40)
# axis X for profile in XY (in plane) -> about X
tryit("XY about X", lambda: Circle(3).translate(0, 10).revolve(X))
print("expected torus", math.pi*9*2*math.pi*10)
# axis not in the sketch plane: XY sketch about Z
tryit("axis normal to plane", lambda: Circle(3).translate(10, 0).revolve(Z))
# axis skew (in plane but tilted)
tryit("tilted axis in plane", lambda: Circle(3).translate(10, 0).revolve(Axis((0, 0, 0), (1, 1, 0))))
# sketch with a hole
tryit("with hole", lambda: (Circle(5) - Circle(2)).translate(20, 0).on(Plane.front).revolve())
print("expected", math.pi*(25-4)*2*math.pi*20)
# two regions
tryit("two regions", lambda: (Rectangle(4, 4).translate(10, 0) + Rectangle(4, 4).translate(20, 0)).on(Plane.front).revolve())
print("expected", 16*2*math.pi*(10+20))
