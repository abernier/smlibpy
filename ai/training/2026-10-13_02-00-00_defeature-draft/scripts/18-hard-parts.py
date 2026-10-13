# remove_fillets on hard cases: B-spline faces, an invalid part, the guard on the example enclosure
import os, sys, time
sys.path.insert(0, os.path.join(os.getcwd(), "examples"))
from smlibpy import defeature
plate = Box(60, 40, 5, align=(Align.CENTER, Align.CENTER, Align.MAX))
sharp = plate + Box(20, 16, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
part = sharp.fillet(sharp.edges().filter(lambda e: abs(e.center().z) < 1e-6 and e.convexity == "concave"), 2)
nurbs = part.to_nurbs()
back = nurbs.remove_fillets()
v = back.mass_properties(accuracy=1e-10).volume
print("[18] B-spline boss: faces", len(nurbs.faces()), "->", len(back.faces()), "volume %.6f, relative error %.1e" % (v, (v - 15200) / 15200))
box = Box(40, 30, 20)
nb = box.fillet(box.edges(), 3).to_nurbs().remove_fillets()
print("[18] B-spline full round box: faces", len(nb.faces()), "volume error %.1e" % (nb.mass_properties(accuracy=1e-10).volume - 24000))
sheet = Part._wrap(box.faces()[0].to_shell()._copy_brep())
try:
    sheet.remove_fillets()
except ModelingError as e:
    print("[18] invalid part:", e)
import enclosure
enc = enclosure.model()[0]
print("[18] enclosure:", len(enc.faces()), "faces,", len(enc.faces().fillets()), "fillet faces, guard", defeature.GUARD_SECONDS, "s")
t = time.time()
try:
    enc.remove_fillets()
except ModelingError as e:
    print("[18] strict:", str(e)[:160], "[%.0f s]" % (time.time() - t))
t = time.time()
r = enc.remove_fillets(partial=True)
print("[18] partial: faces %d -> %d, volume %.3f -> %.3f, %d left, valid %s [%.0f s]" % (len(enc.faces()), len(r.faces()), enc.volume, r.volume, len(r.faces().fillets()), r.is_valid(), time.time() - t))
