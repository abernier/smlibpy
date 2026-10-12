# Polygon: point lists, closing, orientation, self-intersection, align, 3D points
def bb(s):
    b = s.bbox()
    return f"{tuple(round(v, 6) for v in b.min)}..{tuple(round(v, 6) for v in b.max)}"
def attempt(label, fn):
    try:
        s = fn()
        print(f"[04] {label}: {s!r} bbox={bb(s)} edges={len(s.edges())} normal={s.faces()[0].normal_at() if s.faces() else None} plane z={s.plane.z_dir}")
        return s
    except Exception as e:
        print(f"[04] {label}: {type(e).__name__}: {e}")
pts = [(0, 0), (30, 0), (30, 10), (10, 25), (0, 25)]
attempt("varargs", lambda: Polygon(*pts))
attempt("one list", lambda: Polygon(pts))
attempt("tuple of tuples", lambda: Polygon(tuple(pts)))
attempt("Vectors", lambda: Polygon(*[Vector(*p) for p in pts]))
attempt("first point repeated", lambda: Polygon(*pts, pts[0]))
attempt("clockwise", lambda: Polygon(*reversed(pts)))
attempt("align CENTER", lambda: Polygon(*pts, align=Align.CENTER))
attempt("align MIN on shifted pts", lambda: Polygon((10, 10), (20, 10), (15, 20), align=Align.MIN))
attempt("two points", lambda: Polygon((0, 0), (10, 0)))
attempt("collinear 3 points", lambda: Polygon((0, 0), (10, 0), (20, 0)))
attempt("collinear midpoint on edge", lambda: Polygon((0, 0), (10, 0), (20, 0), (20, 10), (0, 10)))
attempt("duplicate consecutive", lambda: Polygon((0, 0), (10, 0), (10, 0), (10, 10)))
attempt("bowtie (self-intersecting)", lambda: Polygon((0, 0), (10, 10), (10, 0), (0, 10)))
attempt("touching itself at a vertex", lambda: Polygon((0, 0), (20, 0), (10, 10), (20, 20), (0, 20), (10, 10)))
attempt("3D points in a tilted plane", lambda: Polygon((0, 0, 0), (10, 0, 0), (10, 10, 10), (0, 10, 10)))
attempt("3D points, z = 5", lambda: Polygon((0, 0, 5), (10, 0, 5), (10, 10, 5)))
attempt("non-planar 3D points", lambda: Polygon((0, 0, 0), (10, 0, 0), (10, 10, 5), (0, 10, 0)))
