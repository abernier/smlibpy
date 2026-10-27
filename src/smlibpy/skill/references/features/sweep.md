# sweep

Moves a profile along a path to make a solid (tubes, rails, springs, frames). An open profile
makes a surface (`Shell`).

## Signature
`sweep(profile, path, *, orient=True, translational=False, sharp_corners=None, up=None, twist=0.0, scale=None, anchor="center", rails=None)`
`sketch.sweep(path, *, orient=True, translational=False, sharp_corners=None, up=None, twist=0.0, scale=None, anchor="center")` (no `rails`: a sketch is a closed profile)

- `profile`: a sketch (holes allowed), a planar face or a closed wire. Draw it anywhere,
  usually at the origin in XY.
- `path`: an `Edge` or a connected `Wire` (`Polyline`, `FilletPolyline`, `Wire([...])`). Edges
  that meet tangentially are swept in one go. A closed path that does not lie in a plane
  (`Spline(..., closed=True)`) is swept in one go and closed where its ends meet; a planar
  closed single-edge path (the edge of an `Ellipse`, a closed planar spline) is split into two
  halves. A full circle is swept as a revolve (one torus face, see Gotchas).
- `orient=True`: turn the profile to stand perpendicular to the path at its start. Leave it on.
- `translational=True`: keep the profile's orientation fixed (it does not turn with the path).
  The profile then cuts the path at a slant; on an arc the volume is area × rise, not area ×
  length. Useless on helices.
- `sharp_corners`: for paths of several edges. Default: mitered corners for planar paths
  (where the kernel cannot miter them, such as arcs meeting at a corner, the path goes piece by
  piece with a `RuntimeWarning`; not with `up`/`twist`, see below). `False` sweeps the path piece
  by piece (each run of tangent edges in one go) and fuses the pieces (notched corners). `True` on
  a 3D path raises.
- `up`: an `Axis` or a direction the profile keeps its attitude to: along the whole path it stays
  at the angle it starts at to `up` made perpendicular to the path (also after corners). `"frenet"`:
  to the path's principal normal (towards the center of curvature). Default: a helix's axis on
  helical paths (also conical ones and chains of helices), the smallest turn on other paths.
- `twist`: degrees the profile turns about the path on top of that, spread evenly along its
  length, or a function of the fraction `s` of the length (0 to 1) giving the angle in degrees
  there (`twist=lambda s: 90 * s * s`; the profile starts turned by `twist(0)`).
- `scale`: the profile's scale along the path, about the point that sits on the path (the center
  of its box): `(start, end)` changes evenly along the length; `[(t, s), ...]` passes through the
  scales `s` at the fractions `t` of the length, from `t=0` to `t=1` (a piecewise cubic that does
  not overshoot them); a function of the fraction gives it. Positive everywhere; along a closed
  path the same at both ends. A planar path of several edges is then swept piece by piece
  (`sharp_corners=True` raises). The law holds along the length also where the path's parameter
  runs unevenly (a spline through unevenly spaced points: radius within 2e-6, read at 65
  points).
- `anchor`: the point of the profile that goes on the path (and that `scale` scales about):
  `"center"` (default: the center of its box), `"origin"` (the origin of the sketch's plane: (0, 0)
  of a `Polygon` or `Profile` drawn on XY; a centered shape such as `Circle` or `Rectangle` moves
  its plane with it, so its origin is its middle; a face, wire or edge: (0, 0, 0)), or a point
  (a tuple or a `Vertex`) of the profile's plane (`ValueError` off it).
- `rails`: a second rail (an edge or a wire) for an **open** profile that runs from the path to
  the rail; see "Two rails" below.

## Placement
- The **center of the profile's box** goes to the start of the path, wherever the profile was
  drawn: its box along the axes of its plane (for a sketch in XY, `sketch.bbox().center`), also
  on oblique and helical paths, and on planar paths with mitered corners (with splines among the
  edges too). `anchor=` puts another point there: `anchor="origin"` for a `Polygon` drawn from
  (0, 0), `anchor=(x, y)` for any point of the profile's plane (an L-section by its corner, a lip
  by its edge).
