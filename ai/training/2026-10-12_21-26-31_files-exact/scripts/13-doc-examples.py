import os
os.chdir("ai/training/2026-10-12_21-26-31_files-exact/files")

# --- export_step.md
bracket = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket").colored("steelblue")
cover = Box(60, 40, 2).translate(0, 0, 10).named("cover").colored("#d9925a")
export_step([bracket, cover], "assembly.step")

back = import_step("assembly.step")
print([p.name for p in back], round(back[0].volume, 3), round(bracket.volume, 3))
# ['bracket', 'cover'] 18797.876 18797.876

# an inch file: scale the model first, then declare the unit
export_step(bracket.scale(1 / 25.4), "bracket_inch.step", unit="inch")
print(import_step("bracket_inch.step").bbox().size)   # Vector(60, 40, 8)

# --- import_step.md
r = import_step("assembly.step")
parts = r if isinstance(r, ShapeList) else [r]
for p in parts:
    print(type(p).__name__, p.name, p.color, p.is_valid(), round(p.volume, 3))
# Part bracket (0.2745..., 0.5098..., 0.7058...) True 18797.876
# Part cover (0.8509..., 0.5725..., 0.3529...) True 4800.0

# --- save_load.md
save(bracket, "bracket.smb")                  # ASCII, exact
save(bracket, "bracket_bin.smb", ascii=False) # binary, bit-exact
again = load("bracket.smb")
print(again.volume == bracket.volume, again.name)   # True None
again = again.named(bracket.name).colored(bracket.color)   # name and color are not stored

# --- export.md
bracket.export("bracket.step")                # exact
bracket.export("bracket.stl", tolerance=0.01) # mesh, 0.01 mm chord error
export([bracket, cover], "assembly.glb")      # meshes with names and colors
print(type(load("bracket.step")).__name__, type(load("bracket.stl")).__name__)   # Part Mesh
