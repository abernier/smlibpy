# Line: inputs, start/end, length, direction, parameterization
a = Line((0, 0), (30, 40))
print("[01] repr:", a)
print("[01] type:", type(a).__name__, a.geom_type)
print("[01] start/end:", a.start, a.end, "length:", a.length)
print("[01] direction:", a.direction, "tangent(0.5):", a.tangent_at(0.5))
print("[01] point_at 0.25:", a.point_at(0.25), "center:", a.center())
print("[01] is_closed:", a.is_closed)
b = Line((1, 2, 3), Vector(4, 6, 3))
print("[01] 3D:", b.start, b.end, b.length)
c = Line([0, 0, 0], [0, 0, 10])
print("[01] list inputs:", c)
v = Line(Vertex(1, 1, 1), Vertex(2, 2, 2))
print("[01] vertex inputs:", v)
r = a.reversed()
print("[01] reversed:", r.start, r.end, r.direction)
print("[01] vertices:", [vv.point for vv in a.vertices()])
print("[01] bbox:", a.bbox().min, a.bbox().max)
print("[01] distance_to (0,50):", a.distance_to((0, 50)))
x = Line((0, 0), (10, 10)).intersections(Line((0, 10), (10, 0)))
print("[01] intersections:", x)
print("[01] radius on line:")
try:
    a.radius
except Exception as e:
    print("   ", type(e).__name__, e)
for args in [((0, 0), (0, 0)), ((0, 0), (1e-13, 0)), ((0, 0), (1e-9, 0)), ((0, 0),), ((0, 0), (1, 1), (2, 2))]:
    try:
        e = Line(*args)
        print("[01] Line", args, "->", e, e.length)
    except Exception as ex:
        print("[01] Line", args, "->", type(ex).__name__, ex)
try:
    Line("a", (1, 1))
except Exception as ex:
    print("[01] str ->", type(ex).__name__, ex)
try:
    Line((0, 0, 0, 0), (1, 1, 1, 1))
except Exception as ex:
    print("[01] 4D ->", type(ex).__name__, ex)
snapshot("line", a, b, view="top")
