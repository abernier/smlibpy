# Part.remove_fillets on the example parts, native and through STEP; partial=True
import os, sys, tempfile, time
sys.path.insert(0, os.path.join(os.getcwd(), "examples"))
import bracket, flange
d = tempfile.mkdtemp()
for name, mod in (("bracket", bracket), ("flange", flange)):
    part = mod.model()
    export_step(part, os.path.join(d, name + ".step"))
    for variant, p in (("native", part), ("STEP", import_step(os.path.join(d, name + ".step")))):
        t = time.time()
        fl = p.faces().fillets()
        try:
            r = p.remove_fillets()
            note = "all"
        except ModelingError as e:
            print(f"[05] {name} {variant}: ModelingError: {e}")
            r = p.remove_fillets(partial=True)
            note = "partial"
        print(f"[05] {name} {variant} ({note}): {len(fl)} fillets, faces {len(p.faces())} -> {len(r.faces())}, "
              f"volume {p.volume:.3f} -> {r.volume:.3f}, {len(r.faces().fillets())} left, valid {r.is_valid()} [{time.time()-t:.2f} s]")
