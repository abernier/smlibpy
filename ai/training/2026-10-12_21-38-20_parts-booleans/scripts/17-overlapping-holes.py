part = Box(60, 40, 10)
top = part.faces().top()
try:
    r = part - (Locations((0, 0), (5, 0)) * Hole(4, 10)).on(top)
    print("[17] overlapping through Holes as list:", r, r.is_valid())
except KernelError as e:
    print("[17] overlapping through Holes as list:", e)
tools = (Locations((0, 0), (5, 0)) * Hole(4, 10)).on(top)
r = part - sum(tools[1:], tools[0])
print("[17] fused first:", r, "valid", r.is_valid(), "faces", len(r.faces()))
try:
    r = part - (Locations((0, 0), (5, 0)) * Hole(4, 6)).on(top)
    print("[17] overlapping blind Holes as list:", r, r.is_valid())
except KernelError as e:
    print("[17] overlapping blind Holes as list:", e)
for d in [10.5, 12, 20]:
    try:
        r = part - (Locations((0, 0), (5, 0)) * Hole(4, d)).on(top)
        print("[17] overlapping Holes depth", d, ":", r, r.is_valid())
    except KernelError as e:
        print("[17] overlapping Holes depth", d, ":", e)
