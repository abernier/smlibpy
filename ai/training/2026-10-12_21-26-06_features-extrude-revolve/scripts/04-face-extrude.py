def rep(tag, p):
    b = p.bbox()
    print(f"[{tag}] {type(p).__name__} valid={p.is_valid()} vol={p.volume:.4f} min={tuple(round(v,4) for v in b.min.to_tuple())} max={tuple(round(v,4) for v in b.max.to_tuple())}")

box = Box(40, 30, 20)
top = box.faces().top()
print("top type", type(top).__name__, len(top))
boss = top[0].extrude(5)
rep("face.extrude(5)", boss)
inward = top[0].extrude(-5)
rep("face.extrude(-5)", inward)
f = extrude(top, 5)  # ShapeList with one face
rep("extrude(ShapeList)", f)
side = box.faces().facing(X)[0]
rep("side face +5", side.extrude(5))
# fuse and cut
grown = box + top[0].extrude(5)
rep("box+face", grown)
print("faces after fuse", len(grown.faces()))
pocket = box - Rectangle(20, 10).on(top).extrude(-5)
rep("pocket", pocket)
print("expected pocket vol", 40*30*20 - 20*10*5)
# a sketch on a face extruded positive and subtracted: nothing happens?
miss = box - Rectangle(20, 10).on(top).extrude(5)
rep("subtract +5 (misses)", miss)
# both on face
thr = box - Circle(4).on(top).extrude(-25)
rep("through", thr)
# non-planar face
cyl = Cylinder(5, 10)
try:
    cf = cyl.faces().cylinders()[0]
    print(cf.geom_type)
    cf.extrude(3)
except Exception as e:
    print(f"[curved face] {type(e).__name__}: {e}")
# face with hole
plate = Box(40, 40, 5) - Cylinder(5, 10)
tf = plate.faces().top()[0]
rep("face with hole extrude", tf.extrude(3))
print("expected", (1600-math.pi*25)*3)
# taper on a face
rep("face taper", top[0].extrude(5, taper=10))
snapshot("pocket", pocket, view="iso")
