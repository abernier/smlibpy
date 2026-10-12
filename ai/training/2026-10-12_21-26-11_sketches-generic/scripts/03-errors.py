# Error cases of 2D Booleans and empty sketches
def attempt(label, fn):
    try:
        r = fn()
        print(f"[03] {label}: ok ->", repr(r))
        return r
    except Exception as e:
        print(f"[03] {label}: {type(e).__name__}: {e}")

attempt("different planes", lambda: Rectangle(10, 10) + Rectangle(5, 5).on(Plane.XZ))
attempt("parallel offset planes", lambda: Rectangle(10, 10) + Rectangle(5, 5).on(Plane.XY.offset(5)))
attempt("flipped plane (same geometry)", lambda: Rectangle(10, 10) + Rectangle(5, 5).on(Plane.XY.flipped()))
attempt("sketch + part", lambda: Rectangle(10, 10) + Box(5, 5, 5))
attempt("part + sketch", lambda: Box(5, 5, 5) + Rectangle(10, 10))
attempt("sketch - part", lambda: Rectangle(10, 10) - Box(5, 5, 5))
attempt("sketch + edge", lambda: Rectangle(10, 10) + Line((0, 0), (20, 0)))
# bboxes overlap, regions do not
L = Polygon((0, 0), (20, 0), (20, 5), (5, 5), (5, 20), (0, 20))
attempt("bbox-overlap, region-disjoint intersect", lambda: L & Rectangle(10, 10, align=Align.MIN).translate(8, 8))
# empty sketch
empty = Rectangle(10, 10) - Rectangle(20, 20)
print("[03] empty:", repr(empty), "bbox:", attempt("empty bbox", lambda: empty.bbox()))
attempt("empty extrude", lambda: empty.extrude(5))
attempt("empty center", lambda: empty.center())
attempt("empty + rect", lambda: empty + Rectangle(4, 4))
attempt("rect - empty", lambda: Rectangle(4, 4) - empty)
# both on XZ: works?
xz = attempt("both on XZ", lambda: Rectangle(10, 10).on(Plane.XZ) - Circle(3).on(Plane.XZ))
if xz is not None:
    print("[03] xz plane:", xz.plane.z_dir, "area:", round(xz.area, 4), "bbox:", xz.bbox().min, xz.bbox().max)
