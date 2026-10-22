# merge

Several parts as one part made of cells. Where parts overlap, the overlap becomes a cell of its
own; cells that touch share the face between them. For models of several materials whose meshes
must match where they meet (simulation), inserts and overmolds, and to cut parts into all their
pieces at once.

## Signature
`part.merge(*others) -> Part`
`merge(*parts) -> Part` (two or more parts, or lists of them)

`part.cells() -> ShapeList[Part]`: the cells, each a solid of its own (see `cells`).

## Returns
One `Part` that holds every cell:
- `volume`, `center()`, `bbox()`: of the union.
- `faces()`: each face once, a face between two cells too (two boxes side by side: 11 faces,
  not 12).
- `cells()`: the cells as valid parts. Two overlapping boxes give 3 cells (each box alone and
  the overlap); a box with a cylinder through it gives the box with a hole, the piece of the
  cylinder inside, and the two ends that stick out.

## Gotchas
- A merged part is **not a manifold solid**: `is_valid()` is False, and Booleans, `fillet`,
  `shell`, `split` and the other features raise `ModelingError: ... the part is not a valid
  solid`. Model the parts first, merge last; or work on `cells()`. `section()` works: a region per
  cell the plane cuts.
- Parts that do not touch stay apart: two cells, two `solids()`.
- `merge` checks the kernel's result: its volume lies between that of the largest part and that
  of all parts together, or it raises (below).
- Files: STEP writes each cell as a solid of its own (they come back as a `ShapeList`). USD
  (`export_usd`) keeps the merged body with its shared faces: `import_usd` gives the merged part.
- Fast: a plate with nine pins through it (28 cells) takes about 25 ms, with the check of the
  volume; its `cells()` about 40 ms.

## Errors
- `TypeError: merge takes parts, not a Sketch` (also for sheets: only solids are merged).
- `ValueError: merge needs two or more parts, got 1` (`merge(...)`), `ValueError: merge needs
  another part` (`part.merge()`).
- `ModelingError: merge: the kernel returned a result of volume ..., less than that of the largest
  part (...)`: the kernel merged wrongly, as where a seam of a cylinder or sphere lies tangent to
  the other part. Turn that part about its axis or move it a little.

## Example
```python
a = Box(20, 20, 20)
b = Box(20, 20, 20).translate(10, 0, 0)
both = a.merge(b)
print(both.volume, both.is_valid(), len(both.cells()))   # 12000.0 False 3
print(sorted(round(c.volume) for c in both.cells()))     # [4000, 4000, 4000]: a, b alone and the overlap

block = Box(40, 40, 20).named("block")
insert = Cylinder(6, 30).named("insert")
cells = merge(block, insert).cells()                      # block with a hole, the insert in three pieces
print([round(c.volume, 3) for c in cells])                # [29738.053, 2261.947, 565.487, 565.487]
print(all(c.is_valid() for c in cells))                   # True
```

## Related
`cells`, Booleans (`+`, `-`, `&`), `split`, `solids()`, `export_usd`, `generic`
