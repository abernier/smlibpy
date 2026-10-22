# surface_fillet

A round blend between the surfaces of two faces that are not edges of one part: two sheets that
cross, two pipes, a panel and a post. Or a flat one, a chamfer, with one distance or two. Returns
the blend as a sheet. (`fillet` and `chamfer` round and bevel the edges of a part.)

## Signature
`surface_fillet(a, b, radius, *, radius2=None, shape="round", sides=(1, 1), trim=False)`

- `a`, `b`: faces, or sheets (`Shell`) of one face. Parts and sheets of several faces raise.
- `radius`: of the ball that rolls between the two surfaces.
- `shape`: `"round"` (default) a circular cross-section; `"chamfer"` a flat one, straight
  across between the lines where the round of the same radius meets the surfaces (on faces at
  right angles: legs of `radius`, `radius·√2` wide).
- `radius2`: chamfers only: a second distance, from `b`. The chamfer runs between the lines below
  where `a` moved out by `radius` and `b` moved out by `radius2` cross. For faces at right
  angles: its edge on `b` lies `radius` from `a`, its edge on `a` lies `radius2` from `b`.
  `radius2` with `shape="round"` raises (the kernel has no round of two radii).
- `sides`: on which side of each face the ball rolls: `1` the side its normal (`normal_at()`)
  points to, `-1` the other. Two crossing surfaces leave four places for the ball, one per
  combination.
- `trim`: `True` cuts both faces back to the blend's long edges (`Shell.trim`) and sews the
  three into one sheet. The blend's long edges must run across both faces, from border to
  border; else `ModelingError: surface_fillet: the blend does not cut a face back ...`.

## Returns
A `Shell`: the blend. One face per stretch where the ball rolls (two crossing pipes: 2, one
around each place where they cross). The edges along its length lie on the two surfaces
(1e-5), the end edges are arcs across.

## What is blended
- The surfaces, as far as they reach, not the faces: the blend can run past a face's edges. A
  wall 20 wide standing on a floor 40 wide gets a blend 40 long.
- The inputs are not changed. `trim=True` returns one sheet: the two faces cut back to the
  blend's long edges, and the blend (floor and wall below: 3 faces, 1514.1593, 8 free edges).
  To make a solid, `thicken` it or close it with `stitch`.
- It takes 20 to 50 ms.

## Errors
- `ValueError: surface_fillet: radius2 is for chamfers (shape="chamfer"); a round blend has one radius`.
- `ValueError: surface_fillet: shape is "round" or "chamfer", got 'cove'`.
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
rounding = surface_fillet(floor, wall, 5)             # above the floor, on the -Y side of the wall
print(round(rounding.area, 4), rounding.bbox())       # 314.1593 (a quarter circle r5, 40 long), y -5..0, z 0..5
other = surface_fillet(floor, wall, 5, sides=(1, -1)) # above the floor, on the +Y side
print(round(other.bbox().max.y, 6))                  # 5.0
one = surface_fillet(floor, wall, 5, trim=True)       # floor and wall cut back, sewn to the blend
print(len(one.faces()), round(one.area, 4))           # 3 1514.1593
bevel = surface_fillet(floor, wall, 5, shape="chamfer")
print(round(bevel.area, 4))                           # 282.8427 = 40 * 5 * sqrt(2): from y -5 on the floor to z 5
steep = surface_fillet(floor, wall, 2, radius2=4, shape="chamfer")
print(round(steep.area, 4))                           # 178.8854 = 40 * hypot(2, 4): from y -4 on the floor to z 2

# two crossing pipes: a blend around each of the two places where they cross
a = Cylinder(5, 60).faces().cylinders()[0]
b = Cylinder(4, 60).rotate(Axis.X, 90).faces().cylinders()[0]
outside = surface_fillet(a, b, 1.5)                   # outside both pipes (their normals point out)
print(len(outside.faces()))                           # 2
```

## Related
`fillet` (edges of a part), `blend` (a bridge between sheets that do not meet), `trim`,
`surface`, `ruled`, `stitch`, `Shell.thicken`, `generic`
