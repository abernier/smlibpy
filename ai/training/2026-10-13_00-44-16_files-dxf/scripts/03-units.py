# units in and out
import sys, os; sys.path.insert(0, os.path.abspath("ai/training/2026-10-13_00-44-16_files-dxf/scripts"))
from _dxf import TMP, dxf, circle
r = Rectangle(50.8, 25.4)
for unit in ("mm", "inch", "cm", "m", "ft"):
    p = os.path.join(TMP, f"r-{unit}.dxf")
    export_dxf(r, p, unit=unit)
    lines = open(p).read().splitlines()
    ins = lines[lines.index("$INSUNITS") + 2]
    print(f"[03] unit={unit}: $INSUNITS {ins}, read back {import_dxf(p).bbox().size.x:.6g} mm, as mm {import_dxf(p, unit='mm').bbox().size.x:.6g}")
for code in (0, 1, 2, 4, 5, 6, 13, 21):
    s = import_dxf(dxf(f"c{code}.dxf", circle((0, 0), 1), header=f"9\n$INSUNITS\n70\n{code}\n"))
    print(f"[03] $INSUNITS {code}: a circle of radius 1 is {s.bbox().size.x / 2:.10g} mm")
print("[03] no header:", import_dxf(dxf("nohdr.dxf", circle((0, 0), 1))).bbox().size.x / 2)
try:
    export_dxf(r, os.path.join(TMP, "x.dxf"), unit="MM")
except ValueError as e:
    print("[03]", e)
