duct = loft([Rectangle(40, 30), Circle(12).rotate(Z, 45).translate(0, 0, 40)])
for tag, op in [("top only t2", (2, duct.faces().top())), ("bottom only t2", (2, duct.faces().bottom())),
                ("both t1", (1, duct.faces().top() + duct.faces().bottom())), ("closed t2", (2, None))]:
    try:
        h = duct.shell(op[0], op[1])
        print(f"[{tag}] valid={h.is_valid()} vol={h.volume:.2f}")
    except Exception as e:
        print(f"[{tag}] {type(e).__name__}: {e}")
# a prismatic part with two openings for comparison
tube = Box(40, 30, 40)
try:
    h = tube.shell(2, tube.faces().top() + tube.faces().bottom())
    print("[box both ends] valid", h.is_valid(), "vol", round(h.volume, 2), "expected", 40*30*40 - 36*26*40)
except Exception as e:
    print(f"[box both ends] {type(e).__name__}: {e}")
# workaround for an open duct: cut an inner loft
inner = loft([Rectangle(36, 26).translate(0, 0, -1), Circle(10).rotate(Z, 45).translate(0, 0, 41)])
open_duct = duct - inner
print("[duct - inner loft] valid", open_duct.is_valid(), "vol", round(open_duct.volume, 2), "faces", len(open_duct.faces()))
snapshot("open", open_duct)
