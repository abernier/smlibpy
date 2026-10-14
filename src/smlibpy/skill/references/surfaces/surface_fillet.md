# surface_fillet

A round blend between the surfaces of two faces that are not edges of one part: two sheets that
cross, two pipes, a panel and a post. Returns the blend as a sheet. (`fillet` rounds the edges of
a part.)

## Signature
`surface_fillet(a, b, radius, *, sides=(1, 1))`

- `a`, `b`: faces, or sheets (`Shell`) of one face. Parts and sheets of several faces raise.
- `radius`: of the ball that rolls between the two surfaces.
- `sides`: on which side of each face the ball rolls: `1` the side its normal (`normal_at()`)
  points to, `-1` the other. Two crossing surfaces leave four places for the ball, one per
  combination.

## Returns
A `Shell`: the blend. One face per stretch where the ball rolls (two crossing pipes: 2, one
around each place where they cross). The edges along its length lie on the two surfaces
(1e-5), the end edges are arcs across.

## What is blended
- The surfaces, as far as they reach, not the faces: the blend can run past a face's edges. A
  wall 20 wide standing on a floor 40 wide gets a blend 40 long.
- The inputs are not changed and not trimmed. To make one sheet, cut the two sheets back to the
  blend's long edges yourself; to make a solid, `thicken` the sheets or close them with `stitch`.
- It takes 20 to 50 ms.

## Errors
- `ModelingError: surface_fillet: the kernel made no blend; the surfaces may not meet, or not
  leave room for the radius on those sides`: parallel surfaces, a radius that does not fit,
  or a side where the ball has no room.
- `ValueError: surface_fillet: the radius must be positive, got 0`.
- `ValueError: surface_fillet: sides must be two of 1 and -1, got (1, 0)`.
- `TypeError: surface_fillet takes faces (or sheets of one face), not a Part`.
- `ValueError: surface_fillet: a is a sheet of 2 faces; pass one of them`.

## Example
```python
floor = Rectangle(40, 40).faces()[0]                  # z = 0, normal +Z
wall = Rectangle(40, 40).on(Plane.XZ).faces()[0]      # y = 0, normal -Y
print(floor.normal_at(), wall.normal_at())            # Vector(0, 0, 1) Vector(0, -1, 0)
blend = surface_fillet(floor, wall, 5)                # above the floor, on the -Y side of the wall
print(round(blend.area, 4), blend.bbox())             # 314.1593 (a quarter circle r5, 40 long), y -5..0, z 0..5
other = surface_fillet(floor, wall, 5, sides=(1, -1)) # above the floor, on the +Y side
print(round(other.bbox().max.y, 6))                  # 5.0

# two crossing pipes: a blend around each of the two places where they cross
a = Cylinder(5, 60).faces().cylinders()[0]
b = Cylinder(4, 60).rotate(Axis.X, 90).faces().cylinders()[0]
outside = surface_fillet(a, b, 1.5)                   # outside both pipes (their normals point out)
print(len(outside.faces()))                           # 2
```

## Related
`fillet` (edges of a part), `surface`, `ruled`, `stitch`, `Shell.thicken`, `generic`
