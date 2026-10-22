# Lattice

Free-form deformation: a grid of control points around a part; move the points, apply the
lattice, and the part follows smoothly. The result is exact NURBS.

## Signature
`Lattice(box, counts=3, *, margin=0.0)`; `lat.apply(shape, *, tolerance=None)` or
`part.deform(lat)`

- `box`: a `BoundBox` or a shape (its bounding box). `margin` grows it on every side; flat
  shapes need one (`ValueError: ... give a margin for flat shapes`).
- `counts`: points per direction, one int or three (X, Y, Z), 2 to 12. 2 = corners only (a
  trilinear map), 3 = corners and midpoints (default), more = finer control.
- `lat.points`: writable numpy array `(nx, ny, nz, 3)` of world positions, `[i, j, k]` along
  X, Y, Z, starting evenly on the box. `lat.rest` (start positions, read-only),
  `lat.offsets` (points - rest), `lat.counts`, `lat.box`.
- Editing, **in place**, each returns the lattice: `move(index, offset)`,
  `scale(index, factor, center=None)` (about the selection's centroid; factor one number or
  (fx, fy, fz)), `rotate(index, axis, angle)`, `reset()`; `copy()` for an independent one.
- `index`: three indices with ints and slices, `(1, 1, -1)`, `(slice(None), 0, 2)`, or
  `lat.layer(axis, i)` = the i-th layer across `X`, `Y` or `Z` (`lat.layer(Z, -1)` = top).
- `lat.map(point)`: where a point moves.

## Returns
A `Part` (`Shell` for a shell or sketch) with the same faces; the map is a Bezier volume
(Bernstein polynomials of degree count - 1), so every face is its **exact** image. Degrees
measured: box faces up to (counts - 1) per direction ((2, 2) in a 3 x 3 x 3 lattice); with
the top layer of a 3 x 3 x 3 lattice scaled, a cylinder side (4, 2) and a sphere (6, 6);
one point of a 3 x 3 x 3 lattice moved, a sphere (12, 12) with 1225 poles. A face needing
more than degree 12 (`MAX_DEGREE`), such as a sphere with one point of a 4 x 4 x 4
lattice moved, is fitted within `tolerance` instead (quintic, 2925 poles). An unmoved
lattice changes nothing, and faces the lattice leaves in place (the bottom of a block when
only the top layer moves, the sides when only the middle of the top does) keep their type:
the pillow below has 5 planes and a B-spline top.

## How points act
A point pulls the region around it, weighted by Bernstein polynomials: moving the middle
point of the top layer of a 3 x 3 x 3 lattice by 8 lifts the middle of the top face by
8 * 1/2 * 1/2 = 2 (`lat.map((0, 0, 10))` -> `(0, 0, 12)`); corners move fully. Move whole
layers for global changes (bulge, taper, twist a layer), single points for local ones; more
points give more local control.

## Gotchas
- `scale` of a single point does nothing (it scales about its own centroid); scale a layer.
- The editing methods change the lattice; `lat.copy()` before trying variants.
- Moving a point past its neighbours folds space: refused with `ModelingError: lattice:
  the lattice folds the part onto itself near (x, y, z) ...`.
- Space outside the box follows the same polynomial (no clamping): keep the part inside.
- Higher counts raise the degree of the exact faces; curved parts in big lattices get large
  control nets. Use the fewest points that give the shape.

## Errors
- `ValueError: Lattice: counts must be 2 to 12 points per direction (one int or three)`.
- `IndexError: Lattice: select points with three indices (i, j, k) ...`;
  `IndexError: Lattice.layer: index 3 is out of range for 3 layers`.

## Example
```python
block = Box(60, 40, 20)
lat = Lattice(block, 3)                              # 3 x 3 x 3 points on the block's bounding box
lat.move((1, 1, -1), (0, 0, 8))                      # lift the middle of the top layer
pillow = lat.apply(block)
print(pillow.is_valid(), round(pillow.volume, 3))
print(lat.map((0, 0, 10)))                           # the middle of the top moves 8 * 1/2 * 1/2

lat = Lattice(block, 4)
lat.move(lat.layer(Z, -1), (0, 0, 5))                # the whole top layer up
lat.scale(lat.layer(Z, -1), 1.3)                     # and wider (about its centroid)
lat.rotate(lat.layer(Z, -1), Z, 15)                  # and turned
lat.points[0, :, :, 0] -= 4                          # numpy works too: the -X layer out by 4
print(lat.apply(block).bbox())

grip = Cylinder(14, 100).rotate(Y, 90)
gl = Lattice(grip, (5, 3, 3))
gl.scale(gl.layer(X, 2), (1, 1.25, 1.25))            # thicker in the middle
handle = grip.deform(gl)                             # same as gl.apply(grip)
print(handle.bbox())
```
prints `True 50133.333`, `Vector(0, 0, 12)`, a box x -48.40..44.40, y ±35.21, z -10..15, and
y, z ±15.31.

## Related
`deform/generic`, `taper` (a 2 x 2 x 2 lattice with a scaled end), `twist`, `bend`;
`surface` for free-form faces drawn from points.
