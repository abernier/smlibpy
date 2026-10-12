import time, os
def rep(tag, p):
    gt = sorted(set(f.geom_type for f in p.faces()))
    et = sorted(set(e.geom_type for e in p.edges()))
    print(f"[{tag}] valid={p.is_valid()} vol={p.volume:.6f} faces={len(p.faces())} face types={gt} edge types={et}")

part = Box(40, 30, 20) - Cylinder(8, 30)
part = part.fillet(part.edges().parallel_to(Z).filter(lambda e: e.geom_type == "line"), 4)
rep("original", part)
t0 = time.time(); n = part.to_nurbs(); dt = time.time() - t0
rep("to_nurbs", n); print("   time", round(dt, 3))
print("   bbox same", part.bbox().min.to_tuple() == n.bbox().min.to_tuple(), n.bbox().size.to_tuple())
# operations after to_nurbs
try:
    nh = n - Cylinder(3, 40).translate(12, 0, 0)
    rep("nurbs - cylinder", nh)
except Exception as e:
    print(f"[nurbs boolean] {type(e).__name__}: {e}")
try:
    nf = n.fillet(n.faces().top(), 1)
    rep("nurbs fillet top r1", nf)
    of = part.fillet(part.faces().top(), 1)
    rep("analytic fillet top r1", of)
except Exception as e:
    print(f"[nurbs fillet] {type(e).__name__}: {e}")
try:
    ns = n.shell(2, n.faces().top())
    rep("nurbs shell", ns)
except Exception as e:
    print(f"[nurbs shell] {type(e).__name__}: {e}")
# selectors that rely on analytic types
print("circles before", len(part.edges().circles()), "after", len(n.edges().circles()))
print("cylinders before", len(part.faces().cylinders()), "after", len(n.faces().cylinders()))
try:
    print("radius of hole face after:", n.faces().filter(lambda f: f.geom_type != "plane")[0].radius)
except Exception as e:
    print(f"[radius after] {type(e).__name__}: {e}")
# STEP size
d = "/private/tmp/claude-501/-Users-dev-dev-awv-classcad/b6f86784-159b-48f0-a560-42efd2a6af42/scratchpad"
export_step(part, f"{d}/a.step"); export_step(n, f"{d}/n.step")
print("step bytes analytic", os.path.getsize(f"{d}/a.step"), "nurbs", os.path.getsize(f"{d}/n.step"))
back = import_step(f"{d}/n.step")
print("nurbs step reimport vol", round(back.volume, 6) if hasattr(back, "volume") else back)
# sketches/shells
sh = extrude(CenterArc((0, 0), 10, 0, 180), 20)
sn = sh.to_nurbs()
print("[shell to_nurbs]", type(sn).__name__, sorted(set(f.geom_type for f in sn.faces())), round(sn.area, 4), round(sh.area, 4))
sk = Circle(5).to_nurbs()
print("[sketch to_nurbs]", type(sk).__name__, round(sk.area, 4), sk.plane.z_dir.to_tuple())
# heal on clean parts
t0 = time.time(); h = part.heal(); dt = time.time() - t0
rep("heal clean part", h); print("   time", round(dt, 3))
