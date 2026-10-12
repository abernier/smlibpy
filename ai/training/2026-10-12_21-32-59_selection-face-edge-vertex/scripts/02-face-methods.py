# normal_at(point), interior_point, to_sketch, to_shell, extrude, wires, plane origin
def r3(v): return tuple(round(c, 4) for c in v)
part = Box(40, 30, 20) - Cylinder(6, 30) - Cylinder(2, 30).translate(14, 0, 0)
hole = part.faces().cylinders().filter(lambda f: abs(f.radius - 6) < 1e-9).one()
print("[02] hole normal_at((6,0,0)):", r3(hole.normal_at((6, 0, 0))), " at (0,6,5):", r3(hole.normal_at((0, 6, 5))))
print("[02] hole normal_at far point (100,0,0):", r3(hole.normal_at((100, 0, 0))))
boss = Cylinder(6, 20)
print("[02] boss normal_at((6,0,0)):", r3(boss.faces().cylinders().one().normal_at((6, 0, 0))))
top = part.faces().top().one()
print("[02] top normal_at((100,100,100)) off-face:", r3(top.normal_at((100, 100, 100))))
print("[02] top center (centroid):", r3(top.center()), " bbox center:", r3(top.bbox().center))
print("[02] top plane origin:", r3(top.plane.origin), " distance centroid->face:", round(top.distance_to(top.center()), 6))
print("[02] top interior_point:", r3(top.interior_point()), " on face:", round(top.distance_to(top.interior_point()), 9))
print("[02] top outer/inner:", top.outer_wire(), top.inner_wires())
print("[02] inner wire radii:", [round(w.edges()[0].radius, 3) for w in top.inner_wires()])
# ring face: centroid in the hole
ring = Cylinder(10, 5) - Cylinder(6, 10)
rt = ring.faces().top().one()
print("[02] ring top centroid:", r3(rt.center()), " distance to face:", round(rt.distance_to(rt.center()), 4), " interior:", r3(rt.interior_point()))
c = Circle(1).on(rt)
print("[02] Circle.on(ring top) center:", r3(c.center()))
# to_sketch, to_shell, extrude
sk = top.to_sketch()
print("[02] to_sketch:", type(sk).__name__, round(sk.area, 3), " plane origin", r3(sk.plane.origin), " z", r3(sk.plane.z_dir), " faces", len(sk.faces()), " inner", len(sk.faces()[0].inner_wires()))
shl = top.to_shell()
print("[02] to_shell:", type(shl).__name__, round(shl.area, 3), len(shl.faces()))
ex = top.extrude(5)
print("[02] extrude(5):", type(ex).__name__, round(ex.volume, 3), ex.bbox())
ex2 = top.extrude(-5)
print("[02] extrude(-5):", round(ex2.volume, 3), ex2.bbox())
side = part.faces().facing(X).one()
exs = side.extrude(3)
print("[02] side extrude(3):", round(exs.volume, 3), exs.bbox())
try:
    hole.to_sketch()
except Exception as ex_:
    print("[02] cylinder to_sketch:", type(ex_).__name__, ex_)
try:
    print("[02] cylinder extrude:", hole.extrude(2))
except Exception as ex_:
    print("[02] cylinder extrude:", type(ex_).__name__, ex_)
print("[02] cylinder to_shell:", hole.to_shell(), round(hole.to_shell().area, 3))
# sketch face plane keeps sketch x_dir
s = Rectangle(10, 5).on(Plane.XZ)
print("[02] sketch face plane x/z:", r3(s.faces()[0].plane.x_dir), r3(s.faces()[0].plane.z_dir), " sketch plane x:", r3(s.plane.x_dir))
# is_planar on a bspline plane (to_nurbs)
nb = Box(10, 10, 10).to_nurbs()
f0 = nb.faces()[0]
print("[02] nurbs face geom_type:", f0.geom_type, " is_planar:", f0.is_planar, " planar() count:", len(nb.faces().planar()), " is_planar count:", len(nb.faces().filter(lambda f: f.is_planar)))
try:
    print("[02] nurbs plane z:", r3(f0.plane.z_dir))
except Exception as ex_:
    print("[02] nurbs plane:", type(ex_).__name__, ex_)
print("[02] nurbs parallel_to(Z):", len(nb.faces().parallel_to(Z)), " facing(Z):", len(nb.faces().facing(Z)))
