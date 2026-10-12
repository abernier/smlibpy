import os
OUT = "ai/training/2026-10-12_21-26-31_files-exact/files"

bracket = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket").colored("steelblue")
cover = Box(60, 40, 2).translate(0, 0, 10).named("cover").colored("#d9925a")
plain = Cylinder(5, 20).translate(40, 0, 0)          # no name, no color
rgb255 = Sphere(5).translate(-45, 0, 0).colored((255, 0, 0))

p = os.path.join(OUT, "03-assembly.step")
export_step([bracket, cover, plain, rgb255], p)
back = import_step(p)
print("[03] type:", type(back).__name__, len(back))
for s in back:
    print("[03]  ", type(s).__name__, repr(s.name), s.color, round(s.volume, 3), s.bbox().center)
txt = open(p).read()
print("[03] products:", [l for l in txt.splitlines() if "PRODUCT(" in l])
print("[03] solids:", [l.split("=")[1][:40] for l in txt.splitlines() if "MANIFOLD_SOLID_BREP" in l])

# name= overrides the product name and the label of unnamed bodies
p2 = os.path.join(OUT, "03-named.step")
export_step([plain, Box(5, 5, 5)], p2, name="widget")
txt = open(p2).read()
print("[03] name=widget products:", [l for l in txt.splitlines() if "PRODUCT(" in l])
print("[03] name=widget solids:", [l.split("=")[1][:40] for l in txt.splitlines() if "MANIFOLD_SOLID_BREP" in l])
print("[03] back names:", [s.name for s in import_step(p2)])

# single unnamed part: label = product = file stem
p3 = os.path.join(OUT, "03-single.step")
export_step(plain, p3)
print("[03] single unnamed back name:", repr(import_step(p3).name))
export_step(plain, p3, name="shaft")
print("[03] single unnamed name=shaft back name:", repr(import_step(p3).name))

# non-ASCII and quotes in names
odd = Box(5, 5, 5).named("Bügel 'A'")
p4 = os.path.join(OUT, "03-odd.step")
export_step(odd, p4)
print("[03] odd name back:", repr(import_step(p4).name))

# color formats
for c in ["red", "#48b", (0.2, 0.4, 0.6), (51, 102, 153), (1, 1, 1)]:
    p5 = os.path.join(OUT, "03-color.step")
    export_step(Box(5, 5, 5).colored(c), p5)
    print("[03] color", c, "->", tuple(round(x, 3) for x in import_step(p5).color))
try:
    b = Box(5, 5, 5).colored("notacolor")
    print("[03] colored('notacolor') accepted:", b.color)
    export_step(b, p5)
except Exception as e:
    print("[03] bad color on export:", type(e).__name__, e)
snapshot("assembly", *back)
