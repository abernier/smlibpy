"""The machining files of the compass armchair: cut list, STEP, a flat DXF per setup, drawings, nests and a README.

    python examples/compass_armchair_machining.py [output folder]   (default: compass_armchair_machining/)

Everything is read off `compass_armchair.py`'s model and constants, nothing is retyped. `machining_setup` lays each
part on a 3-axis router and sorts its features into DXF layers: OUTLINE, THROUGH, POCKET_D<depth>, LABEL. The cane
panels are woven, not cut: their openings are listed instead.
"""

from __future__ import annotations

import csv
import importlib.util
import math
import sys
from pathlib import Path

from smlibpy import *


def _chair():
    spec = importlib.util.spec_from_file_location("compass_armchair", Path(__file__).with_name("compass_armchair.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


chair = _chair()
DENSITY = 0.65e-3  # teak, g/mm3
ALLOWANCE_L, ALLOWANCE_W = 30.0, 10.0  # rough blank over the finished length and width (half an end, half a side)
ROUGH = [(22.0, 27.0), (30.0, 34.0), (36.0, 41.0), (48.0, 54.0), (60.0, 65.0), (75.0, 80.0)]  # finished up to, sawn
PLANK = (2400.0, 200.0)  # the planks the nests assume: length along the grain, width
KERF = 4.0  # the saw cut between blanks in a nest
ARC = f"R {chair.R_BACK:.0f} on the middle line, bow {chair.BOW:.0f}"
NOTES = {  # what the pockets of each part are, in words (their sizes are in the README's tables)
    "front leg": "mortise for the side rail's stub tenon on the inner face; half of the spline's slot on the seam "
    "edge, open at the top end",
    "rear leg": "mortise for the side rail's stub tenon on the inner face; half of the spline's slot on the seam "
    "edge, open at the top end",
    "spline": "loose tenon across the seam of the two leg boards, running on into the armrest",
    "side rail": "two stub tenons on the outer face (into the legs); two mortises on the inner face for the cross "
    "rails",
    "armrest": "half-lap recess on the inner face where the back post crosses; mortise for the spline in the underside",
    "back post": "two mortises on the inner face for the back rails; half-lap recess on the outer face for the armrest",
    "front rail": "tenons at both ends into the side rails: four cheeks, two a face",
    "rear rail": "tenons at both ends into the side rails: four cheeks, two a face",
    "back rail": f"curved ({ARC}); tenons at both ends into the posts: four cheeks",
}


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


def fmt(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".")


def to_model(plane: Plane, d: Vector) -> Vector:
    """A direction of a setup's frame, in the model."""
    return (plane.x_dir * d.x + plane.y_dir * d.y + plane.z_dir * d.z).normalized()


def main_direction(part: Part) -> Vector:
    """The face the main setup works from: the side of the largest flat face that leaves the fewest features to
    other setups (features of the other face count less: turning the part over is the easy second setup)."""
    big = max((f for f in part.faces() if f.is_planar), key=lambda f: f.area)
    n = big.normal_at()
    best = None
    for d in (n, -n):
        s = machining_setup(part, d)
        score = (sum(why != "opens below" for why, _, _ in s.elsewhere), len(s.elsewhere), -len(s.layers))
        if best is None or score < best[0]:
            best = (score, d)
    return best[1]


def symmetric(part: Part) -> bool:
    """Whether the part is its own mirror image across its middle plane normal to the model's x."""
    mirrored = part.mirror(Plane(part.center(), z_dir=(1, 0, 0)))
    return abs((part & mirrored).volume - part.volume) < 1e-6 * part.volume


def keyed(parts: list[Part]) -> list[tuple[str, str, Part]]:
    """(key, side, part) for every part: the name with its side (left/right by the model's x) or its rank."""
    out = []
    groups: dict[str, list[Part]] = {}
    for p in parts:
        groups.setdefault(p.name, []).append(p)
    for name, group in groups.items():
        if len(group) == 1:
            out.append((slug(name), "", group[0]))
        elif all(abs(p.center().x) > 1.0 for p in group):
            for p in group:
                side = "right" if p.center().x > 0 else "left"
                out.append((f"{slug(name)}_{side}", side, p))
        else:
            for i, p in enumerate(sorted(group, key=lambda p: p.center().z)):
                rank = ["lower", "upper"][i] if len(group) == 2 else str(i + 1)
                out.append((f"{slug(name)}_{rank}", rank, p))
    return out


def pocket_rows(setup: MachiningSetup) -> list[dict]:
    """One row per pocket region of a setup: layer, depth, size, where it is, and where the stock's surface is above
    it (the entry), which differs from the top where the part's top is not flat there."""
    rows = []
    for layer in setup.layers:
        if not layer.name.startswith("POCKET_D"):
            continue
        floor = setup.thickness - float(layer.name[len("POCKET_D") :].replace("_", "."))
        for face in layer.faces():
            b, c = face.bbox(), face.center()
            entries = []
            for v in face.outer_wire().vertices():
                p = v.center()
                away = p - c
                q = p + away.normalized() * 0.5 if away.length > 1e-9 else p
                hits = setup.part.raycast((q.x, q.y, setup.thickness + 1), (0, 0, -1))
                if hits:
                    entries.append(hits[0].point.z)
            rows.append(
                {
                    "layer": layer.name,
                    "depth": setup.thickness - floor,
                    "floor": floor,
                    "size": (b.size.x, b.size.y),
                    "at": (b.min.x, b.min.y, b.max.x, b.max.y),
                    "entry": (min(entries), max(entries)) if entries else (setup.thickness, setup.thickness),
                    "islands": len(face.inner_wires()),
                }
            )
    return sorted(rows, key=lambda r: (r["layer"], *(round(v, 3) for v in r["at"])))  # the same order every run


def describe_direction(d: Vector) -> str:
    axes = {"+X": (1, 0, 0), "-X": (-1, 0, 0), "+Y": (0, 1, 0), "-Y": (0, -1, 0), "+Z": (0, 0, 1), "-Z": (0, 0, -1)}
    for name, v in axes.items():
        if d.is_parallel(v) and d.dot(Vector(v)) > 0:
            return f"model {name}"
    return f"model ({d.x:.3f}, {d.y:.3f}, {d.z:.3f})"


def drawing(part_or_parts, path: Path, title: str, views=("front", "top", "left")) -> None:
    """Three views at true size, hidden lines dashed, the title under them."""
    views_ = drawing_views(part_or_parts, views)
    box = views_[0].bbox()
    for v in views_[1:]:
        box = box.union(v.bbox())
    size = max(4.0, min(12.0, box.size.x / 60))
    label = Text(title, size, align=(Align.MIN, Align.MAX)).translate(box.min.x, box.min.y - 2 * size, 0)
    export_svg([*views_, label], path)


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


def setups_of(key: str, side: str, part: Part) -> dict:
    """The setups of one part: the main face, then the other face and the edges its features open on."""
    d_main = main_direction(part)
    label = f"{part.name.upper()}{(' ' + side[0].upper()) if side in ('left', 'right') else ''}"
    thickness = machining_setup(part, d_main).thickness
    main = machining_setup(part, d_main, label=f"{label} T{fmt(thickness)}")
    setups = [("", main, d_main, "main face")]
    for why, direction, _ in main.elsewhere:
        d = to_model(main.plane, direction)
        if why == "opens below" and not any(sfx == "_back" for sfx, *_ in setups):
            back = machining_setup(part, d, x_dir=main.plane.x_dir, label=f"{label} BACK")
            setups.append(("_back", back, d, "the other face, turned over about x"))
        elif why == "opens at the side" and not any(d.is_parallel(d0) and d.dot(d0) > 0 for _, _, d0, _ in setups):
            n = sum(sfx.startswith("_edge") for sfx, *_ in setups) + 1
            try:
                edge = machining_setup(part, d, x_dir=main.plane.x_dir, label=f"{label} EDGE {n}")
            except ValueError:
                edge = machining_setup(part, d, label=f"{label} EDGE {n}")
            setups.append((f"_edge{n}", edge, d, "an edge"))
    # an edge whose feature a vertical cutter cannot make there is reported, not drawn
    drawn = [s for s in setups if not s[0] or any(layer.name.startswith("POCKET") for layer in s[1].layers)]
    return {"key": key, "side": side, "part": part, "main": main, "setups": drawn, "all_setups": setups}


def cut_list(records: list[dict]) -> list[dict]:
    """One row per part name: finished size from the main setup, blank, quantity, files."""
    rows = []
    groups: dict[str, list[dict]] = {}
    for r in records:
        groups.setdefault(r["part"].name, []).append(r)
    for name, group in groups.items():
        r0 = group[0]
        box = r0["main"].layer("OUTLINE").bbox()
        length, width, thickness = box.size.x, box.size.y, r0["main"].thickness
        sides = sorted({r["side"] for r in group} - {""})
        if sides == ["left", "right"]:
            qty_note = "1 left + 1 right, " + ("identical" if symmetric(r0["part"]) else "mirror images")
        else:
            qty_note = "identical" if len(group) > 1 else ""
        rows.append(
            {
                "part": name,
                "qty": len(group),
                "length": length,
                "width": width,
                "thickness": thickness,
                "blank": (length + ALLOWANCE_L, width + ALLOWANCE_W, rough_thickness(thickness)),
                "volume": sum(r["part"].volume for r in group),
                "files": ", ".join(f"{r['key']}{s[0]}.dxf" for r in group for s in r["setups"]),
                "notes": NOTES.get(name, ""),
                "qty_note": qty_note,
                "records": group,
            }
        )
    return rows


def write_cut_list(rows: list[dict], cane: list[Part], out: Path) -> tuple[float, float]:
    finished = sum(r["volume"] for r in rows)
    rough = sum(r["qty"] * math.prod(r["blank"]) for r in rows)
    with (out / "cutlist.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(
            ["part", "qty", "finished_length_mm", "finished_width_mm", "finished_thickness_mm", "material", "grain"]
            + ["blank_length_mm", "blank_width_mm", "sawn_thickness_mm", "dxf_files", "notes"]
        )
        for r in rows:
            notes = r["notes"] + ("; " + r["qty_note"] if r["qty_note"] else "")
            sizes = [f"{r['length']:.1f}", f"{r['width']:.1f}", f"{r['thickness']:.1f}"]
            blank = [f"{v:.0f}" for v in r["blank"]]
            w.writerow(
                [r["part"], r["qty"], *sizes, "teak", "along the length (x of the DXF)", *blank, r["files"], notes]
            )
    with (out / "cutlist_optimizer.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["Length", "Width", "Qty", "Label", "Material", "Grain"])
        for r in rows:
            bl, bw, bt = r["blank"]
            w.writerow([f"{bl:.0f}", f"{bw:.0f}", r["qty"], r["part"], f"teak sawn {bt:.0f} mm", "length"])
    lines = [
        "# Cut list — compass armchair",
        "",
        (
            "Finished sizes from the model (`machining_setup`: length and width of the footprint in the main setup, "
            f"thickness along the tool). Blanks: finished + {fmt(ALLOWANCE_L)} in length, + {fmt(ALLOWANCE_W)} in "
            "width; "
            "sawn thickness from the table in the README."
        ),
        "",
        "| Part | Qty | Finished L × W × T (mm) | Blank L × W × sawn T (mm) | Grain | DXF | What is on it |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        qty = f"{r['qty']}" + (f" ({r['qty_note']})" if r["qty_note"] else "")
        blank = " × ".join(f"{v:.0f}" for v in r["blank"])
        lines.append(
            f"| {r['part']} | {qty} | {fmt(r['length'])} × {fmt(r['width'])} × {fmt(r['thickness'])} | {blank} | "
            f"along the length | {r['files']} | {r['notes']} |"
        )
    seat = next(p for p in cane if p.name == "seat cane").bbox()
    lines += [
        "",
        (
            f"Finished teak: {finished / 1e6:.2f} dm³ ({finished / 1e9:.4f} m³), {finished * DENSITY / 1000:.2f} kg at "
            f"{DENSITY * 1e3:.2f} g/cm³."
        ),
        f"Sawn blanks: {rough / 1e9:.4f} m³ ({rough / finished:.1f} × the finished volume).",
        "",
        "Cane panels (not machined; the weave is not modelled, each panel is a plate touching its rails):",
        (
            f"- seat cane: opening {fmt(seat.size.x)} across × {fmt(seat.size.y)} front to back, panel "
            f"{fmt(seat.size.z)} thick, flush with the rails' top"
        ),
        (
            f"- back cane: opening {fmt(2 * chair.X_BOARD)} between the posts × "
            f"{fmt(chair.BACK_RAILS[1][0] - chair.BACK_RAILS[0][1])} along the posts, on the rails' arc ({ARC}), panel "
            f"{fmt(chair.CANE)} thick"
        ),
        "",
    ]
    (out / "cutlist.md").write_text("\n".join(lines), encoding="utf-8")
    return finished, rough


def write_nests(rows: list[dict], out: Path) -> list[tuple[float, int, float, list[str]]]:
    """The blanks of each sawn thickness on planks, as DXF and SVG: PLANK, BLANK, OUTLINE and LABEL layers."""
    nests = []
    by_sawn: dict[float, list[dict]] = {}
    for r in rows:
        for rec in r["records"]:
            outline = rec["main"].layer("OUTLINE")
            item = {
                "key": rec["key"],
                "outline": outline,
                "blank": r["blank"][:2],
                "finished": (r["length"], r["width"]),
            }
            by_sawn.setdefault(r["blank"][2], []).append(item)
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
                dx, dy = x + (bl - fl) / 2 - box.min.x, y + (bw - fw) / 2 - box.min.y
                sketches.append(it["outline"].translate(dx, dy, 0).named("OUTLINE"))
                size = max(6.0, min(14.0, fw / 6))
                sketches.append(Text(it["key"], size).translate(x + bl / 2, y + bw / 2, 0).named("LABEL"))
        export_dxf(sketches, out / "nests" / f"nest_T{sawn:.0f}.dxf", curves="arcs")
        export_svg(sketches, out / "nests" / f"nest_T{sawn:.0f}.svg")
        used = sum(it["blank"][0] * it["blank"][1] for it in items)
        nests.append((sawn, len(planks), used / (len(planks) * PLANK[0] * PLANK[1]), [it["key"] for it in items]))
    return nests


def setup_tables(records: list[dict]) -> tuple[list[str], list[tuple[str, str, str, str]]]:
    """The README's per-part setups, and the features no setup draws."""
    lines, flagged = [], []
    for r in records:
        lines += [f"### {r['key']}", ""]
        for suffix, setup, d, what in r["setups"]:
            box = setup.layer("OUTLINE").bbox()
            layers = ", ".join(f"`{layer.name}`" for layer in setup.layers)
            lines += [
                (
                    f"**`{r['key']}{suffix}.dxf`** — {what}; the tool comes from {describe_direction(d)}; "
                    f"T = {fmt(setup.thickness)}, footprint {fmt(box.size.x)} × {fmt(box.size.y)}; layers: {layers}."
                ),
                "",
            ]
            pockets = pocket_rows(setup)
            if pockets:
                lines += [
                    (
                        "| Layer | Pocket (x × y) | At x, y (min … max) | Depth from top | Floor above table | "
                        "Entry z | "
                        "Islands |"
                    ),
                    "|---|---|---|---|---|---|---|",
                ]
                for p in pockets:
                    e0, e1 = p["entry"]
                    entry = fmt(e0) if abs(e1 - e0) < 0.05 else f"{fmt(e0)} … {fmt(e1)}"
                    x0, y0, x1, y1 = (fmt(v) for v in p["at"])
                    lines.append(
                        f"| `{p['layer']}` | {fmt(p['size'][0])} × {fmt(p['size'][1])} | {x0}, {y0} … {x1}, {y1} | "
                        f"{fmt(p['depth'])} | {fmt(p['floor'])} | {entry} | {p['islands']} |"
                    )
                lines.append("")
            if suffix.startswith("_edge"):
                lines += [
                    (
                        "In an edge setup the OUTLINE is the part's shadow seen along the tool, for placing the part "
                        "on "
                        "the machine; the part's own faces are cut in the main setup."
                    ),
                    "",
                ]
            if not suffix:
                for why, _, faces in setup.elsewhere:
                    if why in ("opens below", "opens at the side"):
                        continue  # (drawn in another setup of this part)
                    b = faces.bbox()
                    where = ", ".join(f"{a} {fmt(lo)} … {fmt(hi)}" for a, lo, hi in zip("xyz", b.min, b.max))
                    flagged.append((r["key"], f"{r['key']}.dxf", why, where))
        for suffix, _, d, _ in r["all_setups"]:
            if not any(sfx == suffix for sfx, *_ in r["setups"]):
                why = "the feature opening there is not a prism along that direction"
                flagged.append((r["key"], f"edge, tool from {describe_direction(d)} (not drawn)", why, "see the notes"))
    return lines, flagged


def readme(parts, rows, nests, tables, flagged, finished, rough) -> str:
    """The README: how to read the files, the stock, the setups that need a word, the order of assembly, then the
    tables. Every number is the model's or one of this file's assumptions."""
    box = parts[0].bbox()
    for p in parts[1:]:
        box = box.union(p.bbox())
    machined = sum(r["qty"] for r in rows)
    thicknesses = sorted({r["thickness"] for r in rows})
    used = [(up_to, sawn) for up_to, sawn in ROUGH if any(rough_thickness(t) == sawn for t in thicknesses)]
    by_name = {r["part"]: r for r in rows}
    back_rail = by_name["back rail"]
    loose = rough_thickness(chair.RAIL_T)
    pl, pw = (fmt(v) for v in PLANK)
    text = (
        f"""# Compass armchair — machining files

Everything a joinery or CNC shop needs to machine the teak armchair of `examples/compass_armchair.py`:
{fmt(box.size.x)} × {fmt(box.size.y)} × {fmt(box.size.z)} mm over all, {len(parts)} parts, {machined} of them
machined (the cane panels are woven, not cut).

Every file here is **derived from the model by code**: `examples/compass_armchair_machining.py`, with smlibpy's
`machining_setup`. Every number in the tables below is read off the model. To make the files again:

```sh
python examples/compass_armchair_machining.py <output folder>
```

## How to read the DXF files

- Units: millimetres. Format: DXF AC1015 (AutoCAD 2000), lines and arcs only (`curves="arcs"`), closed
  contours. Every CAM program reads it (Fusion 360, VCarve/Aspire, Alphacam, woodWOP via DXF import, Inkscape).
- One file is one **setup**: the part lying on the machine table on one face, the tool coming from above. The
  drawing's x and y are the table's; z runs from the table (z = 0) up to the top face (z = T, the finished
  thickness). The origin is the lower-left corner of the part's footprint.
- Layers:
  - `OUTLINE` — the part's contour, cut through. In the main setups it is the finished shape; in an edge
    setup (`*_edge1.dxf`) it is the part's shadow seen along the tool, for placing the part only.
  - `THROUGH` — holes through the part.
  - `POCKET_D<depth>` — a pocket open on the top face, to be cleared `<depth>` mm below the top face
    (`POCKET_D7_5` is 7.5 deep). A contour with an inner loop keeps the inner loop as an island (the side
    rails' stub tenons). A pocket whose contour touches the outline is open to the side: a tenon cheek, a
    rabbet, the half laps.
  - `LABEL` — the part's name and thickness as outlines, and an arrow along the grain. Do not cut it.
- The grain runs along x in every file.
- **Inside corners.** The model's mortises, half laps and slots have square corners; a router leaves inside
  corners rounded at the tool's radius. These files assume the corners are squared with a chisel after
  routing. The alternative, rounding the tenons' edges to the tool radius, suits the loose splines and the
  stub tenons; either way, mortise and tenon were modelled to the same size, so leave the usual few tenths of a
  millimetre for glue on the tenons.
- Depths are from the **top face of the finished part**. If the shop machines from oversize stock, the
  outline is cut through at T and the pockets measured from the finished surface.

## Stock

Finished thicknesses: {", ".join(fmt(t) for t in thicknesses)} mm. The cut list gives each part a sawn
thickness by this table, the usual French trade series for sawn hardwood — **check it against the supplier's
actual stock**, teak is often sold already planed:

| Finished thickness | Sawn ("avivé") |
|---|---|
"""
        + "\n".join(f"| up to {fmt(up_to)} | {fmt(sawn)} |" for up_to, sawn in used)
        + f"""

Blanks are the finished footprint plus {fmt(ALLOWANCE_L)} mm in length and {fmt(ALLOWANCE_W)} mm in width. The nests
assume planks of {pl} × {pw} mm with the grain along the plank. Teak at {DENSITY * 1e3:.2f} g/cm³: the finished parts
weigh {finished * DENSITY / 1000:.1f} kg; the sawn blanks are {rough / finished:.1f} × the finished volume.

## Setups that need a word

- **Legs (four boards).** Main setup: the board flat, inner face up — the outline and the mortise for the
  side rail's stub tenon. Edge setup (`*_edge1.dxf`): the board standing on its seam edge (the edge that
  meets the other board of the pair), tool from the seam — half of the spline's slot, a pocket open at the
  board's top end. A slot on an edge is also a job for a slot cutter or a router jig; the DXF gives its
  position from the board's corners.
- **Armrests.** Main setup, inner face up: the half-lap recess for the post, open at the arm's rear end.
  The spline's mortise enters the sloping underside and runs vertically (along the chair's height), so it is
  not perpendicular to the underside: its edge setup (`armrest_*_edge1.dxf`) has the arm **upside down on its
  flat top**, the tool coming from below the chair. Its layer name gives the depth from the highest point of
  the underside; the table says where the floor is above the table and where the sloping surface is at the
  mortise (entry): the mortise is {fmt(chair.SPLINE_IN_ARM)} deep from the surface at the spline. A hollow-chisel
  mortiser with the arm clamped top-down does the same job.
- **Side rails.** As modelled, the stub tenons into the legs are integral: {fmt(chair.TENON[0])} mm proud of the
  outer face, which puts the rail in {fmt(by_name["side rail"]["thickness"])} mm stock and makes the second setup
  (`side_rail_*_back.dxf`) a facing of the whole outer face around two islands. A shop will prefer **loose
  tenons** (Domino or shop-made): mortise the rail's outer face at the islands' positions, as deep as they are
  proud, and the rail drops to {fmt(chair.RAIL_T)} mm finished ({fmt(loose)} sawn); the legs' mortises do not change.
- **Cross rails and back rails.** Tenons at both ends, cheeks on both faces: two setups each (`*.dxf`,
  `*_back.dxf`), or a tenoning jig on the table saw; the shoulders across the height are in the outline.
  The back rails are curved ({ARC}, hidden within the posts' depth): bandsaw the blank from a
  {fmt(back_rail["blank"][1])} mm wide board, then rout the arcs; grain along the chord.
- **Back posts.** Inner face up: the mortises for the back rails; turned over: the half-lap recess for the
  armrest, whose walls follow the arm's top and sloping underside.
- **Cane.** The model holds each cane panel as a plate flush with its rails, to give the openings (in the cut
  list). Real caning wants a groove or holes along the opening, which are **not** in these files: a groove near
  the inside edge of each frame member for prewoven webbing, or a row of holes for hand caning.

## Suggested order of assembly

1. Dry-fit everything; the DXF pockets are the model's exact sizes.
2. Back frame: the two posts and the two curved rails (tenons), glued square and left to cure.
3. Each side: the two leg boards meet on the seam with the spline glued across it; the side rail's stub
   tenons into the boards; then the armrest down onto the boards' tops, the spline entering its mortise.
4. The two sides joined by the front and rear rails into the side rails; the back frame offered into the
   two half laps from behind at the same time (dry-fit step 1 tells whether the laps go on before the
   armrests are glued).
5. Cane last; oil (teak oil or a hardwax oil) after sanding, or leave the teak raw to silver.

## What was checked, and what was not

- The model passes its own `check()`: every part's volume against a hand calculation, the parts fusing into
  one solid without gap or overlap, the back touching only the armrests, the feet on the floor.
- The DXF layers read back into smlibpy with the areas they were made from; the STEP files are the model's
  exact bodies.
- Not done: no CAM program has run these files, no part has been cut. Check the first part on scrap.
- The chair's proportions are a reading of photographs of the 1955 Chandigarh office chair, not a
  manufacturer's drawing (see the example's own notes).
- The sawn thickness series and the blank allowances are the usual trade sizes for sawn hardwood in France,
  not a supplier's: ask for the actual stock before cutting the list. The optimizer CSV's columns (`Length,
  Width, Qty, Label, Material, Grain`, blank sizes) are mapped in the import dialog of CutList Optimizer and
  similar tools; no tool's exact header set was verified.

## Files

| File | What it is |
|---|---|
| `cutlist.md`, `cutlist.csv` | the cut list: finished sizes, blanks, grain, which DXF covers the part |
| `cutlist_optimizer.csv` | the blanks for a panel optimizer |
| `step/compass_armchair.step` | the assembly, one named product per part |
| `step/<part>.step` | each part alone, in the model's position |
| `dxf/<part>.dxf` | the part laid on its main face: layers OUTLINE, THROUGH, POCKET_D<depth>, LABEL |
| `dxf/<part>_back.dxf` | the same part turned over about the drawing's x axis: the pockets of the other face |
| `dxf/<part>_edge<n>.dxf` | the part held on an edge: the mortise that opens there, as a pocket |
| `drawings/<part>.svg` | front, top and left views of the part in its main setup, hidden lines dashed, true size |
| `drawings/assembly.svg`, `assembly_iso.png` | the chair: three views, and a shaded view |
| `nests/nest_T<sawn>.dxf`, `.svg` | the blanks of one sawn thickness on planks, grain along the plank |

## Setups

Every machined part, its setups and what each setup cuts. x, y are the DXF's axes (mm), z the tool's axis from
the table (z = 0) to the top face (z = T). A pocket's layer names its depth from the top face; "floor" is its
height above the table and "entry" where the stock's surface is above the pocket's edge, which is lower than T
where the top is not flat there.

"""
    )
    text += "\n".join(tables) + "\n## Not for a vertical cutter\n\n"
    if flagged:
        text += "| Part | Setup | Why | Where |\n|---|---|---|---|\n"
        text += "".join(f"| {k} | `{f}` | {w} | {where} |\n" for k, f, w, where in flagged)
    else:
        text += "Nothing: every feature is a pocket of one of the setups above.\n"
    text += (
        f"\n## Nests\n\nPlanks of {pl} × {pw} mm, blanks with their grain along the plank, {fmt(KERF)} mm apart.\n\n"
    )
    text += "| Sawn thickness | Planks | Area used | Blanks |\n|---|---|---|---|\n"
    text += "".join(f"| {fmt(s)} mm | {n} | {u:.0%} | {', '.join(keys)} |\n" for s, n, u, keys in nests)
    return text


def machining_files(out: str | Path, parts: list[Part] | None = None, *, pictures: bool = True) -> dict:
    """Write the machining files of the chair into `out`; `pictures=False` leaves out the drawings and the shaded
    view. Returns what was written: the cut list's rows, the DXF names, the nests and the flagged features."""
    out = Path(out)
    parts = model() if parts is None else parts
    for sub in ("dxf", "step", "drawings", "nests"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    records = [setups_of(k, s, p) for k, s, p in keyed(parts) if "cane" not in p.name]
    dxf = []
    for r in records:
        for suffix, setup, _, _ in r["setups"]:
            dxf.append(f"{r['key']}{suffix}.dxf")
            export_dxf(setup.layers, out / "dxf" / dxf[-1], curves="arcs")
    rows = cut_list(records)
    finished, rough = write_cut_list(rows, [p for p in parts if "cane" in p.name], out)
    export_step(parts, out / "step" / "compass_armchair.step", assembly=True)
    for key, _, part in keyed(parts):
        export_step(part, out / "step" / f"{key}.step")
    if pictures:
        for r in records:
            box, t = r["main"].layer("OUTLINE").bbox(), r["main"].thickness
            title = f"{r['key']}  {fmt(box.size.x)} x {fmt(box.size.y)} x {fmt(t)} mm  (main setup, 1:1)"
            drawing(r["main"].part, out / "drawings" / f"{r['key']}.svg", title)
        box = parts[0].bbox()
        for p in parts[1:]:
            box = box.union(p.bbox())
        size = " x ".join(fmt(v) for v in box.size)
        drawing(parts, out / "drawings" / "assembly.svg", f"compass armchair  {size} mm  (first-angle, 1:1)")
        render(parts, path=out / "drawings" / "assembly_iso.png", size=(1600, 1200))
    nests = write_nests(rows, out)
    tables, flagged = setup_tables(records)
    (out / "README.md").write_text(readme(parts, rows, nests, tables, flagged, finished, rough), encoding="utf-8")
    return {"rows": rows, "dxf": dxf, "nests": nests, "flagged": flagged}


if __name__ == "__main__":
    written = machining_files(sys.argv[1] if len(sys.argv) > 1 else "compass_armchair_machining")
    print(
        f"{sum(r['qty'] for r in written['rows'])} machined parts, {len(written['dxf'])} DXF setups, "
        f"{len(written['flagged'])} features flagged, nests: {[(s, n) for s, n, _, _ in written['nests']]}"
    )
