def cyls(p):
    return sorted(tuple(round(c, 3) for c in f.center().to_tuple()) for f in p.faces().cylinders())

part = Box(60, 40, 10)
top = part.faces().top()
g = part - (GridLocations(20, 10, 3, 1) * Hole(2, 10)).on(top)
print("[03] 3x1 grid spacing 20 on top:", cyls(g))
# front face (normal -Y): plane x_dir and y_dir
front = part.faces().front()
print("[03] front plane:", front.one().plane, "y_dir:", front.one().plane.y_dir)
f = part - (GridLocations(20, 4, 3, 2) * Hole(1, 5)).on(front)
print("[03] grid on front (cyl centers):", cyls(f))
for fc in f.faces().cylinders():
    print("[03]   axis:", fc.axis)
    break
# right face (+X)
right = part.faces().right()
print("[03] right plane:", right.one().plane)
r = part - (Pos(10, 2) * Hole(1, 5)).on(right)
print("[03] Pos(10,2) on right face:", cyls(r))
# bottom face (normal -Z): hole goes up
bottom = part.faces().bottom()
print("[03] bottom plane:", bottom.one().plane)
b = part - (Pos(10, 5) * Hole(2, 4)).on(bottom)
print("[03] Pos(10,5) on bottom, depth 4:", cyls(b), "z range:", [(round(x.bbox().min.z, 3), round(x.bbox().max.z, 3)) for x in b.faces().cylinders()])
snapshot("front", f, view="front")
snapshot("bottom", b, view="bottom")
