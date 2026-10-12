# Repro: does stitch unify normals of an open set? Two strips meeting at an L, opposite normals.
a = ruled(Line((0, 0, 0), (10, 0, 0)), Line((0, 10, 0), (10, 10, 0)))      # floor, normal +Z
b = ruled(Line((0, 10, 0), (10, 10, 0)), Line((0, 10, 10), (10, 10, 10)))  # wall at y=10, normal x × z = -Y
c = ruled(Line((0, 10, 10), (10, 10, 10)), Line((0, 10, 0), (10, 10, 0)))  # the same wall, normal +Y
for label, wall in (("b", b), ("c", c)):
    print(f"[09] input normals floor {a.faces()[0].normal_at()} wall {label} {wall.faces()[0].normal_at()}")
    sh = stitch(a, wall)
    print(f"[09]   stitched: {type(sh).__name__} edges {len(sh.edges())} normals {[f.normal_at() for f in sh.faces()]}")
    for t in (1, -1):
        try:
            p = sh.thicken(t)
            print(f"[09]   thicken({t}): vol {p.volume:.3f} valid {p.is_valid()}")
        except Exception as e:
            print(f"[09]   thicken({t}): {type(e).__name__}: {e}")
