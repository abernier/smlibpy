# machining_setup

A part laid on a 3-axis router — resting on one face, the tool coming from the other — and its
features sorted into the layers a CNC shop reads from a DXF: the outline (the through cut), the
holes through the part, the pockets that open on the top face by depth, a label with the grain. What
the setup cannot cut comes back with the reason and the direction another setup needs.

## Signature
`machining_setup(part, direction=(0, 0, 1), *, x_dir=None, label=None, label_size=None) -> MachiningSetup`

- `part`: a `Part` of one solid.
- `direction`: where the tool comes from: a planar `Face` of the part (that face is worked, the part
  rests on the opposite side), an `Axis` or a vector from the part towards the tool. Default from
  above, the part as it stands.
- `x_dir`: the model direction that becomes the drawing's x. Default: the footprint's longest
  straight edge, laid along x at the bottom of the drawing (a board's long side, with its grain); a
  footprint without one (a curved rail) lies along its principal axis.
- `label`: a text for the `LABEL` layer at the footprint's centroid, a grain arrow along x under it.
- `label_size`: its capital height in mm; default a sixth of the footprint's shorter extent, 2 to 20.

## Returns
A `MachiningSetup`, a named tuple:

| Field | Meaning |
|---|---|
| `part` | the part in the setup's frame: on z = 0, the worked face at z = `thickness`, the footprint in the positive quadrant |
| `plane` | the setup's frame in the model: origin of the drawing, its x and y, the normal towards the tool |
| `thickness` | the extent along the tool: the finished thickness of the stock |
| `layers` | sketches in XY named `OUTLINE`, `THROUGH`, `POCKET_D<depth>` (`POCKET_D15`, `POCKET_D7_5`: depth from the top face) and `LABEL`; `export_dxf(setup.layers, path, curves="arcs")` writes one DXF layer each |
| `elsewhere` | `(why, direction, faces)` triples: `"opens below"` (direction `(0, 0, -1)`: turn the part over), `"opens at the side"` (the normal of the face the feature opens through: an edge setup), `"enclosed"` (a void) or `"not a prism along the tool"` (a slope, a cove, an undercut, a shaped rim; no direction) |

`setup.layer("POCKET_D15")` is one layer's sketch (`None` when there is none).

## Gotchas
- The footprint is the union of the part's sections between its horizontal faces and the shadows
  of its sloping planar faces: exact for anything cut from flat stock; a curved face seen on its
  side (a round-over) is drawn by its sections.
- A pocket is written at each floor it has (a stepped pocket on several layers), its contour the
  floor's outline with the islands that rise from it; a pocket open to the side (a rabbet, a tenon
  cheek) has its contour on the outline. The depth is from the top face (z = `thickness`), also where
  the stock's surface above the pocket is lower (a mortise entering a sloping face).
- Features are faces joined along their edges; a face no vertical cutter follows makes its whole
  feature `"not a prism along the tool"`. Faces along the outline that slope (a chamfer, a bevel)
  are reported on their own and do not spoil the pockets next to them.
- A direction given as a `Face` must be planar; a part of several solids is refused (lay out its
  `solids()` one by one).
- 0.1 to 0.5 s a setup for a board with a few mortises (sections, a few rays per floor).

## Example
```python
board = Box(400, 80, 20, align=(Align.MIN, Align.MIN, Align.MIN))
board -= Box(40, 10, 12, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(100, 40, 20)  # a mortise 12 deep
board -= Cylinder(4, 50).translate(300, 40, 0)  # a hole through
board -= Box(15, 10, 8, align=(Align.MIN, Align.CENTER, Align.CENTER)).translate(0, 40, 10)  # a mortise in the end
setup = machining_setup(board, label="RAIL 3")
print([s.name for s in setup.layers])  # ['OUTLINE', 'THROUGH', 'POCKET_D12', 'LABEL']
print(setup.thickness, setup.layer("POCKET_D12").area)  # 20.0 400.0: the stock's thickness, the mortise 40 x 10
export_dxf(setup.layers, "rail_3.dxf", curves="arcs")  # one layer a name, lines and arcs only
why, direction, faces = setup.elsewhere[0]
print(why, direction.to_tuple(), len(faces))  # opens at the side (-1.0, 0.0, 0.0) 5: the end mortise, its floor and four walls
towards = setup.plane.x_dir * direction.x + setup.plane.y_dir * direction.y + setup.plane.z_dir * direction.z
end = machining_setup(board, towards)  # the part standing on its far end
print([s.name for s in end.layers], end.thickness)  # ['OUTLINE', 'POCKET_D15'] 400.0: the end mortise, 15 deep
```

## Related
`export_dxf`, `drawing_views` (views of `setup.part`), `section`, `flat_pattern` (sheet metal's
flat, with bend lines)
