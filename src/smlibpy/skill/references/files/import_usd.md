# import_usd

Reads the bodies of the `BrepArray` prims of a USD text file: the exact B-reps that
`export_usd`, NVIDIA's usd-brep and Omniverse write (usd-brep's omniSolid schema).

## Signature
`import_usd(path, *, heal=False, units=None, placement=True, check=True, partial=False)`

- `path`: a `.usda` file, or a `.usd` file that holds text.
- `heal=True`: runs the kernel's import healer on each body (for files from other software
  whose faces do not quite meet).
- `units`: the stage's unit, `"mm"`, `"cm"`, `"m"`, `"um"` or `"inch"`, in place of its
  `metersPerUnit`. `None` takes the stage's `metersPerUnit`; a stage without one is read as
  millimeters (USD itself would take centimeters).
- `placement=False`: leaves each body where its prim has it (no `xformOp` transforms, no up axis).
- `check=False`: skips the kernel's check of each body (see Errors).
- `partial=True`: leaves out the bodies that cannot be read (malformed, broken, or that the
  kernel cannot build), with a `RuntimeWarning` for each that says which and why, and returns the
  others (usd-brep's `allow_partial`). A file none of whose bodies can be read raises either way.

`load("parts.usda")` does the same with the defaults.

## Returns
One body: a `Part` (or a `Shell` for a body that encloses no volume). Several: a `ShapeList`
of them, in the order of the stage, named after their prims (or the prim's `displayName`,
where it has one: smlibpy writes the names that are no prim names there, `"Größe"`) and
colored by their `primvars:displayColor`. A body whose prim's name another prim has too is
named by its prim's path (`/World/Left/Wheel`). A merged part comes back merged, with its cells. Lengths come out in
millimeters (`metersPerUnit = 0.01` scales by 10), and each body is placed as the stage has it:
the `xformOp` transforms of its prim and of the prims above it (`translate`, `scale`, the
`rotate` kinds, `orient`, `transform`, `!invert!`, `!resetXformStack!`), and a stage whose
`upAxis` is `"Y"` turned to Z up.

## Composition
- `subLayers` and the files prims reference (`references`, `payload`) are read too, relative to
  the file that names them (text USD only); a reference without a prim path takes the file's
  `defaultPrim`, one without a file is to a prim of the same stage. Opinions of the referencing
  prim, and of stronger layers, win.
- Prims that are abstract (`class`), inactive (`active = false`) or only an `over` hold no
  bodies, nor do their children.
- A file that cannot be read (not there, binary) is named in a `RuntimeWarning`, or in the
  `ValueError` when no bodies are left.
- Not composed: inherits, specializes, variant sets.

## What is kept
- Bodies written by `export_usd` come back with the same faces and face types, the same edges
  with the same curve types (lines, circles and ellipses; `edges().circles()` finds the holes,
  `Edge.radius` works), within 1e-12, and the same volume (1e-11 relative). Surfaces the schema
  has no type for (surfaces of revolution and extrusion, offset surfaces) come back as B-spline
  surfaces, and so do the circles and ellipses on them.
- usd-brep and Omniverse write every edge as a B-spline: those that are lines come back as
  lines, those that are circular arcs on faces of planes, cylinders, cones, spheres and tori as
  circles.
- Only `BrepArray` prims are read: `Mesh` prims (the ones `export_usd` writes beside each body
  too) and everything else in the stage are skipped.

## Errors
- `ValueError: the USD file holds no BrepArray prims (bodies)`.
- `ValueError: usd: this is binary USD (.usdc), which is not read: convert it to text with
  usdcat (usdcat in.usdc -o out.usda)`; a `.usdz` package raises a similar one (`usdcat
  in.usdz -o out.usda` reads it too). The command line tools come with a full OpenUSD install
  (macOS has them); with `pip install usd-core`, in Python:
  `Sdf.Layer.FindOrOpen("in.usdc").Export("out.usda")`.
- `ValueError: usd: not a .usda text (it does not start with #usda)`.
- A malformed `BrepArray` (arrays of the wrong length, broken references between faces, loops
  and edges) raises a `ValueError` that names the field that is wrong. So do values the
  conversion cannot take, with the body, the face or edge and the rule of usd-brep's validator:
  numbers that are not finite (BA.660), weights, radii and tolerances that are not positive, an
  axis or direction of length 0, an axis and refDirection that are parallel or not at right angles,
  ranges the wrong way round, edges no edgeuse uses (BA.582), empty bodies:
  `ValueError: usd: the BrepArray "/World/ball" is malformed: body 0, face 0: the axis and the
  refDirection are parallel (BA.482-484)`. Directions are made unit (a cone axis of length 2 read
  as a different cone before).
- A body the kernel cannot build raises `KernelError: import_usd failed (SM_ERR_INVALID_INPUT):
  body 0 of the BrepArray "/World/c" could not be built; partial=True leaves such bodies out and
  reads the others`.
- With `partial=True`: `RuntimeWarning: import_usd: body 0 of the BrepArray "/World/c" could not
  be built (SM_ERR_INVALID_INPUT); it is left out`; a file of no readable body raises
  `ValueError: import_usd: no body of the file can be read: ...`.
- Bodies that smlibpy did not write are checked by the kernel (`SmBrep::AssertValid`) before
  anything measures them. One whose faces, edges and vertices leave gaps of more than 1e-3 of its
  size raises `ValueError: usd: body 0 of the BrepArray "/culprit" is broken: the kernel finds a
  gap of 377 (0.033 of its size) at face 5: ...`; smaller gaps give a `RuntimeWarning`.
  `check=False` reads such a body as it is.

## Example
```python
part = (Box(30, 20, 10) - Cylinder(4, 10)).named("block")
export_usd(part, "block.usda")
back = import_usd("block.usda")
print(back.name, len(back.faces()) == len(part.faces()), abs(back.volume - part.volume) < 1e-6)   # block True True
```

## Related
`export_usd`, `import_step`, `load`, `generic`
