t = CounterSinkHole(2, 4, 1)   # depth 1 < sink depth 2.3
print("[14] depth < sink: bbox z", round(t.bbox().min.z, 4), "..", round(t.bbox().max.z, 4), "faces", [f.geom_type for f in t.faces()], "valid", t.is_valid())
block = Box(40, 40, 20)
block -= CounterSinkHole(2.2, 4.5, 8, angle=90).on(block.faces().top())
z_sink = 10 - (4.5 - 2.2)
e = block.edges().filter_by(lambda e: abs(e.center().z - z_sink) < 1e-3)
print("[14] edges at the sink bottom:", len(e), [x.geom_type for x in e], [round(x.length, 4) for x in e], "2*pi*2.2:", round(2 * math.pi * 2.2, 4))
