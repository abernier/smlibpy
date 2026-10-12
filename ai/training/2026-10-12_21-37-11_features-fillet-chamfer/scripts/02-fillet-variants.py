def rep(tag, fn, base):
    try:
        p = fn()
        print(f"[{tag}] valid={p.is_valid()} vol={p.volume:.4f} dV={p.volume - base.volume:.4f} faces={len(p.faces())}")
        return p
    except Exception as e:
        print(f"[{tag}] {type(e).__name__}: {e}")

box = Box(40, 30, 20)
e = box.edges().parallel_to(Z).first
print("edge start", e.start.to_tuple(), "end", e.end.to_tuple())
var = rep("variable (2, 8)", lambda: box.fillet(e, (2, 8)), box)
# radius at both ends: measure the fillet face extent at z=-10 and z=+10
if var is not None:
    ff = [f for f in var.faces() if f.geom_type not in ("plane",)]
    print("fillet faces", [f.geom_type for f in ff])
    for z in (-9.99, 9.99):
        s = var.section(Plane.XY.offset(z))
        print(f"   area at z={z}: {s.area:.4f} -> removed {1200 - s.area:.4f}")
    print("   removed for r=2:", 4 - math.pi, " r=8:", 64 - 16*math.pi)
lin = (8 - 2) / 20
expected = -sum((1 - math.pi/4) * (2 + lin*(t+0.5)*20/200)**2 for t in range(0)) 
r2 = lambda z: 2 + 6*(z/20)
import numpy as _np
zs = _np.linspace(0, 20, 2001)
print("   expected dV (linear r)", -_np.trapezoid([(1 - math.pi/4)*r2(z)**2 for z in zs], zs))
# per-edge radii
edges = box.edges().parallel_to(Z)
print("edge centers", [tuple(round(v, 1) for v in x.center().to_tuple()) for x in edges])
st = rep("list [2,4,6,8]", lambda: box.fillet(edges, [2, 4, 6, 8]), box)
print("expected dV", -(1 - math.pi/4)*20*(4+16+36+64))
rep("list wrong length", lambda: box.fillet(edges, [2, 4]), box)
rep("tuple of 3", lambda: box.fillet(edges, (2, 4, 6)), box)
# continuity
for c in (None, "G1", "G2", "G3", 2, "g2"):
    rep(f"continuity={c!r} r5", lambda: box.fillet(box.edges().parallel_to(Z), 5, continuity=c), box)
rep("continuity=G4", lambda: box.fillet(box.edges().parallel_to(Z), 5, continuity="G4"), box)
for fu in (0.5, 0.8, 1.0, 1.2, 1.5, 2.0):
    rep(f"G2 fullness={fu}", lambda: box.fillet(box.edges().parallel_to(Z), 5, continuity="G2", fullness=fu), box)
rep("circular fullness=2 (ignored?)", lambda: box.fillet(box.edges().parallel_to(Z), 5, fullness=2.0), box)
rep("G2 + variable", lambda: box.fillet(e, (2, 8), continuity="G2"), box)
rep("G2 + list", lambda: box.fillet(edges, [2, 4, 6, 8], continuity="G2"), box)
rep("G2 all edges", lambda: box.fillet(box.edges(), 4, continuity="G2"), box)
rep("G3 all edges fullness 1.2", lambda: box.fillet(box.edges(), 4, continuity="G3", fullness=1.2), box)
