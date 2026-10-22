# nurbs_surface

A surface from its NURBS data: control points, knot vectors, degrees and weights, as other
programs, files, papers or numpy code give them. Also rational surfaces, degrees other than 3,
knots that are not uniform. The inverse of `Face.nurbs()`.

## Signature
`nurbs_surface(points, knots=None, degrees=None, weights=None)`

- `points`: the control points in rows: `points[i][j]` is the point `i` along u and `j` along v
  (lists of tuples, `Vector`s or an array of shape (nu, nv, 3); 2D points get z = 0). All rows the
  same length, at least `degree + 1` each way. Or a `NurbsSurface` (what `Face.nurbs()` returns:
  `degrees`, `knots`, `points`, `weights`) with nothing else given.
- `knots`: `(u_knots, v_knots)`, every knot as often as its multiplicity: `nu + u_degree + 1`
  and `nv + v_degree + 1` knots, not decreasing. The ends need not repeat: the surface spans
  `knots[degree]` to `knots[-degree - 1]` each way, and where the ends do not repeat it starts
  inside the control net (a uniform cubic at (P0 + 4 P1 + P2) / 6). Inner knots repeat at most
  `degree` times. Default: uniform and clamped, so the surface starts at the net's corners (one
  Bezier patch for 4 x 4 points of degree 3).
- `degrees`: `(u, v)` or one number for both, 1 to 32. Default: from the knots
  (`len(knots) - n - 1`), else 3 (less for fewer than 4 points).
- `weights`: a positive weight per control point, in the same rows; `None`: non-rational.

## Returns
A `Shell` of one face over the whole surface, of type `"bspline"`, its normal along
du x dv (rows to the next row x along a row, as `surface`). The surface keeps the data exactly
(control points, knots and weights read back as given; unclamped knot vectors are clamped first,
the same surface).

## Errors
- `ValueError: nurbs_surface: 4 control points of degree 3 along u need 8 knots (control points +
  degree + 1), got 7`.
- `ValueError: nurbs_surface: the u knots must be finite and not decrease`.
- `ValueError: nurbs_surface: an inner u knot repeats more often than the degree (the surface
  would come apart there)`.
- `ValueError: nurbs_surface: the weights must be positive numbers`; `... weights are rows like
  the control points (4 x 4), got 3x4`.
- `ValueError: nurbs_surface: the u degree must be 1 to 32, got 0`; `... degree 4 needs at least
  5 control points along u, got 4`.
- `ValueError: nurbs_surface: the control points are rows of points (at least 2 x 2), all rows the
  same length`.

## Example
```python
# a rational biquadratic patch: the middle weight 0.5 pulls the middle less
net = [[(0, 0, 0), (0, 10, 0), (0, 20, 0)],
       [(10, 0, 5), (10, 10, 8), (10, 20, 5)],
       [(20, 0, 0), (20, 10, 0), (20, 20, 0)]]
dome = nurbs_surface(net, degrees=2, weights=[[1, 1, 1], [1, 0.5, 1], [1, 1, 1]])
print(round(dome.bbox().max.z, 6))                     # 2.571429 = 18/7 at the middle

# the data of a face, and back
sheet = surface([[(x, y, math.sin(x / 10)) for y in range(0, 25, 5)] for x in range(0, 35, 5)])
d = ext.surface_data(sheet.faces()[0]._f.surface(), True)    # or sheet.faces()[0].nurbs()
nv = len(d["v_knots"]) - d["v_degree"] - 1
rows = [d["poles"][i:i + nv] for i in range(0, len(d["poles"]), nv)]
again = nurbs_surface(rows, (d["u_knots"], d["v_knots"]), (d["u_degree"], d["v_degree"]))
print(abs(again.area - sheet.area) < 1e-9)             # True
```

## Related
`surface` (through points, or fitted to a cloud), `Face.nurbs`, `Edge.nurbs`, `Bezier`, `loft`,
`network`, `generic`
