# section

The cross-section of a part in a plane, as a `Sketch`.

## Signature
`part.section(plane=Plane.XY)`
`section(part, plane=Plane.XY)`

- `plane`: a `Plane` or a planar face (its plane). Default `Plane.XY`.

## Returns
A `Sketch` lying in the plane, with `sketch.plane` equal to the plane you passed (same origin,
normal and x direction). Holes come back as inner loops; separate pieces as separate faces
(`len(sketch.faces())`). `area` is exact (`Box(40, 30, 20) - Cylinder(8, 30)` at z 0:
998.938 = 40·30 − π·8²).

## Uses
- Measuring: wall thickness, material area at a height, checking a loft or sweep for twist
  (`loft.section(Plane.XY.offset(mid)).area`).
- Building: a section is a sketch, so it extrudes along the plane normal
  (`part.section(Plane.XY.offset(5)).extrude(3)` spans z 5..8).

## Gotchas
- A plane that misses the part: `ValueError: the plane does not cut the part`.
- A plane that only touches the part (tangent to the side of a cylinder, through an edge of a
  turned box, around the top of a torus): `ValueError: the plane only touches the part (along a
  line or a curve, or at a point), so the section has no area; move the plane into the part`.
- A plane lying on a face of the part returns that face's area.
- A part made by `merge`: the sections of the cells the plane cuts, a region per cell
  (`merge(Box(40, 40, 20), Cylinder(6, 30)).section(Plane.XY)`: 2 faces, the block's 1486.903
  around the insert's 113.097). A face between two cells that lies in the plane comes once.
- The section's edges are B-splines, also where the part has arcs (a rounded box gives
  `geom_type == "bspline"` edges): `edges().circles()` finds nothing on a section.
- The kernel can fail on a plane that passes exactly through a vertex or the end of a sweep, or
  that is tangent to a face inside the part (along the wall of a hole): `KernelError: section
  failed (SM_ERR): the kernel could not make faces of the curves where the plane meets the part;
  ...`; shift the plane slightly.

## Example
```python
part = Box(40, 30, 20) - Cylinder(8, 30)
cut = part.section(Plane.XY)                            # a Sketch on Plane.XY
print(round(cut.area, 3))                               # 998.938 = 40*30 - pi*8^2
side = part.section(Plane.XZ)                           # two pieces left and right of the hole
print(len(side.faces()), round(side.area, 1))           # 2 480.0
slab = part.section(Plane.XY.offset(5)).extrude(3)      # sections are sketches: z 5..8
print(slab.bbox().min.z, slab.bbox().max.z)
try:
    part.section(Plane.XY.offset(50))
except ValueError as e:
    print(e)                                            # the plane does not cut the part
```

## Related
`slices` (sections a step apart), `Mesh.section` (`Mesh-section`), `split` (keep a side as a
solid), `Part.outline`, `Part.silhouette`, `extrude`.
