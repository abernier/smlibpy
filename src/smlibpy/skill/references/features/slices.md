# slices

Sections of a part or a mesh across an axis, a step apart: the contours of a printer's layers,
the profile of a scan every few millimeters.

## Signatures
`part.slices(step, axis=Z) -> list[Sketch]`
`mesh.slices(step, axis=Z) -> list[ShapeList[Wire]]`

- `step`: the layer thickness, positive (`ValueError` otherwise).
- `axis`: an `Axis` or a direction; the planes are perpendicular to it.

## Levels
The body is cut into layers of thickness `step` from its lowest point along the axis up, and
each layer is cut in its middle: at `step / 2`, `3 * step / 2`, ... above the lowest point,
while below the top. A part 20 high with `step=5`: 4 sections at 2.5, 7.5, 12.5 and 17.5 above
its bottom. A last layer thinner than half a step gets none. Layers whose plane misses the body
(the gap between two bodies) are left out, so check the level of each:

- A part's sections are `Sketch`es (as `section` gives them, exact); `sketch.plane.origin` is
  on its plane.
- A mesh's are the wires of `Mesh.section` (closed loops for a closed mesh), each list for one
  level, all on its plane.

## Example
```python
part = Box(40, 30, 20) - Cylinder(6, 40)
layers = part.slices(5)
print([round(s.plane.origin.z, 1) for s in layers])        # [-7.5, -2.5, 2.5, 7.5]
print(round(layers[0].area, 3))                            # 1086.903 = 40*30 - pi*6^2
across = part.slices(7, X)                                 # x -16.5 ... 18.5
print([round(s.area, 1) for s in across])                  # [600.0, 600.0, 381.8, 441.3, 600.0, 600.0]
contours = part.mesh(0.01).slices(5)                       # the same for a mesh: loops of wires
print([len(c) for c in contours])                          # [2, 2, 2, 2]: outline and bore
```

## Related
`features/section`, `Mesh-section`, `Mesh`.
