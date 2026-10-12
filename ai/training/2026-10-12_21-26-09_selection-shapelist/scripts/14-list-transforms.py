# A ShapeList as a list: transforms, copy, append, extend, operators with patterns
pins = ShapeList([Cylinder(2, 10), Cylinder(2, 10).translate(10, 0, 0)])
print("[14] ShapeList(list):", type(pins).__name__, len(pins))
t = pins.translate(0, 0, 5)
print("[14] translate:", type(t).__name__, [tuple(round(c, 3) for c in p.center()) for p in t], " original z:", pins[0].center().z)
tv = pins.translate((1, 2, 3))
print("[14] translate(vector):", [tuple(round(c, 3) for c in p.center()) for p in tv])
r = pins.rotate(Z, 90)
print("[14] rotate(Z,90):", [tuple(round(c, 3) for c in p.center()) for p in r])
print("[14] rotate() default angle:", [tuple(round(c, 3) for c in p.center()) for p in pins.rotate()])
m = pins.moved(Pos(0, 0, 100))
print("[14] moved:", [round(p.center().z, 3) for p in m])
lm = Pos(5, 0, 0) * pins
print("[14] Pos * ShapeList:", type(lm).__name__, [round(p.center().x, 3) for p in lm])
plate = Box(60, 40, 10)
onl = ShapeList([Circle(2), Circle(2).translate(10, 0, 0)]).on(plate.faces().top())
print("[14] on(face):", type(onl).__name__, [tuple(round(c, 3) for c in s.center()) for s in onl])
grid = GridLocations(20, 20, 2, 2) * Cylinder(3, 20)
print("[14] GridLocations * part:", type(grid).__name__, len(grid))
holes = plate - grid
print("[14] plate - grid:", round(holes.volume, 3), len(holes.faces().cylinders()))
# list methods
c = pins.copy()
print("[14] copy():", type(c).__name__)
pins2 = pins.translate(0, 0, 0)
pins2.append(Cylinder(1, 5))
print("[14] append:", type(pins2).__name__, len(pins2))
pins2.extend([Box(1, 1, 1)])
print("[14] extend:", type(pins2).__name__, len(pins2))
s = pins + [Box(1, 1, 1)]
print("[14] + list:", type(s).__name__, len(s))
s2 = [Box(1, 1, 1)] + pins
print("[14] list + ShapeList:", type(s2).__name__)
print("[14] list(...):", type(list(pins)).__name__, " ShapeList(generator):", type(ShapeList(x for x in pins)).__name__)
print("[14] filter result chain after copy():", hasattr(c, "top"))
# transforming faces / edges taken from a part
top = plate.faces().top()
moved = top.translate(0, 0, 10)
print("[14] face translate:", type(moved[0]).__name__, moved[0].center().z, " owner:", type(moved[0].owner).__name__, " owner is plate:", moved[0].owner is plate)
emoved = plate.edges().top().translate(0, 0, 5)
print("[14] edges translate:", [round(e.center().z, 3) for e in emoved], " faces of moved edge:", emoved[0].faces())
vmoved = plate.vertices().top().translate(0, 0, 1)
print("[14] vertices translate:", [round(v.z, 3) for v in vmoved])
try:
    plate.fillet(emoved, 1)
except Exception as ex:
    print("[14] fillet moved edges:", type(ex).__name__, ex)
# scale / mirror on lists?
for name in ("scale", "mirror"):
    print(f"[14] ShapeList has {name}:", hasattr(ShapeList, name) and name in ShapeList.__dict__)
try:
    print("[14] scale:", pins.scale(2))
except Exception as ex:
    print("[14] scale:", type(ex).__name__, ex)
