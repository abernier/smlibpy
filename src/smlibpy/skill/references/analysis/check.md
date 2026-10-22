# check, tolerance

What is wrong with a body, and where: the kernel's own validity checks of every face, edge and
vertex. For imported, stitched and healed bodies, and for a part `is_valid()` accepts but a later
operation fails on.

## Signature
`body.check(level=2) -> list[Problem]` (Part, Shell, Sketch)
`part.is_valid(strict=True) -> bool`
`edge.tolerance`, `vertex.tolerance` (properties)

- `level`: 0 checks the structure (how faces, loops, edges and vertices connect) and the gaps
  between vertices, edges and faces against their tolerances; 1 also the geometry; 2 (default)
  all tests. Anything else raises `ValueError`.

## Returns
A list of `Problem`s, empty when nothing is found. Each has:

| Field | |
|---|---|
| `shape` | the `Face`, `Edge` or `Vertex` it is about, or the body |
| `message` | what is wrong, with the value and tolerance (`"Vertex-Face Gap exceeds XSectTol3d for one (or more) Faces (offset= 0.002, tolerance= 2e-05)"`) |
| `value`, `tolerance` | the value measured and the tolerance it was held against (or None) |
| `category` | `"gap"`, `"geometric"`, `"topological"`, `"values"`, `"degenerate"`, ... |
| `test` | the test's short name: `"Bad Vertex Gap"`, `"Bad Gap"`, `"Bad Loop Connection Vertex"`, `"Face Near missing Seam"`, `"Tolerance"` |
| `other` | a second face, edge or vertex the test compared with, or None |

`is_valid(strict=True)` is `is_valid()` and an empty `check()`. `edge.tolerance` and
`vertex.tolerance` are the kernel's tolerances (1e-5 on parts smlibpy makes; larger where a
stitched or imported body's surfaces meet less exactly); `ValueError` for edges and vertices of
no body.

## Gotchas
- The tests look at each face, edge and vertex and its neighbours: they do **not** see a body
  that runs through itself (a shell too thick for its part passes).
- Parts smlibpy makes pass (a few milliseconds); an imported part of 170 faces takes about
  0.1 s. Of 1471 Boolean results of a random test campaign that `is_valid()` accepted, 34 failed
  `is_valid(strict=True)` (gaps above the tolerance, repeated control points, seams).
- `check()` names problems; it fixes nothing. Try `heal()`, `stitch` with a smaller tolerance,
  or rebuild the face it names.

## Example
```python
faces = Box(20, 20, 20).faces()
lifted = [f.to_shell().translate(0, 0, 0.002 if f.normal_at().z > 0.5 else 0) for f in faces]
part = stitch(lifted, tolerance=0.01)                   # the top 0.002 above the walls, sewn
print(part.is_valid(), part.is_valid(strict=True))      # True False
for p in part.check():
    print(p.test, p.shape, round(p.value, 6), p.tolerance)
# Bad Vertex Gap Vertex(-10, -10, 10) 0.002 2e-05   (four times, one per top corner)
print(round(max(e.tolerance for e in part.edges()), 6))  # 0.004: the stitched top edges
print(Box(10, 10, 10).check())                          # []
```

## Related
`is_valid`, `features/heal`, `surfaces/stitch`, `files/import_step`.
