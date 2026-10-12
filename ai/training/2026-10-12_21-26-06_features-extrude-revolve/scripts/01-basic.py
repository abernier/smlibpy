def rep(tag, p):
    b = p.bbox()
    print(f"[{tag}] {type(p).__name__} valid={p.is_valid()} vol={p.volume:.4f} min={b.min.to_tuple()} max={b.max.to_tuple()} faces={len(p.faces())}")

plate = Rectangle(40, 30).extrude(5)
rep("plain", plate)
neg = Rectangle(40, 30).extrude(-5)
rep("negative", neg)
both = Rectangle(40, 30).extrude(5, both=True)
rep("both", both)
bothneg = Rectangle(40, 30).extrude(-5, both=True)
rep("both-neg", bothneg)
# function form
f = extrude(Circle(5), 10)
rep("func", f)
print("expected circle vol", math.pi*25*10)
# sketch on front plane: normal?
fr = Rectangle(20, 10).on(Plane.front).extrude(5)
rep("front", fr)
print("Plane.front z_dir", Plane.front.z_dir.to_tuple(), "Plane.XZ z_dir", Plane.XZ.z_dir.to_tuple())
# slanted direction
sl = Circle(5).extrude(20, direction=(0, 1, 2))
rep("slanted", sl)
print("slanted expected (len along dir=20):", math.pi*25*20*2/math.sqrt(5), " (height 20):", math.pi*25*20)
# direction against normal
dn = Circle(5).extrude(10, direction=(0, 0, -1))
rep("dir-down", dn)
# direction with negative amount
dn2 = Circle(5).extrude(-10, direction=(0, 1, 2))
rep("dir-neg", dn2)
# sketch on offset plane
up = Rectangle(10, 10).on(Plane.XY.offset(20)).extrude(5)
rep("offset-plane", up)
snapshot("sheet", plate, fr, sl, up, view="sheet")
