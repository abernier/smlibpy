# font= takes a file; what can be read
import os
from smlibpy.font import DEFAULT_FONT, load_font
data = "tests/data"  # run from the repository root
print("[06] default font:", DEFAULT_FONT.name, os.path.getsize(DEFAULT_FONT), "bytes")
same = Text("Hi", 10, font=str(DEFAULT_FONT))
print("[06] font=DEFAULT_FONT same area:", round(same.area, 6) == round(Text("Hi", 10).area, 6))
for fn in ("test-cubic.otf", "test-quadratic.woff", "test-fonts.ttc"):
    f = load_font(os.path.join(data, fn))
    t = Text("HO", 10, font=os.path.join(data, fn))
    print(f"[06] {fn}: {f.name}, faces {len(t.faces())}, edge kinds {sorted({e.geom_type for e in t.edges()})}")
f = load_font()
print("[06] Lato covers", len(f.characters()), "characters, e.g.", "".join(c for c in f.characters() if ord(c) > 160)[:60])
for txt in ("ж", "日本", "→"):
    try:
        Text(txt, 5)
    except ValueError as e:
        print("[06]", repr(txt), "->", e)
for bad in ("/no/such/font.ttf", "README.md"):
    try:
        Text("A", 5, font=bad)
    except (ValueError, FileNotFoundError) as e:
        print("[06]", type(e).__name__, e)
