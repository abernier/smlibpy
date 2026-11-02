"""The machining files of the zigzag chair: cut list, STEP, a flat DXF per setup, drawings, nests and a README.

    python examples/zigzag_chair_machining.py [output folder]   (default: zigzag_chair_machining/)

Everything is read off `zigzag_chair.py`'s model and constants, nothing is retyped. `machining_setup` lays each
part on a 3-axis router and sorts its features into DXF layers: OUTLINE, THROUGH, POCKET_D<depth>, LABEL. What it
cannot cut (the mitres, the base's planed sides, the dovetail pins, the cleats' long face) and what it refuses (the
seat on its face) are listed with how they are made instead: a tilted saw blade, a tilted fixture, hand work.
"""

from __future__ import annotations

import csv
import importlib.util
import math
import sys
from pathlib import Path

from smlibpy import *


def _chair():
    spec = importlib.util.spec_from_file_location("zigzag_chair", Path(__file__).with_name("zigzag_chair.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


chair = _chair()
DENSITY = chair.CHERRY  # g/mm3
ALLOWANCE_L, ALLOWANCE_W = 30.0, 10.0  # rough blank over the finished length and width (half an end, half a side)
ROUGH = [(22.0, 27.0), (30.0, 34.0), (36.0, 41.0)]  # finished up to, sawn: 4/4, 5/4 and 6/4 hardwood boards
PLANK = (2400.0, 200.0)  # the planks the nests assume: length along the grain, width (a wide cherry board)
KERF = 4.0  # the saw cut between blanks in a nest
JOINT = 5.0  # what a strip of an edge-glued panel takes over its share of the width, for jointing its edges
MITRE_ANGLE = chair.SLANT / 2  # each mitre's face to the board's face, 22.5 degrees: 67.5 from a square end
MITRE_RUN = chair.T / chair.MITRE  # how far a mitre runs along the board's face, from its long point
DOVETAIL = math.degrees(math.atan(chair.SLOPE))  # the tails' and pins' walls from square, 1 in 6


def fmt(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".")


def fmt2(v: float) -> str:
    return f"{v:.2f}".rstrip("0").rstrip(".")


NOTES = {  # what is on each part, in words (the sizes are in the README's tables)
    "seat": f"{chair.TAILS} through dovetail tails at the rear end, square to the back; at the nose a mitre "
    f"{fmt(MITRE_ANGLE)} degrees to the face",
    "back": "the pins of the through dovetails at the lower end; the hand grip, a pocket in the rear face",
    "slant": f"at each end a mitre {fmt(MITRE_ANGLE)} degrees to the face",
    "base": f"at the rear end a mitre {fmt(MITRE_ANGLE)} degrees to the face, the front end square; the sides "
    f"planed to {fmt(chair.BEVEL_ANGLE)} degrees after glue-up",
    "seat cleat": "a right triangle in section, ripped on a tilted saw; glued in the top mitre's acute angle",
    "foot cleat": "a right triangle in section, ripped on a tilted saw; glued in the bottom mitre's acute angle",
}
SAWN = ("seat cleat", "foot cleat")  # made on the saw, not on the router: their DXF only gives the length


def model() -> list[Part]:
    """The chair whose files these are."""
    return chair.model()


def slug(text: str) -> str:
    return text.replace(" ", "_").replace("-", "_")


def rough_thickness(finished: float) -> float:
    for up_to, sawn in ROUGH:
        if finished <= up_to + 1e-6:
            return sawn
    return math.ceil(finished / 10) * 10 + 10


def outer_normal(profile: list[tuple[float, float]], a: int, b: int) -> Vector:
    """The normal of the edge from profile[a] to profile[b] of a board's side view (y, z), out of the board."""
    (y0, z0), (y1, z1) = profile[a], profile[b]
    n = Vector(0, z1 - z0, -(y1 - y0)).normalized()
    cy, cz = chair.centroid(profile)
    return n if n.dot(Vector(0, y0 - cy, z0 - cz)) > 0 else -n


def grain(normal: Vector) -> Vector:
    """A board's grain: along its side view, square to the chair's width (the drawing's x)."""
    return Vector(1, 0, 0).cross(normal).normalized()


def seat_blank() -> Part:
    """The seat before its tails are cut: the board run on to the back's rear face, between the seat's sides."""
    top, bottom = chair.SEAT_TOP, chair.SEAT_BOTTOM
    profile = [chair.NOSE, (chair.rear(top), top), (chair.rear(bottom), bottom), chair.SEAT_INNER]
    return (chair.side_prism(profile) & chair.SEAT_SIDES).named("seat")


# Each part's main setup: the face the tool comes from (the board's outer face, away from its cleat; the back's rear
# face, which has the grip; a cleat on the leg glued to its board) and the drawing's x (the grain).
FACES = {
    "seat": outer_normal(chair.SEAT, 0, 1),  # the top
    "back": outer_normal(chair.BACK, 0, 1),  # the rear face
    "slant": outer_normal(chair.SLANT_BOARD, 3, 0),  # the front face
    "base": outer_normal(chair.BASE, 3, 0),  # the underside
    "seat cleat": Vector(0, 0, 1),  # the leg on the seat's underside
    "foot cleat": Vector(0, 0, -1),  # the leg on the base's top
}


def leans(setup: MachiningSetup, faces) -> list[float]:
    """How far each planar face of a feature leans from the tool's axis, in degrees (0: a wall the tool follows)."""
    out = set()
    for f in faces:
        if f.is_planar:
            n = f.normal_at()
            out.add(round(abs(90.0 - math.degrees(math.acos(min(1.0, abs(n.z))))), 1))
    return sorted(out)


def tails_layer(setup: MachiningSetup) -> Sketch:
    """The tails, in the seat's tilted setup: its outline between the planes of the back's two faces, which the tool
    follows there (both contain the back's direction)."""
    top = chair.SEAT_TOP
    y_front = setup.plane.to_local((0, chair.front(top), top)).y
    y_rear = setup.plane.to_local((0, chair.rear(top), top)).y
    outline = setup.layer("OUTLINE")
    box = outline.bbox()
    band = Rectangle(box.size.x + 20, abs(y_rear - y_front), align=(Align.MIN, Align.MIN))
    band = band.translate(box.min.x - 10, min(y_front, y_rear), 0)
    return (outline & band).named("TAILS")


def setups_of(key: str, part: Part) -> dict:
    """The setups of one part, and what machining_setup refused for it."""
    name = part.name
    d = FACES[name]
    x_dir = (1, 0, 0) if name in SAWN else grain(d)
    refused = []
    main, laid = None, part
    for towards, face in ((d, "main face"), (-d, "the other face")):
        try:
            main = machining_setup(part, towards, x_dir=x_dir, label=name.upper())
            d = towards
            break
        except (ModelingError, KernelError) as error:
            # The seat with its tails: their faces lean two ways at once (along the back, and 1 in 6), and the
            # kernel fails on their shadows. It is said so in the README, and the seat's blank is laid instead.
            refused.append(
                (key, f"{face}, tool from {describe_direction(towards)}", f"{type(error).__name__}: {error}")
            )
    if main is None:
        laid = seat_blank()
        main = machining_setup(laid, d, x_dir=x_dir, label=name.upper())
    setups = [("", main, d, "main face" if laid is part else "main face, the blank before its tails are cut")]
    if name == "seat":
        # The tails are prisms along the back: with the seat on a wedge of the back's lean, the tool comes along the
        # back, and every face of the joint is a wall it follows.
        up = Vector(*chair.UP)
        tilted = machining_setup(part, up, x_dir=(1, 0, 0), label="SEAT TAILS")
        layers = [*tilted.layers[:1], tails_layer(tilted), *tilted.layers[1:]]
        tilted = tilted._replace(layers=layers)
        setups.append(("_tails", tilted, up, f"tilted {fmt(chair.BACK_LEAN)} degrees, the tool along the back"))
    if name == "back":
        # On end, the tool along the back: the pins' walls lean 1 in 6 and the sockets' floors (the seat's top)
        # 8 degrees; machining_setup says what it makes of that, and the README lists it.
        down = -Vector(*chair.UP)
        on_end = machining_setup(part, down, x_dir=(1, 0, 0))
        setups.append(("_end", on_end, down, "on its top edge, the tool into the lower end"))
    return {"key": key, "part": part, "laid": laid, "main": main, "setups": setups, "refused": refused}


def describe_direction(d: Vector) -> str:
    axes = {"+X": (1, 0, 0), "-X": (-1, 0, 0), "+Y": (0, 1, 0), "-Y": (0, -1, 0), "+Z": (0, 0, 1), "-Z": (0, 0, -1)}
    for name, v in axes.items():
        if d.is_parallel(v) and d.dot(Vector(v)) > 0:
            return f"model {name}"
    return f"model ({d.x:.3f}, {d.y:.3f}, {d.z:.3f})"


def drawn(record: dict) -> list[tuple]:
    """The setups written as DXF: those that cut something (the back on end cuts nothing: it is only reported)."""
    return [s for s in record["setups"] if s[0] != "_end"]


def drawing(part_or_parts, path: Path, title: str, views=("front", "top", "left")) -> None:
    """Three views at true size, hidden lines dashed, the title under them."""
    views_ = drawing_views(part_or_parts, views)
    box = views_[0].bbox()
    for v in views_[1:]:
        box = box.union(v.bbox())
    size = max(4.0, min(12.0, box.size.x / 60))
    label = Text(title, size, align=(Align.MIN, Align.MAX)).translate(box.min.x, box.min.y - 2 * size, 0)
    export_svg([*views_, label], path)


def strips(width: float) -> int:
    """How many boards an edge-glued panel of this blank width takes from the plank."""
    n = 1
    while width / n + (JOINT if n > 1 else 0.0) > PLANK[1] + 1e-6:
        n += 1
    return n


def nest(items: list[dict], plank: tuple[float, float], kerf: float) -> list[list[dict]]:
    """Shelf nesting: blanks sorted by width, placed in rows along the plank, a new plank when the rows are full.
    Every blank keeps its grain along the plank."""
    planks: list[list[dict]] = [[]]
    x = y = row_h = 0.0
    for it in sorted(items, key=lambda it: (-it["blank"][1], -it["blank"][0], it["key"])):
        bl, bw = it["blank"]
        if bl > plank[0] + 1e-6 or bw > plank[1] + 1e-6:
            raise ValueError(f"{it['key']} ({bl} x {bw}) does not fit a plank of {plank[0]} x {plank[1]}")
        if x + bl > plank[0] + 1e-6:  # next row
            x, y, row_h = 0.0, y + row_h + kerf, 0.0
        if y + bw > plank[1] + 1e-6:  # next plank
            planks.append([])
            x = y = row_h = 0.0
        planks[-1].append({**it, "x": x, "y": y})
        x += bl + kerf
        row_h = max(row_h, bw)
    return planks


def cut_list(records: list[dict]) -> list[dict]:
    """One row per part: finished size from the main setup, blank, the boards of its panel, files."""
    rows = []
    for r in records:
        box = r["main"].layer("OUTLINE").bbox()
        length, width, thickness = box.size.x, box.size.y, r["main"].thickness
        blank = (length + ALLOWANCE_L, width + ALLOWANCE_W, rough_thickness(thickness))
        n = strips(blank[1])
        rows.append(
            {
                "part": r["part"].name,
                "key": r["key"],
                "qty": 1,
                "length": length,
                "width": width,
                "thickness": thickness,
                "blank": blank,
                "boards": n,
                "strip": blank[1] / n + (JOINT if n > 1 else 0.0),
                "volume": r["part"].volume,
                "files": ", ".join(f"{r['key']}{s[0]}.dxf" for s in drawn(r)),
                "notes": NOTES[r["part"].name],
                "records": [r],
            }
        )
    return rows


def panel(row: dict) -> str:
    if row["boards"] == 1:
        return "one board"
    return f"{row['boards']} boards edge-glued, {fmt(row['strip'])} wide each"


def write_cut_list(rows: list[dict], out: Path) -> tuple[float, float]:
    finished = sum(r["volume"] for r in rows)
    rough = sum(r["qty"] * math.prod(r["blank"]) for r in rows)
    with (out / "cutlist.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(
            ["part", "qty", "finished_length_mm", "finished_width_mm", "finished_thickness_mm", "material", "grain"]
            + ["blank_length_mm", "blank_width_mm", "sawn_thickness_mm", "panel", "dxf_files", "notes"]
        )
        for r in rows:
            sizes = [f"{r['length']:.1f}", f"{r['width']:.1f}", f"{r['thickness']:.1f}"]
            blank = [f"{v:.0f}" for v in r["blank"]]
            w.writerow(
                [r["part"], r["qty"], *sizes, "cherry", "along the length (x of the DXF)", *blank, panel(r)]
                + [r["files"], r["notes"]]
            )
    with (out / "cutlist_optimizer.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["Length", "Width", "Qty", "Label", "Material", "Grain"])
        for r in rows:
            bl, _, bt = r["blank"]
            label = r["part"] if r["boards"] == 1 else f"{r['part']} (panel strip)"
            w.writerow([f"{bl:.0f}", f"{r['strip']:.0f}", r["boards"], label, f"cherry sawn {bt:.0f} mm", "length"])
    base = next(r for r in rows if r["part"] == "base")
    lines = [
        "# Cut list — zigzag chair",
        "",
        (
            "Finished sizes from the model (`machining_setup`: length and width of the footprint in the main setup, "
            f"thickness along the tool). Blanks: finished + {fmt(ALLOWANCE_L)} in length, + {fmt(ALLOWANCE_W)} in "
            "width; sawn thickness from the table in the README. A blank wider than a plank is an edge-glued panel: "
            f"its boards each take {fmt(JOINT)} mm over their share of the width, for jointing."
        ),
        "",
        "| Part | Qty | Finished L × W × T (mm) | Blank L × W × sawn T (mm) | Panel | Grain | DXF | What is on it |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        blank = " × ".join(f"{v:.0f}" for v in r["blank"])
        grain_ = "along the length (across the chair)" if r["part"] in SAWN else "along the length"
        lines.append(
            f"| {r['part']} | {r['qty']} | {fmt(r['length'])} × {fmt(r['width'])} × {fmt(r['thickness'])} | {blank} | "
            f"{panel(r)} | {grain_} | {r['files']} | {r['notes']} |"
        )
    lines += [
        "",
        (
            f"The base's width is its top face's: {fmt2(base['width'])} at the bottom mitre's inner edge, "
            f"{fmt(chair.W_BASE_FRONT)} at the front. It is cut square to that, mitred and glued up; then its sides "
            f"are planed to {fmt(chair.BEVEL_ANGLE)} degrees from the vertical, {fmt2(chair.BEVEL)} mm a side off at "
            f"the underside, flush with the slant's sides."
        ),
        "",
        (
            f"Finished cherry: {finished / 1e6:.2f} dm³ ({finished / 1e9:.4f} m³), {finished * DENSITY / 1000:.2f} kg "
            f"at {DENSITY * 1e3:.2f} g/cm³."
        ),
        f"Sawn blanks: {rough / 1e9:.4f} m³ ({rough / finished:.1f} × the finished volume).",
        "",
    ]
    (out / "cutlist.md").write_text("\n".join(lines), encoding="utf-8")
    return finished, rough


def write_nests(rows: list[dict], out: Path) -> list[tuple[float, int, float, list[str]]]:
    """The blanks of each sawn thickness on planks, as DXF and SVG: PLANK, BLANK, OUTLINE and LABEL layers. A panel's
    boards are nested one by one; each carries its share of the outline."""
    nests = []
    by_sawn: dict[float, list[dict]] = {}
    for r in rows:
        outline = r["records"][0]["main"].layer("OUTLINE")
        box = outline.bbox()
        bl, bw, sawn = r["blank"]
        for i in range(r["boards"]):
            # the board's share of the finished outline: a band of the footprint's width
            share = box.size.y / r["boards"]
            band = Rectangle(box.size.x + 2, share, align=(Align.MIN, Align.MIN)).translate(
                box.min.x - 1, box.min.y + i * share, 0
            )
            piece = outline & band if r["boards"] > 1 else outline
            key = r["key"] if r["boards"] == 1 else f"{r['key']}_{'abcdefgh'[i]}"
            item = {"key": key, "outline": piece, "blank": (bl, r["strip"]), "finished": (r["length"], share)}
            by_sawn.setdefault(sawn, []).append(item)
    for sawn, items in sorted(by_sawn.items()):
        planks = nest(items, PLANK, KERF)
        sketches = []
        for i, plank in enumerate(planks):
            y0 = i * (PLANK[1] + 60.0)
            sketches.append(Rectangle(*PLANK, align=(Align.MIN, Align.MIN)).translate(0, y0, 0).named("PLANK"))
            for it in plank:
                (bl, bw), (fl, fw) = it["blank"], it["finished"]
                x, y = it["x"], y0 + it["y"]
                sketches.append(Rectangle(bl, bw, align=(Align.MIN, Align.MIN)).translate(x, y, 0).named("BLANK"))
                box = it["outline"].bbox()
                dx, dy = x + (bl - fl) / 2 - box.min.x, y + (bw - box.size.y) / 2 - box.min.y
                sketches.append(it["outline"].translate(dx, dy, 0).named("OUTLINE"))
                size = max(6.0, min(14.0, fw / 6))
                sketches.append(Text(it["key"], size).translate(x + bl / 2, y + bw / 2, 0).named("LABEL"))
        export_dxf(sketches, out / "nests" / f"nest_T{sawn:.0f}.dxf", curves="arcs")
        export_svg(sketches, out / "nests" / f"nest_T{sawn:.0f}.svg")
        used = sum(it["blank"][0] * it["blank"][1] for it in items)
        nests.append((sawn, len(planks), used / (len(planks) * PLANK[0] * PLANK[1]), [it["key"] for it in items]))
    return nests


def pocket_rows(setup: MachiningSetup) -> list[dict]:
    """One row per pocket region of a setup: layer, depth, size, where it is."""
    rows = []
    for layer in setup.layers:
        if not layer.name.startswith("POCKET_D"):
            continue
        depth = float(layer.name[len("POCKET_D") :].replace("_", "."))
        for face in layer.faces():
            b = face.bbox()
            rows.append(
                {
                    "layer": layer.name,
                    "depth": depth,
                    "floor": setup.thickness - depth,
                    "size": (b.size.x, b.size.y),
                    "at": (b.min.x, b.min.y, b.max.x, b.max.y),
                    "area": face.area,
                }
            )
    return sorted(rows, key=lambda r: (r["layer"], *(round(v, 3) for v in r["at"])))


def setup_tables(records: list[dict]) -> tuple[list[str], list[tuple[str, str, str, str, str]]]:
    """The README's per-part setups, and what no setup cuts: (key, setup, why, leans, where)."""
    lines, flagged = [], []
    for r in records:
        lines += [f"### {r['key']}", ""]
        for suffix, setup, d, what in r["setups"]:
            box = setup.layer("OUTLINE").bbox()
            layers = ", ".join(f"`{layer.name}`" for layer in setup.layers)
            written = suffix != "_end"
            name = f"`{r['key']}{suffix}.dxf`" if written else "(no DXF)"
            lines += [
                (
                    f"**{name}** — {what}; the tool comes from {describe_direction(d)}; "
                    f"T = {fmt(setup.thickness)}, footprint {fmt(box.size.x)} × {fmt(box.size.y)}; layers: {layers}."
                ),
                "",
            ]
            pockets = pocket_rows(setup)
            if pockets:
                lines += [
                    "| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table |",
                    "|---|---|---|---|---|",
                ]
                for p in pockets:
                    x0, y0, x1, y1 = (fmt(v) for v in p["at"])
                    lines.append(
                        f"| `{p['layer']}` | {fmt(p['size'][0])} × {fmt(p['size'][1])} | {x0}, {y0} … {x1}, {y1} | "
                        f"{fmt(p['depth'])} | {fmt(p['floor'])} |"
                    )
                lines.append("")
            if suffix == "_tails":
                tails = setup.layer("TAILS")
                lines += [
                    (
                        f"`TAILS` is the {len(tails.faces())} tails, {fmt2(chair.TAIL_FRONT)} wide at the back's front "
                        f"face and {fmt2(chair.TAIL_REAR)} at its rear face: cut through along them in this setup, and "
                        "nothing else. The `OUTLINE` here is the seat's shadow along the tool, for placing it on the "
                        "wedge; its sides and nose are cut in the main setup."
                    ),
                    "",
                ]
            # one row per reason: the features of that reason together (the back on end has twelve alike)
            for why in dict.fromkeys(w for w, _, _ in setup.elsewhere):
                features = [faces for w, _, faces in setup.elsewhere if w == why]
                b = features[0].bbox()
                for faces in features[1:]:
                    b = b.union(faces.bbox())
                where = ", ".join(f"{a} {fmt(lo)} … {fmt(hi)}" for a, lo, hi in zip("xyz", b.min, b.max))
                lean = ", ".join(fmt(v) for v in sorted({x for f in features for x in leans(setup, f)})) or "curved"
                count = sum(len(f) for f in features)
                kind = f"{why} ({len(features)} feature{'s' * (len(features) > 1)}, {count} faces)"
                flagged.append((r["key"], name, kind, lean, where))
    return lines, flagged


def readme(parts, rows, nests, tables, flagged, refused, finished, rough) -> str:
    """The README: how to read the files, the stock, the setups and the joints that need a word, the order of
    assembly, then the tables. Every number is the model's or one of this file's assumptions."""
    box = parts[0].bbox()
    for p in parts[1:]:
        box = box.union(p.bbox())
    by_name = {r["part"]: r for r in rows}
    thicknesses = sorted({round(r["thickness"], 3) for r in rows})
    used = [(up_to, sawn) for up_to, sawn in ROUGH if any(rough_thickness(t) == sawn for t in thicknesses)]
    pl, pw = (fmt(v) for v in PLANK)
    wide = [r["part"] for r in rows if r["boards"] > 1]
    grip_r = chair.GRIP_HIGH / 2
    tilt_t = by_name["seat"]["records"][0]["setups"][1][1].thickness
    text = (
        f"""# Zigzag chair — machining files

Everything a joinery or CNC shop needs to make the cherry chair of `examples/zigzag_chair.py`, after Rietveld's 1934
Zig-Zag chair: {fmt(box.size.x)} × {fmt(box.size.y)} × {fmt(box.size.z)} mm over all, {len(parts)} parts, four boards
{fmt(chair.T)} mm thick and two cleats.

Every file here is **derived from the model by code**: `examples/zigzag_chair_machining.py`, with smlibpy's
`machining_setup`. Every number below is read off the model. To make the files again:

```sh
python examples/zigzag_chair_machining.py <output folder>
```

## How to read the DXF files

- Units: millimetres. Format: DXF AC1015 (AutoCAD 2000), lines and arcs only (`curves="arcs"`), closed
  contours. Every CAM program reads it (Fusion 360, VCarve/Aspire, Alphacam, woodWOP via DXF import, Inkscape).
- One file is one **setup**: the part lying on the machine table, the tool coming from above. The drawing's x and y
  are the table's; z runs from the table (z = 0) up to the top face (z = T). The origin is the lower-left corner of
  the part's footprint.
- Layers:
  - `OUTLINE` — the part's footprint seen along the tool, cut through. Where a face of the part leans (a mitre, a
    bevelled side), the footprint is its widest extent: the router cuts the blank to it, and the lean is made
    after, as below.
  - `POCKET_D<depth>` — a pocket open on the top face, cleared `<depth>` mm below it.
  - `TAILS` — only in `seat_tails.dxf`: the tails' contour, cut through in that setup.
  - `LABEL` — the part's name as outlines, and an arrow along the grain. Do not cut it.
- The grain runs along x in every file: along the chair's side view for the boards, across the chair for the
  cleats.

## Stock

Finished thicknesses: {", ".join(fmt(t) for t in thicknesses)} mm. The cut list gives each part a sawn thickness by
this table, 4/4 and 5/4 hardwood boards — **check it against the supplier's actual stock**:

| Finished thickness | Sawn |
|---|---|
"""
        + "\n".join(f"| up to {fmt(up_to)} | {fmt(sawn)} |" for up_to, sawn in used)
        + f"""

Blanks are the finished footprint plus {fmt(ALLOWANCE_L)} mm in length and {fmt(ALLOWANCE_W)} mm in width. The nests
assume cherry boards of {pl} × {pw} mm, the grain along the board: wide for cherry, which comes in random widths,
most boards narrower. The {", ".join(wide)} are {fmt(min(by_name[n]["width"] for n in wide))} to
{fmt(max(by_name[n]["width"] for n in wide))} mm wide, wider than any board: each is an **edge-glued panel** of
{by_name["seat"]["boards"]} boards, matched for colour and grain, jointed and glued before it is cut (the cut list
gives each board's width). Glue the panels with the joints along the grain, so that the grain still runs round the
chair's zigzag. Cherry at {DENSITY * 1e3:.2f} g/cm³: the finished parts weigh {finished * DENSITY / 1000:.1f} kg;
the sawn blanks are {rough / finished:.1f} × the finished volume.

## What the router cuts, and what it does not

`machining_setup` lays each part on its main face (the outer face of a board, the back's rear face, a cleat on the
leg glued to its board) and sorts its faces. What it leaves is listed in "Not for a vertical cutter" below; this is
how each of those is made.

- **Mitres** (the seat's nose, both ends of the slant, the base's rear end). Two boards meet at
  {fmt(chair.SLANT)} degrees, so each mitre face is {fmt(MITRE_ANGLE)} degrees to the board's face
  ({fmt(90 - MITRE_ANGLE)} from a square end) and runs {fmt(MITRE_RUN)} mm along it from the long point. A flat end
  mill cuts walls along its axis only: the OUTLINE stops at each mitre's long point, and the mitre is made after.
  - On the table saw: no blade tilts {fmt(90 - MITRE_ANGLE)} degrees from the vertical, so the board stands on end
    against a tall fence (or in a tenoning jig), its face to the fence, the blade tilted {fmt(MITRE_ANGLE)} degrees,
    fed across the board's width. A track saw cannot make this cut.
  - On the router: a V-bit of {fmt(180 - 2 * MITRE_ANGLE)} degrees included has its cone {fmt(MITRE_ANGLE)} degrees to
    the table, and a pass along the mitre's edge leaves the cone's wall in the mitre's plane; passes stepped down
    and in along that plane make the face without ridges. Not assumed here: it wants a CAM bevel toolpath and a bit
    whose cone reaches the full {fmt(MITRE_RUN)} mm or the steps for it.
  - By hand: plane the bevel to two lines, the long point on the face and the short one on the other face.
  Mating mitres meet flush in the model: make both of a pair with the same setting, and check them together.
- **The base's sides.** The base is narrower forward ({fmt2(by_name["base"]["width"])} at the bottom mitre's inner
  edge, {fmt(chair.W_BASE_FRONT)} at the front, on its top face), and its sides lean in toward the floor,
  {fmt(chair.BEVEL_ANGLE)} degrees from the vertical, so that they run on flush from the slant's. The OUTLINE is the
  top face's planform: cut the base square to it, mitre it, glue it up, then plane each side down to the underside,
  {fmt2(chair.BEVEL)} mm off a side there, flush with the slant's sides at the mitre. (Cut square to
  {fmt(chair.W_FOOT)} at the foot and {fmt(chair.W_BASE_FRONT)} at the front instead, the base would be
  {fmt2(chair.SQUARE_STEP)} mm narrower a side than the slant at the mitre's inner edge, a step that planing the base
  cannot close.)
- **The dovetails.** The seat carries {chair.TAILS} tails, the back the pins; the back leans {fmt(chair.BACK_LEAN)}
  degrees, so the tails are prisms along the back's faces, not square to the seat, and their walls also flare 1 in
  {fmt(1 / chair.SLOPE)} ({fmt(DOVETAIL)} degrees) across the back's thickness.
  - On its face, `machining_setup` refuses the seat, either face up (below: the kernel fails on the shadows of
    the tails' leaning faces). `seat.dxf` is the seat's blank instead, the board run on to the back's rear face: the
    router cuts its tapered sides; the nose is mitred on the saw.
  - `seat_tails.dxf`: the seat on a wedge of {fmt(chair.BACK_LEAN)} degrees, nose down, the tool along the back
    (T = {fmt(tilt_t)}, the seat's extent along it). There every face of the joint is a wall the tool follows: the
    tails' sides, their ends on the back's rear face, the shoulders between them on its front face. Cut through
    along `TAILS`; square the inside corners at the shoulders with a chisel. Without a wedge fixture, saw the tails
    by hand to the same lines.
  - The pins (the back's sockets) lean both ways in every setup: on the rear face their walls flare
    {fmt(DOVETAIL)} degrees across the thickness and their floor, the seat's top, leans {fmt(chair.BACK_LEAN)}
    degrees; on end (the tool along the back) the floor still leans, and `machining_setup` finds no pocket. Rough
    the waste on the router to `back.dxf`'s OUTLINE (it stops where the sockets are narrowest, at the front face),
    then mark the pins from the cut tails and pare to the lines by hand: a dovetail saw and chisels, as through
    dovetails are usually fitted.
- **The hand grip** ({fmt(chair.GRIP)} × {fmt(chair.GRIP_HIGH)}, {fmt(chair.GRIP_DEEP)} deep, round ends): a pocket of
  the back's main setup, `POCKET_D{fmt(chair.GRIP_DEEP)}` in `back.dxf`. Any end mill up to {fmt(2 * grip_r)} mm makes
  its round ends as they are; break its edges by hand.
- **Cleats.** Right triangles of {fmt(chair.CLEAT)} mm legs, ripped from a square strip with the blade at 45
  degrees; their DXF only gives the length. Each cleat's ends are the side planes of the boards it joins, two facets
  meeting at the mitre: cut it a little long and plane it flush with the boards' sides after glue-up, with the
  base's sides.

## Suggested order of assembly

The model's `assembly_order()` tests this order: every member moves straight in with nothing in its way.

1. Dry-fit everything.
2. The back slides down onto the seat's tails along its own faces ({fmt(chair.BACK_LEAN)} degrees from the vertical);
   straight down, its front face would run into the seat in front of the joint.
3. A cleat glued to the seat's underside, coming up square to it, and one down onto the base's top.
4. The slant onto the seat along the top mitre's normal, its rear face coming onto the seat's cleat.
5. The base with its cleat onto the slant along the bottom mitre's normal. Once both mitres are glued the slant is
   locked between them.
6. Plane the base's sides and the cleats' ends flush; sand; oil.

## What was checked, and what was not

- The model passes its own `check()`: every part's volume against a hand calculation, the parts fusing into one
  solid, the mitres meeting flush, the base's bevel, and the order of assembly above.
- The DXF layers read back into smlibpy with the areas they were made from; every part lies inside its main
  setup's OUTLINE cut through its thickness; the tails' contour is the model's six trapezoids; the grip's pocket is
  the model's slot. The STEP files are the model's exact bodies.
- Not done: no CAM program has run these files, no part has been cut. Check the first part on scrap.
- The chair's proportions are a reading of the production drawing and photographs (see the example's notes).
- The sawn thickness series, the blank allowances and the board size are assumptions, not a supplier's: ask for the
  actual stock before cutting the list.

## Files

| File | What it is |
|---|---|
| `cutlist.md`, `cutlist.csv` | the cut list: finished sizes, blanks, panels, grain, which DXF covers the part |
| `cutlist_optimizer.csv` | the boards for a panel optimizer (a panel's boards one by one) |
| `step/zigzag_chair.step` | the assembly, one named product per part |
| `step/<part>.step` | each part alone, in the model's position |
| `dxf/<part>.dxf` | the part laid on its main face: layers OUTLINE, POCKET_D<depth>, LABEL |
| `dxf/seat_tails.dxf` | the seat tilted along the back: the tails (layer TAILS) |
| `drawings/<part>.svg` | front, top and left views of the part in its main setup, hidden lines dashed, true size |
| `drawings/seat_tails.svg` | the seat in its tilted setup |
| `drawings/assembly.svg`, `assembly_iso.png` | the chair: three views, and a shaded view |
| `nests/nest_T<sawn>.dxf`, `.svg` | the boards of one sawn thickness on planks, grain along the plank |

## Setups

Every part, its setups and what each setup cuts. x, y are the DXF's axes (mm), z the tool's axis from the table
(z = 0) to the top face (z = T).

"""
    )
    text += "\n".join(tables) + "\n## Not for a vertical cutter\n\n"
    text += (
        "What `machining_setup` leaves in each setup: the reason it gives, how far the feature's planar faces lean "
        "from the tool (0 is a wall the tool follows), and where it is in the setup's frame. How each is made is "
        "above.\n\n"
    )
    text += "| Part | Setup | Why | Leans (degrees) | Where |\n|---|---|---|---|---|\n"
    text += "".join(f"| {k} | {f} | {w} | {lean} | {where} |\n" for k, f, w, lean, where in flagged)
    text += "\n## Refused\n\n"
    text += "| Part | Setup | What machining_setup raised |\n|---|---|---|\n"
    text += "".join(f"| {k} | {what} | {msg} |\n" for k, what, msg in refused)
    text += (
        f"\n## Nests\n\nPlanks of {pl} × {pw} mm, blanks with their grain along the plank, {fmt(KERF)} mm apart; a "
        "panel's boards are named `<part>_a`, `_b`.\n\n"
    )
    text += "| Sawn thickness | Planks | Area used | Boards |\n|---|---|---|---|\n"
    text += "".join(f"| {fmt(s)} mm | {n} | {u:.0%} | {', '.join(keys)} |\n" for s, n, u, keys in nests)
    cleats = [by_name[n] for n in SAWN]
    long = max(r["blank"][0] for r in cleats)
    across = sum(r["blank"][1] for r in cleats) + KERF * (len(cleats) - 1)
    text += (
        f"\nThe cleats' plank is mostly spare: an offcut of {fmt(cleats[0]['blank'][2])} mm stock, {fmt(long)} × "
        f"{fmt(across)}, holds both blanks.\n"
    )
    return text


def machining_files(out: str | Path, parts: list[Part] | None = None, *, pictures: bool = True) -> dict:
    """Write the machining files of the chair into `out`; `pictures=False` leaves out the drawings and the shaded
    view. Returns what was written: the cut list's rows, the DXF names, the nests, the flagged features and what
    machining_setup refused."""
    out = Path(out)
    parts = model() if parts is None else parts
    for sub in ("dxf", "step", "drawings", "nests"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    records = [setups_of(slug(p.name), p) for p in parts]
    dxf = []
    for r in records:
        for suffix, setup, _, _ in drawn(r):
            dxf.append(f"{r['key']}{suffix}.dxf")
            export_dxf(setup.layers, out / "dxf" / dxf[-1], curves="arcs")
    rows = cut_list(records)
    finished, rough = write_cut_list(rows, out)
    export_step(parts, out / "step" / "zigzag_chair.step", assembly=True)
    for p in parts:
        export_step(p, out / "step" / f"{slug(p.name)}.step")
    if pictures:
        for r in records:
            for suffix, setup, _, _ in drawn(r):
                box, t = setup.layer("OUTLINE").bbox(), setup.thickness
                which = "main setup" if not suffix else "tilted setup"
                title = f"{r['key']}{suffix}  {fmt(box.size.x)} x {fmt(box.size.y)} x {fmt(t)} mm  ({which}, 1:1)"
                drawing(setup.part, out / "drawings" / f"{r['key']}{suffix}.svg", title)
        box = parts[0].bbox()
        for p in parts[1:]:
            box = box.union(p.bbox())
        size = " x ".join(fmt(v) for v in box.size)
        drawing(parts, out / "drawings" / "assembly.svg", f"zigzag chair  {size} mm  (first-angle, 1:1)")
        render(parts, path=out / "drawings" / "assembly_iso.png", size=(1600, 1200))
    nests = write_nests(rows, out)
    tables, flagged = setup_tables(records)
    refused = [x for r in records for x in r["refused"]]
    text = readme(parts, rows, nests, tables, flagged, refused, finished, rough)
    (out / "README.md").write_text(text, encoding="utf-8")
    return {"rows": rows, "dxf": dxf, "nests": nests, "flagged": flagged, "refused": refused, "records": records}


if __name__ == "__main__":
    written = machining_files(sys.argv[1] if len(sys.argv) > 1 else "zigzag_chair_machining")
    print(
        f"{sum(r['qty'] for r in written['rows'])} parts, {len(written['dxf'])} DXF setups, "
        f"{len(written['flagged'])} features flagged, {len(written['refused'])} refused, "
        f"nests: {[(s, n) for s, n, _, _ in written['nests']]}"
    )
