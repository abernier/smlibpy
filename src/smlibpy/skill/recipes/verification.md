# Verification

A model is done when its numbers and its pictures agree with what was asked. Check after
every step, not only at the end: an error found early is one line to fix, an error found late
is a rebuild.

## After every step

```python
print(part.is_valid(), round(part.volume, 3), part.bbox().size, len(part.faces()))
```

- `is_valid()` must be `True`. An invalid part comes from a feature that half failed; fix the
  step that made it before going on.
- The volume must change in the expected direction and by a plausible amount. A cut that
  leaves the volume unchanged missed the part; a fillet that adds volume was not a fillet.
  Compare with a formula where there is one (a hole of radius r through t removes about
  pi·r²·t).
- `bbox().size` must be the outer dimensions you planned. Features placed on the wrong side
  show up here first.
- The face count changes with every feature: a through hole adds one face, a fillet one face
  per edge, a pocket five faces.

## Look

Pictures check shape, topology and placement; numbers check sizes, because every picture is
scaled to fit. `snapshot` (MCP) and `render` (Python) take the same options.

- **The drawing, after every few steps:** `snapshot(view="sheet")`, the same as
  `drawing=True`. A technical drawing in ISO projection method E: the front view, the view from
  the left to its right, the top view below it, all in line style at one scale, and a shaded
  iso view. Visible edges are solid, hidden edges dashed, round features have center lines.
  The hidden lines show what a shaded view cannot: through or blind holes, bores, pockets,
  hollow or solid. A feature on a hidden side shows here, not always in the iso view.
- **A reference drawing to match:** read its projection method from the projection symbol or
  the title block, render the same method, `drawing="first-angle"` (ISO E, usual in Europe) or
  `drawing="third-angle"` (ISO A, usual in the US), and compare view by view, hidden lines
  included. With the wrong method the side and top views swap places and the part looks
  mirrored.
- **Handedness:** before rendering, write down what the reference shows (for example "the slot
  opens to the upper right in the iso view"). Then `snapshot(sheet=[view, mirrored view])`, for
  example `[{"azimuth": 30, "elevation": 30}, {"azimuth": -30, "elevation": 30}]`, gives panels A
  and B side by side; decide which panel matches the reference image, not your own notes.
- **Wall thickness and inner shapes:** `section={"origin": [x, y, z], "normal": [nx, ny, nz]}`
  or `section="Plane.XZ"` cuts the model and hatches the cut faces; bores and pockets stay
  open. Measure the wall with `distance_to` afterwards; the cut shows where to measure.
- **Before filleting, chamfering or cutting with a selection:** `snapshot(highlight="part.edges()
  .concave()")` draws the selected edges red (faces orange). A selection that picks other edges
  than you meant is the most common reason for a wrong result.
- **Probe points:** `markers=[{"position": [x, y, z], "label": "A"}]` puts a crosshair where a
  measured or computed point is, to see whether it lies where you think.
- **Size at a glance:** `annotate=True` writes the bounding box size and draws a scale bar.
- **Before and after a change:** take the first snapshot, keep the `frame` it reports, change
  the model, then `snapshot(frame=..., compare="<path of the first PNG>")`: the answer counts the
  changed pixels and shows them red. A change outside the expected area, or none at all, is a
  finding. Use a view or `lines=True` that shows the change.
- **Hidden geometry without choosing a plane:** `xray=True`.
- **Bodies that should be separate:** `colors="distinct"` gives every body its own color.

## Before delivering

- The part is one solid when it should be: `len(part.solids()) == 1`.
- Critical dimensions measured on the result, not taken from the script: the distance between
  hole axes (`face.center()` of the hole faces), wall thickness (`distance_to`), heights from
  `bbox()`.
- The STEP file reads back: `import_step(path).volume` equals `part.volume`.

## When something is wrong

Read the error hint. Check the selection that fed the failing feature: print the count and
the centers of the faces or edges you selected. Most failures are a selection that picked
nothing, or something else than intended.
