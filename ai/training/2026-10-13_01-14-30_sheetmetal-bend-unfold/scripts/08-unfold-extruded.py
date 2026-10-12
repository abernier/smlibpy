# unfold(): a sheet metal part that was not made with bend(): an L profile extruded
t, r = 2, 2
profile = make_face([Line((0, r + t), (0, 25)), Line((0, 25), (t, 25)), Line((t, 25), (t, r + t)),
                     CenterArc((r + t, r + t), r, 180, 90), Line((r + t, t), (30, t)), Line((30, t), (30, 0)),
                     Line((30, 0), (r + t, 0)), CenterArc((r + t, r + t), r + t, 270, -90)])
angle_part = (Plane.XZ * profile).extrude(40)
print("[08] part:", angle_part, angle_part.bbox())
print("[08] bends:", angle_part.bends())
for k in (0.3, 0.44, 0.5):
    print(f"[08] k {k}: flat {angle_part.flat_pattern(k_factor=k).size.x:.6f}  developed_length "
          f"{developed_length(30, 25, radius=r, thickness=t, k_factor=k):.6f}")
flat = unfold(angle_part)
print("[08] unfold in place:", flat.bbox(), round(flat.volume, 6))
standing = unfold(angle_part, fixed=angle_part.faces().filter(lambda f: f.geom_type == "plane").sort_by(X)[0])
print("[08] fixed = the face at x=0:", standing.bbox())
snapshot("angle", angle_part, flat, view="iso")
