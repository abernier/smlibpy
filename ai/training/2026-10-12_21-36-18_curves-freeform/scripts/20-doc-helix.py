# Doc examples, copied verbatim from the docs listed below

# ---- Helix.md block 1
print('==== Helix.md block 1')
spring = sweep(Circle(1.2), Helix(pitch=6, height=48, radius=10))     # valid, volume pi*1.44*L
rod = Cylinder(5, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
tooth = Polygon((0, -0.8), (0, 0.8), (1.2, 0))                         # tip towards +X
thread = sweep(tooth, Helix(pitch=2, height=16, radius=5.6, center=(0, 0, 2)))
screw = rod + thread                                                   # valid, one solid

# ---- Helix.md block 2
print('==== Helix.md block 2')
h = Helix(pitch=5, height=20, radius=10)               # (10, 0, 0) -> (10, 0, 20), 4 turns
lh = Helix(5, 20, 10, left_handed=True)
cone = sweep(Circle(0.8), Helix(5, 20, 10, end_radius=4))
long = sweep(Circle(1), Wire([Helix(4, 12, 8), Helix(4, 12, 8, center=(0, 0, 12))]))
print(h.start, h.end, h.point_at(1 / 16))              # quarter turn: (0, 10, 1.25)
print("[20] spring", spring.is_valid(), "screw", screw.is_valid(), len(screw.solids()), "cone", cone.is_valid(), "long", long.is_valid(), round(long.volume, 3))
