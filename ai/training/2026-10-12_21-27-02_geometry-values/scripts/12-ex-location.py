place = Location((10, 0, 0), (0, 0, 90))      # position, then X/Y/Z angles in degrees
same = Pos(10, 0, 0) * Rot(z=90)
print(place == same, place.position, place.rotation)

bar = Box(4, 2, 2)
print((Pos(10, 0, 0) * Rot(z=90) * bar).center())   # rotate, then move: Vector(10, 0, 0)
print((Rot(z=90) * Pos(10, 0, 0) * bar).center())   # move, then rotate: Vector(0, 10, 0)

moved = bar.moved(place)
back = moved.moved(place.inverse())
print(back.center(), place * Vector(1, 0, 0), place.rotate_vector((1, 0, 0)))

turn_in_place = Location.about(Axis((10, 0, 0), (0, 0, 1)), 45)
print((turn_in_place * Pos(10, 0, 0) * bar).center())   # stays at Vector(10, 0, 0)
