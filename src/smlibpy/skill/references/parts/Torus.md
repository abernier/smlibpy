# Torus

A ring around the Z axis, centered on the origin.

## Signature

`Torus(major_radius, minor_radius, *, minor_start_angle=0.0, minor_end_angle=360.0, major_angle=360.0, align=Align.CENTER)`

- `major_radius`: from the Z axis to the center of the tube. `minor_radius`: the tube radius.
  Requires 0 < minor < major (no spindle or horn tori).
- `major_angle`: degrees, at most 360: a sector around Z from the +X axis counter-clockwise,
  with round ends (a `torus` face and two planes).
- `minor_start_angle`, `minor_end_angle`: degrees around the tube, as build123d takes them: the
  part of the tube's circle between them is kept, measured in the tube's section from the side
  away from the axis (0) towards +Z (90). The section is a slice of the circle from its center,
  so its straight sides sweep planes (at 0 or 180), cylinders (at 90 or 270) or cones. More than
  0 and at most 360 apart.
- `align`: per axis, as for `Box` (bounding-box based). A sector is centered by its own box;
  `align=None` keeps the torus's center at the origin.

## Returns

A `Part` with one toroidal face. `Torus(20, 4)`: bbox x, y −24..24, z −4..4; volume 2π²·R·r²
(6316.548); inner hole radius 16. `face.radius` is the minor radius (4), `face.axis` is Z.

## Gotchas

- `torus.edges()` is empty (two seams, `edges(seams=True)`), so there is nothing to fillet.
- It lies flat in XY. To stand it up rotate it: `Torus(20, 4).rotate(X, 90)` lies in the XZ
  plane (bbox y −4..4).
- `align=(Align.CENTER, Align.CENTER, Align.MIN)` sets it on XY (z 0..8).
- The repr shows the volume less precisely (`volume=6316.8`); use `.volume`.
- A part of the tube (`minor_start_angle`/`minor_end_angle`) is centered by its own box like a
  sector: `Torus(20, 5, minor_start_angle=0, minor_end_angle=180)` (the upper half) spans z
  −2.5..2.5; `align=None` keeps the torus's center at the origin (z 0..5).

## Errors

- `minor_radius >= major_radius` or `minor_radius <= 0`:
  `ValueError: need 0 < minor_radius < major_radius`.
- `ValueError: Torus: minor_end_angle must lie more than 0 and at most 360 degrees past minor_start_angle, got 90 and 90`

## Example

```python
ring = Torus(20, 4)                                                      # x, y -24..24, z -4..4
standing = Torus(20, 4).rotate(X, 90)                                    # in the XZ plane
elbow = Torus(20, 4, major_angle=90, align=None)                         # the quarter from +X to +Y
print(ring.bbox(), standing.bbox(), round(ring.volume, 3), round(elbow.volume, 3))  # ... 1579.137
top = Torus(20, 5, minor_start_angle=0, minor_end_angle=180)             # the upper half: a flat bottom
bead = Torus(20, 5, minor_start_angle=-90, minor_end_angle=90)           # the outer half: a cylinder inside
print(round(top.volume, 3), sorted(f.geom_type for f in bead.faces()))   # 4934.802 ['cylinder', 'torus']
```

## Related

`Sphere`, `Cylinder`, `features/revolve` (`major_angle` is the revolve
`Circle(4).translate(20, 0, 0).on(Plane.front).revolve(Z, 90)`),
`features/sweep` (a tube along any path).
