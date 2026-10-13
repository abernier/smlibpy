# Recipe: check a part for a two-part mold (pull along Z)
cover = RoundedRectangle(80, 50, 6).extrude(25, taper=2)                 # outside, drafted 2 degrees
cover -= RoundedRectangle(74, 44, 3).extrude(23, taper=1.5)               # inside from the open bottom, narrowing up
print("[11] cover:", cover.is_valid(), round(cover.volume, 3), len(cover.faces()), "faces")
lines = cover.parting_line(Z)
print("[11] parting line:", [(round(w.length, 4), round(w.bbox().min.z, 6), round(w.bbox().max.z, 6)) for w in lines])
up = cover.draft_analysis(Z, min_angle=1)
down = cover.draft_analysis(-Z, min_angle=1)
print("[11] up:", up)
print("[11] down:", down)
need = [f for f in cover.faces() if f not in up.positive and f not in down.positive]
print("[11] faces that release in neither direction:", len(need))
for fd in up:
    print("[11]   ", fd.face.geom_type, round(fd.min_angle, 4), round(fd.max_angle, 4), fd.kind, "| down:", next(x.kind for x in down if x.face == fd.face))
# a rib without draft

ribbed = cover + Box(2, 44, 10, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 23)
up2, down2 = ribbed.draft_analysis(Z), ribbed.draft_analysis(-Z)
need2 = [f for f in ribbed.faces() if f not in up2.positive and f not in down2.positive]
print("[11] with a rib:", len(need2), "faces need draft:", sorted((f.geom_type, round(f.area, 2)) for f in need2))
print("[11] vertical in both:", len([f for f in ribbed.faces() if f in up2.vertical and f in down2.vertical]))
snapshot("cover", cover, view="iso")
# the inside widening upwards: the core cannot come out downwards
bad = RoundedRectangle(80, 50, 6).extrude(25, taper=2) - RoundedRectangle(74, 44, 3).extrude(23, taper=-1.5)
print("[11] inside widening up:", bad.draft_analysis(-Z), "| parting lines:", len(bad.parting_line(Z)),
      [(round(w.bbox().min.z, 3), round(w.bbox().max.z, 3)) for w in bad.parting_line(Z)])
