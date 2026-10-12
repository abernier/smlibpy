import os
OUT = "ai/training/2026-10-12_21-32-28_files-mesh/files"
p = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket")
for e in (True, False):
    export_glb(p, f"{OUT}/18.glb", edges=e); export_gltf(p, f"{OUT}/18.gltf", edges=e)
    a, b = os.path.getsize(f"{OUT}/18.glb"), os.path.getsize(f"{OUT}/18.gltf")
    print(f"[18] edges={e}: glb {a} gltf {b} ratio {b / a:.2f}")
s = Sphere(10)
for tol in (None, 0.01, 0.001):
    export_glb(s, f"{OUT}/18s.glb", tolerance=tol)
    print(f"[18] sphere tol={tol}: glb {os.path.getsize(f'{OUT}/18s.glb')} bytes, triangles {len(tessellate(s, tol))}")
