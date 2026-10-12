# Axis: construction, world axes, uses, moving
print("[03] X Y Z:", X, Y, Z, "Axis.Z is Z:", Axis.Z is Z)
print("[03] Axis():", Axis())
a = Axis((10, 0, 0), (0, 0, 5))
print("[03] Axis((10,0,0),(0,0,5)):", a, "direction normalized:", a.direction, "origin:", a.origin)
try:
    Axis((0, 0, 0), (0, 0, 0))
except Exception as e:
    print("[03] zero dir ->", type(e).__name__, e)
print("[03] -Z:", -Z, "reversed:", Z.reversed())
print("[03] at:", Z.at((5, 5, 0)))
print("[03] moved by Pos:", Z.moved(Pos(5, 0, 0)), "Pos*Z:", Pos(5, 0, 0) * Z)
print("[03] moved by Rot(y=90):", Z.moved(Rot(y=90)))
print("[03] distance_to:", a.distance_to((0, 0, 3)), "project:", a.project((0, 0, 3)), "position_along:", a.position_along((0, 0, 3)))
print("[03] is_parallel:", Z.is_parallel(-Z), Z.is_parallel((0, 0, 7)), Z.is_parallel(X))
print("[03] eq:", Axis((0, 0, 5), (0, 0, 1)) == Z, Axis((0, 0, 0), (0, 0, -1)) == Z, Axis((1, 0, 0), (0, 0, 1)) == Z)
# 2D origin tuple
print("[03] 2D origin:", Axis((3, 4), (1, 0)))
# rotate a part about an offset axis
b = Box(2, 2, 2).translate(10, 0, 0)
r = b.rotate(Axis((5, 0, 0), (0, 0, 1)), 90)
print("[03] rotate about axis thru (5,0,0) by 90:", r.center())
# revolve uses Axis
s = Rectangle(4, 10).translate(12, 0)
ring = s.revolve(Y)
print("[03] revolve about Y: volume", round(ring.volume, 3), "expected", round(2 * math.pi * 12 * 40, 3), "bbox", ring.bbox())
# selection uses Axis
p = Box(10, 20, 30)
print("[03] sort_by(X)[-1] center:", p.faces().sort_by(X)[-1].center())
print("[03] parallel_to(Z) count:", len(p.edges().parallel_to(Z)), "parallel_to((0,0,1)):", len(p.edges().parallel_to((0, 0, 1))))
print("[03] sort_by(Axis offset):", p.faces().sort_by(Axis((0, 0, 100), (0, 0, -1)))[0].center())
print("[03] face.axis of cylinder:", Cylinder(3, 10).translate(5, 0, 0).faces().cylinders()[0].axis)
# rotate with a tuple instead of Axis
try:
    print(b.rotate((0, 0, 1), 90).center())
except Exception as e:
    print("[03] rotate((0,0,1),90) ->", type(e).__name__, e)
# mirror with an Axis?
try:
    print(b.mirror(X).center())
except Exception as e:
    print("[03] mirror(X) ->", type(e).__name__, e)
# Axis as hash key
print("[03] set of axes:", len({X, Axis((0, 0, 0), (1, 0, 0)), Y}))
print("[03] Rot*Axis:", Rot(z=90) * X)
