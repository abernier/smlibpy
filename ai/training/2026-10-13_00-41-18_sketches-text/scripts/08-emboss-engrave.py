# raised and engraved letters on a part
plate = Box(70, 24, 5)
label = Text("SMLIB 42", 8)
top = plate.faces().top()
embossed = plate + label.on(top).extrude(0.8)
engraved = plate - label.on(top).extrude(-0.5)
print("[08] embossed valid", embossed.is_valid(), "volume", round(embossed.volume, 4), "expected", round(plate.volume + 0.8 * label.area, 4))
print("[08] engraved valid", engraved.is_valid(), "volume", round(engraved.volume, 4), "expected", round(plate.volume - 0.5 * label.area, 4))
print("[08] embossed top z", embossed.bbox().max.z, "faces", len(embossed.faces()))
side = plate.faces().facing(-Y).one()
sign = plate - Text("FRONT", 3).on(side).extrude(-0.3)
b = Text("FRONT", 3).on(side).bbox()
print("[08] on the front face: text bbox x", round(b.min.x, 3), round(b.max.x, 3), "z", round(b.min.z, 3), round(b.max.z, 3), "y", round(b.min.y, 3), "valid", sign.is_valid())
# a curved face has no plane: place the text on a tangent plane and cut through the surface
can = Cylinder(15, 40)
try:
    Text("CAN", 6).on(can.faces().cylinders().one())
except ValueError as e:
    print("[08] on a cylinder face:", e)
tangent = Plane((0, -15, 0), x_dir=(1, 0, 0), z_dir=(0, -1, 0))
cut = can - Text("CAN", 6).on(tangent).extrude(-1)
print("[08] cut from a tangent plane: valid", cut.is_valid(), "removed", round(can.volume - cut.volume, 4), "flat depth would remove", round(Text("CAN", 6).area * 1, 4))
snapshot("parts", embossed, engraved.translate(0, 30, 0), view="iso")
