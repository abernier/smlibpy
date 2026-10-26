# joining: the edges where two bodies meet

Select the edges a Boolean made between two bodies: the circle where a boss stands on a plate,
the rims of a hole, the inside corner where a rib meets a wall. These are the edges one rounds or
chamfers after the Boolean.

## Signature
`shapelist.joining(a, b) -> ShapeList[Edge]`

- `a`, `b`: bodies (Part, Shell, Sketch) or lists of them; an edge on any body of a list counts.
- On lists of edges only (`TypeError: joining selects edges, not a Face`).

## How it works
An edge is taken where it lies on the surfaces of both: at a quarter, half and three quarters of
its length, each point lies on a face of `a` and on a face of `b` (exact classification, within
the edge's tolerance, 1e-5 on most parts). It goes by geometry, so the bodies need not be the
operands themselves: copies in the same place work, and the part may have been edited since (a
fillet elsewhere).

`new(since=[a, b])` (see `history`) finds the curves where the bodies' faces *cross*; `joining`
also finds an edge of one body that lies on the other: a boss standing on a plate (its bottom
face on the plate's top) meets the plate along the boss's own bottom edge, which is not new.

## Example
```python
plate = Box(60, 40, 8)                                  # top at z = 4
boss = Cylinder(8, 10).translate(0, 0, 9)               # standing on it: z 4..14
part = plate + boss
print(len(part.edges().new(since=[plate, boss])))       # 0: the circle is the boss's bottom edge
rim = part.edges().joining(plate, boss)
print(len(rim), rim[0].geom_type, round(rim[0].length, 4))   # 1 circle 50.2655
rounded = part.fillet(rim, 2)                           # the round where the boss meets the plate

block = Box(40, 40, 10)
hole = Cylinder(5, 40).rotate(X, 30)
print(len((block - hole).edges().joining(block, hole)))  # 4: the two elliptic rims, in two pieces each

holes = [Cylinder(2, 20).translate(x, 0, 0) for x in (-10, 0, 10)]
print(len((plate - holes).edges().joining(plate, holes)))   # 6: top and bottom rims of each hole
```

## Gotchas
- Where coplanar faces of the two bodies merged (two boxes side by side: their tops become one
  face), the merged face's edges lie on one body only: none of them is taken.
- A boss through a plate with holes in it: the rims of the holes inside the boss's footprint also
  lie on both (the hole walls end on the boss's bottom face) and are taken. Filter by position if
  only the outer circle is wanted.
- Cost: a few classifications per edge near both bodies (about 0.5 ms an edge).

## Related
`history` (`new`, `derived_from`), `convexity` (`concave()`), `features/fillet`.
