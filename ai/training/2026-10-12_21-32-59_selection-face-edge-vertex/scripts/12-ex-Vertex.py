box = Box(10, 10, 10)
corner = box.vertices().top().right().back().one()
print(corner, corner.x, corner.point)            # Vertex(5, 5, 5) 5.0 Vector(5, 5, 5)
print(corner == Vertex(5, 5, 5))                 # True: equal by position
print(len(corner.edges()), len(corner.faces()))  # 3 3
print(Line(corner, Vertex(0, 0, 0)).length)      # 8.660254037844387
sk = Rectangle(20, 10)
rounded = sk.fillet(2, sk.vertices().right())    # round only the two right corners
print(round(rounded.area, 4))                    # 198.2832
