plate = Box(60, 40, 10)
top = plate.faces().top()
s = Circle(3).on(top)
print("[02] sketch:", s, type(s).__name__)
for name, r in [("plate - sketch", plate - s), ("plate + sketch", plate + s), ("plate & sketch", plate & s)]:
    print("[02]", name, "->", r, "valid:", r.is_valid(), "solids:", len(r.solids()) if r.is_valid() else "-")
inside = Circle(3)   # on XY at z=0: through the middle of the centered box
r = plate - inside
print("[02] plate - Circle(3) inside the box:", r, "valid:", r.is_valid())
ok = plate - s.extrude(-4)
print("[02] with extrude(-4):", ok, "valid:", ok.is_valid())
# a Shell tool (open surface)
sh = Rectangle(80, 50).to_shell() if hasattr(Rectangle(80, 50), "to_shell") else None
print("[02] Rectangle has to_shell:", sh is not None)
