import os, re
OUT = "ai/training/2026-10-12_21-26-31_files-exact/files"
p = os.path.join(OUT, "12-box.step")
export_step(Box(20, 20, 20), p)
txt = open(p).read()
m = re.search(r"CLOSED_SHELL\('',\(([^)]*)\)\)", txt)
faces = m.group(1).split(",")
bad = txt.replace(m.group(0), "CLOSED_SHELL('',(" + ",".join(faces[:-1]) + "))")
q = os.path.join(OUT, "12-box-missing-face.step")
open(q, "w").write(bad)
for heal in (True, False):
    try:
        r = import_step(q, heal=heal)
        vol = r.volume if isinstance(r, Part) else None
        print(f"[12] missing face heal={heal}: {type(r).__name__} valid={r.is_valid()} faces={len(r.faces())} volume={vol}")
    except Exception as e:
        print(f"[12] missing face heal={heal}: {type(e).__name__}: {str(e)[:200]}")
