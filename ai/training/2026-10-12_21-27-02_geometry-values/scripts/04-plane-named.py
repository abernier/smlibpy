# Plane: named planes, their axes
def show(n, p):
    print(f"[04] {n:7s} origin {p.origin} x {p.x_dir} y {p.y_dir} z {p.z_dir} repr {p!r}")
for n in ["XY", "YZ", "ZX", "XZ", "YX", "ZY", "top", "bottom", "front", "back", "left", "right"]:
    show(n, getattr(Plane, n))
print("[04] normal alias:", Plane.XZ.normal)
# defaults when only z_dir given
for zd in [(0, 0, 1), (0, 0, -1), (0, -1, 0), (0, 1, 0), (1, 0, 0), (-1, 0, 0), (1, 1, 0), (1, 0, 1), (0, 1, 1), (1, 1e-4, 0)]:
    p = Plane(z_dir=zd)
    print("[04] Plane(z_dir=", zd, ") x", p.x_dir, "y", p.y_dir)
# positional args
p = Plane((1, 2, 3), (0, 1, 0), (0, 0, 1))
show("pos3", p)
p = Plane((0, 0, 0), (1, 1, 1), (0, 0, 1))
show("xproj", p)
try:
    Plane((0, 0, 0), (0, 0, 1), (0, 0, 1))
except Exception as e:
    print("[04] x parallel z ->", type(e).__name__, e)
try:
    Plane((0, 0, 0), z_dir=(0, 0, 0))
except Exception as e:
    print("[04] zero z ->", type(e).__name__, e)
# sketch drawn upward on each side plane: where does local +Y go?
for n in ["front", "back", "left", "right", "XZ", "ZX", "YZ"]:
    pl = getattr(Plane, n)
    s = Rectangle(10, 20, align=(Align.CENTER, Align.MIN)).on(pl)
    print(f"[04] Rectangle(10,20,MIN y).on({n}) bbox", s.bbox(), "sketch normal", s.plane.z_dir)
