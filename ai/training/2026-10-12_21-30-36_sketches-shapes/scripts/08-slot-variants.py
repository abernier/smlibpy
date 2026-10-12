# Slot variants smlibpy does not have: center-to-center slot, slot between two points, arc slot
# center to center 20, width 6  ->  Slot(20 + 6, 6)
c2c = Slot(20 + 6, 6)
arcs = [e.arc_center.x for e in c2c.edges() if e.geom_type == "circle"]
print("[08] c2c centers:", sorted(arcs))
# slot between two points p and q
p, q, w = Vector(5, 5), Vector(25, 15), 6
d = q - p
ang = math.degrees(math.atan2(d.y, d.x))
pq = Pos((p + q) / 2) * Slot(d.length + w, w, rotation=ang)
print("[08] slot p->q arc centers:", [tuple(round(c, 6) for c in e.arc_center) for e in pq.edges() if e.geom_type == "circle"])
# arc slot: centerline radius R from 0 to 90 degrees, width w
R, w = 30, 6
ri, ro = R - w / 2, R + w / 2
outline = Wire([
    CenterArc((0, 0), ro, 0, 90),
    CenterArc((0, R), w / 2, 90, 180),
    CenterArc((0, 0), ri, 90, -90),
    CenterArc((R, 0), w / 2, 180, 180),
])
print("[08] arc slot wire:", outline, "closed:", outline.is_closed)
arc_slot = make_face(outline)
expected = math.pi / 4 * (ro ** 2 - ri ** 2) + math.pi * (w / 2) ** 2
print("[08] arc slot:", repr(arc_slot), "area:", round(arc_slot.area, 4), "expected:", round(expected, 4), "plane z:", arc_slot.plane.z_dir)
ex = arc_slot.extrude(3)
print("[08] arc slot extrude valid:", ex.is_valid(), "bbox:", ex.bbox().min, ex.bbox().max)
snapshot("variants", c2c.extrude(1), pq.extrude(1), ex, view="top")
