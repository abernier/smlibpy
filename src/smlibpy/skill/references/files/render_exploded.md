# render_exploded

An exploded view of an assembly as a PNG: each part moved by its offset and rendered as `render`
does, the assembly axes dashed, a numbered balloon on every part that shows and a parts list
(number, name, how many) beside the picture. For assembly instructions, a cut list's picture, a
look at how parts go together. Drawn in software by the library alone: no browser, no fonts.

## Signature
`render_exploded(parts, offsets, *, path=None, view="iso", size=(1200, 800), order=None,
axes=True, balloons=True, background="white", zoom=1.0, supersample=2, tolerance=0.01) -> Picture`

- `parts`: the parts, assembled (each in its place in the finished model). Their names
  (`Part.named`) are the rows of the list; an unnamed part is `"part <n>"`.
- `offsets`: how far each part moves out: a list of vectors in the order of the parts, or a
  mapping from names or from the parts themselves to vectors; parts a mapping leaves out stay.
- `view`, `background`, `supersample`: as for `render`. `size` is the whole picture, the list
  included.
- `order`: the names in the order they are numbered (the order of assembly, say), every name
  once. Default: the order in which the names first come.
- `axes`: draw the assembly axes (`assembly_axes`): from where two touching parts meet, moved
  with the one, to the same point moved with the other. Axes on one line that overlap are drawn
  as one.
- `balloons`: draw the balloons and the parts list.
- `zoom`: factor on the scale that fits the moved parts into the room the balloons leave.
- `tolerance`: the gap under which surfaces touch (see `assembly_axes`).

## Returns
A `Picture`, as `render` gives: the PNG's bytes, `.pixels`, `.frame` (the frame of the moved
parts' view; the balloons and the list are drawn over it), `.save(path)`.

```python
block = Box(60, 60, 40).cut(Pos(0, 0, 12.5) * Cylinder(5, 15)).named("block")
peg = Pos(0, 0, 20) * Cylinder(5, 30).named("peg")
lid = Pos(0, 0, 22.5) * Box(30, 30, 5).cut(Cylinder(5, 10)).named("lid")
pic = render_exploded([block, peg, lid], {"peg": (0, 0, 80), "lid": (0, 0, 40)}, path="exploded.png")
print(pic.width, pic.height)   # 1200 800
```

In the front view with `balloons=False` the parts fill the picture as `render` fits them, and an
axis lands where the frame puts it: two boxes 100 x 60 x 20 and 40 x 30 x 10, the small one
standing on the large one at (10, 5) and moved up 50, span x -50..50 and z -10..70; the scale is
min(800 * 0.88 / 100, 600 * 0.88 / 80) = 6.6 px/mm, and the axis from the contact's centroid
(10, 5, 10) runs in the column 400 + 10 * 6.6 = 466:

```python
base = Box(100, 60, 20).named("base")
top = Pos(10, 5, 15) * Box(40, 30, 10).named("top")
pic = render_exploded([base, top], {"top": (0, 0, 50)}, view="front", size=(800, 600), balloons=False)
print(pic.frame["scale"], pic.frame["mid_y"])   # 6.6 30.0
```

## How it lays out
- A balloon points at a pixel near the middle of what shows of its part, at least two pixels in
  from its outline. A part hidden behind others gets no balloon (it keeps its row in the list).
- The balloons stand in two columns, left and right of the parts, in the order of their targets
  from top to bottom, spread so that none overlaps; then two are swapped while that makes the
  leaders cross less, or run shorter. Room for the columns is kept free beside the parts.
- Parts of the same name share a number; the list gives each name once, with its count (`×2`).
- Text is the library's 5 x 7 font in capitals, as on `render`'s drawings and markers.

## Gotchas
- The axes come from contacts, so an axis joins any two touching parts that move differently,
  also where they do not come together along it (a seat panel lying on two rails that move
  sideways gets a slanted axis to each). Give such parts offsets that agree, or draw your own
  axes from `assembly_axes`.
- Axes are drawn over the parts, not hidden by them.
- Finding the contacts takes most of the time (about 20 s for an 18-part chair); a second view
  of the same parts finds them again.

## Errors
The errors of `assembly_axes`, and
- `ValueError: render_exploded: order names 'lid', which no part has; ...`,
  `... order leaves out 'top'; give every name once`, `... order names 'base' more than once`;
- `ValueError: render_exploded: 12 balloons do not fit beside the parts in a picture 120 pixels
  high; give a larger size`.

## Related
`assembly_axes`, `render` (views, frames), `diff_images`.
