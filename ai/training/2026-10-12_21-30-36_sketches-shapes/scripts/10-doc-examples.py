# The examples of Rectangle.md ... Trapezoid.md, unchanged
# --- Rectangle
plate = Box(60, 40, 10)
pocket = Rectangle(30, 20).on(plate.faces().top()).extrude(-4)
plate = plate - pocket                                   # volume 24000 - 2400
corner = Rectangle(40, 20, align=Align.MIN)              # bbox (0, 0)..(40, 20)
turned = Rectangle(40, 20).rotate(Z, 30)                 # bbox ±22.32 x ±18.66
print("[10] rect:", round(plate.volume, 6), corner.bbox().min, corner.bbox().max, turned.bbox().max)
# --- RoundedRectangle
outline = RoundedRectangle(80, 50, 8)                    # area 4000 - (4 - pi) * 64
plate = (outline - GridLocations(64, 34, 2, 2) * Circle(3)).extrude(6)
stadium = RoundedRectangle(40, 20, 10)                   # same region as Slot(40, 20)
print("[10] rrect:", round(outline.area, 4), round(4000 - (4 - math.pi) * 64, 4), plate.is_valid(), round(stadium.area, 4), round(Slot(40, 20).area, 4))
# --- Circle
ring = Circle(10) - Circle(6)                            # 1 face, 1 inner wire, area pi*(100-36)
disk = Circle(10, align=Align.MIN)                       # bbox (0, 0)..(20, 20)
washer = ring.extrude(2)
print("[10] circle:", round(ring.area, 4), round(math.pi * 64, 4), disk.bbox().min, disk.bbox().max, washer.is_valid())
# --- Ellipse
e = Ellipse(15, 8)                    # 30 wide, 16 high
tilted = Ellipse(15, 8).rotate(Z, 30)
boss = e.extrude(5)                   # 3 faces, volume pi*15*8*5
print("[10] ellipse:", e.bbox().size, tilted.bbox().max, len(boss.faces()), round(boss.volume, 3), round(math.pi * 600, 3))
# --- Polygon
profile = Polygon((0, 0), (30, 0), (30, 10), (10, 25), (0, 25))   # area 600, bbox 0..30 x 0..25
rib = profile.on(Plane.XZ).extrude(4)                             # stands up in XZ, 4 thick toward -Y
centered = Polygon((10, 10), (20, 10), (15, 20), align=Align.CENTER)
print("[10] polygon:", profile.area, rib.bbox().min, rib.bbox().max, centered.bbox().min, centered.bbox().max)
# --- RegularPolygon
nut = RegularPolygon(6.5, 6, inscribed=True) - Circle(3.4)   # M6 nut: 13 across flats
hex_up = RegularPolygon(10, 6, rotation=30)                  # corners at (0, ±10)
square = RegularPolygon(10, 4, inscribed=True, rotation=45)  # 20 x 20, axis aligned
print("[10] regpoly:", round(nut.bbox().size.y, 6), hex_up.bbox().max, square.bbox().min, square.bbox().max)
tri = RegularPolygon(10, 3); tri2 = RegularPolygon(10, 3, align=(Align.CENTER, Align.CENTER))
print("[10] triangle shift:", tri2.bbox().min.x - tri.bbox().min.x)
# --- Slot
plate = Box(60, 40, 8)
cut = plate - Slot(30, 8, rotation=90).on(plate.faces().top()).extrude(-8)   # vertical through slot

c2c = Slot(20 + 6, 6)                       # arc centers at x = -10 and 10

R, w = 30, 6                                # arc slot: centerline radius 30, 0..90 degrees
ri, ro = R - w / 2, R + w / 2
outline = Wire([
    CenterArc((0, 0), ro, 0, 90),
    CenterArc((0, R), w / 2, 90, 180),
    CenterArc((0, 0), ri, 90, -90),
    CenterArc((R, 0), w / 2, 180, 180),
])
arc_slot = make_face(outline)
print("[10] slot:", cut.is_valid(), round(plate.volume - cut.volume, 4), sorted(e.arc_center.x for e in c2c.edges() if e.geom_type == "circle"), round(arc_slot.area, 4))
# --- Trapezoid
t = Trapezoid(40, 15, 60)                       # top 22.68 long, area 470.1
dovetail = Trapezoid(40, 15, 120)               # top 57.32 long
ramp = Trapezoid(40, 15, 60, 90, align=(Align.CENTER, Align.MIN))   # right side vertical, base on y = 0
rail = ramp.on(Plane.XZ).extrude(100)           # base on z = 0, 100 long toward -Y
print("[10] trapezoid:", round(t.area, 4), dovetail.bbox().size.x, ramp.bbox().min, ramp.bbox().max, rail.bbox().min, rail.bbox().max, rail.is_valid())
top_edges = [e for e in dovetail.edges() if abs(e.center().y - 7.5) < 1e-9]
print("[10] dovetail top length:", round(top_edges[0].length, 4), "t top:", round([e for e in t.edges() if abs(e.center().y - 7.5) < 1e-9][0].length, 4))
snapshot("rail", rail, view="sheet")
