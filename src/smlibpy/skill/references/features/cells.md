# cells

The cells of a part made by `merge`: every closed region of the body, each as a solid part of its
own. A part that is one solid gives `[itself]`.

## Signature
`part.cells() -> ShapeList[Part]`

## Returns
Valid parts (`is_valid()` True), named and colored as the merged part. Together they fill the
merged part: their volumes add up to its `volume`. A cavity is no cell: a cell around a cavity
has it as a hole (a box merged with a smaller box inside: the outer cell is the box with the
cavity, 992 of 1000, and the inner box is the second cell).

## Gotchas
- The cells of two touching parts share a face in the merged part; as separate parts each has
  its own copy of it.
- Order: as the kernel keeps the regions, not by size or position. Pick cells by geometry
  (`max(cells, key=lambda c: c.volume)`, `cells.filter_by(...)`) rather than by index.

## Example
```python
m = Box(10, 10, 10).merge(Box(2, 2, 2))               # a small box inside a big one
outer, inner = sorted(m.cells(), key=lambda c: -c.volume)
print(round(outer.volume, 6), round(inner.volume, 6), len(outer.faces()))   # 992.0 8.0 12: the outer cell has the cavity
print(round(Box(5, 5, 5).cells()[0].volume, 6))       # 125.0: a plain part is its only cell
```

## Related
`merge`, `solids()`, `split`, `generic`
