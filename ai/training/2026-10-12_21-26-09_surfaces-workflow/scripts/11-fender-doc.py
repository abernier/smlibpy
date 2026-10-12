import math

L, W = 120.0, 50.0
def z(x, y):
    return 40 + 6 * math.cos(math.pi * x / L) ** 2 - 18 * (y / W) ** 2.2
skin = surface([[(x, y, z(x, y)) for y in np.linspace(0, W, 9)] for x in np.linspace(-L / 2, L / 2, 13)])
panel = skin.thicken(-2)                                  # normal is up; -2 goes under the skin
assert panel.is_valid() and panel.volume > 0
fender = panel - Cylinder(42, 200).rotate(X, 90)          # wheel arch, axis along Y
fender = fender.fillet(fender.faces().cylinders().edges(), 0.5)
print(fender.is_valid(), round(fender.volume, 2), len(fender.solids()))   # True 9908.49 1
