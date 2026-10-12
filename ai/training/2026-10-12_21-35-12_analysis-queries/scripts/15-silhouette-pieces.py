# What exactly is in a silhouette: smooth contour generators and/or face boundary edges?
for name, body, d in (("cylinder r5 h20 from +X", Cylinder(5, 20), (1, 0, 0)),
                      ("cone r10 h30 from +X", Cone(10, 0, 30), (1, 0, 0)),
                      ("box from +Z", Box(10, 10, 10), (0, 0, 1)),
                      ("torus from +Z", Torus(20, 5), (0, 0, 1))):
    cs = body.silhouette(d)
    print(f"[15] {name}: {len(cs)} pieces")
    for c in cs:
        print(f"[15]    {c.geom_type:8s} start={c.start} end={c.end} mid={c.point_at(0.5)} length={c.length:.6g}")
