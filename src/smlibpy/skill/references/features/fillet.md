# fillet

Rounds edges of a part.

## Signature
`part.fillet(edges, radius, *, continuity=None, fullness=1.0)`
`fillet(edges, radius, **same keywords)` (finds the part the edges belong to)

- `edges`: a selection (`ShapeList`), one `Edge`, or faces (all their edges). Edges from an
  earlier version of the same part are matched by position, so a selection made before a cut
  still works if the edge did not change.
- `radius`: a number; a `(start, end)` tuple for a linearly varying radius (start = the edge's
  `start` point; check `edge.start`); a list with one radius per edge, in selection order.
- `continuity`: `None` circular arc. `"G1"`, `"G2"`, `"G3"` (or 1, 2, 3; case does not matter)
  make a blend instead: it meets the faces at the same setback as the circular round but bulges
  more (removes less: 4 vertical box edges r5 remove 429.2 circular, 400.0 G1, 270.7 G2, 212.0 G3).
  A picture shows the difference: `render(part, zebra=True)` (stripes kink at a circular round,
  bend smoothly into a G2 blend) or `render(part, curvature="max")` (one color against a ramp
  from white); see `recipes/verification`.
- `fullness`: blends only (ignored for circular). Below 1 flatter, above 1 fuller. 0.5 to 1.2
  work; 1.5 and 2.0 fail on a box edge with the radius error message.

## Returns
A new `Part`. One face per rounded edge plus corner patches. Removed volume per straight
convex 90° edge: `(r² − π r²/4) * length`. Where an edge runs on into an edge that is not
rounded (tangentially, as into the arc of a rounded corner, or at a kink, as around a polygon),
the kernel extends the round past the end until it leaves the material, so more is removed.

## What can be rounded
- Seam edges and smooth (tangent) edges in the selection are skipped. A selection with only
  those raises `ValueError: fillet: the selection holds only seam or smooth edges, nothing to fillet`.
- Concave edges add material (a boss root): `part.edges().concave()`.
- Circular edges (hole rims, cylinder ends) work.

## Limits
- smlibpy checks edges that run alongside each other on a face: two rounded edges `d` apart
  allow `r <= d/2`; one rounded edge next to an unrounded one allows `r <= d`. A larger radius
  raises a `ModelingError` that names the largest setback.
- **Right at the limit the kernel can return a wrong body.** smlibpy checks that the result
  is a valid solid and that its volume changed by no more than rounds of that size can remove
  or add (edges that are neither lines nor circles, and edges that run on into an edge that is
  not rounded, are not bounded). A 10 mm cube with all
  edges r 4.99 raises `ModelingError`; r 4.97 and r 4.999 are right; r 5 raises. Stay 2% or
  more below the limit, and compare the volume with a formula.
- A single edge can take a radius up to the full face width (one edge of a 10 cube with r 10
  gives the exact quarter cylinder).
- `r <= 0` raises `ValueError: fillet: the radius must be positive`.
- The part must be valid: an invalid input raises `ModelingError: fillet: the part is not a
  valid solid (...); check is_valid() after each step and fix the step that broke it`.

## Order
- Where rounds of different radii meet at a corner, give them in one call with a radius list,
  or round the larger radius first. Small first, then large, leaves a dented corner
  (picture in training; volume 25199.4 vs 25154.7).
- Fillet after the Booleans that create the edges; select new edges by geometry (`circles()`,
  `concave()`, radius filters).
- Fillet before `shell` when the walls should follow the rounds (see `shell`).

## Errors
- `ModelingError: fillet: the radius is too large; the rounds on edges 10 apart would overlap (largest possible setback here: 5)`
- `KernelError: fillet failed (SM_ERR): the radius may be too large for the selected edges`
- `KernelError: fillet failed: the size is too large for the selected edges` when the result
  of rounding only convex edges has more volume than before (smlibpy's own check).
- `ModelingError: fillet: the kernel returned a wrong body (the volume changed by 988.809, at most 804.757 is possible); the radius 4.99 is too close to the largest the selected edges allow, use a smaller one`
- `ValueError: fillet: the radius must be positive`
- `ValueError: 2 radii for 4 edges`; `ValueError: continuity must be G1, G2 or G3`.
- `ValueError: Edge(...) is not an edge of this part`; with the function form and edges of no
  part: `ValueError: these edges do not belong to a part; call part.fillet(edges, ...) instead`.

## Example
```python
box = Box(40, 30, 20)
rounded = box.fillet(box.edges().parallel_to(Z), 5)     # 4 vertical edges
print(round(box.volume - rounded.volume, 4))            # 429.2037 = 4 * (25 - 25*pi/4) * 20

lid = box.fillet(box.faces().top(), 3)                  # a face: its edges
ramp = box.fillet(box.edges().parallel_to(Z).first, (2, 8))  # radius 2 at the edge start, 8 at its end
stepped = box.fillet(box.edges().parallel_to(Z), [2, 4, 6, 8])  # one radius per edge, in selection order
soft = box.fillet(box.edges().parallel_to(Z), 5, continuity="G2")  # curvature-continuous, same setback 5

# different radii that meet at corners: one call with a list, or the larger radius first
blk = Box(30, 30, 30)
edges = list(blk.edges().parallel_to(Z)) + list(blk.faces().top().edges())
both = blk.fillet(edges, [8] * 4 + [3] * 4)
print(both.is_valid(), round(both.volume, 3))           # True 25154.747

# concave edges add material
part = Box(60, 40, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
part += Cylinder(10, 12, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate(0, 0, 8)
part = part.fillet(part.edges().concave(), 2)           # root of the boss

# rounding a hole's rim: select the circle by radius and height
plate = Box(60, 40, 8) - Cylinder(5, 20)
rim = plate.edges().circles().filter(lambda e: abs(e.radius - 5) < 1e-6 and e.center().z > 0)
plate = plate.fillet(rim, 1)

cube = Box(10, 10, 10)
try:
    cube.fillet(cube.edges(), 6)
except ModelingError as e:
    print(e)   # fillet: the radius is too large; the rounds on edges 10 apart would overlap (largest possible setback here: 5)
```

## Related
`chamfer`, `shell`, `Sketch.fillet` (2D corners), `Wire.fillet`, `FilletPolyline`,
`ShapeList.concave()`, `ShapeList.parallel_to()`.
