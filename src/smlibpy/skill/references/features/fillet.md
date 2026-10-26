# fillet

Rounds edges of a part.

## Signature
`part.fillet(edges, radius, *, continuity=None, fullness=1.0, propagate=True, corners="patch", setback=None)`
`fillet(edges, radius, **same keywords)` (finds the part the edges belong to)

- `edges`: a selection (`ShapeList`), one `Edge`, or faces (all their edges). Edges from an
  earlier version of the same part are matched by position, so a selection made before a cut
  still works if the edge did not change.
- `radius`: a number; a list with one radius per edge, in selection order; or a varying radius:
  - a `(start, end)` tuple runs linearly along each run of selected edges that meet tangentially
    (one edge, or a chain such as a rounded plate's top run, which `propagate` adds), in
    proportion to the length along it. The run goes the way of its first selected edge (from its
    `start` to its `end`; check `edge.start`) and starts at the end of the run that way begins.
    Not around a closed run or a closed edge (a hole rim: the radius would jump back at the start).
  - a dict `{position: radius}` sets the radius at positions along each run (0 its start, 1 its
    end; a missing 0 or 1 takes the radius given nearest it) and joins them smoothly without
    overshooting (flat at the ends and at each largest and smallest radius): `{0: 1, 0.5: 3, 1: 1}`
    swells in the middle. Around a closed edge (a rim) its radius at 1 must be the one at 0 (a
    missing one takes it); around a closed run of several edges it cannot vary (the kernel builds
    broken rounds there: `ValueError`).
  Varying radii make circular rounds only (not with `continuity`). Selected edges of different
  runs that still meet tangentially raise `ValueError` (the kernel would bend both laws to one).
- `continuity`: `None` circular arc. `"G1"`, `"G2"`, `"G3"` (or 1, 2, 3; case does not matter)
  make a blend instead: it meets the faces at the same setback as the circular round but bulges
  more (removes less: 4 vertical box edges r5 remove 429.2 circular, 400.0 G1, 270.7 G2, 212.0 G3).
  A picture shows the difference: `render(part, zebra=True)` (stripes kink at a circular round,
  bend smoothly into a G2 blend) or `render(part, curvature="max")` (one color against a ramp
  from white); see `recipes/verification`. Where three blended edges meet, the corner patch is
  tangent continuous (G1) only, whatever `continuity`: the stripes kink at such a corner (the
  kernel's corner patches are G1). Keep three-edge corners out of Class-A areas.
- `fullness`: blends only (ignored for circular). Below 1 flatter, above 1 fuller. 0.5 to 1.2
  work; 1.5 and 2.0 fail on a box edge with the radius error message.
- `propagate`: `True` (default) also rounds the edges that continue a selected edge
  tangentially, its `tangent_chain()` (see `selection/tangent_chain`): one top edge of a plate
  with rounded corners rounds the whole top outline (r 1: 11757.4972, as OpenCASCADE, which
  always does this). An added edge takes the radius of the selected edge it continues; a radius
  list still has one radius per selected edge. `False` rounds the selected edges only: an edge
  that runs on tangentially at one end is rounded and the round runs on past that end (see
  Returns); one that runs on tangentially at both ends often fails, and the `KernelError` then
  names the edge and where it runs on.
- `corners`: where three rounded edges meet. `"patch"` (default) joins the rounds with a corner
  patch (a ball corner for equal radii). `"mitre"` runs the rounds on until they meet each other
  along mitre lines, no patch (machined look): all edges of a 40x30x20 box r 3, 23354.2820 and
  18 faces against 23340.8494 and 26. Mitred are the corners of three rounded convex edges and no
  other edge (others keep their patch); a selection without one raises `ValueError`. Works with
  `continuity` and radius lists.
- `setback`: set the corners back: the rounds stop `setback` from the corner along each of its
  edges and one larger patch joins them (a softer corner than the ball, as on molded parts): all
  edges of a 20 mm cube r 2, `setback=3`: 7781.6093 against 7804.6961, its 12 rounds 14 long, 6
  patch faces a corner. Set back are the corners where three or more rounded edges meet and no
  other edge, all convex (a box's outside corners) or all concave (a pocket's floor corners);
  others keep their usual patch, and a selection without one raises `ValueError`. The setback
  must exceed how far the rounds reach along the corner's edges (the radius at a right-angled
  corner: `setback=2` with r 2 raises) and stay below each such edge's length (half of it with
  both ends set back). Constant radii (also lists and blends) only, not with `corners="mitre"`.
  Corners between slanted faces (a frustum's) the kernel often cannot set back: `KernelError`.

## Returns
A new `Part`. One face per rounded edge plus corner patches. Removed volume per straight
convex 90° edge: `(r² − π r²/4) * length`. Where an edge runs on into an edge that is not
rounded (at a kink, as around a polygon, or tangentially with `propagate=False`, as into the
arc of a rounded corner), the kernel extends the round past the end until it leaves the
material, so more is removed. With `propagate` (the default) a tangential run-on is rounded
with the edge.

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
  not rounded, are not bounded). Where the kernel fails or its body is refused, smlibpy tries
  once more with the rounds' edges closer to the faces (as the kernel's own all-edge fillet
  builds them), which is exact closer to the limit. A 10 mm cube with all edges: r 4.97, 4.98,
  4.995 and 4.999 are right; r 4.99 raises `ModelingError`; r 5 raises. A 20 mm cube: r 9.98 and
  9.99 are right. Stay 2% or more below the limit, and compare the volume with a formula.
