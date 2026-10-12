# Free-form bodies: extruded and revolved spline profiles against sketch area (A*h, Pappus).
pi = math.pi
top = Spline((30, 0), (25, 8), (32, 15), (20, 22), (10, 20))
w = Wire([Line((10, 0), (30, 0)), top, Line((10, 20), (10, 0))]) if False else None
outline = Wire([Line((10, 0), (30, 0)), Spline((30, 0), (25, 8), (32, 15), (20, 22), (10, 20)), Line((10, 20), (10, 0))])
prof = make_face(outline)
A, c = prof.area, prof.center()
print(f"[07] profile area={A:.10g} center=({c.x:.8g},{c.y:.8g},{c.z:.3g}) faces={len(prof.faces())}")
ext_ = prof.extrude(15)
print(f"[07] extruded: V={ext_.volume:.10g} A*h={A*15:.10g} rel={(ext_.volume-A*15)/(A*15):+.2e}")
cz = ext_.center()
print(f"[07] extruded center=({cz.x:.8g},{cz.y:.8g},{cz.z:.8g}) exp z=7.5")
# revolve about the sketch's Y axis (x = 0): Pappus V = 2 pi xbar A
rev = prof.revolve(Axis((0, 0, 0), (0, 1, 0)))
vp = 2*pi*c.x*A
v10 = rev.mass_properties(accuracy=1e-10).volume
print(f"[07] revolved: V={rev.volume:.10g} V10={v10:.10g} Pappus={vp:.10g} rel={(rev.volume-vp)/vp:+.2e} rel10={(v10-vp)/vp:+.2e} valid={rev.is_valid()}")
for f in rev.faces():
    print(f"[07]    face {f.geom_type} area={f.area:.6g}")
half = prof.revolve(Axis((0, 0, 0), (0, 1, 0)), 90)
print(f"[07] revolved 90: V={half.volume:.10g} exp={vp/4:.10g} rel={(half.volume-vp/4)/(vp/4):+.2e}")
lo = loft([Circle(10), Rectangle(20, 20).on(Plane.XY.offset(30))], ruled=True)
print(f"[07] ruled loft circle->square: V={lo.volume:.10g} V10={lo.mass_properties(accuracy=1e-10).volume:.10g} valid={lo.is_valid()}")
snapshot("rev", rev, view="iso")
