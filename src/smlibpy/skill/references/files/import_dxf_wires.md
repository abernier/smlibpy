# import_dxf_wires

Reads every chain of curves of a DXF drawing as a `Wire`, open or closed: sweep paths,
construction lines, outlines that do not close, or the pieces of a drawing that branches.

## Signature
`import_dxf_wires(path, *, layers=None, unit=None, tolerance=None)`

The parameters are those of `import_dxf`: the same entities are read, the same units and the
same tolerance join the ends.

## Returns
A `ShapeList` of `Wire`s: the closed chains first, then the open ones, each in drawing order.
A chain stops where it ends, and where three or more curve ends meet:
- a square with one line leaving a corner: `[Wire(4 edges, closed, length=40), Wire(1 edges, open, length=14.1421)]`;
- a square with a 0.02 gap: `[Wire(4 edges, open, length=39.98)]`.

The edges keep their exact types (`line`, `circle`, `ellipse`, `bspline`) and are turned so that
each wire runs head to tail.

## Uses
- Paths: `sweep(Circle(2), import_dxf_wires("path.dxf")[0])`.
- Finding out why `import_dxf` refuses a drawing: the open wires show where the gaps are
  (`w.start`, `w.end`).
- Outlines you want to fix or combine yourself: `make_face(w.close())`.

## Gotchas
- Wires carry no layer; read one layer at a time with `layers=` when it matters.
- A full circle, ellipse or closed spline is a closed wire of one edge.

## Example
```python
path = Polyline((0, 0), (40, 0), (40, 30))
export_dxf(path, "path.dxf")
[w] = import_dxf_wires("path.dxf")
print(w, w.is_closed)                  # Wire(2 edges, open, length=70) False
tube = sweep(Circle(2).on(Plane.YZ), w)
print(tube.is_valid())                 # True
```

## Related
`import_dxf`, `export_dxf`, `Wire`, `make_face`, `sweep` (features).
