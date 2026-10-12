# End to end: a car-fender-like panel. Freeform skin -> thicken -> wheel arch cut -> fillet -> export.
import math, os, tempfile
L, W = 120.0, 50.0                      # length along x, width along y
def z(x, y):
    crown = 6 * math.cos(math.pi * x / L) ** 2          # higher over the wheel
    side = -18 * (y / W) ** 2.2                          # rolls down towards the outside (y = W)
    return 40 + crown + side
# rows along y, stacked in x -> normal = x × y = +Z (up, out of the car)
grid = [[(x, y, z(x, y)) for y in np.linspace(0, W, 9)] for x in np.linspace(-L / 2, L / 2, 13)]
skin = surface(grid)
n = skin.faces()[0].normal_at((0, 0, 46))
print("[04] skin:", skin, "normal at top", n)
print("[04] skin bbox", skin.bbox().min, skin.bbox().max)
panel = skin.thicken(-2)                 # 2 mm under the skin (inside the car)
print("[04] panel valid", panel.is_valid(), "vol", round(panel.volume, 2), "area*2", round(skin.area * 2, 2))
# wheel arch: a cylinder along Y, axis at z = 0, radius 42
arch = Cylinder(42, 200).rotate(X, 90)
print("[04] arch bbox", arch.bbox().min, arch.bbox().max)
fender = panel - arch
print("[04] fender valid", fender.is_valid(), "vol", round(fender.volume, 2), "faces", len(fender.faces()), "solids", len(fender.solids()))
snapshot("fender", fender, view="sheet")
snapshot("fender-iso", fender)
