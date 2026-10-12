# twisted vase: a star profile, twisted, then hollowed
star = Polygon(*[(r * math.cos(math.radians(a)), r * math.sin(math.radians(a)))
                 for i, a in enumerate(range(0, 360, 30)) for r in [30 if i % 2 == 0 else 24]])
vase = star.extrude(120).twist(90)
vase = vase.shell(2.5, vase.faces().sort_by(Z)[-1])
print(vase.is_valid(), len(vase.faces()))                        # True 27

# twisted blade with a straight root, fused to a hub
blade = Rectangle(60, 6).extrude(150)
blade = blade.fillet(blade.edges().parallel_to(Z), 2.9).twist(40, start=10)
fan = Box(70, 20, 20).translate(0, 0, -10) + blade
print(fan.is_valid(), len(fan.faces()))

# bent handle: holes first, then bend; the legs come back over each other
bar = Box(200, 20, 8) - Locations((-80, 0, 0), (80, 0, 0)) * Cylinder(3, 20)
handle = bar.bend(180, radius=30)
holes = [f for f in handle.faces() if f.geom_type == "cylinder"]
print(handle.is_valid(), sorted((round(f.center().x, 3), round(f.center().z, 3)) for f in holes))

# tapered grip, bored after the taper so the bore stays round
grip = Cylinder(12, 90)
grip = grip.fillet(grip.edges(), 4).taper(0.75) - Cylinder(4, 100)
print(grip.is_valid(), [f.geom_type for f in grip.faces()].count("cylinder"))

# pillow top with a lattice
block = Box(80, 50, 20)
block = block.fillet(block.edges().parallel_to(Z), 10)
lat = Lattice(block, 3)
lat.move((1, 1, -1), (0, 0, 6))
cushion = lat.apply(block)
print(cushion.is_valid(), round(cushion.bbox().max.z, 3))
snapshot("recipe", vase, fan.translate(120, 0, 0), handle.translate(0, 120, 0), grip.translate(-100, 0, 0),
         cushion.translate(-100, 120, 0), view="iso")
