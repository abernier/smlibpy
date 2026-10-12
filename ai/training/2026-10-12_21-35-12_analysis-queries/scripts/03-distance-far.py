# Sphere-sphere distance against the formula, at the origin and moved away; other pairs too.
exp = math.sqrt(10**2 + 20**2 + 5**2) - 9
for off in (0, 10, 100, 1000, 1e4, 1e5):
    o = np.array([off, -2*off, 3*off], float)
    s1 = Sphere(7).translate(tuple(map(float, o)))
    s2 = Sphere(2).translate(tuple(map(float, o + np.array([10, 20, -5]))))
    print(f"[03] spheres offset {off:g}: d={s1.distance_to(s2):.12g} exp={exp:.12g} err={s1.distance_to(s2)-exp:+.2e}")
# direction dependence at the origin
for dvec in ((25, 0, 0), (0, 25, 0), (0, 0, 25), (10, 20, -5), (15, 15, 15), (-20, 3, 7)):
    d = np.array(dvec, float)
    s2 = Sphere(2).translate(tuple(d))
    e = np.linalg.norm(d) - 9
    print(f"[03] sphere r7 at 0, r2 at {dvec}: d={Sphere(7).distance_to(s2):.12g} exp={e:.12g} err={Sphere(7).distance_to(s2)-e:+.2e}")
# cylinder-cylinder parallel, box-sphere oblique
for dvec in ((30, 0, 0), (20, 20, 0), (20, 20, 20), (10, 20, -5)):
    d = np.array(dvec, float)
    b = Box(10, 10, 10)
    s2 = Sphere(2).translate(tuple(d))
    # distance from the box to the sphere center minus 2
    q = np.maximum(np.abs(d) - 5, 0)
    e = np.linalg.norm(q) - 2
    print(f"[03] box10 to sphere r2 at {dvec}: d={b.distance_to(s2):.12g} exp={e:.12g} err={b.distance_to(s2)-e:+.2e}")
for dvec in ((10, 20, -5), (-20, 3, 7), (15, 15, 15)):
    d = np.array(dvec, float)
    e = np.linalg.norm(d) - 7
    print(f"[03] sphere r7 to point {dvec}: d={Sphere(7).distance_to(tuple(d)):.12g} exp={e:.12g}")
