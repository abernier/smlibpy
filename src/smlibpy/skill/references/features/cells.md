# cells

The cells of a part made by `merge`: every closed region of the body, each as a solid part of its
own. A part that is one solid gives `[itself]`.

## Signature
`part.cells() -> ShapeList[Part]`

## Returns
Valid parts (`is_valid()` True). Together they fill the merged part: their volumes add up to its
`volume`. A cavity is no cell: a cell around a cavity has it as a hole (a box merged with a
smaller box inside: the outer cell is the box with the cavity, 992 of 1000, and the inner box is
the second cell).

Each cell knows the parts given to `merge` that it lies in: `cell.sources` (a tuple of those
parts, in the order given; a part that was itself merged stands for its own parts). It is named
after them, the names joined by `&` ("steel&brass" where they overlap), and colored in the color
of the last of them that has one; where none has a name (or a color), the merged part's own is
used. `part.sources` of any other part is `()`.

## Gotchas
- The cells of two touching parts share a face in the merged part; as separate parts each has
  its own copy of it.
- `sources` are the parts as given to `merge`, not moved along with the merged part: of
  `m.translate(10, 0, 0).cells()`, the sources lie where they were. The names and colors are right.
- The kernel keeps no record of the parts: smlibpy classifies a point inside each cell against
  them (about 1.5 ms per cell). A cell where no such point is found has no sources and the merged
  part's name and color.
- Order: as the kernel keeps the regions, not by size or position. Pick cells by geometry
  (`max(cells, key=lambda c: c.volume)`, `cells.filter_by(...)`) rather than by index.
- An insert that touches the part around it at a point (a ball against a wall) is a cell of its
  own, and a cavity in the cell around it. One that touches it along a line (a cylinder lying
  against a wall) raises, because the cavity cannot be cut out: move the insert off the wall or
  into it.

## Errors
- `ModelingError: cells: the cells inside a cell could not be cut out of it (the kernel's cut
  ...); the insert at (6, 0, 0) touches the part around it at a point or along a line: move it off
  the wall or into it`: an insert touches the part around it along a line (above).
- `ModelingError: cells: the cells add up to a volume of ..., the part has ...`: the kernel kept
  two cells together; the same remedy.

## Example
```python
m = Box(10, 10, 10).merge(Box(2, 2, 2))               # a small box inside a big one
outer, inner = sorted(m.cells(), key=lambda c: -c.volume)
print(round(outer.volume, 6), round(inner.volume, 6), len(outer.faces()))   # 992.0 8.0 12: the outer cell has the cavity
print(round(Box(5, 5, 5).cells()[0].volume, 6))       # 125.0: a plain part is its only cell

steel = Box(40, 40, 20).named("steel").colored("gray")
brass = Cylinder(6, 30).named("brass").colored("gold")
for c in merge(steel, brass).cells():
    print(c.name, c.color, round(c.volume, 1), [s.name for s in c.sources])
# steel gray 29738.1 ['steel'] / steel&brass gold 2261.9 ['steel', 'brass'] / brass gold 565.5 ['brass'] (twice)
```

## Related
`merge`, `solids()`, `split`, `generic`
