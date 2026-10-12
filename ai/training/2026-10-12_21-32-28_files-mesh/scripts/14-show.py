import os, re, base64, json, struct
OUT = "ai/training/2026-10-12_21-32-28_files-mesh/files"
bracket = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket").colored("steelblue")
r = show(bracket, path=f"{OUT}/14-bracket.html", open_browser=False)
print("[14] return:", r, type(r).__name__)
html = open(r).read()
print("[14] size:", len(html), "title:", re.search("<title>(.*?)</title>", html).group(1))
print("[14] hud:", re.search('<div id="hud">(.*?)</div>', html).group(1))
print("[14] cdn:", sorted(set(re.findall(r"https://[^\"]+?three@[0-9.]+", html))))
glb = base64.b64decode(re.search(r"gltf-binary;base64,([A-Za-z0-9+/=]+)", html).group(1))
jl = struct.unpack("<I", glb[12:16])[0]
doc = json.loads(glb[20:20 + jl])
print("[14] embedded glb meshes:", [m["name"] for m in doc["meshes"]])
r2 = show(bracket, Rectangle(10, 10).translate(0, 0, 20), Spline((0, 0, 40), (30, 20, 50), (60, 0, 40)), tessellate(Sphere(5)),
          title="Bracket <test>", path=f"{OUT}/14-multi.html", open_browser=False, edges=False, tolerance=0.01, angle=5)
h2 = open(r2).read()
print("[14] multi title:", re.search("<title>(.*?)</title>", h2).group(1), "hud:", re.search('<div id="hud">(.*?)</div>', h2).group(1))
print("[14] Shape.show:", bracket.show(path=f"{OUT}/14-method.html", open_browser=False))
print("[14] _repr_html_ is iframe:", bracket._repr_html_()[:60])
# open_browser=False without a path: a temp file
r3 = show(Box(1, 1, 1), open_browser=False)
print("[14] no path:", r3, os.path.exists(r3))
os.remove(r3)
try:
    show(path=f"{OUT}/14-empty.html", open_browser=False)
    print("[14] empty show: written", os.path.getsize(f"{OUT}/14-empty.html"))
except Exception as e:
    print("[14] empty show:", type(e).__name__, e)
# pathlib
import pathlib
print("[14] pathlib path:", show(Box(1, 1, 1), path=pathlib.Path(OUT) / "14-pathlib.html", open_browser=False))
# view (0,0,0) render
b = render(Box(5, 5, 5), view=(0, 0, 0), size=(40, 30))
print("[14] render view (0,0,0) bytes:", len(b))
