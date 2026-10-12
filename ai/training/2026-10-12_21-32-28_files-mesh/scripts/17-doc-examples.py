import os
os.chdir("ai/training/2026-10-12_21-32-28_files-mesh/files")

# --- export_stl.md / import_stl.md
part = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket")
export_stl(part, "bracket.stl")                      # binary, default tolerance
export_stl(part, "bracket_fine.stl", tolerance=0.01) # finer: 0.01 mm chord error
m = import_stl("bracket_fine.stl")
print(m, round(m.volume, 3), round(part.volume, 3))
# Mesh(138 vertices, 272 triangles) 18798.526 18797.876

# --- export_glb.md
bracket = part.colored("steelblue")
cover = Box(60, 40, 2).translate(0, 0, 10).named("cover").colored("#d9925a")
export_glb([bracket, cover], "assembly.glb")                  # mm, Z up, edges as lines
export_glb([s.scale(0.001) for s in (bracket, cover)], "assembly_m.glb")  # meters for Blender & co.
export_gltf(bracket, "bracket.gltf", edges=True, edge_color="red")
print([s.scale(0.001).name for s in (bracket, cover)])   # ['bracket', 'cover']

# --- export_obj.md
export_obj([bracket, cover], "assembly.obj", tolerance=0.01)
print([l.strip() for l in open("assembly.obj") if l.startswith("o ")])   # ['o bracket', 'o cover']

# --- render.md
plate = (Box(40, 30, 10) - Cylinder(6, 20)).colored("steelblue")
png = render(plate, path="plate.png")                                   # iso, 800 x 600
render(plate, path="plate_views.png", view="sheet", size=(1000, 760))  # front, top, right, iso
render(plate, path="plate_under.png", view=(1, -1, -1), edges=False, background="#202020")
print(png[:4], len(png))

# --- show.md
page = show(plate, cover, title="plate", path="plate.html", open_browser=False)
print(page)   # plate.html

# --- Mesh.md
solid = Box(20, 20, 20) - Sphere(12)       # Boolean on exact parts first
m = solid.mesh(tolerance=0.01)             # then mesh
print(m, m.vertices.shape, m.triangles.shape, m.normals.shape)
print(round(m.volume, 2), round(solid.volume, 2), round(m.area, 2), round(solid.area, 2))
