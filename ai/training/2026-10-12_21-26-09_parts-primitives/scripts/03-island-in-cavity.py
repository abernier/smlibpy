hollow = Box(20, 20, 20) - Box(10, 10, 10)
inner = hollow + Box(4, 4, 4)
ss = inner.solids()
print("[03] solids:", len(ss), [round(s.volume, 3) for s in ss], [len(s.faces()) for s in ss])
print("[03] hollow solids:", len(hollow.solids()), [round(s.volume, 3) for s in hollow.solids()])
# island outside instead of inside
outside = hollow + Box(4, 4, 4).translate(40, 0, 0)
print("[03] island outside solids:", len(outside.solids()), [round(s.volume, 3) for s in outside.solids()])
# island inside fused in the other order
inner2 = Box(4, 4, 4) + hollow
print("[03] reversed order solids:", len(inner2.solids()), [round(s.volume, 3) for s in inner2.solids()])
# distance between hollow part and inner box
print("[03] distance hollow to island:", round(hollow.distance_to(Box(4, 4, 4)), 6))
