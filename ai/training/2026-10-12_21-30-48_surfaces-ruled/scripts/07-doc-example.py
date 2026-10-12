# Doc example: a twisted blade between two lines, and a frustum between two circles, thickened.
blade = ruled(Line((0, 0, 0), (40, 0, 0)), Line((0, 20, 10), (40, 20, -10)))
print(blade.faces()[0].normal_at())               # tangent of a × (a → b), here mostly +Z
blade_solid = blade.thicken(1.5)
print(blade_solid.is_valid(), round(blade_solid.volume, 2))

funnel = ruled(CenterArc((0, 0, 0), 20, 0, 360), CenterArc((0, 0, 30), 5, 0, 360))
print(round(funnel.area, 3))                      # exact frustum: π(20+5)·√(15²+30²) = 2634.3
wall = funnel.thicken(-2)                         # normal points outward; -2 puts the wall inside
print(wall.is_valid(), round(wall.volume, 1), wall.bbox().max.x)
snapshot("doc", blade_solid, wall.translate(60, 0, 0))
