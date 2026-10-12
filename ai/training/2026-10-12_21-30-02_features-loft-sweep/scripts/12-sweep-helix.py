def rep(tag, p):
    b = p.bbox()
    print(f"[{tag}] valid={p.is_valid()} vol={p.volume:.4f} min={tuple(round(v,3) for v in b.min.to_tuple())} max={tuple(round(v,3) for v in b.max.to_tuple())} faces={len(p.faces())} solids={len(p.solids())}")

h = Helix(pitch=5, height=30, radius=10)
print("helix start", tuple(round(v, 3) for v in h.start.to_tuple()), "end", tuple(round(v, 3) for v in h.end.to_tuple()), "len", round(h.length, 4))
L = 6*math.hypot(2*math.pi*10, 5)
print("analytic length", L)
spring = sweep(Circle(1), h)
rep("spring", spring); print("expected", math.pi*1*L)
# profile larger than pitch allows: circle radius 3 with pitch 5 -> coils overlap
try:
    ov = sweep(Circle(3), h)
    rep("overlapping coils r3 pitch5", ov)
except Exception as e:
    print(f"[overlapping coils] {type(e).__name__}: {e}")
# thread-like triangle: where does it point?
tri = Polygon((0, -1.5), (1.5, 0), (0, 1.5))   # points along +x in the sketch
th = sweep(tri, h)
rep("triangle along helix", th)
# where is the triangle at the start: section with plane through the helix start, normal = tangent
t0 = h.tangent_at(0)
sec = th.section(Plane(h.start, z_dir=t0))
sb = sec.bbox()
print("start section bbox", tuple(round(v, 3) for v in sb.min.to_tuple()), tuple(round(v, 3) for v in sb.max.to_tuple()), "area", round(sec.area, 3))
# square thread profile, radial orientation check: radial extent of the swept body
sq = sweep(Rectangle(2, 1), h)
rep("rect 2x1 along helix", sq)
b = sq.bbox()
print("radial extent (x max - 10):", round(b.max.x - 10, 3))
# conical helix
ch = Helix(pitch=6, height=30, radius=10, end_radius=4)
cs = sweep(Circle(1), ch)
rep("conical", cs)
# left handed
lh = sweep(Circle(1), Helix(pitch=5, height=30, radius=10, left_handed=True))
rep("left handed", lh)
# many turns (fine pitch)
fine = sweep(Circle(0.4), Helix(pitch=1, height=20, radius=5))
rep("fine 20 turns", fine); print("expected", math.pi*0.16*20*math.hypot(2*math.pi*5, 1))
snapshot("helix", spring, th.translate(30, 0, 0), cs.translate(60, 0, 0))
