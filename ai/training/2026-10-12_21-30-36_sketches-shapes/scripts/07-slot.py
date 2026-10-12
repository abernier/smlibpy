# Slot: length overall, width, rotation, align, length <= width
def bb(s):
    b = s.bbox()
    return f"{tuple(round(v, 4) for v in b.min)}..{tuple(round(v, 4) for v in b.max)}"
def attempt(label, fn):
    try:
        s = fn()
        print(f"[07] {label}: {s!r} bbox={bb(s)} edges={[e.geom_type for e in s.edges()]} plane origin={s.plane.origin}")
        return s
    except Exception as e:
        print(f"[07] {label}: {type(e).__name__}: {e}")
s = attempt("Slot(30, 10)", lambda: Slot(30, 10))
print("[07] area:", round(s.area, 6), "formula (L-W)*W + pi (W/2)^2:", round(20 * 10 + math.pi * 25, 6))
print("[07] arc centers:", [e.arc_center for e in s.edges() if e.geom_type == "circle"], "radii:", [e.radius for e in s.edges() if e.geom_type == "circle"])
attempt("rotation 90", lambda: Slot(30, 10, rotation=90))
attempt("rotation 30", lambda: Slot(30, 10, rotation=30))
attempt("align MIN", lambda: Slot(30, 10, align=Align.MIN))
attempt("rotation 90 + align MIN", lambda: Slot(30, 10, rotation=90, align=Align.MIN))
attempt("length == width", lambda: Slot(10, 10))
attempt("length < width", lambda: Slot(6, 10))
attempt("length 10.001 width 10", lambda: Slot(10.001, 10))
attempt("width 0", lambda: Slot(30, 0))
attempt("negative width", lambda: Slot(30, -10))
attempt("negative length", lambda: Slot(-30, 10))
try:
    Slot(30, 10, 45)
except Exception as e:
    print("[07] positional rotation:", type(e).__name__, e)
# realistic: slot on a face, cut through
plate = Box(60, 40, 8)
cut = plate - Slot(30, 8, rotation=90).on(plate.faces().top()).extrude(-8)
print("[07] cut through:", repr(cut), "valid:", cut.is_valid(), "removed:", round(plate.volume - cut.volume, 4), "expected:", round((22 * 8 + math.pi * 16) * 8, 4))
snapshot("slots", cut, view="top")
