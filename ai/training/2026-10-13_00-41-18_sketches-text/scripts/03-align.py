# align works on the layout box (advance widths, baseline to cap height), not on the ink
def box(t):
    b = t.bbox()
    return f"x {b.min.x:.4f}..{b.max.x:.4f}  y {b.min.y:.4f}..{b.max.y:.4f}"
for a in (Align.CENTER, Align.MIN, Align.MAX, None, (Align.MIN, Align.CENTER), ("max", "min")):
    print(f"[03] align={a!r}:", box(Text("Hg", 10, align=a)))
print("[03] ink box of 'Hg' centered:", box(Text("Hg", 10)), "(the descender hangs below -5)")
print("[03] two labels with MIN share the baseline:", Text("Hg", 10, align=Align.MIN).bbox().min.y, Text("HH", 10, align=Align.MIN).bbox().min.y)
print("[03] 'AV' advance box vs ink: ", box(Text("AV", 10, align=Align.MIN)))
