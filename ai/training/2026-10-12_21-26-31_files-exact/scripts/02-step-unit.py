import os
OUT = "ai/training/2026-10-12_21-26-31_files-exact/files"

box = Box(60, 40, 8)
for unit in ["mm", "cm", "m", "um", "inch", "in"]:
    p = os.path.join(OUT, f"02-box-{unit}.step")
    export_step(box, p, unit=unit)
    back = import_step(p)
    txt = open(p).read()
    pt = [l for l in txt.splitlines() if "CARTESIAN_POINT" in l and "30." in l][:1]
    print(f"[02] unit={unit:4s} size back:", back.bbox().size, "volume:", round(back.volume, 3), "point:", pt)
# the honest way to write inches: scale the model first
inch_model = box.scale(1 / 25.4)
p = os.path.join(OUT, "02-box-scaled-inch.step")
export_step(inch_model, p, unit="inch")
back = import_step(p)
print("[02] scaled then inch, size back:", back.bbox().size)
for bad in ["MM", "mil", "ft"]:
    try:
        export_step(box, os.path.join(OUT, "02-bad.step"), unit=bad)
        print("[02] unit", bad, "accepted")
    except Exception as e:
        print("[02] unit", bad, type(e).__name__, e)
print("[02] bad file left behind:", os.path.exists(os.path.join(OUT, "02-bad.step")))
