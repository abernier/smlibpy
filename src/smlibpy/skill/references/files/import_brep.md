# import_brep

Reads an OpenCASCADE `.brep` file: what OpenCASCADE, build123d (`export_brep`), CadQuery
(`exportBrep`) and FreeCAD (`Shape.exportBrep`) write, ASCII (`BRepTools::Write`) or binary
(`BinTools::Write`). Read with the bridge of NVIDIA's usd-brep, compiled into smlibpy.

## Signature
`import_brep(path, *, heal=False, check=True, strict=False)`
`from_brep(data, *, heal=False, check=True, strict=False)` reads the contents (`str` or `bytes`).

`strict=True` raises `ModelingError` where a solid, shell or face of the file cannot be read; by
default it is left out with a `RuntimeWarning`, as `import_step`, `import_iges` and `import_usd` do.

- `heal=True`: runs the kernel's import healer on each body.
- `check=False`: skips the kernel's check of each body (see Errors).

`load("part.brep")` does the same with the defaults.

## Returns
A `Part` for each solid of the file's shape (with its cavities), a `Shell` for each shell or face
that belongs to no solid: one shape, or a `ShapeList` in the order of the file's compound. Bodies
are placed as the file places them (its locations) and in its units (millimeters for the tools
above); they have no names or colors (the format has none). Faces and edges keep their exact
geometry: planes, cylinders, cones, spheres, tori and B-splines come back as those
(`faces().cylinders()` finds the holes); surfaces of extrusion and revolution, Bezier surfaces,
offset surfaces and curves as B-splines.

## Example
```python
export_brep([Box(10, 10, 10), Sphere(3).translate(20, 0, 0)], "two.brep")
a, b = import_brep("two.brep")
print(round(a.volume), round(b.volume, 2), b.faces()[0].geom_type)   # 1000 113.1 sphere
```

## Errors
- `check=True` (the default): the kernel checks each body before anything measures it. Gaps
  between its faces, edges and vertices of more than 1e-3 of its size raise `ValueError` that
  names them (`the shape is broken: the kernel finds a gap of ...`), smaller ones give a
  `RuntimeWarning` (it may not mesh or measure exactly).
- A file whose shape holds no faces (a wire, curves) raises `ValueError: import_brep: the file
  holds no solid, shell or face ...`; one that is no `.brep` file, or a broken one, a `ValueError`
  that says where (`shape 3 is made of shape 9, which is not written before it`).
- Wires, edges and vertices outside faces are not read: a `RuntimeWarning` says how many. Shapes
  the bridge cannot read are left out with a warning (`1 of the 3 solids, shells and faces in the
  file cannot be read and is left out`).

## Gotchas
- A body whose curves on faces lie far from its edges (OpenCASCADE's approximations of sweeps,
  a spring) can come back with gaps the check refuses; `check=False` reads it as it is, to look
  at, but it may not mesh or measure exactly.
- Read the result's `volume` against the tool that wrote it before you build on it.

## Related
`export_brep.md`, `import_step.md`, `generic.md`, `in_memory.md`, `save_load.md`
