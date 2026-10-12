# Parallel cylinders at the origin: is brep distance right? Which points are closest?
for dx, dy in ((20, 0), (0, 20), (20, 10), (10, 20), (-20, 10), (15, 15)):
    c1 = Cylinder(5, 20)
    c2 = Cylinder(3, 20).translate(dx, dy, 0)
    e = math.hypot(dx, dy) - 8
    d = c1.distance_to(c2)
    print(f"[05] cylinders r5 and r3 at ({dx},{dy}): d={d:.12g} exp={e:.12g} err={d-e:+.2e}")
# heights differ: same length but offset in z, so closest points are on the side faces
c1 = Cylinder(5, 20)
c2 = Cylinder(3, 40).translate(20, 10, 0)
print(f"[05] r3 longer: d={c1.distance_to(c2):.12g} exp={math.hypot(20, 10)-8:.12g}")
# point sampling reference: min over points of c2 side of distance to c1
c2 = Cylinder(3, 20).translate(20, 10, 0)
pts = [(20 + 3*math.cos(t), 10 + 3*math.sin(t), z) for t in np.linspace(0, 2*math.pi, 721) for z in (-10, 0, 10)]
print(f"[05] sampled min point distance: {min(c1.distance_to(p) for p in pts):.12g}")
