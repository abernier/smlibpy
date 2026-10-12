def apex(p):
    # the vertices of the top edge (highest z)
    zmax = max(v.z for v in p.vertices())
    return sorted({(round(v.x, 3), round(v.z, 3)) for v in p.vertices() if abs(v.z - zmax) < 1e-6})
for args in [(20, 10, 8), (-20, 10, 8), (20, 10, -8)]:
    w = Wedge(*args)
    zs = sorted({round(v.z, 3) for v in w.vertices()})
    print("[15]", args, "top vertices (x,z):", apex(w), "z levels:", zs, "bottom face count at zmin:",
          len([f for f in w.faces() if f.is_planar and abs(f.center().z - min(zs)) < 1e-6]))
