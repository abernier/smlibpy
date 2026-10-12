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

`snapshot(view="sheet")` shows front, left, top and iso at one scale, arranged as in ISO
projection method E: the view from the left stands to the right of the front view, the top
view below it. Use it for shape,
topology and placement; use numbers for sizes, because pictures are scaled to fit. A feature
on a hidden side shows in the sheet, not always in the iso view.

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
