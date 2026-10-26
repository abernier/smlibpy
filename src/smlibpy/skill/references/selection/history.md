# new, derived_from: where faces and edges came from

Select the faces and edges an operation made (the curve where a boss meets a plate, the rounds
of a fillet, the walls of holes), and keep using a selection taken before an edit.

## Signature
`shapelist.new(since) -> ShapeList`
`shapelist.derived_from(*shapes) -> ShapeList`

- `since`: a body (Part, Shell, Sketch) or a list of them, or faces and edges: the list's faces
  or edges that descend from none of these are new.
- `shapes`: bodies, faces, edges, or lists of them: the list's faces or edges that descend from
  one of them (faces from faces, edges from edges, both from a body).
- On lists of faces and edges only (`TypeError` for vertices).

## How it works
smlibpy marks every face and edge of every body it makes, and the kernel carries the marks
through its operations:

| Operation | Faces and edges of the result |
|---|---|
| copies (`named`, `colored`, `solids()`, `heal`, `to_nurbs`) | keep their marks |
| Booleans, `split` | keep theirs; both halves of a split face keep the parent's; a face merged from two (coplanar tops of a union) descends from both; the curves where the bodies meet, and the cut faces of a split, are new |
| fillet, chamfer | keep theirs; the rounds and bevels (and their edges) are new |
| shell, offset, thicken | the offset faces descend from their source faces; the faces that join them (blends, the rim of an outward shell, the sides of a thickened sheet) are new; the rim of an inward shell descends from the opening face |
| imprint | the pieces of split faces keep the parent's; the pieces inside a tool part or sketch region also descend from the tool |
| draft, twist, taper, bend, `remove_fillets`, `remove_faces`, `cells()`, sheet-metal folds and flanges | keep the marks of the faces they change or extend; faces they add are new |
| moved, turned, mirrored, scaled copies, patterns | **new marks**: a copy is a shape of its own |
| bodies read from files, sections | new marks everywhere (all new) |

## Old selections
A face or edge taken from an earlier version of the part stands for its descendants in
`fillet`, `chamfer`, `shell` openings, `draft`, `remove_faces` and `flange`: the pieces a cut left
of a top edge are all rounded. Only where it has none (another body, or a body rebuilt from
scratch) is it matched by geometry, and raises `ValueError: ... is not an edge of this part`
if nothing matches.

## Example
```python
plate = Box(60, 40, 8)
boss = Cylinder(8, 20).translate(0, 0, 10)
part = plate + boss
rim = part.edges().new(since=[plate, boss])            # where the boss (through the top) meets the plate
print(len(rim), rim[0].geom_type, rim[0].radius)        # 1 circle 8.0
rounded = part.fillet(rim, 2)
print(len(rounded.faces().new(since=part)))             # 1: the round

holes = GridLocations(40, 20, 2, 2) * Cylinder(3, 20)  # four moved copies, each its own
drilled = plate - holes
print(len(drilled.faces().derived_from(holes)))         # 4 hole walls
print(len(drilled.faces().derived_from(holes[0])))      # 1

top = plate.edges().top()                               # taken before the slot
slotted = plate - Box(6, 50, 4).translate(0, 0, 3)
print(len(slotted.edges().derived_from(top)))           # 6: the long edges cut in two
done = slotted.fillet(top, 1)                           # rounds all six pieces
```

## Gotchas
- Pass the same objects: `Cylinder(3, 20)` made again is another body, with marks of its own.
- The marks of a pattern's copies differ: `derived_from(holes)` takes the list, not the shape the
  pattern was made from.
- A body read from a file counts as all new: `new(since=...)` of an imported part gives every
  face.

- A boss *standing* on a plate meets it along the boss's own bottom edge, which is not new:
  `new(since=[plate, boss])` finds nothing there. `joining(plate, boss)` (see `joining`) finds it.

## Related
`selection/joining` (the edges where two bodies meet, by geometry), `selection/topology`,
`features/fillet` (rounding the new edges of a Boolean), `features/imprint`.
