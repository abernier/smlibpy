# axis direction, other axes, a tilted axis, big angles, the tolerance
import time
from smlibpy._kernel import ext, k
from smlibpy import deform as D
plate = Box(80, 60, 10) - Cylinder(5, 20)
t = plate.twist(30, axis=Axis((0, 0, 0), (0, 1, 0)))
print("[03] about Y: valid", t.is_valid(), "volume", round(t.mass_properties(accuracy=1e-10).volume, 4), "expect", round(48000 - math.pi * 250, 4))
off = Box(10, 10, 50).twist(90, axis=Axis((20, 0, 0), (0, 0, 1)))
print("[03] axis through (20,0,0): bbox", off.bbox())
tilt = Box(10, 10, 60).rotate(Y, 30).twist(90, axis=Axis((0, 0, 0), (math.sin(math.radians(30)), 0, math.cos(math.radians(30)))))
print("[03] tilted axis: valid", tilt.is_valid(), "volume", round(tilt.mass_properties(accuracy=1e-10).volume, 4))
hexa = RegularPolygon(10, 6).extrude(80)
for a in (90, 360, 720):
    t0 = time.time(); h = hexa.twist(a); dt = time.time() - t0
    poles = sum(len(ext.surface_data(f._f.surface(), True)["poles"]) for f in h.faces())
    print(f"[03] hexagon twist {a}: valid {h.is_valid()} volume {h.mass_properties(accuracy=1e-10).volume:.4f} poles {poles} {dt:.3f}s")
for tol in (1e-3, 1e-6, 1e-8):
    plan = D._plan_twist(hexa, 360.0, Z, None, None, tol)
    t0 = time.time(); h = hexa.twist(360, tolerance=tol); dt = time.time() - t0
    dev = max(k.deform.deviation(plan.shape._brep, h._brep, dict(plan.spec, max_degree=D.MAX_DEGREE), 9).values())
    poles = sum(len(ext.surface_data(f._f.surface(), True)["poles"]) for f in h.faces())
    print(f"[03] tolerance {tol:g}: deviation {dev:.2e} poles {poles} {dt:.3f}s")
