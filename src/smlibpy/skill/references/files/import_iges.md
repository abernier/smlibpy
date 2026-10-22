# import_iges

Reads the solids and surfaces of an IGES file (IGES 5.3, ASCII) as exact smlibpy bodies.
`load("x.igs")` does the same thing. IGES is read only: write STEP to give a model to another
system.

## Signature
`import_iges(path, *, heal=True, strict=False)`

- `path`: `str` or `pathlib.Path`. `load()` sends `.igs` and `.iges` here (in any letter case).
- `heal`: repair solids (entity 186) that come out invalid, as `import_step` does. Faces of
  trimmed surfaces are stitched in any case.
- `strict`: raise `ModelingError` for something that cannot be read, instead of leaving it out
  with a warning.

## Returns
- One body: a `Part` (a solid) or a `Shell` (a surface model, a sheet).
- Several bodies: a `ShapeList` of them.

```python
r = import_iges(path)
parts = r if isinstance(r, ShapeList) else [r]
```

Lengths are converted to mm from the unit the file declares (inch, mm, m, ...).

## How the bodies are made
- **Trimmed surfaces (144)** are how most CAD systems write a solid: each face on its own, sharing
  no edges with the others. Each becomes a face on its exact surface, bounded by its exact
  curves; the faces are stitched where their edges meet (the kernel's stitch, then gaps up to
  1e-4 of the model's size), and each set of faces that closes up becomes a `Part`, the rest
  `Shell`s.
- **Solid B-rep objects (186)** come in as STEP solids do: their faces share the file's edges
  and vertices, no stitching needed.
- Bounded surfaces (143), bounded planes (108) and untrimmed B-spline surfaces (128, 114) become
  faces too, and are stitched with the rest.
- Surfaces of revolution (120) and tabulated cylinders (122) that are planes, cylinders, cones,
  spheres or tori come back as those (`geom_type` `"cylinder"`, not `"revolution"`).
- IGES does not fix which way a boundary runs: a face whose outer loop runs clockwise in its
  surface's parameters is turned over, a hole that runs the way the outer loop does is turned
  round. Slivers of no area (some writers leave them where faces meet) are dropped.
- A boundary given only in its surface's parameters (no model-space curve) is taken onto the
  surface when the surface is a B-spline (approximated within 1e-6 of its size).
- Names: the name property (406 form 15) or the entity's label; a stitched body takes the name
  its faces all have. Colors: the color number or color definition (314); a stitched body takes
  the color most of its faces have.

## Warnings
- `import IGES: left out trimmed surface 'ODD' (DE 1): surface entity 116 (DE 3), which is not
  supported`: that face is not in the result; the rest is.

## Gotchas
- **Check `is_valid()` and the type.** A solid whose faces leave gaps larger than the stitch
  closes comes back as a `Shell` (OpenCASCADE cannot close such files either). Closed bodies
  come back as `Part`s.
- A file of faces of several solids gives one `Part` per closed set of faces; a face that fits
  none stays a `Shell` of its own.
- Not read: binary and compressed IGES, offset curves (130), ruled surfaces between circles or
  conics, wireframe-only files (curves and points), annotation.

## Errors
- `ModelingError: the IGES file holds no solids or surfaces`: wireframe only, or empty.
- `ModelingError: import IGES: nothing in the file could be read: ...`: every body and face was
  left out; the message gives the first three reasons.
- `ModelingError: import IGES: trimmed surface 'ODD' (DE 1): ...` with `strict=True`.
- `ValueError: not an IGES file (...)`; `ValueError: IGES: this is a binary or compressed IGES
  file, which is not read; save it as ASCII IGES`.
- `FileNotFoundError` for a missing file.

## Example
```python
part = import_iges("bracket.igs")       # an IGES file from another CAD system
print(type(part).__name__, part.is_valid(), round(part.volume, 3))
export_step(part, "bracket.step")       # passed on as STEP
```
OpenCASCADE's IGES files of a box with a hole, fillets, a chamfer, cones, spheres, tori, lofts,
sweeps and revolved B-splines (trimmed surfaces and B-rep objects, mm and inch) read back as valid
parts within 1e-8 of the volume they were written from.

## Related
`import_step`, `load`, `export_step`, `stitch`, `Part.is_valid`, `generic.md`.
