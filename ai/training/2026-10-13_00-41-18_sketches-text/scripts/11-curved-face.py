# engraving with a uniform depth on a cylinder: the text prism intersected with a skin of the wall
r, h, depth = 15, 40, 0.6
can = Cylinder(r, h)
tangent = Plane((0, -r, 0), x_dir=(1, 0, 0), z_dir=(0, -1, 0))   # touches the wall at y = -r, normal outward
prism = Text("CAN 01", 6).on(tangent).extrude(-r)                  # through to the axis
skin = can - Cylinder(r - depth, h + 2)                            # the outer `depth` of the wall
engraved = can - (prism & skin)
print("[11] valid", engraved.is_valid(), "removed", round(can.volume - engraved.volume, 4))
probe = engraved.faces().filter_by(lambda f: f.geom_type == "cylinder" and abs(f.radius - (r - depth)) < 1e-9)
print("[11] floor faces at radius", r - depth, ":", len(probe))
flat = can - Text("CAN 01", 6).on(tangent).extrude(-depth)
print("[11] a plain cut of depth", depth, "from the tangent plane removes", round(can.volume - flat.volume, 4),
      "- only near the line where the plane touches")
snapshot("can", engraved, view=(0, -1, 0.3))
