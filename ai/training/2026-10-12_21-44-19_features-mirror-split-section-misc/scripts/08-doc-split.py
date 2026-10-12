part = Box(40, 30, 20) - Cylinder(8, 30)
upper = part.split(Plane.XY)                            # keeps the side the normal points to: z 0..10
lower = part.split(Plane.XY, keep="below")              # z -10..0
right, left = part.split(Plane.YZ, keep="both")         # (above, below) = (x > 0, x < 0)
low5 = part.split(Plane.XY.offset(5), keep="below")     # everything under z = 5

empty = part.split(Plane.XY.offset(50))                 # nothing above: an empty Part, no error
print(empty.is_valid(), len(empty.faces()))             # False 0

# drafted wall: cut with a plane through the bottom edge, normal tilted 5 degrees, pointing into the part
wall = Box(40, 30, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
a = math.radians(5)
drafted = wall.split(Plane(origin=(20, 0, 0), z_dir=(-math.cos(a), 0, -math.sin(a))))
print(round(drafted.volume, 3))                         # 23475.068

inside, outside = part & Sphere(15), part - Sphere(15)  # "split by a body"
