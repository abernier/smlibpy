# Spline in use: many points, sweep path, outline mixed with lines
pts = [(i, 5 * math.sin(i / 10)) for i in range(0, 201, 2)]
big = Spline(*pts)
print("[07] 101 points: ok", round(big.length, 4), "max dev", max(big.distance_to(p) for p in pts))
path = Spline((0, 0, 0), (0, 10, 20), (30, 10, 40))
tube = sweep(Circle(2), path)
print("[07] sweep along spline: valid", tube.is_valid(), "volume", round(tube.volume, 4), "pi*4*L", round(math.pi * 4 * path.length, 4))
print("[07] path start", path.start, "t0", path.tangent_at(0), "tube bbox", tube.bbox().min, tube.bbox().max)
# outline: flat bottom, spline top, tangent to vertical sides
top = Spline((40, 10), (25, 20), (10, 15), (0, 10), tangents=((0, 1), (0, -1)))
outline = Wire([Line((0, 0), (40, 0)), Line((40, 0), (40, 10)), top, Line((0, 10), (0, 0))])
print("[07] outline closed", outline.is_closed)
for i, (e1, e2) in enumerate(zip(outline.edges(), list(outline.edges()[1:]) + [outline.edges()[0]])):
    print(f"[07]   joint {i}: {e1.tangent_at(1).angle_to(e2.tangent_at(0)):.4f} deg")
cam = make_face(outline).extrude(6)
print("[07] extruded valid", cam.is_valid(), "volume", round(cam.volume, 3))
snapshot("use", tube, cam.translate(50, 0, 0), view="iso")
