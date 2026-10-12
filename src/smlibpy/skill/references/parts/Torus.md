# Torus

A ring around the Z axis, centered on the origin.

## Signature

`Torus(major_radius, minor_radius, *, align=Align.CENTER)`

- `major_radius`: from the Z axis to the center of the tube. `minor_radius`: the tube radius.
  Requires 0 < minor < major (no spindle or horn tori).
- `align`: per axis, as for `Box` (bounding-box based).

## Returns

A `Part` with one toroidal face. `Torus(20, 4)`: bbox x, y −24..24, z −4..4; volume 2π²·R·r²
(6316.548); inner hole radius 16. `face.radius` is the minor radius (4), `face.axis` is Z.

## Gotchas

- `torus.edges()` is empty (two seams, `edges(seams=True)`), so there is nothing to fillet.
- It lies flat in XY. To stand it up rotate it: `Torus(20, 4).rotate(X, 90)` lies in the XZ
  plane (bbox y −4..4).
- `align=(Align.CENTER, Align.CENTER, Align.MIN)` sets it on XY (z 0..8).
- The repr shows the volume less precisely (`volume=6316.8`); use `.volume`.

## Errors

- `minor_radius >= major_radius` or `minor_radius <= 0`:
  `ValueError: need 0 < minor_radius < major_radius`.

## Example

```python
ring = Torus(20, 4)                                                      # x, y -24..24, z -4..4
standing = Torus(20, 4).rotate(X, 90)                                    # in the XZ plane
print(ring.bbox(), standing.bbox(), round(ring.volume, 3))
```

## Related

`Sphere`, `Cylinder`, `features/revolve` (partial torus:
`Circle(4).translate(20, 0, 0).on(Plane.front).revolve(Z, 90)`, the quarter from +X to +Y),
`features/sweep` (a tube along any path).
