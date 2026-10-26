# face colors and names: paint and label single faces

Give a color or a name to some faces of a body (the hole walls red, the sealing face labelled
"seal"), which stays with them through later Booleans, fillets and moves, and goes into STEP,
glTF, USD and pictures.

## Signature
- `body.colored(color, faces=...)`: a copy whose selected faces have `color` (a CSS name, `"#rrggbb"`
  or `(r, g, b)`); `None` takes the faces' color off. The body keeps its own `color`.
- `body.named(name, faces=...)`: the same for names; `None` takes them off. The body keeps its `name`.
- `face.color`: `(r, g, b)` floats from 0 to 1, or `None` (the face shows in its body's color). A
  body's `color` is what it was given (`"steelblue"`, `"#c0c0c0"`): to compare the two, turn the
  body's into floats with `from smlibpy.colors import to_rgb; to_rgb(part.color)`.
- `face.name`: a string or `None`.
- smlibwasm: `body.colored(color, { faces })`, `body.named(name, { faces })`, `face.color` (`[r, g, b]`
  or null), `face.name`.

`faces` takes faces of the body, a list or a ShapeList of them, or faces of an earlier version of
the part (they stand for their pieces, as for `fillet`); a face of another body in the same place
works too. `ValueError` for an empty selection or a face that is not on the part.

## What keeps them
They are the kernel's own face attributes, which it carries through its operations:
- Booleans: both pieces of a face a cut splits keep it; the walls of a hole keep the color the
  *tool's* faces had (paint the tool, then cut); a face merged from two keeps the first's, or the
  other's where the first had none.
- Fillets and chamfers keep the faces' (the rounds and bevels are new: none).
- Shells, offsets and thickening: the offset faces keep the color of the faces they come from.
- Moves, mirrors, scales (also per axis), patterns, `split`, `imprint`, `cells()`, `solids()`,
  `heal()`, `to_nurbs()`, deforms.

## Files and pictures
- STEP: a `STYLED_ITEM` per colored `ADVANCED_FACE` (over the body's color), the name as the face's
  name. `import_step` reads both, also from files of other systems (SolidWorks, NX, OpenCASCADE
  color single faces this way).
- glTF / the viewer: a primitive per color. USD: the mesh prim gets a color per triangle
  (`displayColor`, interpolation `uniform`); the exact `BrepArray` prim has no face colors.
- `render` / snapshots: the faces in their colors (also cut open by a section).
- `.smb` (`save`) keeps neither, nor the body's name and color. `.smp` keeps the faces' colors,
  not their names.

## Example
```python
tool = Cylinder(5, 20)
tool = tool.colored("red", faces=tool.faces())              # every hole it cuts has red walls
plate = (Box(60, 40, 8) - tool).colored("steelblue")
plate = plate.colored("gold", faces=plate.faces().top()).named("seal", faces=plate.faces().bottom())
rounded = plate.fillet(plate.edges().top(), 1)
print([f.color for f in rounded.faces() if f.color])         # red wall, gold top: kept
seal = rounded.faces().filter_by(lambda f: f.name == "seal")
export_step(rounded, "plate.step")                            # the faces' colors and names go along
```

## Gotchas
- `colored(color)` without `faces` colors the body, as before (the faces' own colors win where
  they have one).
- A face made anew by an operation has no color: color after the fillet if the rounds should be
  colored too (`part.colored("red", faces=part.faces().new(since=before))`).
- Colors come back as float tuples, not as the string given.

## Related
`selection/history` (new, derived_from), `files/export_step`, `files/export_glb`, `files/export_usd`,
`files/render`.
