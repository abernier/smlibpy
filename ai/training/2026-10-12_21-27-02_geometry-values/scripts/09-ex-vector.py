a = Vector(10, 0, 0)
b = Vector((0, 5))                    # 2D: z = 0
print(a + b, a - (0, 0, 3), 2 * a, a / 4)
print(a.dot(b), a.cross(b), a.length, a.normalized())
print(a.angle_to(b))                  # 90.0, always 0..180
print(Vector(1, 0, 0).rotate(Z, 90))  # Vector(0, 1, 0)

d = Z.direction * 5                   # X, Y, Z are axes; .direction is the vector
part = Box(10, 10, 10).translate(d)
print(part.center())                  # Vector(0, 0, 5)
total = sum([Vector(1, 0, 0), Vector(0, 2, 0)], Vector())
