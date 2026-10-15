# import_usd

Reads the bodies of the `BrepArray` prims of a USD text file: the exact B-reps that
`export_usd`, NVIDIA's usd-brep and Omniverse write (usd-brep's omniSolid schema).

## Signature
`import_usd(path, *, heal=False)`

- `path`: a `.usda` file, or a `.usd` file that holds text.
- `heal=True`: runs the kernel's import healer on each body (for files from other software
  whose faces do not quite meet).

`load("parts.usda")` does the same.

## Returns
One body: a `Part` (or a `Shell` for a body that encloses no volume). Several: a `ShapeList`
of them, in the order of the file, named after their prims and colored by their
`primvars:displayColor`. A merged part comes back merged, with its cells. Lengths are taken as
they are in the file: smlibpy writes millimeters.

## What is kept
- Bodies written by `export_usd` come back with the same faces, face types and edges (within
  1e-12) and the same volume (1e-7 relative).
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
  and edges) raises a `ValueError` that names the field that is wrong.

## Example
```python
part = (Box(30, 20, 10) - Cylinder(4, 10)).named("block")
export_usd(part, "block.usda")
back = import_usd("block.usda")
print(back.name, len(back.faces()) == len(part.faces()), abs(back.volume - part.volume) < 1e-6)   # block True True
```

## Related
`export_usd`, `import_step`, `load`, `generic`
