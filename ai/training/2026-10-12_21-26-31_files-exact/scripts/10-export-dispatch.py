import os, pathlib
OUT = "ai/training/2026-10-12_21-26-31_files-exact/files"
part = (Box(30, 20, 10) - Cylinder(4, 20)).named("block")

def size(p):
    return os.path.getsize(p) if os.path.exists(p) else None

for ext, kw in [(".step", {}), (".STEP", {}), (".stp", {"unit": "inch"}), (".stl", {"tolerance": 0.01}),
                (".stl", {"ascii": True}), (".glb", {"edges": False}), (".gltf", {}), (".obj", {}), (".smb", {"ascii": False}),
                (".iges", {}), (".STL", {}), ("", {}), (".step", {"tolerance": 0.1}), (".stl", {"unit": "mm"})]:
    p = os.path.join(OUT, f"10-block{ext}")
    try:
        part.export(p, **kw)
        print(f"[10] export {ext!r} {kw}: ok {size(p)} bytes")
    except Exception as e:
        print(f"[10] export {ext!r} {kw}: {type(e).__name__}: {e}")
# module-level export with a list and a pathlib.Path
p = pathlib.Path(OUT) / "10-two.step"
export([part, Sphere(5).translate(40, 0, 0)], p)
print("[10] export list to Path:", type(load(p)).__name__, len(load(p)))
# Mesh.export
m = part.mesh()
for ext in (".stl", ".obj", ".glb", ".step", ".smb"):
    q = os.path.join(OUT, f"10-mesh{ext}")
    try:
        m.export(q)
        print(f"[10] Mesh.export {ext}: ok {size(q)}")
    except Exception as e:
        print(f"[10] Mesh.export {ext}: {type(e).__name__}: {e}")
# load by extension
for ext in (".step", ".STEP", ".stp", ".stl", ".smb", ".glb", ".obj"):
    q = os.path.join(OUT, f"10-block{ext}")
    try:
        r = load(q)
        print(f"[10] load {ext}: {type(r).__name__} {getattr(r, 'name', '-')} vol={round(r.volume, 3)}")
    except Exception as e:
        print(f"[10] load {ext}: {type(e).__name__}: {str(e)[:120]}")
for q in [os.path.join(OUT, "missing.step"), os.path.join(OUT, "missing.smb")]:
    try:
        load(q)
    except Exception as e:
        print(f"[10] load missing {q[-5:]}: {type(e).__name__}: {str(e)[:120]}")
# a text file renamed to .step
bad = os.path.join(OUT, "10-garbage.step")
open(bad, "w").write("hello")
try:
    load(bad)
except Exception as e:
    print(f"[10] load garbage .step: {type(e).__name__}: {str(e)[:120]}")
