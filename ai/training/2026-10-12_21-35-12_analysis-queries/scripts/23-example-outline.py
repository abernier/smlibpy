part = Box(30, 30, 10) - Cylinder(5, 6, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, -5)
top_view = part.outline(Plane.XY)            # seen from +Z: the blind hole underneath is hidden
bottom_view = part.outline(Plane.bottom)     # seen from -Z: the hole shows
print(len(top_view), len(bottom_view))       # 4 5
print(sorted(round(e.length, 4) for e in bottom_view))   # [30.0, 30.0, 30.0, 30.0, 31.4159]

front = Cylinder(5, 20).outline(Plane.XZ)    # Plane.XZ looks from -Y: a 10 x 20 rectangle
print(len(front), front.bbox().size)                    # 6 Vector(10, 0, 20)
