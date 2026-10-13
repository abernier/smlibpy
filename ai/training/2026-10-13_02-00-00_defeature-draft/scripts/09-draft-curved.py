# Part.draft_analysis on curved faces
import time
for name, part, d in (("sphere", Sphere(10), Z), ("cylinder along Z", Cylinder(5, 20), Z),
                      ("cylinder along X", Cylinder(5, 20).rotate(Y, 90), Z), ("cone", Cone(10, 5, 20), Z),
                      ("torus", Torus(20, 5), Z), ("dome", Sphere(10) & Box(30, 30, 30, align=(Align.CENTER, Align.CENTER, Align.MIN)), Z)):
    t = time.time()
    da = part.draft_analysis(d)
    print(f"[09] {name}: {da} [{time.time()-t:.3f} s]")
    for fd in da:
        print(f"[09]    {fd.face.geom_type}: {fd.min_angle:.9f} .. {fd.max_angle:.9f} {fd.kind}")
print("[09] cone half angle atan(5/20) =", math.degrees(math.atan(5 / 20)))
cup = Box(60, 40, 30) - Box(52, 32, 26, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 15)
cup = cup.fillet(cup.edges(), 1) if False else cup
print("[09] open box:", cup.draft_analysis(Z), cup.draft_analysis(-Z))
