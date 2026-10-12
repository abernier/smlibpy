# Sketch.offset: edge types, holes, collapse, merging, placed sketches
def info(label, s):
    b = s.bbox()
    print(f"[04] {label}: {s!r} faces={len(s.faces())} holes={[len(f.inner_wires()) for f in s.faces()]} "
          f"bbox={tuple(round(v, 5) for v in b.min)}..{tuple(round(v, 5) for v in b.max)} plane z={s.plane.z_dir}")
def attempt(label, fn):
    try:
        s = fn(); info(label, s); return s
    except Exception as e:
        print(f"[04] {label}: {type(e).__name__}: {e}")
gs = Rectangle(40, 20).offset(2, round=False)
print("[04] sharp rect edge lengths:", sorted(round(e.length, 6) for e in gs.edges()))
g = Rectangle(40, 20).offset(2)
print("[04] round rect edge lengths:", sorted(round(e.length, 6) for e in g.edges()))
p = g.extrude(5)
print("[04] extruded offset faces:", sorted(f.geom_type for f in p.faces()), "planar:", sum(f.is_planar for f in p.faces()), "valid:", p.is_valid())
print("[04] lines()/circles() after offset:", len(g.edges().lines()), len(g.edges().circles()))
try:
    print("[04] fillet after offset:", repr(Rectangle(40, 20).offset(-2).fillet(3)))
except Exception as e:
    print("[04] fillet after offset:", type(e).__name__, e)
# holes
ring = Circle(10) - Circle(5)
attempt("ring +1 (hole shrinks)", lambda: ring.offset(1))
print("[04]   area", round(ring.offset(1).area, 4), "expected", round(math.pi * (121 - 16), 4))
attempt("ring -1 (hole grows)", lambda: ring.offset(-1))
print("[04]   area", round(ring.offset(-1).area, 4), "expected", round(math.pi * (81 - 36), 4))
attempt("ring +5 (hole closes exactly)", lambda: ring.offset(5))
attempt("ring +6 (hole gone)", lambda: ring.offset(6))
attempt("ring -2.5 (wall collapses exactly)", lambda: ring.offset(-2.5))
attempt("ring -3 (wall gone)", lambda: ring.offset(-3))
# collapse of an outer loop
attempt("rect 40x20 -9.9", lambda: Rectangle(40, 20).offset(-9.9))
attempt("rect 40x20 -10", lambda: Rectangle(40, 20).offset(-10))
attempt("rect 40x20 -11", lambda: Rectangle(40, 20).offset(-11))
# dumbbell splits into two?
db = Rectangle(10, 10).translate(-15, 0) + Rectangle(20, 2) + Rectangle(10, 10).translate(15, 0)
attempt("dumbbell", lambda: db)
attempt("dumbbell -1.5 (bar 2 wide vanishes)", lambda: db.offset(-1.5))
# pieces merge
two = Circle(5).translate(-6, 0) + Circle(5).translate(6, 0)
attempt("two circles gap 2", lambda: two)
attempt("two circles +2 (merge)", lambda: two.offset(2))
attempt("two circles +0.5", lambda: two.offset(0.5))
# placed sketches
xz = Rectangle(20, 10).on(Plane.XZ.offset(5))
attempt("on XZ.offset(5) +2", lambda: xz.offset(2))
attempt("on XZ.offset(5) -2", lambda: xz.offset(-2))
attempt("on XZ sharp", lambda: xz.offset(2, round=False))
# curves
attempt("ellipse +2", lambda: Ellipse(15, 8).offset(2))
attempt("ellipse -2", lambda: Ellipse(15, 8).offset(-2))
attempt("slot +1", lambda: Slot(30, 10).offset(1))
sp = make_face(Spline((0, 0), (20, 10), (0, 20), (-20, 10), closed=True))
attempt("spline +2", lambda: sp.offset(2))
attempt("spline -2", lambda: sp.offset(-2))
