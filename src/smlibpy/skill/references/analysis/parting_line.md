# parting_line

The lines on a part where its surface turns from facing a pull direction to facing away from
it: where the two halves of a mold or a casting pattern meet.

## Signature
`part.parting_line(direction) -> ShapeList[Wire]`

`direction`: an `Axis` (`Z`) or a vector; its length does not matter. Zero raises
`ValueError: parting_line: the direction must not be zero`.

## Returns
A `ShapeList` of closed `Wire`s, longest first, made of standalone exact curves:
- edges of the part where faces facing the direction meet faces facing away (a sharp rim);
- silhouettes through curved faces, where the normal is perpendicular to the direction. Exact
  for spheres (a great circle: the equator for `Z`, 2 `circle` edges of radius 10.0 at z = 0),
  for cylinders lying across the direction (two straight lines, stored as B-splines) and for tori
  whose axis is the direction (two circles). Traced NURBS otherwise, within 1e-6 of the part's
  size of the surface (a torus tilted 30 degrees, 73.4 across: up to 7e-5 off the surface, the
  normal within 6.5e-6 of perpendicular to the direction).

Most parts give one wire. Two for a torus seen along its axis (the outer and the inner equator,
157.0796 and 94.2478). Several on a simple part point to faces the mold cannot reach from
either side (see `draft_analysis`).

## Walls without draft
Faces parallel to the direction (`draft_analysis(...).vertical`) go with the half that moves
along the direction, unless they only touch faces of the other half. The line then runs along
their far end: the bottom edge for `Z`.
- `Box(40, 30, 20)`: the 4 bottom edges (length 140, z = -10).
- A cylinder along Z: its bottom circle. Lying along X: its 2 contour lines (y = ±5, z = 0) and
  the lower halves of its end circles (71.4159 in all).
- A box opening up (a cup) and one opening down: both the outer bottom edge, z = -10.
Drafted walls keep the line where it is (a core tapered 3 degrees: its bottom rim, z = 0).

## How
A copy of the part is split along the silhouettes of the faces that turn over; each face of the
copy then faces one way, and the line is where the two sides meet. Faces split along traced
silhouettes may turn the other way by up to 0.6 degrees next to the line; they count for the way
they mostly face. A face that still faces both ways raises `ModelingError: parting_line: a face
still faces both ways after the split; heal() the part, or try a direction a little off this one`.

## Cost
1 to 20 ms for the examples here, 0.1 s with a traced torus.

## Example
```python
line = Sphere(10).parting_line(Z)
print(len(line), [e.geom_type for e in line[0].edges()], round(line[0].length, 6))   # 1 ['circle', 'circle'] 62.831853

lying = Cylinder(5, 20).rotate(Y, 90).parting_line(Z)[0]
print(round(lying.length, 6), sorted(round(e.center().y, 6) for e in lying.edges() if e._is_straight()))   # 71.415927 [-5.0, 5.0]

cup = Box(40, 30, 20) - Box(30, 20, 15, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 10)
rim = cup.parting_line(Z)
print(len(rim), rim[0].length, rim[0].bbox().max.z)   # 1 140.0 -10.0: walls without draft go with the top half

print([round(w.length, 4) for w in Torus(20, 5).parting_line(Z)])   # [157.0796, 94.2478]
```

## Related
`draft_analysis`, `recipes/mold-check`, `silhouette` (what is visible from a direction),
`outline`, `split` (cut a part at a flat parting line).
