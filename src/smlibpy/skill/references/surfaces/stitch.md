# stitch

Sews faces and sheets along their common edges. Returns a `Part` when the result is a closed,
valid solid, otherwise a `Shell`.

## Signature
`stitch(*pieces, tolerance=None)`

- `pieces`: any mix of `Shell`s (from `surface`, `ruled`, `loft`, `extrude` of curves, ...),
  `Sketch`es (`make_face`), `Face`s (`part.faces()` works directly, no `to_shell()` needed),
  `Part`s, and lists or nested lists of them. `stitch(a, b, c)`, `stitch([a, b, c])` and
  `stitch(a, [b, c])` are the same.
- `tolerance`: see Gaps. Leave it at `None`.

## Returns
- `Part` when every edge is shared by two faces and the body is a valid solid. Face normals are
  made consistent and outward, whatever their direction in the input (`normal_at()` of every
  face points out, volume positive).
- `Shell` otherwise. **A failed close is not an error.** Always check
  `isinstance(result, Part)`.
- An open `Shell` result keeps **each face's input normal**; nothing is unified. A Shell with
  mixed normals thickens to a volume-0 Part (or `KernelError`). Orient the pieces before
  stitching when the result stays open and will be thickened (see `generic`).

## Finding what did not close
Free edges are edges with one face:

```python
free = [e for e in block.edges() if len(e.faces()) == 1]
```

0 free edges and a `Shell` means sewn shut but not a valid solid (see Gaps). Print
`e.center()` of the free edges to see where the hole is. Duplicate faces or three faces on one
edge also give a `Shell` with free edges, without an error.

## Gaps
stitch joins the topology; it **never moves geometry**. Gaps end up inside the tolerances.

- Without `tolerance`, gaps up to about 0.35 % of the bbox diagonal close (10 mm cube: a top
  face 0.06 off closes, 0.07 does not). `tolerance` cannot make this stricter.
- For larger gaps, `tolerance` ≥ gap sews the edges but returns a `Shell` (0 free edges, not
  manifold). `stitch(that_shell)` then gives a `Part`.
- Such a Part is "valid" and keeps the gap: a cube with its top face 0.5 mm too high stitched
  with `tolerance=1` has volume 1050 (face at z 5.5) but `bbox()` and vertices at z 5.0. STEP
  export keeps the broken body.

Do not fix gaps with tolerance. Build the pieces so they meet exactly: make neighbouring faces
from the **same curves** (an edge of one face is the curve of the next, as in the example).

## Gotchas
- Closed surfaces close with caps: a closed `surface` tube + `make_face(e)` for each of its two
  boundary edges gives a valid Part (9424.761 vs 9424.778 exact). A torus grid (closed both ways)
  alone: `stitch(torus)` is a Part.
- `make_face(edge)` makes a cap from a closed planar edge, also a bspline one.
- Pieces of a polyline: `ruled` per edge, then stitch, gives one Shell (shared edges merged).
- `stitch` of an existing valid Part returns it as a Part.

## Errors
- `ValueError: nothing to stitch`: empty input.
- Everything else comes back as a `Shell` instead of an error (see Returns).

## Example
Freeform top, four ruled walls down to z = 0 and a flat bottom, closed into a solid. The walls
are ruled from the top's own boundary edges, so they meet it exactly.

```python
import math

h = lambda x, y: 10 + 3 * math.sin(x / 10) * math.cos(y / 12)
top = surface([[(x, y, h(x, y)) for y in np.linspace(0, 40, 9)] for x in np.linspace(0, 60, 13)])
walls = []
for e in top.edges():                                  # the top's own boundary curves
    a, b = e.start, e.end
    walls.append(ruled(e, Line((a.x, a.y, 0), (b.x, b.y, 0))))   # same direction as e
bottom = make_face(Polyline((0, 0, 0), (60, 0, 0), (60, 40, 0), (0, 40, 0), close=True))

block = stitch(top, walls, bottom)
if not isinstance(block, Part):                        # a Shell: something did not close
    free = [e for e in block.edges() if len(e.faces()) == 1]
    raise ValueError(f"{len(free)} free edges, e.g. at {free[0].center()}")
print(block.is_valid(), round(block.volume, 2), len(block.faces()))   # True 23997.28 6
```

The volume matches the integral of h over the rectangle (23997.27).

## Related
`surface`, `ruled`, `make_face`, `Face.to_shell`, `Shell`, `Shell.heal`, `generic`
