# Trim a surface with a solid: (part & shell) is a sheet typed as Part; stitch() turns it into a Shell.
f = lambda x, y: 5 + 0.01 * (x - 20) ** 2 - 0.01 * (y - 15) ** 2
s = surface([[(x, y, f(x, y)) for y in range(0, 31, 5)] for x in range(0, 41, 5)])
cut = Cylinder(8, 30).translate(20, 15, 0) & s
patch = stitch(cut)
print("[07]", type(cut).__name__, "->", type(patch).__name__, "area", round(patch.area, 3), "edges", len(patch.edges()))
print("[07] bbox", patch.bbox().min, patch.bbox().max)
t = patch.thicken(1)
print("[07] thicken(1): vol", round(t.volume, 3), "valid", t.is_valid(), "area*1", round(patch.area, 3))
snapshot("disc", patch, view="sheet")
