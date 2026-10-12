b = Box(10, 10, 10)
for col in ["notacolor", (2, 0, 0), (255, 128, 0), 42]:
    try:
        c = b.colored(col)
        print("[16] colored", col, "-> accepted, color:", c.color)
    except Exception as e:
        print("[16] colored", col, type(e).__name__, e)
try:
    print("[16] named(123):", b.named(123).name)
except Exception as e:
    print("[16] named(123):", type(e).__name__, e)
# export with a bad color
import os, tempfile
d = tempfile.mkdtemp()
try:
    export_step(b.colored("notacolor"), os.path.join(d, "c.step"))
    print("[16] step export with bad color: ok")
except Exception as e:
    print("[16] step export with bad color:", type(e).__name__, e)
try:
    export_gltf(b.colored("notacolor"), os.path.join(d, "c.gltf"))
    print("[16] gltf export with bad color: ok")
except Exception as e:
    print("[16] gltf export with bad color:", type(e).__name__, e)
# invalid part: revolve a profile that crosses the axis
bad = Rectangle(10, 10).on(Plane.front).revolve()
print("[16] revolve crossing axis:", bad, "valid:", bad.is_valid())
# STEP names
export_step([b.named("cube").colored("red"), Sphere(3).translate(20, 0, 0).named("ball")], os.path.join(d, "n.step"))
txt = open(os.path.join(d, "n.step")).read()
print("[16] names in step:", "'cube'" in txt, "'ball'" in txt)
