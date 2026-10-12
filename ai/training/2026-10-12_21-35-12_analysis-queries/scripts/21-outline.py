# outline: what is projected (edges? silhouettes?), onto which plane, duplicates, degenerate edges.
import time
def show(name, body, plane=Plane.XY):
    t = time.perf_counter()
    try:
        cs = body.outline(plane)
    except Exception as e:
        print(f"[21] {name}: {type(e).__name__}: {e}")
        return None
    dt = 1000*(time.perf_counter()-t)
    n = np.array(plane.z_dir.to_tuple()); o = np.array(plane.origin.to_tuple())
    offp = max([abs(np.dot(np.array(c.point_at(i/4).to_tuple()) - o, n)) for c in cs for i in range(5)] or [0])
    lens = sorted(round(c.length, 4) for c in cs)
    print(f"[21] {name}: n={len(cs)} types={sorted(set(c.geom_type for c in cs))} lengths={lens} max off plane={offp:.1e} ({dt:.0f} ms)")
    return cs
show("box 20x10x5 on XY", Box(20, 10, 5))
show("box 20x10x5 on XY.offset(-50)", Box(20, 10, 5), Plane.XY.offset(-50))
show("box 20x10x5 on XZ", Box(20, 10, 5), Plane.XZ)
show("cylinder r5 h20 on XY", Cylinder(5, 20))
cs = show("cylinder r5 h20 on XZ (side view)", Cylinder(5, 20), Plane.XZ)
show("sphere r10 on XY", Sphere(10))
show("box with through hole on XY", Box(20, 20, 10) - Cylinder(4, 20))
show("box with through hole on XZ (hidden hole)", Box(20, 20, 10) - Cylinder(4, 20), Plane.XZ)
show("box rotated 45 about Z on XY", Box(20, 20, 10).rotate(Z, 45))
show("box on tilted plane", Box(20, 20, 10), Plane((0, 0, 0), z_dir=(1, 1, 1)))
show("sketch circle on XZ", Circle(5), Plane.XZ)
if cs:
    for c in cs:
        print(f"[21]    side view piece {c.geom_type}: start={c.start} end={c.end}")
