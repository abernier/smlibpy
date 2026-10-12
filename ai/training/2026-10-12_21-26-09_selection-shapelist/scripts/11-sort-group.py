# sort_by, sort_by_distance, group_by, sort/reverse, operators
part = Box(40, 30, 20) - Cylinder(6, 30) - Cylinder(2, 30).translate(14, 0, 0)
F, E = part.faces(), part.edges()
def z(f): return round(f.center().z, 3)
print("[11] sort_by() default:", [z(f) for f in F.sort_by()])
print("[11] sort_by(Z, reverse=True):", [z(f) for f in F.sort_by(Z, reverse=True)])
print("[11] sort_by('z'):", [z(f) for f in F.sort_by("z")], " 'X':", [round(f.center().x, 2) for f in F.sort_by("X")])
print("[11] sort_by('area'):", [round(f.area, 1) for f in F.sort_by("area")])
print("[11] sort_by('length') edges:", [round(e.length, 2) for e in E.sort_by("length")])
print("[11] sort_by('radius') circles:", [round(e.radius, 2) for e in E.circles().sort_by("radius")])
print("[11] sort_by('size') faces:", [round(f.area, 1) for f in F.sort_by("size")][:3])
print("[11] sort_by(callable):", [round(f.area, 1) for f in F.sort_by(lambda f: -f.area)][:3])
print("[11] sort_by(Axis offset):", [round(f.center().x, 2) for f in F.sort_by(Axis((100, 0, 0), (1, 0, 0)))][:3])
print("[11] sort_by((1,0,0)) tuple?")
for bad in [(1, 0, 0), "distance", "foo", "area"]:
    try:
        r = (E if bad == "area" else F).sort_by(bad)
        print(f"[11] sort_by({bad!r}):", len(r))
    except Exception as ex:
        print(f"[11] sort_by({bad!r}):", type(ex).__name__, ex)
try:
    print("[11] sort_by('radius') faces:", F.sort_by("radius"))
except Exception as ex:
    print("[11] sort_by('radius') all faces:", type(ex).__name__, ex)
try:
    print("[11] sort_by('length') faces:", F.sort_by("length"))
except Exception as ex:
    print("[11] sort_by('length') faces:", type(ex).__name__, ex)
# sort_by_distance
print("[11] sort_by_distance((20,15,10)) verts:", [v.point.to_tuple() for v in part.vertices().sort_by_distance((20, 15, 10))][:2])
print("[11] sort_by_distance reverse:", [v.point.to_tuple() for v in part.vertices().sort_by_distance((20, 15, 10), reverse=True)][:1])
# group_by
g = E.group_by(Z)
print("[11] group_by(Z):", type(g).__name__, [(round(grp[0].center().z, 3), len(grp), type(grp).__name__) for grp in g])
g2 = F.group_by("area")
print("[11] group_by('area'):", [(round(grp[0].area, 1), len(grp)) for grp in g2])
g3 = E.circles().group_by("radius")
print("[11] group_by('radius') circles:", [(round(grp[0].radius, 1), len(grp)) for grp in g3])
print("[11] group_by(Z)[-1] == max_by(Z):", list(g[-1]) == list(E.max_by(Z)))
# group_by tolerance chaining: values 0, 0.00006, 0.00012 with tol 1e-4
pts = ShapeList([Vertex(0, 0, 0), Vertex(0, 0, 0.00006), Vertex(0, 0, 0.00012), Vertex(0, 0, 0.00018)])
print("[11] group_by chain:", [[v.z for v in grp] for grp in pts.group_by(Z)])
print("[11] group_by tol=1:", [len(grp) for grp in E.group_by(Z, tol=25)])
# list methods sort / reverse are in place and return None
L = part.edges()
r = L.reverse()
print("[11] reverse() returns:", r, " list now first:", L[0] == part.edges()[-1])
L2 = part.faces()
r2 = L2.sort(key=lambda f: f.area)
print("[11] sort(key) returns:", r2, " sorted in place:", [round(f.area, 1) for f in L2][:3], type(L2).__name__)
print("[11] sorted():", type(sorted(F, key=lambda f: f.area)).__name__, " reversed():", type(reversed(F)).__name__)
print("[11] [::-1]:", type(F[::-1]).__name__)
# operators
print("[11] F > Z:", [z(f) for f in (F > Z)], " F < Z:", [z(f) for f in (F < Z)][:2])
print("[11] F >> Z:", len(F >> Z), " F << Z:", len(F << Z), " E >> Z:", len(E >> Z))
print("[11] (E >> Z) == E.top():", list(E >> Z) == list(E.top()))
print("[11] stable ties: sort_by(Z) of top edges keeps order:", list(E.top().sort_by(Z)) == list(E.top()))
