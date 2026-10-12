# Which side does thicken add material to? Flat 4x4-point grid at z=0, rows along y.
grid = [[(x, y, 0) for x in (0, 10, 20, 30)] for y in (0, 10, 20, 30)]
s = surface(grid)
f = s.faces()[0]
print("[02] normal at center:", f.normal_at())
for t in (2, -2):
    p = s.thicken(t)
    print(f"[02] thicken({t}): z {p.bbox().min.z:.4f}..{p.bbox().max.z:.4f} vol {p.volume:.3f} valid {p.is_valid()}")
p = s.thicken(2, both=True)
print(f"[02] thicken(2, both=True): z {p.bbox().min.z:.4f}..{p.bbox().max.z:.4f} vol {p.volume:.3f}")
# swap the grid direction: transpose rows/cols
gridT = [list(col) for col in zip(*grid)]
sT = surface(gridT)
print("[02] transposed normal:", sT.faces()[0].normal_at())
p = sT.thicken(2)
print(f"[02] transposed thicken(2): z {p.bbox().min.z:.4f}..{p.bbox().max.z:.4f}")
# reverse rows
sR = surface(grid[::-1])
print("[02] rows reversed normal:", sR.faces()[0].normal_at())
p = sR.thicken(2)
print(f"[02] rows reversed thicken(2): z {p.bbox().min.z:.4f}..{p.bbox().max.z:.4f}")
# module function on a Face
p = thicken(f, 3)
print(f"[02] thicken(face, 3): z {p.bbox().min.z:.4f}..{p.bbox().max.z:.4f}")