- The profile is turned by the smallest rotation from its normal to the path tangent. For a
  path along Z it is unchanged. For a path along X, sketch x becomes Z; along Y, sketch y
  becomes Z. Check with `bbox()`.
- Along a path of several edges the profile keeps its orientation from piece to piece: tangent
  edges (a `FilletPolyline` in 3D) are one sweep, and at a corner it turns by the smallest
  rotation from one tangent to the next (`Rectangle(4, 2)` along
  `FilletPolyline((0, 0, 0), (0, 0, 40), (40, 0, 40), (40, 40, 40), radius=8)` ends 2 wide in x
  and 4 high, as it is carried along). Where the
  kernel cannot sweep an open path's joined edges in one go (some circles and ellipses along 3D
  `FilletPolyline`s), each edge is swept on its own, turned to its own start, and the pieces are
  fused: a profile that is not round then turns where the edges meet, and a `RuntimeWarning`
  says so.
- On a `Helix` around Z starting at (r, 0, 0) the sketch x axis points radially at the start,
  and stays radial along the whole helix.

## Attitude along the path
- The profile turns about the path as little as it can (the kernel's rotation-minimizing frame:
  on a planar path it keeps its attitude to the plane), except along helices: there it keeps its
  attitude to the helix's axis, as a thread tooth or a flat spring wire does. A `Rectangle(2, 1)`
  along `Helix(pitch=5, height=30, radius=10)` measures 2 x 1.004 at every section (the band cut
  at its slope).
- `up=Z` keeps a rail upright along a 3D spline; the path must never run along `up`
  (`ValueError: sweep: the path runs along up= at (...)`): a path that starts along Z needs
  another `up`.
- `up="frenet"` follows the curvature: on a straight piece it raises (`ValueError: sweep: the
  path runs straight at (...)`), and where the path nearly straightens, so that the profile would
  spin about it (half a turn within a ten-thousandth of the path), it raises too (`ValueError:
  sweep: the profile would spin about the path at (...): it turns by 52 degrees within 0.00409 of
  it (the path nearly straightens there, ...)`). Pick `up=` a direction there.
- Round a closed path with corners that does not lie in a plane, the profile carried by the
  smallest turns comes back turned about the path; that turn is spread evenly along the length,
  so the profile meets itself where the loop closes (round `Polyline((0, 0, 0), (40, 0, 0),
  (40, 30, 25), (10, 40, -10), close=True)`, for one).
- `twist` works on any path, on top of the default frame (on a helix: of its axis): a twisted bar
  `sweep(Rectangle(10, 2), Line((0, 0, 0), (0, 0, 100)), twist=180)` (volume 2000), a twisted
  ribbon from an open line profile (a helicoid). Along a closed path the profile must come round
  into itself: `twist=90` with a square works, with a 4 x 2 rectangle it raises (`ValueError: ...
  must come round into itself`).
