# Is the 7e-8 gap of the far, rotated Boolean body from rotation or from the distance?
tilted = Box(40, 40, 40) - Cylinder(8, 100).rotate(Axis((0, 0, 0), (1, 1, 0)), 35)
variants = {
    "as built": tilted,
    "rotated": tilted.rotate(Axis((0, 0, 0), (3, -1, 2)), 71),
    "far": tilted.translate(5000, -8000, 12000),
    "rotated+far": tilted.rotate(Axis((0, 0, 0), (3, -1, 2)), 71).translate(5000, -8000, 12000),
    "far 1e6": tilted.translate(1e6, 0, 0),
}
for name, p in variants.items():
    vals = [p.mass_properties(accuracy=a).volume for a in (1e-7, 1e-9, 1e-11)]
    print(f"[10] {name}: " + " ".join(f"{v:.12g}" for v in vals) + f"  A={p.area:.12g}")
# exact volume: box minus the part of the cylinder inside; check against a mesh too
m = tilted.mesh(tolerance=0.0005)
print(f"[10] mesh(0.0005) V={m.volume:.10g}")
