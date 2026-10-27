# swing

Revolves a profile about Z along an outline of any shape instead of a circle: elliptical or
rounded-rectangular bottles, knobs, soap bars, lamp shades. Exact (each face is the NURBS product
of a profile curve and an outline curve).

## Signature
`swing(profile, outline)`
`sketch.swing(outline)`

- `profile`: drawn as for a lathe (`features/revolve`): in the XZ plane (`Plane.front`), x the
  distance from the Z axis (x >= 0), z the height. A region (sketch, planar face, closed wire)
  gives a `Part`: its edges on the Z axis swing to nothing and are left out, holes are swung and
  cut out. An open curve gives a surface (`Shell`).
- `outline`: a closed curve around the Z axis in a plane parallel to XY (its height does not
  matter): a single region without holes (`Ellipse(30, 20)`, `RoundedRectangle(60, 40, 10)`), or a
  closed wire or edge. Every ray from the Z axis must cross it once.

## What it makes
At each height the section is the outline scaled about the Z axis so that it passes through the
profile's point on the +X side. The cut of the result by the XZ plane on the +X side is the
profile: for a profile whose x is 30 where the outline crosses the +X axis at 30, the outline
appears at full size; where the profile's x is 15, at half size. A circle about the origin gives
the revolve.

`swing(cup, Ellipse(30, 20))` for the rectangle cup x 0..30, z 0..40 is the elliptic cylinder,
volume π·30·20·40 = 75398.224. A frustum profile (30 at the bottom, 15 at the top) gives
π·30·20·40·(1 + 1/2 + 1/4)/3.

## Returns
A `Part` (an open curve: a `Shell`) of B-spline faces, one per profile edge and outline edge
(the flat bottom and top are planar B-splines: `Face.is_planar` is True, so `faces().planar()`
finds them, `faces().of_type("plane")` does not). The name and color are the profile's.

## Gotchas
- The profile must lie in the XZ plane: a sketch drawn in XY and not placed raises
  `ValueError: swing: the profile must lie in the XZ plane ...`. Use `.on(Plane.front)`.
- The outline sets the shape, the profile the size: an outline crossing +X at 32.2
  (`RoundedRectangle(60, 40, 10)` turned by 30 degrees) is scaled by 30 / 32.2 where the
  profile is at 30.
- An outline that does not surround the Z axis (a C shape open across it), or that a ray from
  the axis crosses more than once (a notch that hooks under the outline), raises; so does a
  region with holes as the outline. A star about the axis is fine: every ray crosses it once.
- To place the result elsewhere move it afterwards (`.translate`, `.rotate`, `.moved`).

## Errors
- `ValueError: swing: the outline must go once around the Z axis`
- `ValueError: swing: every ray from the Z axis must cross the outline once (...)`
- `ValueError: swing: the outline must lie in a plane parallel to XY`
- `ValueError: swing: the outline must be one closed curve, got a region with holes`
- `ValueError: swing: the profile must lie beside the Z axis (x >= 0), it reaches x = -5`

## Example
```python
cup = Polygon((0, 0), (30, 0), (30, 40), (0, 40)).on(Plane.front)
oval = swing(cup, Ellipse(30, 20))
print(oval.is_valid(), round(oval.volume, 3))                           # True 75398.224

bottle = Polygon((0, 0), (20, 0), (20, 50), (8, 60), (8, 70), (0, 70)).on(Plane.front)
flask = bottle.swing(RoundedRectangle(40, 30, 8))                      # 40 x 30 body, 16 x 12 neck
print(flask.bbox(), len(flask.solids()))

shade = swing(Spline((0, 0, 0), (25, 0, 10), (15, 0, 30), (20, 0, 45), (0, 0, 50)), Ellipse(30, 20))
print(type(shade).__name__, round(shade.area, 1))                      # Shell 6564.1
```

## Related
`revolve` (a circle as the outline), `loft` (sections that change shape), `sweep` (a profile
along a path), `deform/taper`.
