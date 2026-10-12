# the examples of import_dxf.md, import_dxf_wires.md and export_dxf.md, unchanged (run in a temp folder)
import os, tempfile
os.chdir(tempfile.mkdtemp(prefix="dxf-doc-"))
print("--- import_dxf.md")
part = Box(40, 30, 20) - Cylinder(8, 30) - Cylinder(3, 30).translate(14, 8, 0)
export_dxf(part.section(Plane.XY), "section.dxf")      # a drawing to read back
outline = import_dxf("section.dxf")
print(outline, [len(f.inner_wires()) for f in outline.faces()])   # Sketch(1 faces, area=970.664) [2]
print(sorted(round(e.radius, 9) for e in outline.edges() if e.geom_type == "circle"))   # [3.0, 8.0]
plate = outline.extrude(6)                             # z 0..6
print(round(plate.volume, 3))                          # 5823.982
print("[11] plate z", plate.bbox().min.z, plate.bbox().max.z)
print("--- import_dxf_wires.md")
path = Polyline((0, 0), (40, 0), (40, 30))
export_dxf(path, "path.dxf")
[w] = import_dxf_wires("path.dxf")
print(w, w.is_closed)                  # Wire(2 edges, open, length=70) False
tube = sweep(Circle(2).on(Plane.YZ), w)
print(tube.is_valid())                 # True
print("--- export_dxf.md")
part = Box(40, 30, 20) - Cylinder(8, 30)
export_dxf(part.section(Plane.XY), "section.dxf")                 # 4 LINE, 1 CIRCLE
export_dxf(part.section(Plane.XZ), "side.dxf")                    # x = X, y = Z
tag = [RoundedRectangle(40, 12, 2).named("cut"), Text("PART 7", 5).named("engrave")]
export_dxf(tag, "tag.dxf", unit="inch")                           # two layers, inches
print(import_dxf("tag.dxf", layers=["cut"]).bbox().size)          # Vector(40, 12, 0)
text = open("section.dxf").read()
print("[11] section.dxf:", {k: text.count(f"\n{k}\n") for k in ("LINE", "ARC", "CIRCLE")})
print("[11] side.dxf bbox:", import_dxf("side.dxf").bbox())
