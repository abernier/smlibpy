# Doc examples, copied verbatim from the docs listed below

# ---- CenterArc.md block 1
print('==== CenterArc.md block 1')
quarter = CenterArc((0, 0), 10, 0, 90)                  # (10, 0) -> (0, 10), ccw
cw = CenterArc((0, 0), 10, 0, -90)                      # (10, 0) -> (0, -10), cw
bend = CenterArc((0, 0), 20, 0, 90, plane=Plane.XZ)     # (20, 0, 0) -> (0, 0, 20)
tube = sweep(Circle(2), bend)                           # volume pi * 4 * 10 * pi
outline = Polyline((0, 0), (40, 0), (40, 30), (0, 30), close=True)
plate = make_face(outline, CenterArc((20, 15), 6, 0, 360)).extrude(5)

# ---- ThreePointArc.md block 1
print('==== ThreePointArc.md block 1')
top = ThreePointArc((-10, 0), (0, 10), (10, 0))         # upper half circle, r = 10
major = ThreePointArc((10, 0), (-10, 0), (0, -10))      # 270 degrees, length 47.12
tilted = ThreePointArc((0, 0, 0), (5, 5, 5), (10, 0, 10))   # 3D, r = 7.5
half = Wire([
    Line((-25, 0), (-25, -7.5)),
    ThreePointArc((-25, -7.5), (0, -15), (25, -7.5)),
    Line((25, -7.5), (25, 0)),
])

# ---- RadiusArc.md block 1
print('==== RadiusArc.md block 1')
a, b = (0, 0), (10, 0)
left = RadiusArc(a, b, 10)       # bulges to +Y: mid (5, 1.33975)
right = RadiusArc(a, b, -10)     # bulges to -Y
half = RadiusArc(a, b, 5)        # half circle through (5, 5)
# D shape traversed counterclockwise: the arc from (20, 0) back to (-20, 0) must bulge to +Y,
# which is right of its travel direction (-X): negative radius
d = Wire([Line((-20, 0), (20, 0)), RadiusArc((20, 0), (-20, 0), -20)])
plate = make_face(d).extrude(5)  # volume pi * 400 / 2 * 5

# ---- SagittaArc.md block 1
print('==== SagittaArc.md block 1')
bump = SagittaArc((0, 0), (10, 0), 2)        # middle (5, 2), r 7.25
dent = SagittaArc((0, 0), (10, 0), -2)       # middle (5, -2)
big = SagittaArc((0, 0), (10, 0), 8)         # major arc, length 22.52
# a lens: both arcs bulge to the right of their own travel direction, i.e. outward
lens = Wire([SagittaArc((-10, 0), (10, 0), -3), SagittaArc((10, 0), (-10, 0), -3)])
print(make_face(lens).area)                  # 81.42202, bbox y -3..3

# ---- TangentArc.md block 1
print('==== TangentArc.md block 1')
l1 = Line((0, 0), (20, 0))
a1 = TangentArc(l1.end, (20, 10), l1.tangent_at(1))
l2 = Line(a1.end, (0, 10))
a2 = TangentArc(l2.end, (0, 0), l2.tangent_at(1))
slot = make_face(Wire([l1, a1, l2, a2]))     # area 200 + 25 * pi, all joints tangent

# ---- TangentArc.md block 2
print('==== TangentArc.md block 2')
up = TangentArc((0, 0), (10, 0), (0, 1))          # half circle, r 5, center (5, 0)
print(up.tangent_at(0), up.radius)                 # (0, 1, 0) 5.0
bend3d = TangentArc((0, 0, 0), (10, 0, 10), (0, 0, 1))   # in XZ, r 10, center (10, 0, 0)

# ---- EllipticalArc.md block 1
print('==== EllipticalArc.md block 1')
oval = make_face(EllipticalArc((0, 0), 20, 10))               # area 628.3186
quarter = EllipticalArc((0, 0), 20, 10, 0, 90)                # (20, 0) -> (0, 10)
upright = EllipticalArc((0, 0), 20, 10, 0, 90, plane=Plane.XZ)   # (20, 0, 0) -> (0, 0, 10)
right_half = Wire([EllipticalArc((0, 0), 20, 10, 270, 360), EllipticalArc((0, 0), 20, 10, 0, 90)])
half = Wire([EllipticalArc((0, 0), 20, 10, 0, 180), Line((-20, 0), (20, 0))])   # area 100 * pi

# ---- checks of the claims in the comments above
print("[14] quarter", quarter.start, quarter.end, "cw", cw.start, cw.end, "bend", bend.start, bend.end)
print("[14] tube", tube.is_valid(), round(tube.volume, 4), round(math.pi * 4 * 10 * math.pi, 4))
print("[14] plate", plate.is_valid(), round(plate.volume, 4), round((1200 - 36 * math.pi) * 5, 4))
print("[14] top r", top.radius, "major len", round(major.length, 4), "tilted r", tilted.radius, "half", half)
print("[14] left mid", left.point_at(0.5), "right mid", right.point_at(0.5), "half mid", half_arc_mid if False else RadiusArc(a, b, 5).point_at(0.5))
print("[14] d mid", d.edges()[1].point_at(0.5), "plate", round(plate.volume, 4), round(math.pi * 400 / 2 * 5, 4))
print("[14] bump", bump.point_at(0.5), bump.radius, "dent", dent.point_at(0.5), "big", round(big.length, 4))
print("[14] lens bbox", make_face(lens).bbox().min, make_face(lens).bbox().max)
print("[14] slot", round(slot.area, 5), round(200 + 25 * math.pi, 5), "bend3d", bend3d.radius, bend3d.arc_center)
print("[14] oval", round(oval.area, 4), "quarter", quarter.start, quarter.end, "upright", upright.start, upright.end)
print("[14] right_half", right_half, right_half.start, right_half.end, "half area", round(make_face(half).area, 4))
