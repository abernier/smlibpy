import os, struct
OUT = "ai/training/2026-10-12_21-32-28_files-mesh/files"
part = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket")
p = f"{OUT}/09-bin.stl"
export_stl(part, p)
data = open(p, "rb").read()
n = struct.unpack("<I", data[80:84])[0]
print("[09] binary: header", data[:30], "triangles", n, "size", len(data), "= 84 + 50n:", 84 + 50 * n == len(data))
print("[09] tessellate count:", len(tessellate(part)))
pa = f"{OUT}/09-ascii.stl"
export_stl(part, pa, ascii=True)
txt = open(pa).read()
print("[09] ascii: first lines", txt.splitlines()[:3], "facets", txt.count("facet normal"), "size", len(txt))
for tol in [None, 1, 0.1, 0.01, 0.001]:
    q = f"{OUT}/09-tol.stl"
    export_stl(part, q, tolerance=tol)
    m = import_stl(q)
    print(f"[09] tol={tol}: triangles {len(m)} size {os.path.getsize(q)} volume {m.volume:.3f} (exact {part.volume:.3f}, rel {(m.volume - part.volume) / part.volume:+.1e})")
for ang in [45, 15, 5, 1]:
    q = f"{OUT}/09-ang.stl"
    export_stl(part, q, angle=ang)
    print(f"[09] angle={ang}: triangles {len(import_stl(q))}")
# float32 precision far from the origin
far = Box(10, 10, 10).translate(100000, 0, 0)
export_stl(far, f"{OUT}/09-far.stl")
mf = import_stl(f"{OUT}/09-far.stl")
print("[09] far box: bbox back", mf.bbox(), "volume", mf.volume)
# several parts in one file
export_stl([Box(10, 10, 10), Sphere(5).translate(20, 0, 0)], f"{OUT}/09-two.stl")
m2 = import_stl(f"{OUT}/09-two.stl")
print("[09] two parts: one mesh", m2, "volume", round(m2.volume, 3), "exact sum", round(1000 + Sphere(5).volume, 3))
# normals in the file vs geometry
rec = np.frombuffer(data[84:], dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
v = rec["v"].astype(float)
g = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0]); g /= np.linalg.norm(g, axis=1, keepdims=True)
print("[09] file normals agree with winding:", bool(np.all(np.einsum("ij,ij->i", g, rec["n"]) > 0.99)))
# sheet and empty
export_stl(Rectangle(10, 10), f"{OUT}/09-sketch.stl")
print("[09] sketch stl:", import_stl(f"{OUT}/09-sketch.stl"))
try:
    export_stl([], f"{OUT}/09-empty.stl")
except Exception as e:
    print("[09] empty:", type(e).__name__, e)
try:
    export_stl(part, f"{OUT}/09-neg.stl", tolerance=0)
    print("[09] tolerance 0:", len(import_stl(f"{OUT}/09-neg.stl")))
except Exception as e:
    print("[09] tolerance 0:", type(e).__name__, e)
try:
    export_stl(part, f"{OUT}/09-neg.stl", tolerance=-1)
    print("[09] tolerance -1:", len(import_stl(f"{OUT}/09-neg.stl")))
except Exception as e:
    print("[09] tolerance -1:", type(e).__name__, e)
try:
    export_stl(part, f"{OUT}/09-neg.stl", angle=0)
    print("[09] angle 0:", len(import_stl(f"{OUT}/09-neg.stl")))
except Exception as e:
    print("[09] angle 0:", type(e).__name__, e)
