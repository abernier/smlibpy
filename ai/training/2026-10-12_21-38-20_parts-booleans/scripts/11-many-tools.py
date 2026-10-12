import time
plate = Box(200, 200, 5)
holes = GridLocations(10, 10, 15, 15) * Cylinder(2, 10)
t = time.time()
p = plate - holes
print(f"[11] 225 holes as list: {time.time()-t:.2f}s faces {len(p.faces())} valid {p.is_valid()}")
t = time.time()
tool = sum(holes[1:], holes[0])
print(f"[11] fuse 225 cylinders first: {time.time()-t:.2f}s solids {len(tool.solids())}")
t = time.time()
p2 = plate - tool
print(f"[11] cut with the fused tool: {time.time()-t:.2f}s faces {len(p2.faces())} vol equal {abs(p2.volume - p.volume) < 1e-6}")
pins = Box(100, 100, 5, align=(Align.CENTER, Align.CENTER, Align.MAX)) + GridLocations(10, 10, 9, 9) * Cylinder(2, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
print(f"[11] 81 pins fused: solids {len(pins.solids())} valid {pins.is_valid()} faces {len(pins.faces())}")
# overlapping tools in one list
ov = Box(40, 40, 5) - [Cylinder(5, 10), Cylinder(5, 10).translate(4, 0, 0), Cylinder(5, 10).translate(8, 0, 0)]
print(f"[11] overlapping tools: valid {ov.is_valid()} vol {round(ov.volume, 3)} faces {len(ov.faces())}")
