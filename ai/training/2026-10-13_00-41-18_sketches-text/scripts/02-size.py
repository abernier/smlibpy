# size is the cap height
for s in (1, 2.5, 10, 100):
    b = Text("H", s).bbox()
    print(f"[02] H size {s}: height {b.size.y:.12g}, y {b.min.y:.6g}..{b.max.y:.6g}")
for ch in "HOAgxÄ":
    b = Text(ch, 10, align=Align.MIN).bbox()
    print(f"[02] {ch!r} at size 10, baseline y=0: y {b.min.y:.4f}..{b.max.y:.4f}")
from smlibpy.font import load_font
f = load_font()
print("[02] font:", f.name, "units per em", f.units_per_em, "cap height", f.cap_height, "-> em size at size 10:",
      round(10 * f.units_per_em / f.cap_height, 4), "mm")
