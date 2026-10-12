# surface

A freeform NURBS face through (or controlled by) a grid of points. Returns a `Shell` with one face.

## Signature
`surface(points, *, interpolate=True)`

- `points`: rows of 3D points, `points[i][j]`. All rows the same length. Lists of tuples,
  `Vector`s or a numpy array of shape (rows, cols, 3). 2D points `(x, y)` get z = 0.
- `interpolate=True`: the surface passes through every point (distance < 1e-10).
- `interpolate=False`: the points are control points. Only the four corners lie on the
  surface; the rest is pulled towards the points but stays away from them (0.3 to 1 mm on a
  ±5 mm bump with 10 mm spacing). It is a smoothing, not a fit.

## Returns
A `Shell`: 1 face of type `"bspline"`, always bicubic (degree 3 x 3), 4 edges and 4 vertices
(the corner points). Rows are the u direction, columns the v direction.

## Normal direction
normal = (direction from one row to the next) × (direction along a row).

- `[[(x, y, z) for x in xs] for y in ys]` (rows along x, stacked in y): normal points **down** (−Z).
- `[[(x, y, z) for y in ys] for x in xs]` (rows along y, stacked in x): normal points **up** (+Z).
- Reversing the row order or transposing the grid flips the normal.

`thicken(t)` adds material along the normal for t > 0, so pick the grid order on purpose, or
check `face.normal_at(point)` before thickening.

## Accuracy
Interpolation error between the points falls fast with density. For a ±8 mm sine bump over
60 x 40 mm: 4x4 points 0.93 mm, 6x6 0.06 mm, 10x10 0.002 mm, 20x20 0.0002 mm. Control mode:
4.2, 1.3, 0.39, 0.09 mm. Uneven spacing is fine (chord-length parameters). A 100 x 100 grid
takes 0.02 s.

## Closed directions and poles
- Rows that are closed rings (first point == last point) give a closed tube: 1 face, 2 edges,
  1 seam edge (`edges(seams=True)`). A grid closed both ways gives a torus with 0 edges.
- The closed direction is **not smooth** at the seam: the normals on both sides differ by
  6.6° with 8 segments per ring, 2.5° with 12, 0.34° with 24, 0.03° with 48. Control mode with
  12 segments: 30°.
- A row of identical points (a pole) works: rings shrinking to a point give a dome.
- **Do not thicken closed grid surfaces or surfaces with a pole.** A closed tube thickens to a
  volume-0 Part that `is_valid()` accepts (or fails at random); a dome thickens to volume 0.
  For exact closed shapes use `revolve`, `loft` or `extrude` of curves, or build two open halves.

## Gotchas
- At least **4 x 4 points**. 2x2, 3x3 and 4x3 raise `KernelError: surface failed (SM_ERR)`
  (`SM_ERR_INVALID_INPUT` with `interpolate=False`), although the docstring says 2 x 2. For a
  four-sided bilinear patch use `ruled` between two lines.
- No input checks beyond the grid shape. Two equal rows make the surface overshoot wildly
  (area 11289 instead of 1621); a NaN gives an empty face (area 0); folded rows give a
  self-overlapping face. All without an error.
- The interpolating surface can bulge past the points between them; the bbox is that of the
  surface, not of the points.

## Errors
- `KernelError: surface failed (SM_ERR)`: fewer than 4 points in a direction.
- `ValueError: expected a grid of at least 2 x 2 points`: not a grid (1 row, 1 column).
- `ValueError: setting an array element with a sequence ... inhomogeneous shape`: rows of
  different length.
- `TypeError: 'int' object is not iterable`: a flat list of points instead of rows.

## Example
```python
import math

# rows run along x, points in a row along y: normal = x × y = +Z (up)
grid = [[(x, y, 4 * math.sin(math.pi * x / 80) * math.cos(math.pi * y / 120))
         for y in np.linspace(-30, 30, 7)]
        for x in np.linspace(0, 80, 9)]
panel = surface(grid)
print(panel.faces()[0].normal_at((40, 0, 4)))      # (0, 0, 1)
solid = panel.thicken(2)                           # 2 mm along the normal: upward
print(solid.is_valid(), solid.volume > 0, solid.bbox().min.z, solid.bbox().max.z)  # True True 0.0 6.0
```

## Related
`ruled`, `loft` (surface through curves), `Shell`, `Shell.thicken`, `stitch`, `generic`
