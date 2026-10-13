# surface

A freeform NURBS face through (or controlled by) a grid of points, or fitted to a cloud of
points such as a scan. Returns a `Shell` with one face.

## Signature
`surface(points, *, interpolate=True, controls=None, smoothing=1e-3)`

- `points`: a grid: rows of 3D points, `points[i][j]`, all rows the same length (lists of
  tuples, `Vector`s or a numpy array of shape (rows, cols, 3); 2D points `(x, y)` get z = 0).
  Or a cloud: points in any order, a list of points or an `(n, 3)` array (see "A cloud of
  points" below).
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
- **Do not thicken closed grid surfaces or surfaces with a pole.** A dome raises; a closed
  tube mostly raises (`ModelingError` or `KernelError`), but some tubes (8 or 12 points per
  ring) still return a Part of volume about 0 that `is_valid()` accepts. For exact closed
  shapes use `revolve`, `loft` or `extrude` of curves, or build two open halves.

## A cloud of points
A flat list of points (or an `(n, 3)` array) is a cloud: the surface approximates the points
(least squares), it does not pass through them.

- `controls`: control points per direction, a number or `(along, across)`, 4 to 64; "along" is
  the longer side of the cloud. Default: about one per 8 points (16 to 1024 in all), shaped like
  the cloud. More follow finer detail, and noise.
- `smoothing`: 0 to 1, default 1e-3: how much the surface resists bending, against how close it
  comes to the points.
- The surface spans the smallest rectangle around the points in their best-fit plane. Where
  there are no points (holes in a scan, the corners of a round cloud), the smoothing shapes it.
- Its normal points up (+Z). A cloud that stands upright: to +Y, else to +X. `thicken(t)` adds
  material along it.
- The cloud must be a **height field over its best-fit plane**: no overhangs, nothing folded
  over. A hemisphere seen from the side or a tube gives a surface that misses the points by
  millimetres, without an error: check `max(s.distance_to(p) for p in points)`.
- Fast: 2000 points 5 ms, 20000 points 50 ms. Smooth shapes come close: a bump of 2000 points
  within 0.001 mm, 20000 points within 3e-5 mm.
- Noisy points (a scan): the surface should stay about as far from the points as the noise
  (on average). Coming much closer means it follows the noise: take fewer control points
  (`controls=12`) or more smoothing (0.1 to 1). With noise of 0.1 mm on 3000 points, the
  default came to 0.027 mm of the true shape on average, `controls=12` to 0.014 and
  `smoothing=1` to 0.015. Too few control points (8) with `smoothing=1` flattens the shape
  (0.07 mm, 0.6 mm at most).

## Gotchas
- At least **4 x 4 points** (bicubic), in both modes. For a four-sided bilinear patch use
  `ruled` between two lines.
- NaN and inf coordinates raise `ValueError`. Otherwise no checks beyond the grid shape: two
  equal rows make the surface overshoot wildly (area 11289 instead of 1621); folded rows give
  a self-overlapping face. Both without an error.
- The interpolating surface can bulge past the points between them; the bbox is that of the
  surface, not of the points.

## Errors
- `ValueError: surface needs a grid of at least 4 x 4 points (bicubic), got 3x3; for a
  four-sided patch use ruled() between two lines`: fewer than 4 points in a direction.
- `ValueError: surface: the points must be finite numbers`: a NaN or inf coordinate.
- `ValueError: setting an array element with a sequence ... inhomogeneous shape`: rows of
  different length.
- `TypeError: 'int' object is not iterable`: a flat list of numbers instead of points.
- `ValueError: surface needs at least 4 points to fit, got 3`, `ValueError: fit_surface: the
  points lie on a line (or a point): they span no surface`: a cloud that spans no surface.
- `ValueError: surface: controls must be 4 to 64 per direction, got 3`; `ValueError: surface:
  smoothing must be 0 to 1, got 2`; `ValueError: surface: controls are for clouds of points; a
  grid sets its own`.

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

# a cloud of points: 2000 points of a bump in any order, as from a scanner
rng = np.random.default_rng(1)
xy = rng.uniform(-30, 30, (2000, 2))
cloud = np.column_stack([xy, 6 * np.exp(-(xy ** 2).sum(axis=1) / 300)])
skin = surface(cloud)                                # fitted, not through the points
print(max(skin.distance_to(p) for p in cloud) < 0.001)               # True
print(round(skin.faces()[0].normal_at((0, 0, 6)).z, 3))               # 1.0: the normal points up
noisy = cloud + rng.normal(0, 0.1, cloud.shape) * [0, 0, 1]          # noise of 0.1 mm
smooth = surface(noisy, controls=12)                 # fewer control points: the shape, not the noise
print(round(np.mean([smooth.distance_to(p) for p in noisy]), 2))     # about the noise: 0.08
```

## Related
`ruled`, `loft` (surface through curves), `surface_fillet`, `Shell`, `Shell.thicken`, `stitch`,
`generic`
