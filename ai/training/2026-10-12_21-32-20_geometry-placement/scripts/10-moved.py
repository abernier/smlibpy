# moved(Location): relative vs absolute, vs translate/rotate
b = Box(4, 2, 2).translate(10, 0, 0)
L = Pos(0, 0, 5) * Rot(z=90)
print("[10] moved:", b.moved(L).center(), "L*b:", (L * b).center())
print("[10] moved is relative: moved twice:", b.moved(Pos(1, 0, 0)).moved(Pos(1, 0, 0)).center())
print("[10] moved(Pos) == translate:", b.moved(Pos(1, 2, 3)).center(), b.translate(1, 2, 3).center())
print("[10] moved(Rot(z=90)) == rotate(Z,90):", b.moved(Rot(z=90)).center(), b.rotate(Z, 90).center())
# absolute placement: move from current location to target
target = Pos(0, 50, 0)
c = b.center()
absplaced = b.moved(Pos(-c)).moved(target)
print("[10] absolute (center to (0,50,0)):", absplaced.center())
# moved with a plane location
print("[10] moved(Plane.XZ.location):", Box(4, 2, 1, align=(Align.CENTER, Align.CENTER, Align.MIN)).moved(Plane.XZ.location).bbox())
try:
    print("[10] moved(Plane.XZ):", b.moved(Plane.XZ).center())
except Exception as e:
    print("[10] moved(Plane) ->", type(e).__name__, e)
try:
    print("[10] moved((1,2,3)):", b.moved((1, 2, 3)).center())
except Exception as e:
    print("[10] moved(tuple) ->", type(e).__name__, e)
# moved on ShapeList, sketches, edges
sl = ShapeList([Box(1, 1, 1), Box(1, 1, 1).translate(5, 0, 0)]).moved(Pos(0, 0, 3))
print("[10] ShapeList moved:", [x.center() for x in sl])
s = Rectangle(4, 2).moved(Rot(x=90))
print("[10] sketch moved Rot(x=90): plane", s.plane, "bbox", s.bbox())
e = Line((0, 0), (5, 0)).moved(Pos(0, 0, 1) * Rot(z=90))
print("[10] edge moved:", e)
# composition: moved(A).moved(B) == moved(B*A)
A, B = Pos(10, 0, 0), Rot(z=90)
print("[10] moved(A).moved(B):", b.moved(A).moved(B).center(), " moved(B*A):", b.moved(B * A).center(), " moved(A*B):", b.moved(A * B).center())
# location of a part? (no attribute)
print("[10] Part has .location:", hasattr(b, "location"), " Sketch.plane.location:", Rectangle(1, 1).translate(3, 0).plane.location)
