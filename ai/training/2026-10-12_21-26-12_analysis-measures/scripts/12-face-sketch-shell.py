# Face, sketch and shell area and center against formulas.
pi = math.pi
cyl = Cylinder(6, 20)
for f in cyl.faces():
    print(f"[12] cylinder face {f.geom_type}: area={f.area:.12g} center={f.center()} interior={f.interior_point()}")
print(f"[12] lateral exp {2*pi*6*20:.12g}, caps exp {pi*36:.12g}")
half = split(Cylinder(10, 20), Plane.XZ, keep="above")
lat = half.faces().filter_by(lambda f: f.geom_type == "cylinder") if hasattr(ShapeList, "filter_by") else None
lat = [f for f in half.faces() if f.geom_type == "cylinder"][0]
c = lat.center()
print(f"[12] half-cylinder face: area={lat.area:.12g} exp={pi*10*20:.12g} center={c} exp y={20/pi:.9f} rel={(c.y-20/pi)/(20/pi):+.2e}")
sph = Sphere(10)
for f in sph.faces():
    print(f"[12] sphere face {f.geom_type}: area={f.area:.12g} exp={4*pi*100:.12g} center={f.center()}")
tor = Torus(20, 5)
print(f"[12] torus face: area={tor.faces()[0].area:.12g} exp={4*pi*pi*100:.12g}")
cone = Cone(10, 0, 30)
for f in cone.faces():
    print(f"[12] cone face {f.geom_type}: area={f.area:.12g}")
print(f"[12] cone lateral exp {pi*10*math.hypot(10, 30):.12g}")
# sketches
ring = Circle(10) - Circle(4)
print(f"[12] ring: area={ring.area:.12g} exp={pi*84:.12g} rel={(ring.area-pi*84)/(pi*84):+.2e} center={ring.center()}")
off = Rectangle(20, 10) - Circle(3).translate(5, 0, 0)
cx = (200*0 - pi*9*5) / (200 - pi*9)
print(f"[12] rect minus off-center hole: area={off.area:.12g} exp={200-pi*9:.12g} center.x={off.center().x:.10g} exp={cx:.10g}")
tilt = (Rectangle(20, 10) - Circle(3).translate(5, 0, 0)).on(Plane((100, 50, 20), z_dir=(1, 1, 1)))
print(f"[12] same on a tilted plane: area={tilt.area:.12g} center={tilt.center()} faces={len(tilt.faces())}")
two = Circle(5) + Circle(5).translate(30, 0, 0)
print(f"[12] two disjoint circles: area={two.area:.12g} exp={50*pi:.12g} center={two.center()} faces={len(two.faces())}")
# shell
sh = Box(10, 20, 30).faces().filter_by(lambda f: True) if False else None
top = Box(10, 20, 30).faces().top().one()
print(f"[12] top face of box: area={top.area} center={top.center()} normal={top.normal_at()}")
s = top.to_shell()
print(f"[12] shell of top face: type={type(s).__name__} area={s.area} center={s.center()}")
# face list helpers
b = Box(40, 30, 20)
print(f"[12] sum of box face areas={sum(f.area for f in b.faces())} part.area={b.area}")
print(f"[12] faces().center() (unweighted average of face centers)={b.faces().center()}")
