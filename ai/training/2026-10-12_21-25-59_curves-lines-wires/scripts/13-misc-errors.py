# Misc: Edge() constructor, make_face with a list of edges, wire + edge prepend
try:
    Edge()
except Exception as ex:
    print("[13] Edge() ->", type(ex).__name__, ex)
edges = [Line((0, 0), (10, 0)), Line((10, 0), (0, 10)), Line((0, 10), (0, 0))]
try:
    s = make_face(edges)
    print("[13] make_face(list):", s.area)
except Exception as ex:
    print("[13] make_face(list) ->", type(ex).__name__, ex)
print("[13] make_face(Wire(list)):", make_face(Wire(edges)).area)
w = Polyline((10, 0), (20, 0))
print("[13] wire + edge before it:", w + Line((0, 0), (10, 0)), (w + Line((0, 0), (10, 0))).start)
print("[13] edge + wire:", Line((0, 0), (10, 0)) + w)
try:
    print("[13] extrude(list of edges):", type(extrude(edges, 3)).__name__)
except Exception as ex:
    print("[13] extrude(list of edges) ->", type(ex).__name__, ex)
print("[13] extrude(Wire(list)):", type(extrude(Wire(edges), 3)).__name__)
print("[13] Wire.translate:", w.translate(0, 0, 5), w.translate(0, 0, 5).start)
