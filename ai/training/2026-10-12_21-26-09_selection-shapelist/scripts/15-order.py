# Order of faces(): stable for one part, changes with every feature; why indices break
box = Box(40, 30, 20)
def desc(f):
    c = f.center()
    return f"{f.geom_type}@({c.x:.0f},{c.y:.0f},{c.z:.0f})"
print("[15] box faces order:", [desc(f) for f in box.faces()])
print("[15] box faces again:", [desc(f) for f in box.faces()] == [desc(f) for f in box.faces()])
moved = box.translate(0, 0, 0)
print("[15] translated copy order same:", [desc(f) for f in moved.faces()] == [desc(f) for f in box.faces()])
print("[15] faces of copy == faces of original:", moved.faces()[0] == box.faces()[0])
cut = box - Cylinder(5, 30)
print("[15] after cut:", [desc(f) for f in cut.faces()])
fil = cut.fillet(cut.edges().parallel_to(Z), 3)
print("[15] after fillet:", [desc(f) for f in fil.faces()][:8])
print("[15] faces()[0] box/cut/fil:", desc(box.faces()[0]), desc(cut.faces()[0]), desc(fil.faces()[0]))
print("[15] top() box/cut/fil:", desc(box.faces().top().one()), desc(cut.faces().top().one()), desc(fil.faces().top().one()))
print("[15] edges order:", [f"{e.geom_type}@{tuple(round(c) for c in e.center())}" for e in box.edges()])
print("[15] vertices order:", [tuple(round(c) for c in v) for v in box.vertices()])
# Selections stay valid after the part variable is rebound
part = Box(10, 10, 10)
top = part.faces().top()
part = part - Cylinder(2, 20)
try:
    print("[15] old top face used on new part:", part.fillet(top, 1))
except Exception as ex:
    print("[15] old selection on new part:", type(ex).__name__, ex)
print("[15] old face still readable:", round(top.one().area, 3), "owner is new part:", top.one().owner is part)
