OUT = "ai/training/2026-10-12_21-32-28_files-mesh/files"
part = Sphere(10).translate(1234.56789, 0.001234, 0)
m0 = tessellate(part)
export_stl(part, f"{OUT}/10-b.stl")
export_stl(part, f"{OUT}/10-a.stl", ascii=True)
for kind in "ba":
    m = import_stl(f"{OUT}/10-{kind}.stl")
    # precision: nearest original vertex for each read vertex
    d = np.abs(m.vertices[:, None, :] - m0.vertices[None, ::7, :]).max(axis=2).min(axis=1) if False else None
    print(f"[10] {kind}: {m} normals {m.normals} vertices of tessellation {len(m0.vertices)}")
    print(f"[10] {kind}: volume {m.volume:.4f} vs mesh {m0.volume:.4f}; center {m.center()} vs {m0.center()}")
    print(f"[10] {kind}: bbox min {m.bbox().min} vs {m0.bbox().min}")
# welding: closed?
def opened(mesh):
    e = np.sort(np.concatenate([mesh.triangles[:, [0, 1]], mesh.triangles[:, [1, 2]], mesh.triangles[:, [2, 0]]]), axis=1)
    _, c = np.unique(e, axis=0, return_counts=True)
    return int((c == 1).sum()), int((c > 2).sum())
m = import_stl(f"{OUT}/10-b.stl")
print("[10] welded index topology open/overused edges:", opened(m))
# two touching boxes: shared corner positions are welded together
export_stl([Box(10, 10, 10), Box(10, 10, 10).translate(10, 0, 0)], f"{OUT}/10-touch.stl")
mt = import_stl(f"{OUT}/10-touch.stl")
print("[10] touching boxes:", mt, "edges used >2 times:", opened(mt)[1], "volume", mt.volume)
# a binary STL whose header starts with 'solid' (some exporters do that)
raw = open(f"{OUT}/10-b.stl", "rb").read()
open(f"{OUT}/10-solidheader.stl", "wb").write(b"solid fake header".ljust(80, b" ") + raw[80:])
print("[10] binary with 'solid' header:", import_stl(f"{OUT}/10-solidheader.stl"))
# truncated binary
open(f"{OUT}/10-trunc.stl", "wb").write(raw[:-10])
try:
    print("[10] truncated binary:", import_stl(f"{OUT}/10-trunc.stl"))
except Exception as e:
    print("[10] truncated binary:", type(e).__name__, e)
# not an STL at all
open(f"{OUT}/10-junk.stl", "w").write("hello world")
try:
    r = import_stl(f"{OUT}/10-junk.stl")
    print("[10] junk:", r)
except Exception as e:
    print("[10] junk:", type(e).__name__, e)
# Mesh from STL: what works
print("[10] area", round(m.area, 3), "bbox", m.bbox(), "triangle_normals", m.triangle_normals.shape)
try:
    m - tessellate(Box(5, 5, 5))
except Exception as e:
    print("[10] boolean on STL mesh:", type(e).__name__, e)
snapshot("stl", m, view="iso")
