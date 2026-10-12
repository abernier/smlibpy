# several lines, line spacing, letter spacing, kerning
def box(t):
    b = t.bbox()
    return f"x {b.min.x:.4f}..{b.max.x:.4f}  y {b.min.y:.4f}..{b.max.y:.4f}"
block = Text("FIRST\nSECOND LINE\nIII", 5, align=Align.MIN)
print("[04] three lines MIN:", box(block), "faces", len(block.faces()))
for ls in (1.0, 1.6, 2.5):
    t = Text("H\nH", 10, line_spacing=ls, align=Align.MIN)
    print(f"[04] line_spacing {ls}: y {t.bbox().min.y:.4f}..{t.bbox().max.y:.4f} (top = (ls + 1) * size = {(ls + 1) * 10})")
for a in (Align.MIN, Align.CENTER, Align.MAX):
    t = Text("HHHH\nH", 10, align=(a, Align.MIN))
    xs = sorted(round(f.center().x, 3) for f in t.faces() if f.center().y < 8)  # the second line stands on y = 0
    print(f"[04] lines aligned {a}: the short line's H at x = {xs}")
plain = Text("AV", 10, align=Align.MIN, kerning=False).bbox().max.x
kern = Text("AV", 10, align=Align.MIN).bbox().max.x
print(f"[04] AV width kerned {kern:.6f}, not kerned {plain:.6f}, difference {plain - kern:.6f} (136 font units * 10/1433 = {136 * 10 / 1433:.6f})")
for sp in (-0.5, 0, 0.5, 2):
    w = Text("ABC", 10, align=Align.MIN, spacing=sp).bbox().max.x
    print(f"[04] spacing {sp}: ABC ends at x {w:.6f}")
tight = Text("AA", 10, spacing=-6)
print("[04] AA spacing -6 (letters overlap): faces", len(tight.faces()), "area", round(tight.area, 4), "single A", round(Text("A", 10).area, 4))
snapshot("block", block, view="top", size=(900, 400))
