# Small claims checked before writing the docs
cyl = Cylinder(5, 10)
print("[18] circle edge vertices:", cyl.edges().top().one().vertices())
print("[18] free circle vertices:", Circle(5).edges().one().vertices())
# group_by of edges by length on a box
b = Box(10, 20, 30)
print("[18] group_by('length'):", [(round(g[0].length, 1), len(g)) for g in b.edges().group_by("length")])
# top() of edges on a box with a filleted top
f = Box(20, 20, 10).fillet(Box(20, 20, 10).edges().top(), 2)
print("[18] filleted top: faces().top()", len(f.faces().top()), "edges().top()", len(f.edges().top()), [e.geom_type for e in f.edges().top()])
# min_by with tol on vertices
print("[18] vertices().top() of cylinder:", cyl.vertices().top())
# within with a tolerance: shapes exactly on the boundary
print("[18] within bbox exact:", len(b.faces().within(b.bbox())))
# facing with planar() first on a part with a full cylinder boss
boss = Box(30, 30, 10) + Cylinder(5, 10).translate(0, 0, 10)
print("[18] planar().facing(X):", len(boss.faces().planar().facing(X)))
# nearest on vertices
print("[18] nearest vertex:", b.vertices().nearest((100, 100, 100)))
# sort_by Axis with negative direction
print("[18] sort_by(-Z) first z:", round(b.faces().sort_by(-Z).first.center().z, 3))
print("[18] max_by(-Z) z:", round(b.faces().max_by(-Z).one().center().z, 3))
