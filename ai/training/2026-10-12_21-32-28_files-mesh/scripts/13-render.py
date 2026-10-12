import struct, zlib
OUT = "ai/training/2026-10-12_21-32-28_files-mesh/files"
part = (Box(40, 30, 10) - Cylinder(6, 20)).colored("steelblue")
part = part.fillet(part.edges().parallel_to(Z).group_by(X)[-1], 4)   # round the two +X corners
peg = Cylinder(3, 12, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(-14, 0, 5).colored("tomato")
def png_info(b):
    w, h = struct.unpack(">II", b[16:24])
    return b[:8] == b"\x89PNG\r\n\x1a\n", w, h, len(b)
b = render(part, peg)
print("[13] default:", type(b).__name__, png_info(b))
for v in ["iso", "front", "back", "left", "right", "top", "bottom", "sheet", (1, 1, 1), (0, 0, -1)]:
    name = v if isinstance(v, str) else "dir" + "_".join(str(c) for c in v)
    b = render(part, peg, path=f"{OUT}/13-{name}.png", view=v, size=(400, 300))
    print("[13] view", v, png_info(b))
render(part, peg, path=f"{OUT}/13-noedges.png", edges=False, size=(400, 300))
render(part, peg, path=f"{OUT}/13-bg.png", background="#202020", size=(400, 300))
render(Sphere(10), path=f"{OUT}/13-coarse.png", tolerance=1.0, size=(400, 300))
render(Sphere(10), path=f"{OUT}/13-fine.png", size=(400, 300))
# mixed content: sketch, edge, wire, mesh, face, vertex, list
mix = [Rectangle(30, 20).translate(0, 0, -10), Line((-20, 0, 15), (20, 0, 15)),
       Spline((-20, -10, 20), (0, 10, 25), (20, -10, 20)), tessellate(Sphere(4).translate(0, 25, 0)),
       Box(10, 10, 10).faces().top().translate(30, 0, 0), part.vertices()[0], [Box(4, 4, 4).translate(-30, 0, 0)]]
render(*mix, path=f"{OUT}/13-mixed.png", size=(600, 450))
print("[13] mixed ok")
for bad in [(), ("diagonal",), ((0, 0, 0),)]:
    try:
        if bad == ():
            render()
        elif bad[0] == "diagonal":
            render(part, view="diagonal")
        else:
            render(part, view=(0, 0, 0))
        print("[13] bad", bad, "no error")
    except Exception as e:
        print("[13] bad", bad, type(e).__name__, str(e)[:80])
try:
    render(part.vertices()[0])
except Exception as e:
    print("[13] vertex only:", type(e).__name__, e)
try:
    render(part, size=(0, 0))
except Exception as e:
    print("[13] size 0:", type(e).__name__, str(e)[:80])
# odd sheet size
b = render(part, view="sheet", size=(401, 301))
print("[13] sheet 401x301:", png_info(b))
# scale invariance: a box twice as big looks the same
a1 = render(Box(10, 10, 10), size=(200, 150)); a2 = render(Box(20, 20, 20), size=(200, 150))
print("[13] same picture for 10 and 20 box:", a1 == a2)
import time
t = time.time(); render(Sphere(10), size=(800, 600)); print("[13] time sphere 800x600:", round(time.time() - t, 2))
t = time.time(); render(Sphere(10), size=(1600, 1200)); print("[13] time sphere 1600x1200:", round(time.time() - t, 2))
