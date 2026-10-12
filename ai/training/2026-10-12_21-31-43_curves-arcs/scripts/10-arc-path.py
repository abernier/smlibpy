# An arc as a sweep path; a full circle as a path
bend = CenterArc((0, 0), 20, 0, 90, plane=Plane.XZ)
print("[10] bend start", bend.start, "end", bend.end, "t0", bend.tangent_at(0))
tube = sweep(Circle(2), bend)
print("[10] tube valid", tube.is_valid(), "volume", round(tube.volume, 4), "expected", round(math.pi * 4 * 20 * math.pi / 2, 4))
print("[10] tube bbox", tube.bbox().min, tube.bbox().max)
ring = sweep(Circle(2), CenterArc((0, 0), 20, 0, 360))
print("[10] ring valid", ring.is_valid(), "volume", round(ring.volume, 4), "expected", round(math.pi * 4 * 2 * math.pi * 20, 4))
snapshot("tube", tube, ring.translate(60, 0, 0), view="iso")
