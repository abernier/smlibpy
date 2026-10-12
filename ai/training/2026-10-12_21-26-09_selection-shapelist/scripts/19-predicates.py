# The predicate snippets of filter_by.md, and a predicate that raises
part = Box(40, 30, 16, align=(Align.CENTER, Align.CENTER, Align.MIN)) - Cylinder(3, 40) - Cylinder(6, 40).translate(12, 0, 0)
print(len(part.edges().filter(lambda e: e.geom_type == "line" and e.length > 35)))   # 4
print(len(part.faces().cylinders().filter(lambda f: abs(f.radius - 3) < 1e-6)))     # 1: holes of r 3
print(len(part.edges().circles().filter(lambda e: e.is_closed)))                    # 4: full circles only
print(len(part.edges().filter(lambda e: abs(e.center().z - 8) < 1e-6)))             # 4: edges at z = 8
try:
    part.edges().filter(lambda e: e.radius > 2)
except ValueError as ex:
    print("[19] raising predicate:", ex)
print("[19] narrowed:", len(part.edges().circles().filter(lambda e: e.radius > 2)))
