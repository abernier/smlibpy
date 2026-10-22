# stitch

Sews faces and sheets along their common edges. Returns a `Part` when the result is a closed,
valid solid, otherwise a `Shell`.

## Signature
`stitch(*pieces, tolerance=None, report=False)`

- `pieces`: any mix of `Shell`s (from `surface`, `ruled`, `loft`, `extrude` of curves, ...),
  `Sketch`es (`make_face`), `Face`s (`part.faces()` works directly, no `to_shell()` needed),
  `Part`s, and lists or nested lists of them. `stitch(a, b, c)`, `stitch([a, b, c])` and
  `stitch(a, [b, c])` are the same.
- `tolerance`: the widest gap to close (default 1e-4 of the size of all pieces together). Edges
  and vertices further apart stay open. Edges that meet closely are sewn first, looser ones after
  them, doubling up to the tolerance.
- `report`: `True` returns `(body, report)`, a `StitchReport`: `sewn_edges`, `open_edges` (free
  edges left), `max_gap` (the widest gap closed, 0 where the pieces met exactly), `turned_faces`,
  `tolerance` (the widest one looked for).

## Returns
- `Part` when every edge is shared by two faces and the body is a valid solid. Face normals are
  made consistent and outward, whatever their direction in the input (`normal_at()` of every
  face points out, volume positive). Also across T-junctions (one long edge against two short
  ones): the bottom and sides of `Box(20, 10, 10)` with the tops of two `Box(10, 10, 10)` give a
  valid Part of 2000.
- `Shell` otherwise. **A failed close is not an error.** Check `isinstance(result, Part)`, or
  `report.open_edges`.
- An open `Shell` has its normals made to agree: each connected piece keeps the normal of its
  first face (in the order given), and the faces sewn to it are turned to match
  (`report.turned_faces`). Such a Shell thickens: floor (normal +Z) and wall (normal away from the
  floor) stitched give `thicken(1)` = 190 (the floor's side), wall first: 210.

## Finding what did not close
Free edges are edges with one face:

```python
body, report = stitch(pieces, report=True)
print(report.open_edges, report.max_gap)
free = [e for e in body.edges() if len(e.faces()) == 1]
```

Print `e.center()` of the free edges to see where the hole is. Duplicate faces or three faces on
one edge also give a `Shell` with free edges, without an error.

## Gaps
stitch joins the topology; it **never moves geometry**. A gap it closes ends up inside the
tolerances, so it only closes gaps up to `tolerance`:

- Default (1e-4 of the size): a box of 10 mm closes gaps up to 0.0017. The faces of a
  `Box(200, 100, 100)` each moved by up to 0.03 along each axis: with `tolerance=1e-4` nothing is
  sewn (26 free edges, a Shell; before 0.5.0 a "valid" Part); with `tolerance=0.2` a valid Part,
  `max_gap` 0.085.
- Five faces of `Box(10, 10, 10)` and the top 0.1 too high: without a tolerance a Shell with 8
  free edges; with `tolerance=0.2` a valid Part (`max_gap` 0.1), its volume 1010 (the top face
  stays at z 5.1 while its edges are at 5.0): `volume` warns that the faces do not meet.

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
- `ValueError: stitch: the tolerance must be a positive distance`.
- Everything else comes back as a `Shell` instead of an error (see Returns).

Before 0.5.0 `tolerance` was ignored for closed bodies (gaps up to 0.35 % of the diagonal were
closed whatever it was), a body sewn shut with it came back as a `Shell`, and open results kept
mixed normals. Scripts that relied on the old closing of larger gaps pass `tolerance=`.

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
`surface`, `ruled`, `make_face`, `fill`, `Face.to_shell`, `Shell` (`flipped`), `Shell.heal`, `generic`
