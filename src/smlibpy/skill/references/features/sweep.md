# sweep

Moves a profile along a path to make a solid (tubes, rails, springs, frames). An open profile
makes a surface (`Shell`).

## Signature
`sweep(profile, path, *, orient=True, translational=False, sharp_corners=None)`
`sketch.sweep(path, *, sharp_corners=None)` (no `orient`/`translational`)

- `profile`: a sketch (holes allowed), a planar face or a closed wire. Draw it anywhere,
  usually at the origin in XY.
- `path`: an `Edge` or a connected `Wire` (`Polyline`, `FilletPolyline`, `Wire([...])`). A
  closed single-edge path (a full `CenterArc`, a closed `Spline`) is split into two halves
  automatically.
- `orient=True`: turn the profile to stand perpendicular to the path at its start. Leave it on.
- `translational=True`: keep the profile's orientation fixed (it does not turn with the path).
  The profile then cuts the path at a slant; on an arc the volume is area × rise, not area ×
  length. Useless on helices.
- `sharp_corners`: for paths of several edges. Default: mitered corners for planar paths.
  `False` sweeps each edge alone and fuses the pieces (notched corners). `True` on a 3D path
  raises.
- There is no twist or scale option.

## Placement
- The **bounding-box center** of the profile goes to the start of the path, wherever the
  profile was drawn. You cannot offset a profile from its path; move the path instead.
- The profile is turned by the smallest rotation from its normal to the path tangent. For a
  path along Z it is unchanged. For a path along X, sketch x becomes Z; along Y, sketch y
  becomes Z. Check with `bbox()`.
- On a `Helix` around Z starting at (r, 0, 0) the sketch x axis points radially at the start.

## Gotchas
- **Profiles roll along a helix.** A `Rectangle(2, 1)` swept along a 6-turn helix turns about
  the path by roughly 30° per turn (sections measure 2.11×1.25, then 1.59×2.22, ...). Circles
  do not care; thread and spring-band profiles do. Workaround: loft through copies of the
  profile placed along the helix with `x_dir` radial (example) — exact to 0.01%.
- Nothing checks self-intersection: a profile bigger than the path's bend radius, or a spring
  wire thicker than the pitch, returns `is_valid() == True` with a volume of area × length
  (too large). Keep profile radius < bend radius and wire diameter < pitch. Inside-out and
  volume-less results raise `ModelingError`.
- Non-planar polylines are swept piece by piece: the corners are notched (3D path of three
  40 mm legs: 3320.9 instead of 3392.9). Round the corners with `FilletPolyline` instead.
- A `Wire` whose edges do not connect raises `ValueError: the sweep path is not connected: a
  gap of 1 between Edge(...) and Edge(...)`.
- `orient=False` with a path that is not along the profile normal raises
  `KernelError: sweep failed (SM_ERR): the profile may be too large for the path's curvature`
  (the message is misleading).
- Open profile (surface sweep) needs a single-edge path: `ValueError: surface sweeps need a
  single-edge path`.

## Checking
Volume = profile area × path length for a perpendicular sweep that does not self-intersect:
`math.pi * r**2 * path.length`. A mitered planar corner keeps that formula exactly.

## Errors
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

ring = sweep(Circle(2), CenterArc((0, 0), 20, 0, 360))  # closed path: split into two halves
print(len(ring.solids()), round(ring.volume, 2))        # 1 1579.14

# a square thread profile that does not roll: loft through placed copies (8 per turn)
h = Helix(pitch=5, height=10, radius=10)
n = 16
secs = []
for i in range(n + 1):
    p = h.point_at(i / n)
    radial = Vector(p.x, p.y, 0).normalized()
    secs.append(Rectangle(2, 1).on(Plane(origin=p, x_dir=radial, z_dir=h.tangent_at(i / n))))
thread = loft(secs)
print(thread.is_valid(), round(thread.volume, 2))       # True 252.12 = 2 * 1 * helix length
```

## Related
`loft`, `revolve`, `Helix`, `Polyline`, `FilletPolyline`, `Wire`, `extrude`.
