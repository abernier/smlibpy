import os
os.chdir("ai/training/2026-10-12_21-26-31_files-exact/files")
for path in ["assembly.step", "bracket.step"]:   # two bodies, one body
    r = import_step(path)
    parts = r if isinstance(r, ShapeList) else [r]
    print("[14]", path, type(r).__name__, len(parts), [p.name for p in parts])
