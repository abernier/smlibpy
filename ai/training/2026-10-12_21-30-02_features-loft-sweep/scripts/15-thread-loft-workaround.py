import time
# Workaround idea: loft through copies of the profile placed along the helix with a frame that
# keeps the sketch x axis radial.
pitch, height, radius = 5, 10, 10
h = Helix(pitch=pitch, height=height, radius=radius)
n = int(8 * height / pitch)
secs = []
for i in range(n + 1):
    t = i / n
    p = h.point_at(t)
    tan = h.tangent_at(t)
    radial = Vector(p.x, p.y, 0).normalized()
    secs.append(Rectangle(2, 1).on(Plane(origin=p, x_dir=radial, z_dir=tan)))
t0 = time.time()
try:
    th = loft(secs)
    print("[loft thread] valid", th.is_valid(), "vol", round(th.volume, 3), "time", round(time.time() - t0, 2))
    sec = th.section(Plane.YZ)
    rows = sorted((round(f.bbox().center.z, 2), round(f.bbox().size.y, 3), round(f.bbox().size.z, 3)) for f in sec.faces() if f.bbox().min.y > 0)
    print("[loft thread] sections at 90 deg", rows)
    print("expected vol ~", 2*1*h.length)
    snapshot("loftthread", th)
except Exception as e:
    print(f"[loft thread] {type(e).__name__}: {e}")
