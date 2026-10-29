# assembly_axes

The assembly axes of an exploded view, found from the model: for every two parts that touch in
the assembled model and move by different offsets, where they touch and the line along which
they come together. `render_exploded` draws them; call this to check them, or to draw them
yourself.

## Signature
`assembly_axes(parts, offsets, *, tolerance=0.01) -> list[AssemblyAxis]`

- `parts`: the parts, assembled: each in its place in the finished model.
- `offsets`: how far each part moves out, in millimeters: a list of vectors in the order of the
  parts, or a mapping from part names (`Part.named`) or from the parts themselves to vectors.
  Parts a mapping leaves out stay where they are; all parts of one name get its offset.
- `tolerance`: the gap under which two surfaces count as touching (0.01 mm).

## Returns
One `AssemblyAxis` per pair of touching parts whose offsets differ, ordered by the parts'
indices. An `AssemblyAxis` is a named tuple:

| Field | Meaning |
|---|---|
| `first`, `second` | the indices of the two parts in `parts` (`first < second`) |
| `contact` | the centroid of the area where they touch, in the assembled model |
| `area` | that area in mm² (0 when they touch only along a line or at a point; `contact` is then a point where they touch) |
| `start`, `end` | `contact` moved by the first part's offset, and by the second's |

Parts that move by the same offset touch but get no axis: they travel together.

## How the contact is found
The faces of each part near the other are tessellated (fine where the faces are about the size of
the contact), and the kernel classifies their corners against the other part (`Part.classify`):
the triangles whose three corners are on or inside the other part make the contact area, and its
centroid is their area-weighted centroid. Of the two parts' measures the larger area is kept: on
the side whose faces lie wholly in the contact (the peg, the smaller box) it is exact up to the
tessellation. Parts that reach into each other (an interference fit, a tenon modeled into a solid
leg) touch where one's surface is inside the other.

```python
block = Box(60, 60, 40).cut(Pos(0, 0, 12.5) * Cylinder(5, 15)).named("block")  # a blind hole 15 deep
peg = Pos(0, 0, 20) * Cylinder(5, 30).named("peg")
lid = Pos(0, 0, 22.5) * Box(30, 30, 5).cut(Cylinder(5, 10)).named("lid")  # on the block, around the peg
axes = assembly_axes([block, peg, lid], {"peg": (0, 0, 80), "lid": (0, 0, 40)})
print(len(axes))                          # 3
print(round(axes[0].contact.z, 3))        # 11.429 = (150 pi * 12.5 + 25 pi * 5) / (175 pi): the bore and the bottom
print(round(axes[0].area, 1))             # 549.7 (175 pi = 549.78; the tessellated bore is a little smaller)
print(round(axes[1].area, 1))             # 821.5 = 30 * 30 - 25 pi: the lid on the block
print(axes[2].start.z, axes[2].end.z)     # 102.5 62.5: the peg's contact with the lid, moved with each
```

Between 0.05 s (two boxes) and about 20 s (the 18 parts of a chair, 32 contacts): the time goes
to tessellating the faces near each contact.

## Errors
- `ValueError: assembly_axes: part 2 ('ball') touches no other part within 0.01 mm; ...`: the
  parts are given assembled; put it in its place or raise `tolerance`.
- `ValueError: assembly_axes: no part is named 'lid'; the names are ...`,
  `... 1 offsets for 2 parts; ...`, `... needs two parts or more`.
- `TypeError: assembly_axes takes parts, not a Vector`.

## Related
`render_exploded` (draws the axes, the balloons and the parts list), `Part.classify`,
`Part.distance_to`.