- A single edge can take a radius up to the full face width (one edge of a 10 cube with r 10
  gives the exact quarter cylinder).
- `r <= 0` raises `ValueError: fillet: the radius must be positive`.
- The part must be valid: an invalid input raises `ModelingError: fillet: the part is not a
  valid solid (...); check is_valid() after each step and fix the step that broke it`.

## Order
- Where rounds of different radii meet at a corner, give them in one call with a radius list,
  or round the larger radius first. Small first, then large, leaves a dented corner
  (picture in training; volume 25199.4 vs 25154.7).
- Fillet after the Booleans that create the edges; select the new edges with
  `part.edges().joining(plate, boss)` (the edges where the bodies meet, see `selection/joining`),
  `part.edges().new(since=[plate, boss])` (the curves where their faces cross, see
  `selection/history`) or by geometry (`circles()`, `concave()`, radius filters). Edges taken
  before a cut that split them stand for their pieces: `(box - slot).fillet(box.edges().top(), 1)`
  rounds all of them.
- Fillet before `shell` when the walls should follow the rounds (see `shell`).

## Errors
- `ModelingError: fillet: the radius is too large; the rounds on edges 10 apart would overlap (largest possible setback here: 5)`
- `KernelError: fillet failed (SM_ERR): the radius may be too large for the selected edges`
- `KernelError: fillet failed (SM_ERR_NULL_POINTER): the kernel failed inside the fillet (it met a
  null pointer of its own), which says nothing about the radius (it fits the faces around the
  edges): round the edges in smaller groups to find the one it fails at` (smlibwasm, for a trap:
  `the kernel crashed in the fillet (...)`)
- `KernelError: fillet failed (SM_ERR): the kernel could not build the corner at (3.71765, -10, 0.942249) (unable to compute geometry); the radius may be too large for the selected edges`:
  the kernel's fillet code names the corner (a vertex) or the edge it could not build (`the round
  of the edge from ... to ...`), and why where it says, with the step that failed where it is
  more than a failure (`(unable to process rollover: a side of the round does not reach the edge
  it should end on)`, `... the offsets of its faces did not meet`, `... its solver did not
  converge`, `... it could not trace the round's surface`). Look there: a tiny edge, a face that
  meets the round almost tangentially, a corner where a smaller radius or fewer edges help.
  Without a place (`the radius may be too large for the selected edges` alone) it recorded none.
- `KernelError: fillet failed (SM_ERR): the edge from (15, 15, 10) to (-15, 15, 10) runs on tangentially into an edge that is not selected at (15, 15, 10) and (-15, 15, 10), which the kernel cannot always round alone; select the whole run (propagate=True, the default, or edge.tangent_chain())`:
  only with `propagate=False`.
