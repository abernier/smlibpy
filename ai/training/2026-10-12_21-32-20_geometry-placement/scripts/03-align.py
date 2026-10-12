# Align on primitives and sketches
A = Align
def bb(s): 
    b = s.bbox(); return f"min {tuple(round(v, 4) for v in b.min)} max {tuple(round(v, 4) for v in b.max)}"
print("[03] values:", list(Align), A.MIN.value)
print("[03] Box default:", bb(Box(10, 20, 30)))
print("[03] Box MIN:", bb(Box(10, 20, 30, align=A.MIN)))
print("[03] Box MAX:", bb(Box(10, 20, 30, align=A.MAX)))
print("[03] Box (C,C,MIN):", bb(Box(10, 20, 30, align=(A.CENTER, A.CENTER, A.MIN))))
print("[03] Box (MIN,MAX,CENTER):", bb(Box(10, 20, 30, align=(A.MIN, A.MAX, A.CENTER))))
print("[03] Box str 'min':", bb(Box(10, 20, 30, align="min")), " ('MIN','center','max'):", bb(Box(10, 20, 30, align=("MIN", "center", "max"))))
print("[03] Box None:", bb(Box(10, 20, 30, align=None)))
print("[03] Box (None,None,MIN):", bb(Box(10, 20, 30, align=(None, None, A.MIN))))
print("[03] Box 2-tuple (MIN,MIN):", bb(Box(10, 20, 30, align=(A.MIN, A.MIN))))
try:
    Box(1, 1, 1, align="bottom")
except Exception as e:
    print("[03] align='bottom' ->", type(e).__name__, e)
print("[03] Cylinder MIN:", bb(Cylinder(5, 10, align=A.MIN)))
print("[03] Cylinder (C,C,MIN):", bb(Cylinder(5, 10, align=(A.CENTER, A.CENTER, A.MIN))))
print("[03] Cone (C,C,MIN):", bb(Cone(5, 2, 10, align=(A.CENTER, A.CENTER, A.MIN))))
print("[03] Sphere MIN:", bb(Sphere(5, align=A.MIN)))
print("[03] Torus MAX:", bb(Torus(10, 2, align=A.MAX)))
print("[03] Wedge default:", bb(Wedge(10, 20, 30)), " center:", Wedge(10, 20, 30).center())
print("[03] Wedge (C,C,MIN):", bb(Wedge(10, 20, 30, align=(A.CENTER, A.CENTER, A.MIN))))
# sketches
print("[03] Rectangle default:", bb(Rectangle(10, 20)))
print("[03] Rectangle MIN:", bb(Rectangle(10, 20, align=A.MIN)))
print("[03] Rectangle (MIN,MAX):", bb(Rectangle(10, 20, align=(A.MIN, A.MAX))))
print("[03] Rectangle 3-tuple (MIN,MIN,MAX):", bb(Rectangle(10, 20, align=(A.MIN, A.MIN, A.MAX))))
print("[03] Circle MIN:", bb(Circle(5, align=A.MIN)))
print("[03] RegularPolygon(10,3) default:", bb(RegularPolygon(10, 3)))
print("[03] RegularPolygon(10,3) CENTER:", bb(RegularPolygon(10, 3, align=A.CENTER)))
print("[03] RegularPolygon(10,3) (CENTER,CENTER):", bb(RegularPolygon(10, 3, align=(A.CENTER, A.CENTER))))
print("[03] RegularPolygon(10,5) default:", bb(RegularPolygon(10, 5)), " (C,C):", bb(RegularPolygon(10, 5, align=(A.CENTER, A.CENTER))))
print("[03] Polygon default:", bb(Polygon((0, 0), (10, 0), (0, 5))))
print("[03] Polygon CENTER:", bb(Polygon((0, 0), (10, 0), (0, 5), align=A.CENTER)))
print("[03] Polygon MAX:", bb(Polygon((0, 0), (10, 0), (0, 5), align=A.MAX)))
print("[03] Slot MIN:", bb(Slot(20, 6, align=A.MIN)))
print("[03] Trapezoid default:", bb(Trapezoid(20, 10, 60)))
print("[03] Ellipse MIN:", bb(Ellipse(6, 3, align=A.MIN)))
print("[03] RoundedRectangle MAX:", bb(RoundedRectangle(20, 10, 2, align=A.MAX)))
# sketch on a plane after align: align happens in XY before .on
s = Rectangle(10, 20, align=(A.CENTER, A.MIN)).on(Plane.XZ)
print("[03] align then on(XZ):", bb(s))
# align is not a parameter of translate / extrude
try:
    print("[03] Hole has align?", Hole(2, 5, align=A.MIN))
except Exception as e:
    print("[03] Hole align ->", type(e).__name__, e)
