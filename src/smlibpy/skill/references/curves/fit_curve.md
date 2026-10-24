# fit_curve

A smooth curve near many points, with as few control points as keep it within a tolerance of
every point: scanned or digitized outlines, sampled curves, long polylines. `Spline` passes
through every point instead, follows every wiggle and needs a control point per point.

## Signature
`fit_curve(points, *, tolerance=None, degree=3, tangents=None, closed=False) -> Edge`

- `points`: in order along the curve: a list of points or an (n, 2) / (n, 3) numpy array (2D
  points at z = 0). Consecutive duplicates are dropped.
- `tolerance`: the largest distance from any point to the curve. Default: 1/1000 of the size
  (bounding box diagonal) of the points.
- `degree`: the highest degree, 2 to 9; the fit starts at 2 and raises it as it needs.
- `tangents`: `(start, end)` directions, either may be None. Or a direction at **every** point
  (as many as there are points, none None): the curve leaves each point near that direction, as
  `Spline(*points, tangents=[...])` through them does, simplified within the tolerance (a cubic;
  the closer the tolerance, the closer the directions too). Not with `closed`.
- `closed=True`: the curve runs back through the first point, tangent there (do not repeat the
  first point; repeating it is harmless).

## Returns
A non-rational `bspline` edge through the first and the last point, within `tolerance` of every
point (measured; the kernel's fit is made again with less where it is off).
- 600 points of a sine with noise 0.01, tolerance 0.05: 32 control points (`Spline`: 602).
- 200 points, tolerance 0.01: 21 control points, largest distance 0.0071.
- Fewer than about 6 points: the curve through them (`Spline`).

## Errors
- `ModelingError: fit_curve: the closest fit found passes 0.012 from a point, more than the
  tolerance 0.01; use a larger tolerance or a higher degree`.
- `ValueError: fit_curve: the degree is 2 to 9, got 1`; `ValueError: fit_curve: a closed curve
  takes no end tangents, nor a direction at every point`; `ValueError: fit_curve: the points all
  coincide`.
- `ValueError: fit_curve: tangents are (start, end), or a direction at each of the 400 points, got 3`;
  `ValueError: fit_curve: with a direction at every point, tangent 2 is None`.

## Example
```python
import numpy as np
xs = np.linspace(0, 60, 600)
scan = np.c_[xs, 8 * np.sin(xs / 9) + np.random.default_rng(7).normal(0, 0.01, xs.size)]
profile = fit_curve(scan, tolerance=0.05)          # 32 control points
print(max(profile.distance_to(tuple(p)) for p in scan))   # 0.043
angles = np.linspace(0, 2 * np.pi, 120, endpoint=False)               # a scanned closed outline
outline_points = np.c_[20 * np.cos(angles), 12 * np.sin(angles)]
blob = make_face(fit_curve(outline_points, tolerance=0.02, closed=True)).extrude(3)
# through every point, in a given direction at each: Spline with one tangent per point
s = Spline((0, 0), (10, 0), (20, 10), tangents=[(1, 0), (1, 1), (0, 1)])
# near 400 points with a direction at each (a digitized path with headings): 36 control points
ts = np.linspace(0, 4 * np.pi, 400)
path = fit_curve(np.c_[5 * ts, 10 * np.sin(ts)], tolerance=0.05, tangents=np.c_[np.full(400, 5.0), 10 * np.cos(ts)])
print(len(path.nurbs().points))                    # 36
```

## Related
`Spline` (through every point), `surfaces/surface` (the same for surfaces), `remove_knots`.
