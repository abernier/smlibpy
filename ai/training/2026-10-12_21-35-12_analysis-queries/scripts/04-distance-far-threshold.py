# Where does body-body distance go wrong far from the origin? Which pairs, and point queries?
exp = math.sqrt(10**2 + 20**2 + 5**2) - 9
for off in (1000, 2000, 3000, 4000, 5000, 7000, 1e4):
    o = (off, -2*off, 3*off)
    s1 = Sphere(7).translate(o)
    s2 = Sphere(2).translate(o[0]+10, o[1]+20, o[2]-5)
    d = s1.distance_to(s2)
    print(f"[04] spheres at {o}: err={d-exp:+.2e}")
for off in (1e4, 1e5, 1e6):
    o = (off, 0, 0)
    s1 = Sphere(7).translate(o)
    s2 = Sphere(2).translate(o[0]+10, o[1]+20, o[2]-5)
    print(f"[04] spheres along x at {off:g}: err={s1.distance_to(s2)-exp:+.2e}")
    b1 = Box(10, 10, 10).translate(o)
    b2 = Box(10, 10, 10).translate(o[0]+20, o[1]+3, o[2]+4)
    print(f"[04] boxes at {off:g}: d={b1.distance_to(b2):.12g} exp=10")
    c1 = Cylinder(5, 20).translate(o)
    c2 = Cylinder(3, 20).translate(o[0]+20, o[1]+10, o[2])
    e = math.hypot(20, 10) - 8
    print(f"[04] parallel cylinders at {off:g}: d={c1.distance_to(c2):.12g} exp={e:.12g}")
    p = (o[0]+10, o[1]+20, o[2]-5)
    print(f"[04] sphere r7 to point at {off:g}: d={s1.distance_to(p):.12g} exp={math.sqrt(525)-7:.12g} closest-o={s1.closest_point(p)-Vector(o)}")
# same pair, rotated instead of moved
s1 = Sphere(7).translate(10000, -20000, 30000)
s2 = Sphere(2).translate(10010, -19980, 29995)
print(f"[04] far pair moved back to the origin: {s1.translate(-10000, 20000, -30000).distance_to(s2.translate(-10000, 20000, -30000)):.12g}")
