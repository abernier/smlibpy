import os, tempfile
d = tempfile.mkdtemp()
cases = {
    "inverted cone alone": Cone(0, 10, 15),
    "box minus drill tip": Box(30, 30, 30) - Cone(0, 5, 10).translate(0, 0, 10),
    "box plus inverted cone": Box(30, 30, 10, align=(Align.CENTER, Align.CENTER, Align.MAX)) + Cone(0, 10, 15, align=(Align.CENTER, Align.CENTER, Align.MIN)),
    "point cone rotated 180": Cone(10, 0, 15).rotate(X, 180),
}
for name, p in cases.items():
    path = os.path.join(d, "x.step")
    export_step(p, path)
    q = import_step(path)
    if not isinstance(q, Part):
        print("[10]", name, "| import gave", type(q).__name__, [type(x).__name__ for x in q])
        q = q[0]
    print("[10]", name, "| in: solids", len(p.solids()), "vol", round(p.volume, 3), "| out vol:", round(q.volume, 3), "valid:", q.is_valid())
