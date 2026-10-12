plate = Box(60, 40, 10)
pins = ShapeList([Cylinder(3, 20), Cylinder(3, 20).translate(20, 0, 0)])
moved = pins.translate(-10, 0, 0)                      # new ShapeList of moved copies
print([round(p.center().x, 3) for p in moved])         # [-10.0, 10.0]
print(type(pins.rotate(Z, 90)).__name__)               # ShapeList
plate -= moved                                         # a list on the right of - is fine
print(len(plate.faces().cylinders()))                  # 2
marks = ShapeList([Circle(2), Circle(2).translate(10, 0, 0)]).on(plate.faces().top())
print([round(m.center().z, 3) for m in marks])         # [5.0, 5.0]
print(type(Pos(1, 0, 0) * pins).__name__, type(pins.copy()).__name__)   # list list
