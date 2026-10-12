# The doc example: a gently curved panel, normal up, thickened downward-free check.
import math

# rows run along x, points in a row along y: normal = x × y = +Z (up)
grid = [[(x, y, 4 * math.sin(math.pi * x / 80) * math.cos(math.pi * y / 120))
         for y in np.linspace(-30, 30, 7)]
        for x in np.linspace(0, 80, 9)]
panel = surface(grid)
print(panel.faces()[0].normal_at((40, 0, 4)))      # (0, 0, 1)
solid = panel.thicken(2)                           # 2 mm along the normal: upward
print(solid.is_valid(), solid.volume > 0, solid.bbox().min.z, solid.bbox().max.z)
snapshot("panel", solid, view="sheet")
