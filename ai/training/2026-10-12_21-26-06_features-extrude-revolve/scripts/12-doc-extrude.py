plate = Rectangle(40, 30).extrude(5)                    # z 0..5
down = Rectangle(40, 30).extrude(-5)                    # z -5..0
slab = Rectangle(40, 30).extrude(5, both=True)          # z -5..5
wall = Rectangle(20, 10).on(Plane.front).extrude(5)     # Plane.front faces -Y: y -5..0
slant = Circle(5).extrude(20, direction=(0, 1, 2))      # 20 measured along the direction

box = Box(40, 30, 20)
top = box.faces().top()
box -= Rectangle(20, 10).on(top).extrude(-5)            # pocket 5 deep
print(box.is_valid(), round(box.volume, 3))             # True 23000.0

boss = Box(40, 30, 20)
boss += boss.faces().top()[0].extrude(5)                # grow the top face by 5
print(boss.bbox().max.z)                                # 15.0

core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)  # sides lean in by 3 degrees
ring = Circle(10).extrude(10, taper=5) - Circle(5).extrude(10, taper=-5)  # tapered ring with a hole
print(round(ring.volume, 3))                            # 1943.914

sheet = extrude(CenterArc((0, 0), 10, 0, 180), 5)       # open curve -> Shell
print(type(sheet).__name__, round(sheet.area, 3))       # Shell 157.08
for p in (plate, down, slab, wall, slant):
    print(p.bbox().min.to_tuple(), p.bbox().max.to_tuple())
