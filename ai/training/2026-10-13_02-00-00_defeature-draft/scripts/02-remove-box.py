# Part.remove_fillets on a box: rounds with sharp ends, mitred, full rounds, blends
import time
box = Box(40, 30, 20)

def report(tag, rounded):
    sharp = rounded.remove_fillets()
    mp = sharp.mass_properties(accuracy=1e-10)
    b = sharp.bbox()
    print(f"[02] {tag}: faces {len(rounded.faces())} -> {len(sharp.faces())} {sorted({f.geom_type for f in sharp.faces()})}, "
          f"volume {rounded.volume:.6f} -> {mp.volume:.9f} (error {mp.volume - 24000:+.1e}), "
          f"bbox {b.min.to_tuple()} {b.max.to_tuple()}")
    return sharp

report("4 vertical r3", box.fillet(box.edges().parallel_to(Z), 3))
report("4 top r3 (mitred)", box.fillet(box.faces().top(), 3))
report("all 12 r3 (corner spheres)", box.fillet(box.edges(), 3))
report("variable 2..4", box.fillet(box.edges().parallel_to(Z), (2, 4)))
report("G2 r3", box.fillet(box.edges().parallel_to(Z), 3, continuity="G2"))
rounded = box.fillet(box.edges(), 3)
print("[02] input unchanged:", len(rounded.faces()), round(rounded.volume, 4))
v4 = box.fillet(box.edges().parallel_to(Z), 3)
first = v4.faces().fillets().sort_by("x")[0]
less = v4.remove_fillets(first)
print("[02] one of 4:", len(less.faces()), round(less.volume - v4.volume, 6), "expected", round(20 * (9 - 9 * math.pi / 4), 6))
t = time.time(); rounded.remove_fillets(); print("[02] time full round box: %.2f s" % (time.time() - t))
t = time.time(); v4.remove_fillets(); print("[02] time 4 vertical: %.2f s" % (time.time() - t))
snapshot("before", rounded)
snapshot("after", rounded.remove_fillets())
