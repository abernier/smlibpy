# heal on shells, show() to a file, export/import of a Shell.
import os, tempfile
d = tempfile.mkdtemp()
def free_edges(r):
    return sum(1 for e in r.edges() if len(e.faces()) == 1)
box = Box(10, 10, 10)
# two faces 0.001 apart, combined but not stitched
pieces = stitch(box.faces().top(), box.faces().front().translate(0, 0, 0.001)) if False else None
raw = box.faces().top()[0].to_shell() + box.faces().front()[0].to_shell().translate(0, -0.001, 0)
print("[04] raw union of two faces 0.001 apart:", type(raw).__name__, "faces", len(raw.faces()), "edges", len(raw.edges()), "free", free_edges(raw))
h = raw.heal()
print("[04] heal:", type(h).__name__, "faces", len(h.faces()), "edges", len(h.edges()), "free", free_edges(h))
st = stitch(raw)
print("[04] stitch:", type(st).__name__, "edges", len(st.edges()), "free", free_edges(st))
# show to a file without a browser
s = surface([[(x, y, 0.02 * x * y) for y in range(0, 31, 10)] for x in range(0, 41, 10)])
path = s.show(path=os.path.join(d, "s.html"), open_browser=False)
print("[04] show ->", os.path.basename(path), os.path.getsize(path) > 1000)
# export / import
for ext in ("step", "stl", "glb"):
    p = os.path.join(d, "s." + ext)
    try:
        s.export(p)
        print(f"[04] export {ext}: {os.path.getsize(p)} bytes")
    except Exception as e:
        print(f"[04] export {ext}: {type(e).__name__}: {e}")
q = import_step(os.path.join(d, "s.step"))
print("[04] import_step:", type(q).__name__, round(q.area, 4) if isinstance(q, Shell) else q)
try:
    m = s.mesh()
    print("[04] mesh:", m)
except Exception as e:
    print("[04] mesh:", type(e).__name__, e)
save_path = os.path.join(d, "s.smlib")
try:
    save(s, save_path); r = load(save_path)
    print("[04] save/load:", type(r).__name__, round(r.area, 4))
except Exception as e:
    print("[04] save/load:", type(e).__name__, e)
