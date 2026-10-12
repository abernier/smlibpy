import os
OUT = "ai/training/2026-10-12_21-32-28_files-mesh/files"
m = Sphere(5).mesh()
m.export(f"{OUT}/20-mesh.gltf")
print("[20] Mesh.export .gltf:", os.path.getsize(f"{OUT}/20-mesh.gltf"))
print("[20] show mesh:", show(m, path=f"{OUT}/20-mesh.html", open_browser=False))
