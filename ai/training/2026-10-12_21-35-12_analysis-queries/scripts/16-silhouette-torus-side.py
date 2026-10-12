# Torus seen from the side: which part of the mathematical silhouette (n . x = 0) comes back?
cs = Torus(20, 5).silhouette((1, 0, 0))
print(f"[16] torus from +X: {len(cs)} pieces, total {sum(c.length for c in cs):.6g}; math set: 2*2pi*20 + 2*2pi*5 = {2*2*math.pi*20 + 2*2*math.pi*5:.6g}")
for c in cs:
    print(f"[16]    {c.geom_type} start={c.start} mid={c.point_at(0.5)} end={c.end} length={c.length:.6g}")
cs = Box(10, 10, 10).silhouette((0, 0, -1))
print(f"[16] box from -Z: z of pieces {[round(c.center().z, 6) for c in cs]}")
snapshot("torus_x", Torus(20, 5), view=(1, 0, 0))
