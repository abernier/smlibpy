# Limit of the default stitch for a 10 mm box, and what the sewn-but-not-solid Shell is.
from smlibpy._kernel import k
def free_edges(r):
    return sum(1 for e in r.edges() if len(e.faces()) == 1)
box = Box(10, 10, 10)
def pieces(g):
    return [f.to_shell() for f in box.faces() if f.normal_at().z < 0.5] + [box.faces().top()[0].to_shell().translate(0, 0, g)]
for g in (0.06, 0.07, 0.08, 0.09):
    r = stitch(pieces(g))
    print(f"[04] gap {g}: {type(r).__name__} free {free_edges(r)}")
# a side gap instead of the top: shift one side face sideways
for g in (0.01, 0.05, 0.08):
    ps = [f.to_shell() for f in box.faces() if f.normal_at().x < 0.5] + [box.faces().right()[0].to_shell().translate(g, 0, 0)]
    r = stitch(ps)
    print(f"[04] side gap {g}: {type(r).__name__} free {free_edges(r)}")
r = stitch(pieces(0.1), tolerance=0.2)
print(f"[04] gap 0.1 tol 0.2: {type(r).__name__} free {free_edges(r)} manifold {r._brep.is_manifold_solid()}")
print(f"[04]   vertices {len(r.vertices())} edges {len(r.edges())}")
h = r.heal()
print(f"[04]   heal: {type(h).__name__} manifold {h._brep.is_manifold_solid()} free {free_edges(h)}")
r2 = stitch(r)
print(f"[04]   stitch again: {type(r2).__name__}")
try:
    t = r.thicken(1)
    print(f"[04]   thicken(1): vol {t.volume:.3f} valid {t.is_valid()}")
except Exception as e:
    print(f"[04]   thicken: {type(e).__name__}: {e}")
