from smlibpy._kernel import k
ring = Circle(10) - Circle(5)
f = ring.faces()[0]
ws = f.wires()
print("[loops]", len(ws), [round(w.length, 3) for w in ws])
for i, w in enumerate(ws):
    p = Part._wrap(k.draft_sweep(w._copy_curves(), 10.0, -5.0))
    b = p.bbox()
    print(f"[loop {i} taper -5] vol={p.volume:.4f} z {b.min.z:.3f}..{b.max.z:.3f} r={b.max.x:.3f}")
    p = Part._wrap(k.draft_sweep(w._copy_curves(), 10.0, 5.0))
    b = p.bbox()
    print(f"[loop {i} taper +5] vol={p.volume:.4f} z {b.min.z:.3f}..{b.max.z:.3f} r={b.max.x:.3f}")
# workaround: taper the outer, cut a straight or tapered hole separately
outer = Circle(10).extrude(10, taper=5)
hole = Circle(5).extrude(10, taper=-5)
w = outer - hole
print("[workaround] vol", round(w.volume, 4), "valid", w.is_valid())
r1 = 10 - 10*math.tan(math.radians(5)); r2 = 5 + 10*math.tan(math.radians(5))
print("expected", math.pi*10/3*(100+r1*r1+10*r1) - math.pi*10/3*(25+r2*r2+5*r2))
# square with square hole
sq = (Rectangle(40, 40) - Rectangle(10, 10)).extrude(10, taper=5)
print("[square ring taper] vol", round(sq.volume, 3), "faces", len(sq.faces()))
print("no-hole frustum", 10/3*(1600 + (40-20*math.tan(math.radians(5)))**2 + 40*(40-20*math.tan(math.radians(5)))))
snapshot("ring", w)
