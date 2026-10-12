# Helix: start point, handedness, pitch/height/radius, turns, length, center, direction
def info(tag, h):
    print(f"[08] {tag}: start {h.start} end {h.end} t0 {h.tangent_at(0)} len {h.length:.6f} bbox {h.bbox().min} {h.bbox().max} type {h.geom_type}")
h = Helix(pitch=5, height=20, radius=10)
info("default", h)
L = 4 * math.hypot(2 * math.pi * 10, 5)
print("[08] expected length 4 turns:", L)
# right-handed: counterclockwise seen from +Z while rising
q = h.point_at(1 / 16)
print("[08] point after 1/4 turn:", q, "(right-handed rises ccw: expect +Y)")
hl = Helix(pitch=5, height=20, radius=10, left_handed=True)
info("left", hl)
print("[08] left point after 1/4 turn:", hl.point_at(1 / 16))
info("fractional turns 2.5", Helix(4, 10, 10))
info("center (5,5,5)", Helix(5, 20, 10, center=(5, 5, 5)))
info("direction X", Helix(5, 20, 10, direction=(1, 0, 0)))
info("direction -Z", Helix(5, 20, 10, direction=(0, 0, -1)))
info("direction (1,1,0)", Helix(5, 20, 10, direction=(1, 1, 0)))
info("cone end_radius 5", Helix(5, 20, 10, end_radius=5))
for args, kw in [((5, 20, 10), {"end_radius": 0}), ((0, 20, 10), {}), ((5, 0, 10), {}), ((5, 20, 0), {}), ((-5, 20, 10), {}), ((5, 20, 10), {"end_radius": -1}),
                 ((50, 20, 10), {}), ((5, 20, 10), {"direction": (0, 0, 0)})]:
    try:
        e = Helix(*args, **kw)
        info(f"{args} {kw}", e)
    except Exception as ex:
        print("[08]", args, kw, "->", type(ex).__name__, str(ex).splitlines()[0])
snapshot("helix", Helix(5, 20, 10), Helix(5, 20, 10, left_handed=True).translate(30, 0, 0), Helix(5, 20, 10, end_radius=3).translate(60, 0, 0), view="front")
