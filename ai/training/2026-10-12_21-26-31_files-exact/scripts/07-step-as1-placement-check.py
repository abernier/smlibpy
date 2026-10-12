# Is the as1 assembly placed wrong? Re-run the import with the CAx-IF reading of
# ITEM_DEFINED_TRANSFORMATION preferred when an item is in both representations.
import smlibpy.step_reader as sr
import numpy as np

asm = import_step("../models/as1_ac_214.stp")
plate = [p for p in asm if p.name == "A52"] or [asm[0]]
print("[07] stock: plate", plate[0].name, "bbox", plate[0].bbox())
brackets = [p for p in asm if p.name == "52D"]
print("[07] stock: brackets centers", [tuple(round(c, 1) for c in b.center().to_tuple()) for b in brackets])
print("[07] stock: plate touches bracket:", [round(plate[0].distance_to(b), 3) for b in brackets])

orig = sr._item_transform
def fixed(it, ref, child, parent, items):
    t, a = it.sf.get(ref)
    if t != "ITEM_DEFINED_TRANSFORMATION":
        return None
    i1, i2 = int(a[2]), int(a[3])
    cax = i2 in items.get(parent, set()) and i1 in items.get(child, set())
    if cax:
        it.use_units(parent); m1 = it.placement_matrix(i2)
        it.use_units(child); m2 = it.placement_matrix(i1)
        it.use_units(None)
        return m1 @ np.linalg.inv(m2)
    return orig(it, ref, child, parent, items)
sr._item_transform = fixed
asm2 = import_step("../models/as1_ac_214.stp")
sr._item_transform = orig
plate2 = [p for p in asm2 if p.name == "A52"] or [asm2[0]]
brackets2 = [p for p in asm2 if p.name == "52D"]
print("[07] patched: plate bbox", plate2[0].bbox())
print("[07] patched: plate touches bracket:", [round(plate2[0].distance_to(b), 3) for b in brackets2])
nuts = [p for p in asm2 if p.name == "79A"]
bolts = [p for p in asm2 if p.name == "870"]
print("[07] patched: bolt to nearest nut:", [round(min(b.distance_to(n) for n in nuts), 3) for b in bolts])
print("[07] stock: bolt to nearest nut:", [round(min(b.distance_to(n) for n in [p for p in asm if p.name == '79A']), 3) for b in [p for p in asm if p.name == '870']])
snapshot("stock", *asm)
snapshot("patched", *asm2)
