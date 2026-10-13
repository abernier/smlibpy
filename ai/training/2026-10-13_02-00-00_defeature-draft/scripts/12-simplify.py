# Recipe: simplify an imported part (fillets, then holes)
import os, sys, tempfile
sys.path.insert(0, os.path.join(os.getcwd(), "examples"))
import bracket
d = tempfile.mkdtemp()
export_step(bracket.model(), os.path.join(d, "bracket.step"))
part = import_step(os.path.join(d, "bracket.step"))
print("[12] imported:", len(part.faces()), "faces,", round(part.volume, 3))
small = part.faces().fillets(max_radius=5)
print("[12] fillets up to r5:", len(small), "| all:", len(part.faces().fillets()))
try:
    simple = part.remove_fillets(max_radius=5)
except ModelingError as e:
    print("[12] strict:", e)
    simple = part.remove_fillets(max_radius=5, partial=True)
print("[12] after fillets:", len(simple.faces()), "faces,", round(simple.volume, 3), "left:", len(simple.faces().fillets(max_radius=5)))
holes = simple.faces().filter(lambda f: f.geom_type in ("cylinder", "cone") and f not in simple.faces().fillets())
print("[12] hole faces:", len(holes), sorted({f.geom_type for f in holes}))
try:
    plain = simple.remove_faces(holes)
except ModelingError as e:
    print("[12] strict:", e)
    plain = simple.remove_faces(holes, partial=True)
print("[12] after holes:", len(plain.faces()), "faces,", round(plain.volume, 3), plain.is_valid())
direct = part.remove_faces(part.faces().filter(lambda f: f.geom_type in ("cylinder", "cone") and f not in part.faces().fillets()))
print("[12] holes straight from the import:", len(part.faces()), "->", len(direct.faces()), "faces")
native = bracket.model()
clean = native.remove_fillets().remove_faces(native.remove_fillets().faces().filter(lambda f: f.geom_type in ("cylinder", "cone")))
print("[12] native bracket fully simplified:", len(clean.faces()), "faces,", round(clean.volume, 3), "(L profile area 8*60 + 8*42 = 816, x 40 =", 816 * 40, ")")
snapshot("simplified", clean)
holes = native.faces().filter(lambda f: f.geom_type in ("cylinder", "cone") and f not in native.faces().fillets())
other = native.remove_faces(holes, partial=True).remove_fillets(partial=True)
print("[12] native bracket, holes first:", len(other.faces()), "faces,", round(other.volume, 3), "fillets left:", len(other.faces().fillets()))
