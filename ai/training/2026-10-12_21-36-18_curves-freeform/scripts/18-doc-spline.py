# Doc examples, copied verbatim from the docs listed below

# ---- Spline.md block 1
print('==== Spline.md block 1')
s = Spline((0, 0), (10, 5), (20, -5), (30, 0))
flat = Spline((0, 0), (10, 5), (20, -5), (30, 0), tangents=((1, 0), (1, 0)))
blob = make_face(Spline((0, 0), (20, -5), (35, 5), (25, 20), (5, 15), closed=True)).extrude(4)
tube = sweep(Circle(2), Spline((0, 0, 0), (0, 10, 20), (30, 10, 40)))
# a spline top tangent to two vertical sides
top = Spline((40, 10), (25, 20), (10, 15), (0, 10), tangents=((0, 1), (0, -1)))
cam = make_face(Wire([Line((0, 0), (40, 0)), Line((40, 0), (40, 10)), top, Line((0, 10), (0, 0))])).extrude(6)
print("[18] s", s, "flat t0", flat.tangent_at(0), "blob", blob.is_valid(), "tube", tube.is_valid(), "cam", cam.is_valid(), round(cam.volume, 3))
# claim: a closed spline path can be split into two open splines that sweep fine
loop = [(20, 0), (0, 20), (-20, 0), (0, -20)]
a = Spline((20, 0), (0, 20), (-20, 0), tangents=((0, 1), (0, -1)))
b = Spline((-20, 0), (0, -20), (20, 0), tangents=((0, -1), (0, 1)))
ring = sweep(Circle(1), Wire([a, b]))
print("[18] two open splines as loop path: valid", ring.is_valid(), "volume", round(ring.volume, 4), "pi*L", round(math.pi * (a.length + b.length), 4))