- `KernelError: fillet failed: the size is too large for the selected edges` when the result
  of rounding only convex edges has more volume than before (smlibpy's own check).
- `ModelingError: fillet: the kernel returned a wrong body (the volume changed by 988.809, at most 804.757 is possible); the radius 4.99 is too close to the largest the selected edges allow, use a smaller one`
- `KernelError: fillet failed (SM_ERR_INVALID_INPUT): the kernel cannot round the selection as given, at any size: it could not build the corner at (15, 10, 5) (it has no corner for the way the rounded edges meet there); select fewer edges there`
  (a boss tangent to a side of the part), or without the corner `...: an edge whose faces meet ...`:
  an edge whose faces meet almost tangentially, or a vertex where the selected edges meet in a
  way the kernel has no corner for (the two halves of an edge that another face touches
  tangentially; edges between duplicated vertices of an imported part). A smaller radius does
  not help; select fewer edges there. (Chamfers say the same.)
- `ValueError: fillet: the radius must be positive`
- `ValueError: 2 radii for 4 edges`; `ValueError: continuity must be G1, G2 or G3`.
- `ValueError: fillet: corners="mitre" mitres the corners where three rounded convex edges meet and no other edge, and the selection has none (round all three edges of a corner)`;
  `ValueError: fillet: corners must be "patch" or "mitre", not 'round'`.
- `ValueError: fillet: the setback must exceed how far the rounds reach along the edges of the corner at (10, -10, 10) (2); give a larger setback`;
  `ValueError: fillet: the setback 10 is too large for the edge from (10, -10, 10) to (10, 10, 10) (20 long, set back at both ends): its corners would meet; give a setback below 10`;
  `ValueError: fillet: setback= sets back the corners where three or more rounded edges meet and no other edge, all convex or all concave, and the selection has none (round every edge of a corner)`;
  `ValueError: fillet: a corner is mitred (corners="mitre") or set back (setback=), not both`.
- `ValueError: fillet: a varying radius ((start, end) or {position: radius}) makes circular rounds only; continuity needs a constant radius`
- `ValueError: fillet: a (start, end) radius cannot run around a closed edge (through (10, 0, 10)): it would jump back to the start radius there; give a constant radius, or {position: radius} with one radius at 0 and 1`
  (also `... a closed run of edges ...`);
  `ValueError: fillet: a radius that varies around a closed run of 8 edges (through (-15, -15, 10)) is not possible: the kernel builds broken rounds there; vary it along an open run or around a single closed edge, or give a constant radius`;
  `ValueError: fillet: around a closed edge (through (10, 0, 10)) the radius at position 1 is the one at 0 (where it starts and ends); give them alike (1 and 2)`;
  `ValueError: fillet: a varying radius runs along each run of edges that meet tangentially, and two selected edges of different runs meet tangentially at (15, 15, 5), where the kernel would bend both laws to one radius; give a constant radius there`;
  `ValueError: fillet: a position along the run lies from 0 (its start) to 1 (its end), not 2`;
  `ValueError: fillet: the selection has open and closed runs of edges, which take a missing radius at position 0 or 1 differently; give both`
- `ValueError: Edge(...) is not an edge of this part` (an edge of another body, with no
  descendant in this part and none in the same place); with the function form and edges of no
  part: `ValueError: these edges do not belong to a part; call part.fillet(edges, ...) instead`.

## Example
```python
box = Box(40, 30, 20)
rounded = box.fillet(box.edges().parallel_to(Z), 5)     # 4 vertical edges
print(round(box.volume - rounded.volume, 4))            # 429.2037 = 4 * (25 - 25*pi/4) * 20

lid = box.fillet(box.faces().top(), 3)                  # a face: its edges
ramp = box.fillet(box.edges().parallel_to(Z).first, (2, 8))  # radius 2 at the edge start, 8 at its end
swell = Cylinder(10, 20).fillet(Cylinder(10, 20).edges().top(), {0: 1, 0.5: 3})  # around the rim: 1, 3, 1
stepped = box.fillet(box.edges().parallel_to(Z), [2, 4, 6, 8])  # one radius per edge, in selection order
soft = box.fillet(box.edges().parallel_to(Z), 5, continuity="G2")  # curvature-continuous, same setback 5
mitred = box.fillet(box.edges(), 3, corners="mitre")    # rounds meet along mitre lines, no corner balls
print(round(mitred.volume, 4), len(mitred.faces()))     # 23354.282 18
softer = box.fillet(box.edges(), 3, setback=5)          # rounds stop 5 from each corner, one patch joins them

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

# one edge of a tangent run rounds the whole run (propagate=True, the default)
plate = Rectangle(40, 30, fillet=5).extrude(10)
long = plate.edges().filter(lambda e: abs(e.center().z - 10) < 1e-6).sort_by("length")[-1]
outline = plate.fillet(long, 1)                         # all 8 top edges, as plate.fillet(long.tangent_chain(), 1)
print(round(outline.volume, 4))                         # 11757.4972

# a radius that runs along a whole open run: 1 at its start, 3 at its end
b = Box(40, 30, 10)
b = b.fillet(b.edges().parallel_to(Z).filter(lambda e: e.center().x > 0), 5)
first = b.edges().filter(lambda e: abs(e.center().z - 5) < 1e-6 and e.geom_type == "line"
                         and abs(e.center().y + 15) < 1e-6)[0]     # (-20, -15, 5) to (15, -15, 5)
tapered = b.fillet(first, (1, 3))                       # line, arc, line, arc, line: 1 -> 3
print(round(tapered.volume, 3))                         # 11795.876

# a look at the rounds before making them: one untrimmed sheet per edge, the part unchanged
sheets = box.fillet_preview(box.edges().parallel_to(Z), 5)
show(box, *sheets)

cube = Box(10, 10, 10)
try:
    cube.fillet(cube.edges(), 6)
except ModelingError as e:
    print(e)   # fillet: the radius is too large; the rounds on edges 10 apart would overlap (largest possible setback here: 5)
```

## fillet_preview
`part.fillet_preview(edges, radius, *, propagate=True)` gives the surfaces the rounds of a
circular fillet would have, one untrimmed sheet (`Shell`) per edge, without changing the part
(the kernel's preview: corners are not made, rounds not trimmed). For a look in the viewer before
the fillet; a preview that succeeds does not promise the fillet will. Errors as `fillet`.

## Related
`chamfer`, `shell`, `Sketch.fillet` (2D corners), `Wire.fillet`, `FilletPolyline`,
`ShapeList.concave()`, `ShapeList.parallel_to()`, `Edge.tangent_chain()` (`selection/tangent_chain`).
