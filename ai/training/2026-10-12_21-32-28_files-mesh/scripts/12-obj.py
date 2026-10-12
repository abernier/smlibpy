import os
OUT = "ai/training/2026-10-12_21-32-28_files-mesh/files"
bracket = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket").colored("steelblue")
cover = Box(60, 40, 2).translate(0, 0, 10)
p = f"{OUT}/12-asm.obj"
export_obj([bracket, cover], p)
lines = open(p).read().splitlines()
kinds = {}
for l in lines:
    kinds[l.split()[0]] = kinds.get(l.split()[0], 0) + 1
print("[12] line kinds:", kinds)
print("[12] objects:", [l for l in lines if l.startswith("o ")])
print("[12] first v:", next(l for l in lines if l.startswith("v ")))
print("[12] tessellate counts:", len(tessellate(bracket).vertices), len(tessellate(bracket)), len(tessellate(cover).vertices), len(tessellate(cover)))
# parse it back by hand: global 1-based indices, volume
V, F = [], []
for l in lines:
    s = l.split()
    if s[0] == "v": V.append([float(x) for x in s[1:]])
    if s[0] == "f": F.append([int(x) - 1 for x in s[1:]])
m = Mesh(V, F)
print("[12] parsed back:", m, "volume", round(m.volume, 3), "exact", round(bracket.volume + cover.volume, 3))
print("[12] precision: first vertex", V[0])
for tol in [None, 0.01]:
    export_obj(bracket, f"{OUT}/12-tol.obj", tolerance=tol)
    print("[12] tolerance", tol, "faces", sum(1 for l in open(f"{OUT}/12-tol.obj") if l.startswith("f ")))
for ang in [15, 5]:
    export_obj(bracket, f"{OUT}/12-ang.obj", angle=ang)
    print("[12] angle", ang, "faces", sum(1 for l in open(f"{OUT}/12-ang.obj") if l.startswith("f ")))
# Mesh input, sketch, names with spaces
export_obj([tessellate(Sphere(3)), Rectangle(5, 5), Box(2, 2, 2).named("my part")], f"{OUT}/12-misc.obj")
print("[12] misc objects:", [l for l in open(f"{OUT}/12-misc.obj").read().splitlines() if l.startswith("o ")])
for bad in ([], [Line((0, 0, 0), (1, 0, 0))]):
    try:
        export_obj(bad, f"{OUT}/12-bad.obj")
        print("[12]", bad, "->", open(f"{OUT}/12-bad.obj").read().strip())
    except Exception as e:
        print("[12]", bad, "->", type(e).__name__, e)
try:
    load(p)
except Exception as e:
    print("[12] load .obj:", type(e).__name__, e)
