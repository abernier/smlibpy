# Part.remove_faces: holes, bosses, pockets
import time
blk = Box(40, 30, 20)
def run(tag, part, faces):
    t = time.time()
    r = part.remove_faces(faces)
    v = r.mass_properties(accuracy=1e-10).volume
    print(f"[07] {tag}: faces {len(part.faces())} -> {len(r.faces())}, volume {part.volume:.4f} -> {v:.9f} (error {v - 24000:+.1e}) [{time.time()-t:.2f} s]")
    return r
holed = blk - Cylinder(5, 40)
run("through hole", holed, holed.faces().cylinders())
blind = blk - Cylinder(5, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
run("blind hole, wall only (floor goes with it)", blind, blind.faces().cylinders())
bossed = blk + Cylinder(5, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 10)
run("boss, side only (top goes with it)", bossed, bossed.faces().cylinders())
pocket = blk - Box(10, 8, 6, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 10)
run("rectangular pocket", pocket, pocket.faces().filter(lambda f: f.bbox().max.z < 10 + 1e-6 and f.bbox().min.z > 3.9))
cb = blk - CounterBoreHole(3, 6, 4, 20).translate(0, 0, 10)
run("counterbore", cb, cb.faces().filter(lambda f: f.geom_type == "cylinder" or (f.is_planar and abs(f.center().z - 6) < 1e-6)))
cs = blk - CounterSinkHole(3, 6, 20).translate(0, 0, 10)
run("countersink", cs, cs.faces().filter(lambda f: f.geom_type in ("cylinder", "cone")))
two = blk - Pos(-10, 0, 0) * Cylinder(3, 40) - Pos(10, 0, 0) * Cylinder(3, 40)
run("two holes at once", two, two.faces().cylinders())
fh = blk - Cylinder(5, 40)
fh = fh.fillet(fh.edges().filter(lambda e: e.geom_type == "circle" and e.center().z > 9), 1)
run("hole with a rounded rim", fh, fh.faces().filter(lambda f: not f.is_planar))
one = two.remove_faces(two.faces().cylinders().sort_by("x")[0])
print("[07] one of two holes:", len(one.faces()), round(one.volume, 4))
for call in ("holed.remove_faces([])", "holed.remove_faces(holed.faces())", "holed.remove_faces(Box(1, 1, 1).translate(50, 0, 0).faces())"):
    try:
        eval(call)
    except Exception as e:
        print("[07]", call, "->", type(e).__name__ + ":", e)
