import os, re
OUT = "ai/training/2026-10-12_21-26-31_files-exact/files"
p = os.path.join(OUT, "11-box.step")
export_step(Box(20, 20, 20) - Cylinder(5, 30), p)
txt = open(p).read()
# move one vertex point off its edges by d
for d in (1e-6, 1e-3, 0.05, 0.5):
    vp = re.search(r"VERTEX_POINT\('',#(\d+)\)", txt).group(1)
    line = re.search(rf"#{vp}=CARTESIAN_POINT\('',\(([^)]*)\)\);", txt)
    x, y, z = (float(v) for v in line.group(1).split(","))
    bad = txt.replace(line.group(0), f"#{vp}=CARTESIAN_POINT('',({x + d!r},{y!r},{z + d!r}));")
    q = os.path.join(OUT, f"11-moved-{d}.step")
    open(q, "w").write(bad)
    for heal in (True, False):
        try:
            r = import_step(q, heal=heal)
            print(f"[11] d={d} heal={heal}: {type(r).__name__} valid={r.is_valid()} volume={round(r.volume, 4)}")
        except Exception as e:
            print(f"[11] d={d} heal={heal}: {type(e).__name__}: {str(e)[:150]}")
