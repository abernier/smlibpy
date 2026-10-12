# Wire.fillet at a sharp corner between a line and an arc
w = Wire([Line((0, 0), (10, 0)), ThreePointArc((10, 0), (13, 6), (10, 12)), Line((10, 12), (0, 12))]).close()
print("[15] corner angle line->arc:", round(w.edges()[0].tangent_at(1).angle_to(w.edges()[1].tangent_at(0)), 3))
f = w.fillet(1)
print("[15] before", [e.geom_type for e in w.edges()], "after", [e.geom_type for e in f.edges()])
