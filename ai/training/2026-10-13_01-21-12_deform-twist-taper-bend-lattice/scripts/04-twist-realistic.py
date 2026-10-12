# twisted vase and a twisted blade with an untwisted root
star = Polygon(*[(r * math.cos(math.radians(a)), r * math.sin(math.radians(a)))
                 for i, a in enumerate(range(0, 360, 30)) for r in [30 if i % 2 == 0 else 24]])
body = star.extrude(120).twist(90)
vase = body.shell(2.5, body.faces().sort_by(Z)[-1])
print("[04] vase: valid", vase.is_valid(), "faces", len(vase.faces()), "volume", round(vase.mass_properties(accuracy=1e-10).volume, 3))
blade = Rectangle(60, 6).extrude(150)
blade = blade.fillet(blade.edges().parallel_to(Z), 2.9)
root = Box(70, 20, 20).translate(0, 0, -10)
twisted = blade.twist(40, start=10)
fan = root + twisted
print("[04] blade: valid", fan.is_valid(), "faces", len(fan.faces()), "volume", round(fan.mass_properties(accuracy=1e-10).volume, 3),
      "expect", round(root.volume + blade.mass_properties(accuracy=1e-10).volume - 60 * 6 * 0, 3))
snapshot("vase", vase, view="iso")
snapshot("blade", fan, view="iso")