- With `up` or `twist` a planar path of several edges is swept piece by piece (mitered corners
  keep the kernel's frame; `sharp_corners=True` raises), and `translational=True` or
  `orient=False` raise.

## Two rails
`sweep(profile, path, rails=rail)` with an open profile (an edge or a wire) that runs from the
path to the rail: the profile is moved, turned and scaled (the same in every direction) so that its
ends stay on both, and the surface (a `Shell`, one face) passes through both rails (1.6e-7 off
the farther one in the example below). Its frame turns with the line from the path to the rail
and with the rails' mean direction; the rails are matched by the fraction of their lengths, from
where the profile meets them to their ends. Not with `orient`, `translational`,
`sharp_corners`, `up`, `twist`, `scale` or `anchor` (`ValueError`); a closed profile along two
rails is not supported (`ValueError`). For surfaces through several profiles along rails use
`loft(sections, rails=...)`.

## Gotchas
- Long helices: `Helix` takes any number of turns, and sweeps along them go (default frame: 400
  turns tested; with the kernel's own frame, `orient=False`, a long helix is swept in 2, 4 or 8
  pieces: it failed beyond some 60 turns, and its surface is approximate, 4e-4 of the volume at 70
  and 100 turns). A
  chain of helices (`Wire([Helix(1, 30, 5), Helix(1, 30, 5, center=(0, 0, 30))])`) sweeps with
  any profile too.
- A loop closed with a kink (`Spline(*pts, pts[0])`, not `closed=True`) is swept in two halves
  fused where its ends cross (a notch outside, the overlap inside: area × length less a few
  tenths of a percent). Where that fuse fails, it is swept in pieces, and a round
  profile with its seam turned (the same body); for a few loops all fail (`KernelError`). Faces
  without area that such a fuse leaves are taken out, or the sweep raises `ModelingError` ("faces
  that enclose no area"). A smoothly closed spline (`closed=True`) has no kink.
- Mitered corners work on planar paths in any plane (the frame below in the YZ plane, or turned
  into an oblique one: 1920.0 each).
- A path that is a single `Line` is swept as an extrusion, a single arc or circle (with `orient`)
  as a revolve: planes, cylinders, cones and tori (`Circle(2)` along a line: a cylinder, radius
  2). A profile that reaches across the arc's axis raises
  `ModelingError: sweep: the profile reaches across the axis of the arc (radius 10), so it would
  sweep through itself`.
- Self-intersection is checked only along a single arc: a profile bigger than the bend radius of
  another path, or a spring wire thicker than the pitch, returns `is_valid() == True` with a volume
  of area × length (too large). Keep profile radius < bend radius and wire diameter < pitch.
  Inside-out and volume-less results raise `ModelingError`.
- Non-planar polylines are swept piece by piece: the corners are notched (3D path of three
  40 mm legs: 3320.9 instead of 3392.9). Round the corners with `FilletPolyline` instead.
- A `Wire` whose edges do not connect raises `ValueError: the sweep path is not connected: a
  gap of 1 between Edge(...) and Edge(...)`.
- `orient=False` with a path that is not along the profile normal raises
  `ModelingError: sweep: the kernel returned a body that is without volume; the profile may be
  too large for the path's curvature` (`Circle(1)` along X; the message is misleading).
- Open profile (surface sweep) needs a single-edge path: `ValueError: surface sweeps need a
  single-edge path`.

## Checking
Volume = profile area × path length for a perpendicular sweep that does not self-intersect:
`math.pi * r**2 * path.length`. A mitered planar corner keeps that formula exactly.

## Errors
- `ValueError: sweep: the path runs along up= at (x, y, z); ...` (pick another `up`)
- `ValueError: sweep: the path runs straight at (x, y, z); up='frenet' needs a path that bends
  everywhere`
- `ValueError: sweep: the profile would spin about the path at (x, y, z): it turns by 52 degrees
  within 0.00409 of it (the path nearly straightens there, and up='frenet' follows its principal
  normal round; pick up= a direction)`
- `ValueError: sweep: anchor is 'center', 'origin' or a point, got 'corner'`
- `ValueError: sweep: the anchor (0, 0, 1) lies 1 off the profile's plane; ...`
- `ValueError: sweep: with rails= the profile runs from the path to the rail: ...`
- `ValueError: sweep: with rails= the path and the rail hold the profile's ends, ...; it takes no
  orient=, translational=, sharp_corners=, up=, twist=, scale= or anchor=`
- `ValueError: sweep: up= and twist= turn the profile along the path; they need orient=True and
  translational=False`
- `ValueError: sweep: mitered corners keep the profile square to the path's plane; up= and twist=
  need sharp_corners=False`
- `ValueError: sweep: along a closed path the profile must come round into itself; twisted by 90
  degrees it does not (...)`
- `ValueError: sweep: the scale must be positive along the whole path; it is 0 at 0.5 of its length`
- `ValueError: sweep: the points of a scale run from t = 0 to t = 1, t increasing`
- `TypeError: sweep: scale is (start, end), [(t, s), ...] or a function of the fraction of the path's length, got 3`
- `ValueError: sweep: along a closed path the profile must come round into itself; scaled from 1 to 2 it does not (...)`
- `ModelingError: sweep: the profile reaches across the axis of the arc (radius 10), so it would
  sweep through itself; ...`
- `TypeError: a sweep path is an edge or a wire, got Part`
- `TypeError: expected a sketch, face or closed wire, got Part`
- `ValueError: sharp-cornered sweeps need a planar path`
- `ValueError: the sweep path is not connected: a gap of ...`
- `ModelingError: sweep: the kernel returned a body that is ...` (inside out, without volume,
  or not closed)

## Example
```python
path = Spline((0, 0, 0), (0, 20, 30), (40, 20, 50))
tube = sweep(Circle(3) - Circle(2), path)               # profile drawn at the origin in XY
print(tube.is_valid(), round(tube.volume, 2), round(math.pi * 5 * path.length, 2))  # True 1314.96 1314.96

spring = sweep(Circle(1), Helix(pitch=5, height=30, radius=10))   # wire diameter 2 < pitch 5

frame = sweep(Rectangle(6, 4), Polyline((0, 0, 0), (0, 0, 40), (40, 0, 40)))  # planar path: mitered corner
print(round(frame.volume, 1))                           # 1920.0

bent = sweep(Circle(3), FilletPolyline((0, 0, 0), (0, 0, 40), (40, 0, 40), radius=8))  # rounded corner

ring = sweep(Circle(2), CenterArc((0, 0), 20, 0, 360))  # a single circle: a revolve, one torus face
print(len(ring.solids()), [f.geom_type for f in ring.faces()], round(ring.volume, 2))  # 1 ['torus'] 1579.14

# a square thread profile: it keeps its attitude to the helix's axis (2 radial, 1 axial)
h = Helix(pitch=5, height=10, radius=10)
thread = sweep(Rectangle(2, 1), h)
print(thread.is_valid(), round(thread.volume, 2))       # True 252.12 = 2 * 1 * helix length

rail = sweep(Rectangle(4, 2), Spline((0, 0, 0), (10, 20, 10), (30, 10, 25), (40, 30, 30)), up=Z)
bar = sweep(Rectangle(10, 2), Line((0, 0, 0), (0, 0, 100)), twist=180)
print(round(bar.volume, 3))                             # 2000.0

horn = sweep(Circle(2), Line((0, 0, 0), (0, 0, 50)), scale=(1, 2))  # radius 2 to 4: a cone
print(round(horn.volume, 3))                            # 1466.077 = the frustum
bulge = sweep(Circle(2), Line((0, 0, 0), (0, 0, 40)), scale=[(0, 1), (0.5, 1.6), (1, 1)])

# an L-section put on the path by its inner corner (drawn with the corner at (0, 0))
ell = Polygon((0, 0), (6, 0), (6, -1), (-1, -1), (-1, 5), (0, 5))
edge_trim = sweep(ell, Line((0, 0, 0), (0, 0, 50)), anchor="origin")
print(edge_trim.bbox().min.to_tuple(), edge_trim.bbox().max.to_tuple())   # (-1, -1, 0) (6, 5, 50)

# a surface along two rails: the arc's ends stay on both, its height grows with the gap
left = Spline((0, 0, 0), (2, 15, 1), (0, 30, 0))
right = Spline((20, 0, 0), (26, 15, 3), (22, 30, 0))
hood = sweep(ThreePointArc((0, 0, 0), (10, 0, 4), (20, 0, 0)), left, rails=right)
print(type(hood).__name__, round(hood.area, 3))         # Shell 813.555
```

## Related
`loft`, `revolve`, `Helix`, `Polyline`, `FilletPolyline`, `Wire`, `extrude`.
