# Volume, area and center of primitives against closed formulas, default accuracy.
pi = math.pi
cases = {
    "box 40x30x20": (Box(40, 30, 20), 40*30*20, 2*(40*30+40*20+30*20)),
    "cylinder r6 h20": (Cylinder(6, 20), pi*36*20, 2*pi*36 + 2*pi*6*20),
    "sphere r10": (Sphere(10), 4/3*pi*1000, 4*pi*100),
    "torus R20 r5": (Torus(20, 5), 2*pi**2*20*25, 4*pi**2*20*5),
    "cone r10 h30": (Cone(10, 0, 30), pi*100*30/3, pi*100 + pi*10*math.hypot(10, 30)),
    "frustum 10/4 h12": (Cone(10, 4, 12), pi*12/3*(100+40+16), pi*(100+16) + pi*(10+4)*math.hypot(6, 12)),
}
for name, (p, v, a) in cases.items():
    c = p.center()
    print(f"[01] {name}: V={p.volume:.10g} relV={(p.volume-v)/v:.2e} A={p.area:.10g} relA={(p.area-a)/a:.2e} C=({c.x:.2e},{c.y:.2e},{c.z:.2e}) valid={p.is_valid()}")
