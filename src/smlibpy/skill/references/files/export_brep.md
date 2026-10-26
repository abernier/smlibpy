# export_brep

Writes parts, sheets and faces to an OpenCASCADE `.brep` file: the exact B-rep format of
OpenCASCADE and of the tools built on it, build123d, CadQuery and FreeCAD's Part workbench. For
handing a part to those tools without the detour through STEP. Written with the bridge of NVIDIA's
usd-brep, compiled into smlibpy (no OpenCASCADE needed).

## Signature
`export_brep(shapes, path)`
`to_brep(shapes)` gives the text instead of writing a file.

- `shapes`: a `Part`, `Shell`, `Sketch`, `Face`, or a list of them.
- `path`: the file; it is written as ASCII, as OpenCASCADE's `BRepTools::Write` writes it.

`export(shapes, "part.brep")` and `shape.export("part.brep")` do the same.

## What is written
- One shape: the solid of a single part (a hollow part with its cavities, each a shell of its
  own), the shell of a single sheet, or a compound of the bodies of a list (a part of several
  solids gives one solid each; a sheet whose faces share no edge, a shell per connected set).
- Faces on their exact surfaces: planes, cylinders, cones, spheres, tori and B-splines; surfaces
  of revolution and extrusion as the B-splines they are in the kernel.
- Edges on their exact curves (lines, circles, ellipses, B-splines), and on each face the curve of
  the edge in the face's parameters (OpenCASCADE needs them on every face that is no plane): made
  from the exact geometry, seams of closed faces twice, poles of spheres as degenerate edges.
- Vertices shared by all their edges, as OpenCASCADE's check requires.

## Example
```python
part = (Box(60, 40, 8) - Cylinder(4, 10)).fillet(Box(60, 40, 8).edges().parallel_to(Z), 5)
export_brep(part, "plate.brep")
again = import_brep("plate.brep")
print(abs(again.volume - part.volume) < 1e-6 * part.volume)   # True
```
In build123d: `import_brep("plate.brep")`; in CadQuery: `cq.importers.importBrep("plate.brep")`;
in FreeCAD: `Part.read("plate.brep")`.

## Gotchas
- **No names, colors or units.** The format has none: OpenCASCADE tools model in millimeters, as
  smlibpy does. Write STEP (`export_step`) to keep names and colors.
- A body the bridge cannot convert raises `KernelError` that names the face: an edge that lies
  farther from its face than 1e-3 of the body's size, a face whose boundary does not close (2 of
  585 bodies of foreign STEP files). Write those as STEP.
- A face that runs through itself is written as it is; OpenCASCADE's check takes it for invalid,
  as `is_valid()` would.
- A `Mesh` raises `TypeError` (write `export_stl`), so do edges, wires and points; an empty part
  (a Boolean that left nothing) raises `ValueError: export_brep: the Part has no faces to write`.
- Binary `.brep` (`BinTools::Write`) is read (`import_brep`) but not written.

## Related
`import_brep.md`, `export_step.md`, `generic.md`, `in_memory.md`
