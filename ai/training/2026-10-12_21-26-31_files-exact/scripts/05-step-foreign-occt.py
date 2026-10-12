import json, time
ref = json.load(open("out/occt/volumes.json"))
rows = []
for name, vol in ref.items():
    t = time.time()
    p = load(f"out/occt/{name}.step")
    dt = time.time() - t
    rel = (p.volume - vol) / vol
    rows.append((name, type(p).__name__, p.name, p.color, p.is_valid(), round(rel, 9), len(p.faces()), round(dt, 2)))
    print(f"[05] {name:10s} {type(p).__name__} name={p.name!r} color={p.color} valid={p.is_valid()} rel.vol.err={rel:.1e} faces={len(p.faces())} t={dt:.2f}s")
# heal=False on the same files
bad = [n for n in ref if not import_step(f"out/occt/{n}.step", heal=False).is_valid()]
print("[05] invalid without heal:", bad)
snapshot("occt", *[load(f"out/occt/{n}.step").translate(i * 40, 0, 0) for i, n in enumerate(["holes", "filleted", "loft", "sweep", "torus"])])
