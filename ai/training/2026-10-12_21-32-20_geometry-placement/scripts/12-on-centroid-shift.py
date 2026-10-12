# the face centroid moves when a feature changes the face
plate = Box(60, 40, 10)
print("[12] top center before:", plate.faces().top()[0].center())
plate2 = plate - (Pos(20, 0) * Rectangle(10, 30)).on(plate.faces().top()).extrude(-3)
top = plate2.faces().top()[0]
print("[12] top center after off-center pocket:", top.center())
c = Circle(2).on(plate2.faces().top())
print("[12] circle placed on new top at:", c.center())
# stable reference: a plane built once
ref = Plane.XY.offset(plate.bbox().max.z)
print("[12] circle on fixed plane:", Circle(2).on(ref).center())
