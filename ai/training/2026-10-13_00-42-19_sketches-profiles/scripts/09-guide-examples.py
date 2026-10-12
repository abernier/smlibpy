# Every python block of the sketches guides, the profiles recipe and the corrected guides of other
# domains, run unchanged (one namespace per file, blocks in order), plus the numbers they quote.
import re
import smlibpy
from pathlib import Path
root = Path(smlibpy.__file__).resolve().parent / "skill"
files = sorted((root / "references" / "sketches").glob("*.md")) + [
    root / "recipes" / "profiles.md",
    root / "references" / "geometry" / "mirror.md",
    root / "references" / "features" / "mirror.md",
    root / "references" / "selection" / "convexity.md",
    root / "references" / "curves" / "generic.md",
    root / "references" / "curves" / "Wire.md",
    root / "references" / "curves" / "Line.md",
    root / "references" / "curves" / "CenterArc.md",
]
block = re.compile(r"```python\n(.*?)```", re.S)
results = {}
for f in files:
    ns = {}
    exec("from smlibpy import *\nimport math", ns)
    ns["show"] = lambda *a, **k: None
    for i, code in enumerate(block.findall(f.read_text())):
        exec(compile(code, f"{f.name}[{i + 1}]", "exec"), ns)
    results[str(f.relative_to(root))] = ns
    print(f"[09] {f.relative_to(root)}: {len(block.findall(f.read_text()))} blocks ran")
r = results
print("[09] Triangle: gusset", round(r["references/sketches/Triangle.md"]["gusset"].area, 4), "rib volume", round(r["references/sketches/Triangle.md"]["rib"].volume, 4),
      "rib bbox", r["references/sketches/Triangle.md"]["rib"].bbox(), "arrow bbox", r["references/sketches/Triangle.md"]["arrow"].bbox())
print("[09] Rectangle: pocket volume", round(r["references/sketches/Rectangle.md"]["pocket"].volume, 4))
print("[09] Hull: link faces/holes", len(r["references/sketches/Hull.md"]["link"].faces()), len(r["references/sketches/Hull.md"]["link"].faces()[0].inner_wires()),
      "tapered slot area", round(r["references/sketches/Hull.md"]["tapered_slot"].area, 4))
print("[09] ArcSlot: plate volume", round(r["references/sketches/ArcSlot.md"]["plate"].volume, 4))
hook = r["recipes/profiles.md"]["hook"]
print("[09] recipe hook: area", round(hook.area, 4), "bbox", hook.bbox(), "edges", [e.geom_type for e in hook.edges()])
import math
print("[09]   closed form", round(6 * 30 + 0.5 * math.pi * (144 - 36) + 6 * 6 + 0.5 * math.pi * 9, 4))
print("[09] recipe part volume", round(r["recipes/profiles.md"]["part"].volume, 4), "clearance area", round(r["recipes/profiles.md"]["clearance"].area, 4))
print("[09] mirror guide: whole", round(r["references/sketches/mirror.md"]["whole"].area, 4), "left bbox", r["references/sketches/mirror.md"]["left"].bbox())
print("[09] Stroke: band", round(r["references/sketches/Stroke.md"]["band"].area, 4), "rib", round(r["references/sketches/Stroke.md"]["rib"].volume, 4))
print("[09] revolve of an empty sketch:", end=" ")
try:
    (Rectangle(10, 10) - Rectangle(20, 20)).revolve(Axis((20, 0, 0), (0, 1, 0)))
except Exception as e:
    print(type(e).__name__, e)
