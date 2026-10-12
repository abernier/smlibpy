import time
for path in ["../models/as1_ac_214.stp", "../models/solid/AWVLogoCube.stp", "../models/solid/Ventil.stp"]:
    t = time.time()
    r = import_step(path)
    dt = time.time() - t
    items = list(r) if isinstance(r, ShapeList) else [r]
    print(f"[06] {path.split('/')[-1]}: {type(r).__name__} n={len(items)} t={dt:.2f}s")
    names = {}
    for s in items:
        names[s.name] = names.get(s.name, 0) + 1
    print("[06]   names:", names)
    print("[06]   colors:", sorted({tuple(round(c, 3) for c in s.color) if s.color else None for s in items}, key=str))
    print("[06]   types:", sorted({type(s).__name__ for s in items}), "valid:", sum(s.is_valid() for s in items), "/", len(items))
    bb = items[0].bbox()
    for s in items[1:]:
        bb = bb.add(s.bbox()) if hasattr(bb, "add") else bb
    print("[06]   bbox of first:", items[0].bbox().size)
asm = import_step("../models/as1_ac_214.stp")
print("[06] as1 total volume:", round(sum(p.volume for p in asm), 3))
print("[06] as1 centers:", [tuple(round(c, 1) for c in p.center().to_tuple()) for p in asm][:6])
snapshot("as1", *asm)
snapshot("logo", *(lambda r: r if isinstance(r, ShapeList) else [r])(import_step("../models/solid/AWVLogoCube.stp")))
snapshot("ventil", import_step("../models/solid/Ventil.stp"))
