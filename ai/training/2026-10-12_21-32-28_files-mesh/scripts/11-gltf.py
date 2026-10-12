import json, struct, base64, os
OUT = "ai/training/2026-10-12_21-32-28_files-mesh/files"
bracket = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket").colored("steelblue")
cover = Box(60, 40, 2).translate(0, 0, 10).named("cover")
pin = Cylinder(2, 30).translate(40, 0, 0)

def read_glb(p):
    d = open(p, "rb").read()
    magic, ver, total = struct.unpack("<4sII", d[:12])
    jl, jt = struct.unpack("<I4s", d[12:20])
    doc = json.loads(d[20:20 + jl])
    bl, bt = struct.unpack("<I4s", d[20 + jl:28 + jl])
    buf = d[28 + jl:28 + jl + bl]
    return magic, ver, total == len(d), doc, buf

def positions(doc, buf, acc):
    a = doc["accessors"][acc]; v = doc["bufferViews"][a["bufferView"]]
    return np.frombuffer(buf[v["byteOffset"]:v["byteOffset"] + v["byteLength"]], dtype=np.float32).reshape(-1, 3)

p = f"{OUT}/11-asm.glb"
export_glb([bracket, cover, pin, Line((0, 0, 20), (30, 0, 20)), Rectangle(10, 10).translate(0, 0, 30)], p)
magic, ver, ok, doc, buf = read_glb(p)
print("[11] glb:", magic, ver, "length ok", ok, "size", os.path.getsize(p))
print("[11] nodes:", [(n.get("name"), n.get("mesh"), n.get("rotation"), n.get("children")) for n in doc["nodes"]])
print("[11] meshes:", [(m["name"], [pr.get("mode", 4) for pr in m["primitives"]]) for m in doc["meshes"]])
print("[11] materials:", [tuple(round(c, 3) for c in m["pbrMetallicRoughness"]["baseColorFactor"]) for m in doc["materials"]])
print("[11] scene roots:", doc["scenes"][0]["nodes"], "asset", doc["asset"])
# coordinates: units?
acc = doc["meshes"][0]["primitives"][0]["attributes"]["POSITION"]
pos = positions(doc, buf, acc)
print("[11] bracket positions min/max (before node rotation):", pos.min(axis=0), pos.max(axis=0))
print("[11] accessor min/max:", doc["accessors"][acc]["min"], doc["accessors"][acc]["max"])
print("[11] triangles in bracket:", len(pos) // 3, "tessellate:", len(tessellate(bracket)), "(non-indexed: 3 vertices per triangle)")
print("[11] has indices:", any("indices" in pr for m in doc["meshes"] for pr in m["primitives"]))
# edges=False
export_glb([bracket], f"{OUT}/11-noedges.glb", edges=False)
print("[11] edges=False primitives:", [len(m["primitives"]) for m in read_glb(f"{OUT}/11-noedges.glb")[3]["meshes"]], "size", os.path.getsize(f"{OUT}/11-noedges.glb"))
# edge lines: count of segments, seams left out?
cyl = Cylinder(5, 10)
export_glb(cyl, f"{OUT}/11-cyl.glb")
_, _, _, d2, b2 = read_glb(f"{OUT}/11-cyl.glb")
lines = d2["meshes"][0]["primitives"][1]
lp = positions(d2, b2, lines["attributes"]["POSITION"])
print("[11] cylinder edge segments:", len(lp) // 2, "x range of points", lp[:, 0].min(), lp[:, 0].max(), "edges in brep (with seams):", len(cyl.edges(seams=True)), "without:", len(cyl.edges()))
# tolerance changes the triangle count
for tol in [None, 0.01]:
    export_glb(cyl, f"{OUT}/11-tol.glb", tolerance=tol)
    _, _, _, d3, b3 = read_glb(f"{OUT}/11-tol.glb")
    print("[11] tolerance", tol, "triangles", len(positions(d3, b3, d3["meshes"][0]["primitives"][0]["attributes"]["POSITION"])) // 3)
# gltf (embedded) and edge_color
export_gltf([bracket], f"{OUT}/11-a.gltf", edge_color="red")
g = json.load(open(f"{OUT}/11-a.gltf"))
print("[11] gltf buffer uri prefix:", g["buffers"][0]["uri"][:40], "materials", [m["pbrMetallicRoughness"]["baseColorFactor"] for m in g["materials"]])
try:
    export_glb([bracket], f"{OUT}/11-b.glb", edge_color="red")
except Exception as e:
    print("[11] export_glb edge_color:", type(e).__name__, e)
# a Mesh as input, names of unnamed items
export_glb([tessellate(Box(5, 5, 5)), Box(5, 5, 5)], f"{OUT}/11-mesh.glb")
print("[11] mesh input names:", [m["name"] for m in read_glb(f"{OUT}/11-mesh.glb")[3]["meshes"]])
# a Vertex
export_glb([Box(5, 5, 5).vertices()[0]], f"{OUT}/11-vertex.glb")
print("[11] vertex primitive mode:", read_glb(f"{OUT}/11-vertex.glb")[3]["meshes"][0]["primitives"][0]["mode"])
try:
    export_glb([], f"{OUT}/11-empty.glb"); print("[11] empty list: written", os.path.getsize(f"{OUT}/11-empty.glb"))
except Exception as e:
    print("[11] empty:", type(e).__name__, e)
