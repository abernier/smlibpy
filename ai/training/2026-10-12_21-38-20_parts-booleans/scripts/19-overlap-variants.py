part = Box(60, 40, 10)
def tool(x, h, ztop):
    return Cylinder(4, h, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(x, 0, ztop)
s1 = part - tool(0, 12, 5)
for name, t in [("exact thickness, flush top", tool(5, 10, 5)), ("out of the bottom only, flush top", tool(5, 12, 5)),
                ("out of top and bottom", tool(5, 12, 6)), ("blind, flush top", tool(5, 6, 5))]:
    try:
        r = s1 - t
        print("[19]", name, "->", r, r.is_valid(), flush=True)
    except KernelError as e:
        print("[19]", name, "->", e, flush=True)
both = part - (tool(0, 12, 5) + tool(5, 12, 5))
print("[19] fused tools first ->", both, both.is_valid(), "expected vol:", round(24000 - (part & (tool(0, 12, 5) + tool(5, 12, 5))).volume, 3))
