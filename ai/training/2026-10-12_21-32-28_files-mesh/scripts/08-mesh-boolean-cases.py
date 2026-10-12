def opened(mesh):
    _, inv = np.unique(np.round(mesh.vertices, 7), axis=0, return_inverse=True)
    t = inv.reshape(-1)[mesh.triangles]
    e = np.sort(np.concatenate([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]]), axis=1)
    _, c = np.unique(e, axis=0, return_counts=True)
    return int((c == 1).sum())
cases = [
    ("box - cyl(3) through", Box(20, 20, 20), Cylinder(3, 40)),
    ("box - cyl(3) off-diagonal", Box(20, 20, 20), Cylinder(3, 40).translate(5, -5, 0)),
    ("box - sphere(12)", Box(20, 20, 20), Sphere(12)),
    ("box - sphere(5) at face", Box(20, 20, 20), Sphere(5).translate(0, 0, 10)),
    ("box - box offset", Box(20, 20, 20), Box(10, 10, 10).translate(10, 10, 10)),
    ("box - box inside one face tri", Box(20, 20, 20), Box(4, 4, 4).translate(5, -5, 10)),
    ("cyl - cyl", Cylinder(10, 20), Cylinder(4, 30)),
    ("sphere - box", Sphere(12), Box(20, 20, 20).translate(10, 0, 0)),
    ("box + box offset", Box(20, 20, 20), Box(10, 10, 10).translate(10, 10, 10)),
]
for label, A, B in cases:
    for op in "-+&":
        try:
            ex = {"-": A - B, "+": A + B, "&": A & B}[op].volume
            mm = {"-": A.mesh() - B.mesh(), "+": A.mesh() + B.mesh(), "&": A.mesh() & B.mesh()}[op]
            print(f"[08] {label:30s} {op}: mesh vol {mm.volume:9.2f} exact {ex:9.2f} rel {(mm.volume - ex) / ex:+.1e} open edges {opened(mm)}")
        except Exception as e:
            print(f"[08] {label:30s} {op}: {type(e).__name__}: {e}")
