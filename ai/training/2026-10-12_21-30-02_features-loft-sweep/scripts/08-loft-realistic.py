vase = loft([Circle(15), Circle(25).translate(0, 0, 30), Circle(18).translate(0, 0, 55), Circle(20).translate(0, 0, 70)])
print("[vase] valid", vase.is_valid(), "vol", round(vase.volume, 2), "faces", len(vase.faces()), "bbox", vase.bbox().size.to_tuple())
cup = vase.shell(2, vase.faces().top())
print("[cup] valid", cup.is_valid(), "vol", round(cup.volume, 2))
smooth4 = vase
quad4 = loft([Circle(15), Circle(25).translate(0, 0, 30), Circle(18).translate(0, 0, 55), Circle(20).translate(0, 0, 70)], smooth=False)
print("[4 sections smooth vs quad] vol", round(smooth4.volume, 2), round(quad4.volume, 2))
# rectangular duct to round duct, then hollow it
duct = loft([Rectangle(40, 30), Circle(12).rotate(Z, 45).translate(0, 0, 40)])
print("[duct] valid", duct.is_valid(), "vol", round(duct.volume, 2), "mid area", round(duct.section(Plane.XY.offset(20)).area, 2))
hollow = duct.shell(2, duct.faces().top() + duct.faces().bottom())
print("[duct hollow] valid", hollow.is_valid(), "vol", round(hollow.volume, 2), "faces", len(hollow.faces()))
snapshot("cup", cup, hollow.translate(60, 0, 0))
