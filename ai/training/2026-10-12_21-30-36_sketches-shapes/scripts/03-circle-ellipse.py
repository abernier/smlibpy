# Circle and Ellipse: radius, align, orientation, errors
def bb(s):
    b = s.bbox()
    return f"{tuple(round(v, 6) for v in b.min)}..{tuple(round(v, 6) for v in b.max)}"
def attempt(label, fn):
    try:
        s = fn()
        print(f"[03] {label}: {s!r} bbox={bb(s)} edges={[e.geom_type for e in s.edges()]}")
        return s
    except Exception as e:
        print(f"[03] {label}: {type(e).__name__}: {e}")
c = attempt("Circle(10)", lambda: Circle(10))
print("[03] circle radius/center:", c.edges()[0].radius, c.edges()[0].arc_center, "vertex:", tuple(c.vertices()[0]))
attempt("Circle align MIN", lambda: Circle(10, align=Align.MIN))
attempt("Circle align (CENTER, MIN)", lambda: Circle(10, align=(Align.CENTER, Align.MIN)))
attempt("Circle(0)", lambda: Circle(0))
attempt("Circle(-1)", lambda: Circle(-1))
cyl = Circle(10).extrude(5)
print("[03] circle extrude faces:", len(cyl.faces()), "volume:", round(cyl.volume, 4), "formula:", round(math.pi * 500, 4))
e = attempt("Ellipse(15, 8)", lambda: Ellipse(15, 8))
print("[03] ellipse area:", round(e.area, 6), "pi a b:", round(math.pi * 120, 6), "vertex:", tuple(round(v, 6) for v in e.vertices()[0]))
attempt("Ellipse(8, 15)", lambda: Ellipse(8, 15))
attempt("Ellipse(10, 10)", lambda: Ellipse(10, 10))
attempt("Ellipse align MIN", lambda: Ellipse(15, 8, align=Align.MIN))
attempt("Ellipse rotated 30", lambda: Ellipse(15, 8).rotate(Z, 30))
for args in [(0, 8), (15, 0), (-15, 8), (15, -8), (-15, -8)]:
    s = attempt(f"Ellipse{args}", lambda: Ellipse(*args))
    if s is not None:
        try:
            print(f"[03]   area {s.area}, extrude: {s.extrude(2)!r}")
        except Exception as ex:
            print(f"[03]   extrude: {type(ex).__name__}: {ex}")
ee = Ellipse(15, 8).extrude(5)
print("[03] ellipse extrude:", repr(ee), "valid:", ee.is_valid(), "faces:", len(ee.faces()))
snapshot("shapes", Circle(10), Ellipse(15, 8).translate(30, 0), Ellipse(8, 15).translate(55, 0), view="top")
