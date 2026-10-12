# make_face: errors and edge cases
def attempt(label, fn):
    try:
        s = fn()
        print(f"[02] {label}: {s!r} faces={len(s.faces())} holes={[len(f.inner_wires()) for f in s.faces()]} plane z={s.plane.z_dir} origin={s.plane.origin}")
        return s
    except Exception as e:
        print(f"[02] {label}: {type(e).__name__}: {e}")
sq = Polyline((0, 0), (20, 0), (20, 20), (0, 20), close=True)
attempt("open wire", lambda: make_face(Polyline((0, 0), (20, 0), (20, 20), (0, 20))))
attempt("open wire .close()", lambda: make_face(Polyline((0, 0), (20, 0), (20, 20), (0, 20)).close()))
attempt("open single Line", lambda: make_face(Line((0, 0), (10, 0))))
attempt("open arc", lambda: make_face(CenterArc((0, 0), 10, 0, 180)))
attempt("gap 1e-3", lambda: make_face(Wire([Line((0, 0), (20, 0)), Line((20, 0), (20, 20)), Line((20, 20), (0, 20)), Line((0, 20), (0, 0.001))])))
attempt("gap 1e-7", lambda: make_face(Wire([Line((0, 0), (20, 0)), Line((20, 0), (20, 20)), Line((20, 20), (0, 20)), Line((0, 20), (0, 1e-7))])))
attempt("self-crossing (bowtie)", lambda: make_face(Polyline((0, 0), (10, 10), (10, 0), (0, 10), close=True)))
attempt("non-planar", lambda: make_face(Polyline((0, 0, 0), (10, 0, 0), (10, 10, 5), (0, 10, 0), close=True)))
attempt("list of edges", lambda: make_face([Line((0, 0), (10, 0)), Line((10, 0), (0, 10)), Line((0, 10), (0, 0))]))
attempt("hole outside the outer", lambda: make_face(sq, CenterArc((50, 50), 3, 0, 360)))
attempt("hole crossing the boundary", lambda: make_face(sq, CenterArc((20, 10), 3, 0, 360)))
attempt("hole touching boundary inside", lambda: make_face(sq, CenterArc((17, 10), 3, 0, 360)))
attempt("hole bigger than outer", lambda: make_face(sq, CenterArc((10, 10), 30, 0, 360)))
attempt("overlapping holes", lambda: make_face(sq, CenterArc((8, 10), 3, 0, 360), CenterArc((12, 10), 3, 0, 360)))
attempt("open hole", lambda: make_face(sq, CenterArc((10, 10), 3, 0, 180)))
attempt("hole in another plane", lambda: make_face(sq, CenterArc((10, 10), 3, 0, 360).translate(0, 0, 5)))
# vertical and tilted wires: which way is the normal?
for name, pts in [
    ("XZ wire ccw seen from -Y", [(0, 0, 0), (20, 0, 0), (20, 0, 10), (0, 0, 10)]),
    ("XZ wire reversed", [(0, 0, 10), (20, 0, 10), (20, 0, 0), (0, 0, 0)]),
    ("YZ wire", [(0, 0, 0), (0, 20, 0), (0, 20, 10), (0, 0, 10)]),
    ("YZ wire reversed", [(0, 0, 10), (0, 20, 10), (0, 20, 0), (0, 0, 0)]),
    ("XY wire at z=5 clockwise", [(0, 0, 5), (0, 10, 5), (10, 10, 5), (10, 0, 5)]),
    ("tilted 45", [(0, 0, 0), (10, 0, 0), (10, 10, 10), (0, 10, 10)]),
    ("tilted 45 reversed", [(0, 10, 10), (10, 10, 10), (10, 0, 0), (0, 0, 0)]),
    ("plane x+y=0", [(0, 0, 0), (10, -10, 0), (10, -10, 10), (0, 0, 10)]),
]:
    s = attempt(name, lambda: make_face(Polyline(*pts, close=True)))
    if s is not None:
        b = s.extrude(2).bbox()
        print(f"[02]   extrude(2) bbox {b.min}..{b.max}")
