import os, sys, tempfile
sys.path.insert(0, os.path.join(os.getcwd(), "examples"))
import bracket
path = os.path.join(tempfile.mkdtemp(), "bracket.step")
export_step(bracket.model(), path)
# --- recipe ---
part = import_step(path)
print(len(part.faces()), round(part.volume, 3), len(part.faces().fillets()))   # 19 31287.062 5

simple = part.remove_fillets(max_radius=5, partial=True)     # small rounds; keep what cannot go
print(len(simple.faces()), len(simple.faces().fillets(max_radius=5)))           # 17 2

holes = part.faces().filter(lambda f: f.geom_type in ("cylinder", "cone") and f not in part.faces().fillets())
plain = part.remove_faces(holes, partial=True)                # holes straight from the import
print(len(plain.faces()), round(plain.volume, 3))            # 13 32550.724
print(plain.is_valid(), len(plain.solids()))                 # True 1
