# Which way does a sketch made from a wire extrude, compared with a sketch placed on the same plane?
for name in ("XZ", "front", "back", "YZ", "left", "bottom"):
    pl = getattr(Plane, name)
    rect = Rectangle(20, 10).on(pl)
    wire = Polyline((-10, -5), (10, -5), (10, 5), (-10, 5), close=True).on(pl)
    ws = wire.to_sketch()
    print(f"[10] {name}: plane z {pl.z_dir.to_tuple()} | Rectangle.on z {rect.plane.z_dir.to_tuple()} "
          f"| wire.to_sketch z {ws.plane.z_dir.to_tuple()} | make_face z {make_face(wire).plane.z_dir.to_tuple()}")
    print(f"      Rectangle extrude(5) bbox {rect.extrude(5).bbox().min.to_tuple()} {rect.extrude(5).bbox().max.to_tuple()}")
    print(f"      wire sketch extrude(5) bbox {ws.extrude(5).bbox().min.to_tuple()} {ws.extrude(5).bbox().max.to_tuple()}")
# the workaround: build the sketch on XY, then place it
s = make_face(Polyline((-10, -5), (10, -5), (10, 5), (-10, 5), close=True)).on(Plane.XZ)
print("[10] make_face on XY then .on(XZ): z", s.plane.z_dir, "extrude bbox", s.extrude(5).bbox().min, s.extrude(5).bbox().max)
