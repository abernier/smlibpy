# Is bbox() tight? Rotated cylinder and torus against formulas, spline edges against sampling.
pi = math.pi
r, h = 6.0, 20.0
d = np.array([1.0, 2.0, 3.0]); d /= np.linalg.norm(d)
cyl = Cylinder(r, h)
ax = Axis((0, 0, 0), tuple(np.cross([0, 0, 1], d)))
ang = math.degrees(math.acos(d[2]))
rc = cyl.rotate(ax, ang)
exp = [abs(d[i])*h/2 + r*math.sqrt(1-d[i]**2) for i in range(3)]
bb = rc.bbox()
print(f"[15] rotated cylinder half-size: {[round(x, 9) for x in (bb.size/2).to_tuple()]} exp {[round(x, 9) for x in exp]}")
R, rr = 20.0, 5.0
tor = Torus(R, rr).rotate(X, 30)
n = np.array([0, -math.sin(math.radians(30)), math.cos(math.radians(30))])
expt = [R*math.sqrt(1-n[i]**2) + rr for i in range(3)]
bb = tor.bbox()
print(f"[15] torus rot X30 half-size: {[round(x, 9) for x in (bb.size/2).to_tuple()]} exp {[round(x, 9) for x in expt]}")
sph = Sphere(10).translate(1000, 2000, 3000)
print(f"[15] sphere at 1000,2000,3000: min={sph.bbox().min} max={sph.bbox().max}")
sp = Spline((0, 0), (10, 5), (20, -3), (30, 8), (35, 0))
pts = np.array([sp.point_at(i/20000).to_tuple() for i in range(20001)])
bb = sp.bbox()
print(f"[15] free spline edge bbox min={bb.min} max={bb.max}; sampled min={pts.min(0).round(9).tolist()} max={pts.max(0).round(9).tolist()}")
part = make_face(Wire([sp, Line((35, 0), (0, 0))])).extrude(5)
bb = part.bbox()
print(f"[15] extruded spline part bbox min={bb.min} max={bb.max}")
arc_part = split(Cylinder(10, 10), Plane((0, 5, 0), z_dir=(0, 1, 0)), keep="above")
print(f"[15] cylinder cut at y=5 (keep y>5): bbox min={arc_part.bbox().min} max={arc_part.bbox().max} exp x=+-{math.sqrt(75):.9f}, y 5..10")
