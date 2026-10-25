# smlibpy and smlibwasm 0.5.0

This release comes out of a review of smlibpy and smlibwasm against the SMLib kernel they wrap
([kernel-deep-dive.md](kernel-deep-dive.md)). It fixes the silent wrong results, crashes, hangs and
leaks the review found, and adds what it found missing: direct editing of faces, fills and blends of
sheets, curve tools, mesh tools, drawings with hidden lines, IGES and OpenCASCADE files, a worker
entry for smlibwasm, and more. What the kernel still gets wrong, and smlibpy refuses or contains, is
under [Known kernel limitations](#known-kernel-limitations), each with its evidence and workaround;
what goes beyond this release is under [Later](#later).

It is a **breaking release**. Where a result was wrong, it is now right or an error that says what
to change; a few defaults that gave wrong numbers changed; some functions return other types; faces
that are planes, cylinders, cones, spheres or tori now say so where they said `bspline`. Read
[Breaking changes](#breaking-changes) and [Migrating from 0.4](#migrating-from-04) before you
upgrade.

Everything applies to smlibpy (Python) and smlibwasm (JavaScript and TypeScript: camelCase names, an
options object for keywords, methods for operators) alike, unless marked *Python* or *smlibwasm*.
Codes in parentheses (B6, F9, ...) are the items of the plan, which gives each one's evidence and
status. Numbers were measured on macOS arm64, smlibwasm in Node 22.

## Breaking changes

Each line links to what to change.

Results that were wrong now raise an error:

- Booleans refuse a wrong empty cut, an intersection or union that gives an operand back unchanged,
  a cut that reaches out of the part, a result that a seam touching the other operand at a point
  made wrong, a merge that loses or gains volume, and cells that do not add up to their part
  ([more](#booleans-that-refuse-a-wrong-result)).
- `is_valid()` is False for a body whose faces leave gaps that make its volume uncertain by 1e-2 or
  more, and features refuse such a body ([more](#is_valid-checks-booleans-and-gaps)).
- Fillets refuse a `(start, end)` radius with `continuity` or around a closed edge, and a radius
  that varies around a closed run of several edges; chamfers refuse an edge whose angle changes
  along it ([more](#radius-laws-and-chamfers-that-raise)).
- `shell`, `offset` and `thicken` refuse results with gaps, without a cavity or of the wrong volume,
  and walls that do not fit; a step longer than 20 s is stopped, and so are fillets and chamfers of
  parts read from files and `cells()` ([more](#shells-and-offsets-that-raise)).
- Sweeps, extrusions and tapers that made bodies through themselves, open bodies or bodies shorter
  than asked raise; an extrusion direction in the sketch plane, a taper's direction across the
  sketch normal and a taper of an open curve are a `ValueError`
  ([more](#sweeps-and-extrusions-that-raise)).
- `section()` with a plane that only touches the part raises `ValueError` ([more](#sections)).
- 2D Booleans of faces that touch at a point raise where no way gives a sound region
  ([more](#2d-booleans)).
- `Wire.fillet` raises for points that are not corners, and rounds corners at arcs and splines
  ([more](#wirefillet)).
- `import_usd` leaves out (or with `strict=True` refuses) malformed values and broken bodies of
  other software; an empty body cannot be meshed or written to USD ([more](#usd),
  [more](#empty-bodies)).
- `export_step` of a list that holds an empty body, and `export_glb`, `export_gltf` and
  `export_obj` of nothing, raise `ValueError` where they left the body out or wrote a file with
  nothing in it ([more](#empty-bodies)).

Defaults and results that changed:

- `fillet` and `chamfer` round the whole tangent run of a selected edge (`propagate=True`)
  ([more](#fillets-and-chamfers-follow-tangent-runs)), and a `(start, end)` radius runs along the
  whole run, not along each edge on its own ([more](#radius-laws-and-chamfers-that-raise)).
- `unfold`, `flat_pattern` and `bends` take each bend's own K-factor; the default `k_factor` is
  `None` ([more](#k-factors)).
- `stitch` closes gaps up to `tolerance` only, returns Parts when closed and turns open sheets to
  agree ([more](#stitch)); a mirrored sheet faces as the sheet does ([more](#mirrored-sheets)).
- `Edge.intersections` has a tolerance that scales with the size, returns `[]` for no hit and each
  point once ([more](#edge-intersections)).
- `import_step` leaves out a body it cannot read, with a warning, and stitches bodies whose faces
  share no edges ([more](#step-import)).
- `silhouette()` returns the whole contour, seen and hidden; `outline()` draws each line once and
  leaves out the specks of edges seen end-on, so views have fewer edges ([more](#silhouette)).
- Closed `Spline`s are curvature continuous at the seam; a list of tangents as long as the points is
  one per point ([more](#splines)).
- Profiles keep their attitude along 3D paths and helices, turn gradually round closed 3D paths with
  corners so that they meet where the loop closes, and sit on the path by the center of their own
  box (`anchor=` picks another point) ([more](#where-a-swept-profile-sits)).
- A selection taken before an edit stands for the pieces of its faces and edges
  ([more](#old-selections-stand-for-their-pieces)).
- `named()` and `colored()` share the body; their faces compare equal
  ([more](#named-and-colored-share-the-body)).
- `cells()` are named and colored after the parts they lie in; `solids()` separates a body in a
  cavity ([more](#cells-and-solids)).
- Seam edges of a tool, or of an earlier hole, that would run tangent to the other operand lie
  elsewhere ([more](#seam-edges-of-tools)).
- `convex()`, `concave()` and `smooth()` answer differently on imported parts and on edges creased
  away from their middle ([more](#convexity)).
- `info()` has more keys ([more](#info)).

Types that changed:

- `part + sheet` and `part - sheet` raise `TypeError`; `part & sheet` is a `Shell`
  ([more](#sheets-as-tools)).
- `Shell.heal()` can return a `Part` ([more](#shellheal)).
- A merged part saved as `.smb` loads as a `Part`; `save(..., "x.smp")` writes an SMLib part file
  ([more](#smb-and-smp)).
- Several errors changed class: `ModelingError` where it was `KernelError`, `ValueError` where it
  was `KernelError` or `ModelingError` ([more](#error-classes)).

Faces and edges that are analytic now (`geom_type`): revolves, single line and arc sweeps, tapered
and oblique extrusions, deformations (a twist keeps cylinders, cones, spheres and tori about its
axis), scales that differ between the axes (their circular rims too), chamfers of circles and the
circles where they meet cylinders, USD round trips and STEP round trips of imported cylinders
([more](#analytic-faces-and-edges)).

Files that are written differently: glTF (linear colors, node translations, indexed triangles, a
primitive per face color), OBJ (normals, 12 digits), USD (analytic edges, display names, a color per
triangle, no open UV loops), STEP (offset surfaces, cylinders, encoded names, face colors, the
uncertainty in mm) ([glTF and OBJ](#gltf-and-obj), [USD](#usd), [STEP](#step-export)).

Messages that changed: hints of Booleans, fillets, chamfers, shells, offsets and `cells()`, and
`KernelError.detail` ([more](#messages)).

Python: new names in `from smlibpy import *`, fonts read without fontTools (`Text` raises
`FontError`), guarded steps in another process or held to a deadline, a kernel lock for threads
([more](#python), [fonts](#fonts)).

smlibwasm: options, `at(point)` and disposed bodies raise `TypeError`, C++ exceptions are `Error`s,
a kernel crash ends every step that would fall back on another kernel call, stricter TypeScript
types, a larger module ([more](#smlibwasm)).

## Migrating from 0.4

### Booleans and cells

#### Booleans that refuse a wrong result

A cut the kernel returns empty although the tools cannot hold the part, and an intersection that
returns an operand unchanged although the other does not contain it, raise `ModelingError` ("a
result that is empty", "partly outside an operand") where they returned an empty Part or the whole
part (B3). `merge` raises when its result holds less than its largest part or more than all parts
together (B5), and `cells()` when its cells do not add up to the part (B8). Right empty results are
accepted as before (B13). A `KernelError` is a `ModelingError` (not the other way round), so catch
`ModelingError` for both:

```python
# 0.4: Part(0 faces) or the whole part, no error
try:
    result = part - tool
except ModelingError as e:      # catches KernelError too
    print(e)                    # says why and what to try
```

```js
try { result = part.cut(tool) } catch (e) { if (e instanceof ModelingError) console.log(e.message) }
```

A union that returns one operand although the other reaches out of it is done again with the
operands the other way round (1446.6121, OpenCASCADE 1446.612107; 0.4: 1358.54), and a cut whose
result reaches out of the part raises "the kernel returned a result that is partly outside the
part" (`Cylinder(2, 12) - Cylinder(1.5, 30).rotate(Y, 90).translate(1, -0.5, 2.4787)` returned a
body of no volume, valid in 0.4). Where a seam of one operand (a torus' outer equator, the seam of
a free-form face) touches a face of the other at a point, the result's faces are checked against
the operands: a wrong result is done again with NURBS copies of the operands whose seams touch, or
raises "... wrong where a seam of one operand touches a face of the other at a point ..." (B6).
Move or turn the tool a little:

```python
part = Box(30, 30, 30) - Cylinder(5.997, 60).translate(2.016, 2.814, 0)
ring = Torus(3.546, 1.773).rotate(Y, 90).translate(8.013, 8.133, 6.396)
union = part + ring                            # 0.4: 23610.4720, the torus in the hole left out; now 23635.9574
try:
    rest = part - ring                         # 0.4: 23390.44 without an error
except ModelingError:
    rest = part - ring.translate(0.01, 0, 0)   # 23415.6468
```

#### is_valid() checks Booleans and gaps

Boolean results were marked sound when made, so `is_valid()` was True for a volume of -776.5 or an
intersection larger than its operand. `is_valid()` now integrates a body once when asked and is also
False where the gaps between its faces make its volume uncertain by 1e-2 or more; features refuse a
body whose gaps were measured so (B2). `check()` says what the kernel's own check finds (T4):

```python
if not part.is_valid():
    print(part.check())          # [Problem(...), ...]: face, edge or vertex, test, value, tolerance
part.is_valid(strict=True)       # also requires check() to be empty
```

#### Sheets as tools

`part + sheet` and `part - sheet` (a `Shell` or a face as the tool) returned invalid "Parts" and now
raise `TypeError` that names the operations to use; `part & sheet` returns the piece of the sheet
inside the part as a `Shell` instead of a "Part" of volume 0 (B12):

```python
marked = box.imprint(sheet)          # 0.4: box + sheet, an invalid "Part" with the sheet's lines
disc = part & sheet                  # a Shell now (stitch(part & sheet) still works)
halves = box.split(sheet, "both")    # split the part along the sheet
```

```js
const marked = box.imprint(sheet)
const disc = part.intersect(sheet)   // a Shell
const [above, below] = box.split(sheet, 'both')
```

#### Old selections stand for their pieces

A face or edge of an earlier version of a part, given to `fillet`, `chamfer`, `shell`, `draft`,
`remove_faces` or `flange`, stands for all its descendants in the part (T3): where a later cut split
it, every piece is rounded (it raised "is not an edge of this part"); where a union merged it with
an edge of the other body, the merged edge is taken. A list of radii gives each piece its edge's
radius. `flange` of an edge a cut split raises "give one edge of the part (got 2)". To round less,
select on the new part:

```python
box = Box(40, 30, 10)
joined = box + Box(40, 30, 10).translate(40, 0, 0)
joined.fillet(box.edges().top().parallel_to(X), 1)      # 0.4: raised; now the merged 80 mm edges
joined.fillet(joined.edges().top().filter_by(lambda e: e.center().x < 20), 1)   # select on the new part
```

#### Seam edges of tools

Where the seam of a cylinder, cone, sphere or torus of one operand would run tangent to a face of
the other, the Boolean turns that operand about its axis first (B6): the volume is right now, and
the seam edge and its vertices lie at another angle in the result (the groove pin's seam vertices at
(+-15, 6.414, -1.414), not (+-15, 5, -2)), and a face can be split along one edge differently.
The seam of an earlier hole or boss that a tool touches is moved on its face first (the hole's
solid added and cut away again turned), so its seam edge lies at another angle too, and a
B-spline operand whose seam touches goes in with its faces recognized: faces that were `bspline` in
a `to_nurbs()` operand can come back as `cylinder`, `cone`, `sphere` or `torus`. Select such edges,
vertices and faces by geometry, not by position or type:

```python
part = (Box(30, 30, 30) - Cylinder(5, 60)) - Cylinder(2, 60).rotate(Y, 90).translate(0, 5, 0)
# 0.4: part.vertices().filter_by(lambda v: abs(v.y - 5) < 1e-9 and abs(v.z + 2) < 1e-9) found the seam's ends
hole = part.faces().cylinders().filter_by(lambda f: abs(f.radius - 2) < 1e-9)
```

#### Named and colored share the body

`named()` and `colored()` return a body that shares the Brep of the original instead of a copy (T8):
each is still a shape of its own (`a.named("x") == a` is False), but their faces and edges are the
same (`a.faces()[0] == a.named("x").faces()[0]` is True, it was False), and a measure of one serves
both. smlibwasm: `dispose()` of a renamed body no longer frees the original's Brep. To get two
independent bodies, copy:

```python
b = a.named("b")                         # shares a's Brep
c = a.translate(0, 0, 0).named("c")      # a copy of its own, as named() gave before
```

#### Cells and solids

The cells of a merged part are named and colored after the parts they lie in (B15), also in STEP
files; they all had the first part's name and color. `solids()` gives a body inside a cavity of
another as a solid of its own (B16):

```python
m = merge(Box(40, 40, 20).named("block"), Cylinder(6, 30).named("insert"))
cells = [c.named(m.name) for c in m.cells()]                     # the merged part's name, as before
blocks = [c for c in m.cells() if c.sources[0].name == "block"]  # or select by source
caged = (Box(20, 20, 20) - Box(10, 10, 10)) + Box(4, 4, 4)
solids = caged.solids()                                          # [7000, 64]; 0.4: [7064]
outer = [s for s in solids if not any(o is not s and o.bbox().contains(s.bbox().min)
                                      and o.bbox().contains(s.bbox().max) for o in solids)]
```

#### Sections

`section()` with a plane that only touches the part (tangent to a cylinder, to the top of a torus,
through an edge) raises `ValueError` "the plane only touches the part" (B18): it raised a bare
`KernelError`, or returned a disc that is not in the part (`Torus(10, 2)` at z = 2: 314.159). A
section of a merged part has a region for every cell the plane cuts (B9: 1600, not 1486.903), and
the curves of a section lie on B-spline faces within 1e-7 of the part's size (the kernel fitted them
within a thousandth of each face's size: section areas of a part thickened from a B-spline sheet
change by up to 0.13 %, 207.006 for 207.266):

```python
try:
    s = part.section(plane)
except ValueError:        # smlibwasm: RangeError
    s = None              # the plane only touches the part
```

#### Empty intersections of touching bodies

An empty intersection or cut is judged by meshes and classified points of the operands, no longer by
the kernel's `brep_relationship`, which called overlapping bodies "touching" and changed its answer
with their position (B13). A right empty result that raised because of where the bodies were is
accepted now; a wrong one the relationship called "touching" raises. Code that caught the error for
touching bodies far from the origin gets the empty part:

```python
common = a.translate(101.3, -57.9, 33.1) & b.translate(101.3, -57.9, 33.1)   # 0.4: raised
if not common.faces(): ...                                                   # now: the empty Part
```

### Fillets and chamfers

#### Fillets and chamfers follow tangent runs

`fillet` and `chamfer` round the edges that continue a selected edge tangentially too
(`propagate=True`, F6), as OpenCASCADE, build123d and most CAD systems do. An edge that ran on
tangentially into an unselected one at both ends failed at any radius; one that did so at one end
worked and now rounds the whole run (14.4863 removed instead of 7.7959 below). Pass
`propagate=False` for the old selection:

```python
b = Box(40, 30, 10)
b = b.fillet(b.edges().parallel_to(Z).filter(lambda e: e.center().x > 0 and e.center().y > 0), 5)
line = b.edges().filter(lambda e: abs(e.center().z - 5) < 1e-6 and abs(e.length - 35) < 1e-9).one()
b.fillet(line, 1)                    # now: the line, the arc and the next line
b.fillet(line, 1, propagate=False)   # 0.4's result
```

```js
b.fillet(line, 1, { propagate: false })
```

#### Radius laws and chamfers that raise

- A `(start, end)` radius with `continuity` raises `ValueError` where start and end differ (F3): the
  kernel made a ruled chamfer, not a blend. `(2, 2)` makes the blend.
- A `(start, end)` radius runs linearly along each run of selected edges that meet tangentially
  (and of the edges `propagate` adds), in proportion to the length along it, from the end where the
  run's first selected edge begins (F5). 0.4 ran it along each edge on its own and the kernel bent
  the radii where the edges met (the top run of a rounded plate: 1.07 -> 2.93, 2.46 -> 1.04, 1.65
  -> 1.99 -> 1.07 along its pieces for `(1, 3)`; now 1.02 rising to 3.0). A dict `{position:
  radius}` sets the radius at positions along each run (0 its start, 1 its end), also around a
  single closed edge.
- Around a closed edge a `(start, end)` radius raises `ValueError` ("cannot run around a closed
  edge"; on a cylinder's rim the kernel's radius rose to 2.90 and fell back to 1 within the last 3 %
  of the edge), and so does any radius that varies around a closed run of several edges (the kernel
  builds an open body there, see [Known kernel limitations](#known-kernel-limitations)).
- A chamfer of an edge whose faces change their angle along it raises `ModelingError` (F4): the
  setback followed the angle. Round such edges with `fillet`.

```python
part.fillet(edge, (1, 3))                            # along the edge's whole tangent run
part.fillet(edge, (1, 3), propagate=False)           # along the selected edges only (a run-on may fail)
part.fillet(rim, {0: 1, 0.5: 3})                     # 1, 2, 3, 2, 1 around a closed edge
part.fillet(edges, 2, continuity="G2")               # a blend needs a constant radius
```

```js
part.fillet(edge, { start: 1, end: 3 }, { propagate: false })   // an array is a radius per edge
part.fillet(rim, new Map([[0, 1], [0.5, 3]]))
```

#### Chamfers of circles are cones

A chamfer of a full circle between faces around one axis (a shaft's end, a hole's rim, a revolved
part) is an exact cone now (F12): its face is a `cone` (it was a `bspline`), the edge where it
meets a plane at right angles to the axis is a circle (so `edges().circles()` finds it), and
volumes move to the exact value by up to 1.2e-5 (the flange example: 157979.6230 to 157979.6668).
The edge where the cone meets a cylinder or another cone is an exact circle too (the kernel's
intersection fitted it 8e-6 short on a pin of radius 2):

```python
pin = Cylinder(2, 5).chamfer(Cylinder(2, 5).edges(), 1)
pin.faces().of_type("cone")               # the two bevels (0.4: geom_type "bspline")
pin.edges().circles()                     # the bevels' 4 edges, on the end faces and the wall (0.4: none)
curved = pin.faces().filter_by(lambda f: not f.is_planar)   # bevels and wall, before and after
```

### Shells and offsets

#### Shells and offsets that raise

`shell`, `offset` and `thicken` refuse what they used to return (O2, O4): results whose faces leave
gaps of 1e-3 of the volume or more, shells without a cavity (`(Box(20, 20, 10) - Cylinder(3,
20)).shell(4)` returned the plate itself), closed shells of the wrong volume, and walls that do not
fit across the part (also turned parts: `Box(40, 30, 10).rotate(X, 45).shell(6)` gave two 6 mm walls
in a 10 mm part). They raise `ModelingError` with what was built. The kernel steps run in another
process (a forked copy, a helper process on Windows; smlibwasm: a probe worker), and a step longer
than `GUARD_SECONDS` (20 s) is stopped (O1, N1). So are the fillets and chamfers of parts read from
files and the stitcher of `cells()`, which had no time limit in 0.4: a large imported part whose
fillet takes longer than 20 s raises `ModelingError` "fillet: the kernel did not finish within 20 s;
smlibpy.defeature.GUARD_SECONDS sets the limit" (smlibwasm: "...; setGuardSeconds(seconds) sets the
limit"). Raise the limit for such parts:

```python
import smlibpy.defeature
smlibpy.defeature.GUARD_SECONDS = 120    # large imported parts
```

```js
setGuardSeconds(120)
```

#### info

`info()` has the keys `"solids"` and `"voids"` (T7), and `"corners"` (`"round"` or `"sharp"`) for a
body made by `shell` or `offset` (O12). Compare the keys you need, not the whole dictionary:

```python
info = part.info()
assert {k: info[k] for k in ("type", "faces", "edges", "vertices")} == expected
```

#### offset of other objects

`offset(x, d)` of an object without an offset raises `TypeError` ("offset takes a part, a sketch, a
sheet (Shell) or a face, not a ...") where it raised `AttributeError`; sheets, faces, wires and
edges are offset now (O7, C7). `offset(part, d, corners=...)` passes `corners` on where it raised
`TypeError` (O9).

```python
offset(sheet, 2)                 # 0.4: AttributeError; now the offset sheet
```

### Sweeps, revolves and extrusions

#### Where a swept profile sits

- Along 3D paths the profile keeps the orientation it was carried in (S1): each edge turned it
  afresh, by up to 90 degrees at a joint. Tangent edges are swept in one go (other face counts).
- Along helices, conical helices and chains of helices the profile keeps its attitude to the axis
  instead of rolling about 30 degrees a turn (S3): a thread tooth along `Helix(pitch=2, height=16,
  radius=5.6)` is 261.0274 (it was 270.8705, rolled).
- An asymmetric profile sits on the path by the center of its own box (S2): on single oblique edges,
  3D paths and mitered planar paths that do not start along X, Y or Z it moved by up to a third of
  its size (a triangle at 30 degrees: 845.8564, it was 839.8564). The box is the curves' own, not
  their control points' (the kernel's anchor, patched): an arc that does not span whole quadrants
  sat a little off (an 80-degree sector of radius 10 by 0.075 along a 3D polyline). Along a single
  full circle whose plane faced against the path's start it is no longer mirrored (S8: 279.6017, it
  was 285.8849).
- Round a closed path with corners that does not lie in a plane (a 3D `Polyline(..., close=True)`, a
  loop closed with a kink), a profile that is not round turns by the rotation the corners add up to
  gradually along the path, so that it meets itself where the loop closes (S3); it turned by all of
  it at the closing corner (8.5 to 29.8 degrees round three 3D polygons). Volumes change slightly.

There is no option for the old frames. `anchor=` names the point of the profile that goes on the
path, and that `scale` scales about (S2): `"center"` (the default, the center of its box),
`"origin"` (the origin of the sketch's plane) or a point of the profile's plane; moving the sketch
first changes nothing, as in 0.4. Drop workarounds that moved the path:

```python
ell = Polygon((0, 0), (6, 0), (6, -1), (-1, -1), (-1, 5), (0, 5))   # an L drawn by its inner corner
trim = sweep(ell, Line((0, 0, 0), (0, 0, 50)), anchor="origin")      # the corner on the path
```

- A thread tooth whose base lies exactly on the rod's surface only touches the rod now that the
  tooth keeps its attitude, and `rod + thread` raises `KernelError` ("the operands touch only along
  an edge, at a point or tangentially"; in 0.4 the rolling tooth cut into the rod). Sink the base a
  little into the rod: a helix radius 0.05 below rod radius + half the tooth's width.

```python
thread = sweep(Rectangle(2, 1), h)                     # 0.4: a loft through placed copies, 8 a turn
tooth = Polygon((0, -0.8), (0, 0.8), (1.2, 0))         # 1.2 wide, its base at x = 0
thread = sweep(tooth, Helix(pitch=2, height=16, radius=5.55, center=(0, 0, 2)))  # 0.4: radius=5.6
screw = Cylinder(5, 20, align=(Align.CENTER, Align.CENTER, Align.MIN)) + thread  # 1809.8079, one solid
c = tri.bbox().center                                  # 0.4's mirrored body along a full circle:
body = sweep(tri.mirror(Plane(c, z_dir=(1, 0, 0))), Circle(15).edges()[0])
```

#### Sweeps and extrusions that raise

- A profile that reaches across the axis of a single arc path raises `ModelingError` (S8); it gave a
  body that sweeps through itself, with too much volume. Make the bend larger than the profile.
- A loop closed with a kink (`Spline(*pts, pts[0])`) whose fused halves leave faces without area
  that cannot be taken out, or that is open between its faces, raises `ModelingError` (S1); the
  others come back with those faces taken out (4 faces where there were 5 to 7). Close such paths
  smoothly where you can.
- A tapered extrusion whose hole widens across the region before the end raises `ModelingError`
  (S9); it returned a shorter body (5.67 of 10).
- An extrusion direction within a sine of 1e-5 of the sketch plane raises `ValueError` (S14; it was
  `KernelError`), also with a taper; below a sine of 1e-3 it warns. An extrusion along a direction
  that the kernel built inside out or open is made again turned, then swept along the line, or
  raises `ModelingError`.
- `extrude(..., taper=t, direction=d)` takes `d` along the sketch normal only, either way (against
  it the taper goes that way); a direction across it raises `ValueError` ("a taper drafts the walls
  about the sketch normal"), and so does a taper of an open curve (S8). 0.4 ignored the direction
  and the taper.

```python
pipe = sweep(Circle(8), CenterArc((0, 0), 10, 0, 90))      # Circle(12) raises: it crosses the axis
ring = sweep(Circle(2), Spline(*pts, closed=True))         # rather than Spline(*pts, pts[0])
ring = (Circle(10) - Circle(8)).extrude(5, taper=10)       # 10 raises: the hole closes the ring
block = Rectangle(10, 10).extrude(10, taper=5)             # 0.4's result of direction=(1, 0, 1)
wall = extrude(Line((0, 0), (10, 0)), 5)                   # 0.4's result of taper=3
try:
    part = sketch.extrude(5, direction=d)
except ValueError:                                         # 0.4: KernelError
    part = sketch.extrude(5)
```

#### Analytic faces and edges

Faces that are planes, cylinders, cones, spheres or tori are built as such where they came out as
B-splines or surfaces of revolution, and `geom_type`, `cylinders()`, `planes()`, `circles()`,
`Face.radius`, `Face.axis`, `draft` and STEP files see them. Volumes are the same or move to the
exact value (by 1e-5 or less). Counts of faces change only where noted.

| Made by | Now | 0.4 |
|---|---|---|
| `revolve` (full turns of lines and arcs, arcs in part of a turn) (S4) | cylinders, cones, spheres, tori | surfaces of revolution |
| `sweep` along a single line or arc (S8) | planes, cylinders, cones, tori | B-splines |
| `extrude(taper=...)` of profiles with sharp corners (S9) | planes, fewer faces (an outward rectangle: 6, it had 14) | flat B-splines and slivers |
| `bend`, `taper`, `twist`, `Lattice` where the exact image is analytic (D2) | planes, cylinders, cones, lines, circles, with the analytic surface's parameters | B-splines |
| `twist` of cylinders, cones, spheres and tori about its own axis, bounded by full circles about it (D2) | the same faces, seams and circles | B-splines |
| `scale` that differs between the axes, shears (T6) | planes, cylinders, cones, surfaces of revolution and extrusion, lines, circles (rims after a scale along the axis) | B-splines |
| `extrude(..., direction=)` across the sketch normal (S8) | planes for straight edges | flat B-splines |
| chamfers of full circles (F12) | cones, and circles where they meet planes, cylinders and cones | B-splines |
| `import_usd` of other writers' files (X5) | lines, and circles on analytic faces | B-spline edges |
| imported cylinders written to STEP and read again (I11) | `CYLINDRICAL_SURFACE`, cylinders | B-splines |

Select by shape rather than by type where both can occur:

```python
walls = part.faces().cylinders()                             # 0.4: f.geom_type == "revolution"
curved = part.faces().filter_by(lambda f: not f.is_planar)   # works before and after
```

### Sketches and curves

#### Edge intersections

`Edge.intersections` returns `[]` where the edges do not meet (it raised `KernelError`), its
tolerance is 1e-6 or 1e-9 of the size of the two shapes (it was 0.001 absolute), each point comes
once (a closed curve's start came twice), an overlap gives both its ends, and points are ordered
along the edge (C5). `e.intersections(e)` raises `ValueError`:

```python
pts = a.intersections(b)                                  # 0.4: try/except KernelError
pts = a.intersections(b, tolerance=1e-3)                  # 0.4's tolerance: near misses count
crossings = e.self_intersections()                        # 0.4: e.intersections(e)
```

```js
a.intersections(b, { tolerance: 1e-3 }); e.selfIntersections()
```

#### Splines

- `Spline(..., closed=True)` without tangents is periodic, curvature continuous at the seam (C13):
  the curve changes (0.64 mm at most for six uneven points). A closed spline of two points raises "a
  closed spline needs at least three points".
- `tangents=` with as many entries as points (three or more) is one direction per point (C8); two
  entries are start and end, as before, and any other number raises `ValueError` (the rest was
  ignored).

```python
d = Vector(pts[1]) - Vector(pts[-1])
s = Spline(*pts, tangents=(d, d), closed=True)    # 0.4's closed spline
Spline(a, b, c, tangents=(t0, t1))                # 0.4's curve for tangents=(t0, t1, t2)
```

```js
Spline(...pts, { tangents: [d, d], closed: true })
```

#### Wire.fillet

`Wire.fillet` rounds corners at arcs, splines and ellipses of planar wires, which it skipped, and
raises where it ignored a point (C15): `ModelingError` for a point that is no corner, an end of an
open wire, a named smooth corner, or a corner next to a curve in a wire that is not planar;
`ValueError` for an empty list. Name the corners to round:

```python
w.fillet(2, [corner])            # only the line-line corner, as 0.4 rounded with w.fillet(2)
```

#### 2D Booleans

Booleans of sketches whose faces touch each other at a point (the faces of `^`) were wrong in 230 of
560 random cases; they are now right or raise `ModelingError` where no way gives a region that holds
(C1). Faces hundreds of times their size apart from the other operand's are combined group by group
(the kernel takes its planar tolerances from the operands' extent: a unit square fused to its
neighbour beside a square 1000 away became a sliver), so such results list their faces in another
order (the groups near each other first): select faces by position or area, not index. Where no way
holds:

```python
try:
    region = abc & t
except ModelingError:            # 0.4: a region of the wrong area, no error
    ...
```

#### Projections

`Part.project` returns `[]` for a curve that misses the body (it raised `KernelError`), its pieces
are fitted within 1e-7 of the size, with more control points, and pieces a closed face's seam cut
apart come back joined (one edge where there were two or three) (C12). smlibwasm:
`project(curve, direction, { nearest })`, and `Face.iso` takes its parameter by name
(`iso({ v: 0.5 })`; Python `iso(v=0.5)`).

```python
pieces = part.project(curve)        # 0.4: try/except KernelError
```

### Surfaces

#### stitch

`stitch` sewed with a kernel call that takes no tolerance and closed gaps up to 1/200 of the body's
diagonal (U5). Now gaps wider than `tolerance` (default 1e-4 of the size) stay open, so pieces that
do not quite meet come back as a `Shell`; a body sewn shut with a tolerance is a `Part` (it was a
`Shell`); the faces of an open result are turned to agree with the first piece:

```python
body, report = stitch(pieces, tolerance=0.2, report=True)    # 0.4: stitch(pieces) closed it anyway
assert isinstance(body, Part) and report.max_gap < 0.1
shell = stitch(skin, walls).flipped().thicken(1.5)           # the other side of a turned sheet
```

```js
const [body, report] = stitch(...pieces, { tolerance: 0.2, report: true })
```

#### Mirrored sheets

The normals of a mirrored sheet (a `Shell`) are the mirror of the sheet's: a dome mirrored about YZ
still faces up and out. They pointed to the other side (`Shell.mirror` turned the sheet inside
out), so a mirrored half of a symmetric sheet faced the other way than its half, and `thicken`
grew it to the other side. Mirrored parts and sketches are unchanged. For 0.4's normals:

```python
half = sheet.mirror(Plane.YZ).flipped()     # 0.4's mirrored sheet
```

#### Shell.heal

`Shell.heal()` returns a `Part` where the healed faces close around a volume (T4); smlibwasm's
`heal()` is typed `this | Part`:

```python
healed = sheet.heal()
if isinstance(healed, Part): ...     # closed: a solid now
```

#### intersection_curves

`intersection_curves` returns `[]` for bodies that do not meet, apart or nested (it raised
`KernelError`), and takes a `Plane` and a `Face` (U14):

```python
curves = part.intersection_curves(Plane.XY.offset(6))   # 0.4: a large sketch, try/except KernelError
```

### Measuring and selecting

#### Convexity

`convex()`, `concave()`, `smooth()` and `Edge.convexity` take the kernel's angle between the faces
(T1), which changes the answers on imported parts, and look along the whole edge (A4): an edge
tangent at its middle but creased elsewhere is convex or concave, not smooth. Generated parts give
the same answers. Where a script needs a fixed rule, ask for the angle:

```python
sharp = part.edges().filter_by(lambda e: e.dihedral_angle < 179.5)
```

#### Distances

`distance_to` takes faces, edges and wires (A2), where it raised `TypeError`; `Edge`, `Wire` and
`Face` take a body:

```python
d = part.distance_to(edge)          # 0.4: TypeError
```

`distance_to(point)` and `closest_point(point)` find the nearest point of a B-spline face that folds
back towards the point, where the kernel stopped at a local minimum (5.83 where it is 5.71): values
on such bodies can be smaller, and take about 2 ms instead of 0.2 ms.

### Meshes, glTF and OBJ

#### glTF and OBJ

- glTF `baseColorFactor` holds linear values, as the format defines (GLTF-COLOR): `#7c93b5` is
  (0.2016, 0.2918, 0.4621). Viewers showed 0.4's colors too light.
- Each glTF node has a `translation` (the middle of its shape) and the positions are relative to it
  (M3), so parts far from the origin keep their shape in float32. A shape around the origin gets
  none.
- glTF triangles are indexed (M12): each distinct (point, normal) pair once, and an `indices`
  accessor (a sphere at 0.001: 3.3 MB, it was 9.6 MB).
- A body with face colors has a primitive per color (T5).
- OBJ files name normals (`f 1//1 2//1 3//1` with `vn` lines) and write 12 significant digits (M3,
  M12).

```python
from smlibpy.exporters import gltf_document

doc, buf = gltf_document(part)
prim = doc["meshes"][0]["primitives"][0]                        # (one per face color, mode 4)
acc = doc["accessors"][prim["attributes"]["POSITION"]]
view = doc["bufferViews"][acc["bufferView"]]
positions = np.frombuffer(buf, np.float32, 3 * acc["count"], view["byteOffset"]).reshape(-1, 3)
positions = positions + doc["nodes"][0].get("translation", [0, 0, 0])   # (the node's translation)
acc = doc["accessors"][prim["indices"]]
index = np.frombuffer(buf, np.uint16 if acc["componentType"] == 5123 else np.uint32,
                      acc["count"], doc["bufferViews"][acc["bufferView"]]["byteOffset"])
tris = positions[index].reshape(-1, 3, 3)                       # 0.4: positions.reshape(-1, 3, 3)
c = np.array(doc["materials"][prim["material"]]["pbrMetallicRoughness"]["baseColorFactor"][:3])
srgb = np.where(c <= 0.0031308, 12.92 * c, 1.055 * c ** (1 / 2.4) - 0.055)   # the color as 0.4 wrote it
line = "f 1//1 2//1 3//1"                                       # an OBJ face line now
a, b, c = (int(x.split("/")[0]) for x in line.split()[1:])
```

#### Mesh Booleans and points

Mesh Boolean results have corner normals where an operand has them (M12; `normals` was None). Mesh
points come from the kernel in float64 (M3): they differ from 0.4's in the last float32 digits.

```python
n = result.normals            # (m, 3, 3) corner normals; flat ones: result.triangle_normals
```

#### Silhouette

`silhouette(direction)` returns the contour of the body (M4): the curves where its faces turn away
and the edges between faces that face the viewer and faces that face away, seen or hidden. It
returned the visible curves of a hidden-line pass: a box along (1, 1, 1) gave 9 edges (180 mm), not
its 6-edge outline (120 mm), a torus from the side half its contour. Arcs of one circle come joined.
For the lines of a view use `outline`.

`outline` (and `drawing_views`) draw each line of a view once and leave out the specks a projection
gives where an edge or a seam is seen end-on: a ring (`Cylinder(10, 5) - Cylinder(8, 5)`) seen from
the front is 4 lines of 50 mm (0.4: 5 lines, 66 mm, the hole's rim on the outline's line), a torus
from the side 8 edges, 111.416 long (0.4: 11). Lines and circles come out as lines and circles (M4).
Count lengths, not edges:

```python
seen = Torus(20, 5).outline(Plane.YZ)                          # visible lines of the view
seen, hidden = Torus(20, 5).outline(Plane.YZ, hidden=True)
length = sum(e.length for e in seen)                           # 111.416, as in 0.4
```

#### Empty bodies

`tessellate` of a body with no faces (a Boolean that left nothing) raises `ValueError` ("the Part is
empty"; smlibwasm `RangeError`), and so do `export_stl`, `export_obj`, `export_glb`, `mesh()`,
`render` and `show` of it; `export_usd` raises where it wrote an invalid file (X10). `export_step`
and `to_step` of a list that holds a body without faces raise `ValueError` naming it ("export_step:
the Part 'gone' is empty: it has no faces to write"; 0.4 left it out of the file), also with
`assembly=True`, and `export_glb`, `export_gltf`, `export_obj` and `to_glb`, `to_gltf`, `to_obj` of
nothing raise "export_glb: nothing to write" (0.4 wrote a file with nothing in it); no file is
written. `except KernelError` does not catch it:

```python
if result.faces():
    export_stl(result, "r.stl")
export_step([b for b in bodies if b.faces()], "out.step")   # 0.4 left the empty ones out itself
if shapes:
    export_glb(shapes, "scene.glb")
```

### Sheet metal and deformations

#### K-factors

`fold` and `flange` record their K-factor on the part, and `unfold`, `flat_pattern` and `bends` use
each bend's own; their `k_factor` default is `None` (as folded, else 0.44) where it was 0.44 (D1). A
part folded with another K now unfolds to its blank (200.0, not 199.623). `FlatPattern.k_factor` is
None where bends differ, and `Bend` shows `k_factor`. A plate made by `Part.bend` is sheet metal now
(D2): `bends()` finds the bend and `unfold()` uses the K of its neutral layer (200.0, it was 199.058
with 0.44). `.smp` files keep the records (each bend's axis, inside radius and K-factor), so a part
read back from one unfolds as it was folded (D1); one read from `.smb` or STEP unfolds at 0.44
unless `k_factor=` is given (the kernel's body writer keeps no attributes).

```python
pattern = flat_pattern(part, k_factor=0.44)     # 0.4's numbers
print([b.k_factor for b in pattern.bends])      # each bend's own
```

```js
flatPattern(part, { kFactor: 0.44 })
```

#### Flat patterns

`flat_pattern(...).outline` has lines, arcs and circles where pieces crossed a bend (D5): a hole
across a bend is one circle (it was 3 arcs and 2 B-splines). The edges of a bend zone are quintic
B-splines within 1e-7 of the exact bend (they were cubic within 1e-4), so `Edge.nurbs()` of them
differs. The faces of a bend zone (hole walls, slanted cutout walls) are fitted on their own knots
within 1e-6, exact where they can be (they were the kernel's 1e-4 fits): volumes of folded parts with
holes in a bend change in the tenth digit, and unfolded ones are the blank's (D5).
`FlatPattern.part` is placed by its edges (its bottom at z = 0), and `FlatPattern.size` measures
edges:

```python
holes = pattern.outline.edges().circles()      # 0.4: arcs and B-splines
```

#### Deformations

Faces and edges whose exact image is analytic are planes, cylinders, cones, lines and circles (D2),
with the analytic surface's parameters (`position_at`, `uv_at`, `nurbs()` of such a face differ).
A twist leaves the cylinders, cones, spheres and tori about its axis that full circles about it
bound as they are, with their seams: `twist(Cylinder(5, 40), 90)` is a cylinder and two planes of
the exact volume, and STEP writes `CYLINDRICAL_SURFACE`.
`twist`, `taper`, `bend`, `unroll` and `Lattice.apply` deform edges, wires and points where they
raised `TypeError` (D6); the error for other inputs reads "expected a Part, a Shell, an Edge, a Wire
or points". The raw layer's deformation spec takes `analytic=False` for NURBS everywhere
(`smlibpy._core.deform.deform_brep`).

```python
bend_faces = bent.faces().filter(lambda f: not f.is_planar)   # 0.4: geom_type == "bspline"
wall = twist(Cylinder(5, 40), 90).faces().cylinders()[0]      # 0.4: a B-spline face
```

### Files

#### STEP import

- A body that cannot be read is left out with a `RuntimeWarning` naming it, its entity, its product
  and why; the other bodies come back (I6). Only a file with no readable body raises. `strict=True`
  raises for the first one, and `read_step(path).skipped` lists them.
- With `heal=True` (the default) a solid whose faces share no edges is stitched and comes back
  valid, with other edges and a warning (I5); `heal=False` keeps the file's topology.
- `Face.interior_point()` and `Edge.distance_to()` raise `KernelError` (a `RuntimeError`) where the
  kernel's raw `RuntimeError` came (I9); the reader's `NotImplementedError` names the entity (`curve
  type CLOTHOID (#203)`).
- Bodies with offset curves (`OFFSET_CURVE_3D`, moved along the reference direction x the tangent,
  as ISO 10303-42 defines them and OpenCASCADE reads them) and edges given only as curves on surfaces
  (`PCURVE`), and instances placed by a transformation that mirrors or scales
  (`CARTESIAN_TRANSFORMATION_OPERATOR_3D`), are read (I6, I10): 0.4 raised for the whole file. A
  closed shell of offsets of planes, spheres, cylinders, cones or tori is also built on the surfaces
  they are, which is taken where the offset build is no solid or of another volume (I11: a sphere
  written as an offset of another sphere imports as that sphere).
- Imports have one vertex per vertex of the file (I1), and faces of their own parameter domain (I9):
  vertex counts and meshes of imported parts change. A `BREP_WITH_VOIDS` solid is the region the
  file describes (I4).
- Faces styled on their own (`STYLED_ITEM` of an `ADVANCED_FACE`) get their colors and names (T5).

```python
parts = import_step("asm.step")                     # 0.4: NotImplementedError, no body at all
parts = import_step("asm.step", strict=True)        # raise for the first body that cannot be read
raw = import_step("per_face_edges.step", heal=False)
```

```js
importStep('asm.step', { strict: true })
```

#### STEP export

- Offset faces are written as `OFFSET_SURFACE` (I11): the body went to NURBS whole, without a word.
  OpenCASCADE drops an offset whose basis is a B-spline with C0 knots; `export_step(part.to_nurbs(),
  ...)` writes what 0.4 wrote. A body that still has to go to NURBS gets a `RuntimeWarning`.
- Cylinders of imported parts and of `fold`, `flange` and `bend` are written as
  `CYLINDRICAL_SURFACE` (I11, D2), and read back as cylinders.
- Edges, wires, vertices, vectors and planes are written as curves, points and coordinate systems
  (I12), where they raised `TypeError`.
- Names keep their characters (`\X2\` encoding; `?` before, I10). Face colors and names are written
  (T5). The uncertainty is 1e-7 mm in any unit (`1.E-10` in meters, I13).
- `assembly=True` writes a product per body (I10); the default file is as before.
- A `StepFrame`'s color is written as a curve style on its `AXIS2_PLACEMENT_3D` (I12).
- A face whose loop passes a vertex twice (a thin hole that reaches the face's border there, as
  where the pieces of a sweep round a loop with a corner meet) is written with the loops between,
  a `FACE_BOUND` each and none of them the `FACE_OUTER_BOUND` (S1); `.brep` files with a wire each.
  OpenCASCADE walked the one wire the wrong way at that vertex and took the face for invalid.
  `import_step`, `read_step` and `import_brep` join such loops into one again, as the kernel has it.

```python
export_step(vase.to_nurbs(), "vase.step")       # 0.4's output (approximated offsets)
export_step([part, *edges], "p.step")           # filter edges out for 0.4's file
warnings.filterwarnings("ignore", "export STEP")
```

#### USD

- `import_usd` places bodies as the stage has them (X2): `xformOp`s, `metersPerUnit` (to mm),
  `upAxis` (to Z up), subLayers, references and payloads; inactive, abstract and over-only prims
  hold no bodies; bodies of prims with the same leaf name are named by their path.
- A body that cannot be read is left out with a `RuntimeWarning` that names it and says why, and
  the others are read, as `import_step`, `import_iges` and `import_brep` do (X7); a file with no
  readable body raises `ModelingError`. `strict=True` raises for the first one instead, as 0.4 did
  (it raised a bare `KernelError` for a body the kernel could not build): malformed values a
  `ValueError` naming prim, body and rule (X1), a body the kernel's check refuses a `ValueError`
  (X6: gaps over 1e-3 of the size; smaller ones warn; `check=False` reads them as they are), one it
  cannot build a `KernelError` that names it.
- Names: a body is named by its prim's `displayName`, which smlibpy writes for names that are no
  prim names ("Bracket #1 (left)", "Größe", X3).
- Edges: lines, circles and ellipses are written as the schema's analytic edges (X5); readers that
  read only `edge3dNurb` must read those too. Other writers' B-spline edges that are lines (and
  circles on analytic faces) come back as `line` and `circle`.
- Colors: a body takes the color of its bound material's `UsdPreviewSurface` before its prim's
  `displayColor` (X12); a body with face colors gets a color per triangle on its mesh (T5).
- A loop whose UV curves do not close is written without them (N4).
- Solids with wire edges, points or loose faces warn when read (X13).
- A body read from USD (as from `.brep`) gets the tolerance its geometry needs on each edge, vertex
  and face where the file's one tolerance is larger (X14): the kernel's check can now report a gap
  that the large tolerance covered (a warning; `strict=True` and `check=True` refuse only gaps over
  1e-3 of the size).

```python
import_usd("a.usda", units="mm", placement=False)       # 0.4's reading of a stage
import_usd("broken.usda", strict=True)                    # raise for a body that cannot be read
import_usd("broken.usda", check=False)                    # read bodies the check refuses
export_usd(part.to_nurbs(), "p.usda", mesh=False)        # B-spline edges and faces only, as 0.4
warnings.filterwarnings("ignore", ".*also holds")         # (load, import_usd, from_usd, from_smb, from_smp)
```

```js
importUsd('a.usda', { units: 'mm', placement: false, check: false, strict: true })
```

#### SMB and SMP

- A merged part saved as `.smb` loads as a `Part` with its cells (X8; it was a `Shell`), and so does
  a broken solid, whose `is_valid()` is False.
- `save(shapes, "x.smp")` writes an SMLib part file with names, colors, curves, several bodies and
  the K-factors of folded parts (X9, D1); 0.4 wrote an `.smb` file under any name. Save `.smb` files
  with `.smb`.
- `load` reads `.igs`, `.iges`, `.smp` and `.brep`, and `export` writes `.smp`, `.svg` and `.brep`,
  where they raised `ValueError`; the messages for unknown extensions list them.

```python
save(part, "cache.smb")      # the .smb file, as before; "cache.smp" is a part file now
```

#### Fonts

*Python*: `font.py` no longer uses fontTools: WOFF2, CFF2 and seac fonts are read by its own reader
(W13). A glyph it cannot draw raises `FontError` also where fontTools is installed (none is known),
and damaged WOFF data raises `FontError` (a `ValueError`) where it raised `zlib.error`. *smlibwasm*:
damaged WOFF data is a `FontError` where it was node's zlib error. `Text(..., font=...)` raises
`FontError` for a font it cannot read, as `load_font` and `Font` do (it is a `ValueError`;
smlibwasm a `RangeError`, so handlers of those still catch it), and `FontError` is in
`from smlibpy import *`:

```python
except FontError: ...        # 0.4: except zlib.error, or except ValueError around Text
```

### Messages

#### Error classes

| Where | Now | 0.4 |
|---|---|---|
| refused Booleans, merges, cells, shells, offsets, sweeps (see above) | `ModelingError` | a wrong result |
| `split()` of a merged or invalid part; `shell` of a region thinner than two walls; a cell whose inner cells cannot be cut out | `ModelingError` | `KernelError` |
| `fillet` with `(start, end)` and continuity, around closed edges, or a varying radius around closed runs (F3, F5); USD values (X1, X6); `classify` with a tolerance of 0 or less; `Edge.dihedral_angle` of an edge without two faces; `section` with a touching plane (B18); an extrusion direction in the plane (S14), a taper's direction across the sketch normal or a taper of an open curve (S8); `tessellate` and `export_usd` of an empty body, `export_step` of a list with one, the mesh writers of nothing (X10); `unfold(fixed=...)` of a rolled part (D3) | `ValueError` (smlibwasm `RangeError`) | `KernelError`, `ModelingError`, a wrong result or a file |
| `Text` with a font it cannot read | `FontError` (a `ValueError`; smlibwasm `RangeError`) | `ValueError` |
| `offset` of an object without one (O7); `part + sheet`, `part - sheet` (B12); writers given edges, vertices or meshes (X13); `save(mesh)` | `TypeError` that says what to use | `AttributeError` or Python's own `TypeError` |
| `Face.interior_point()`, `Edge.distance_to()` (I9) | `KernelError` | `RuntimeError` |

#### Hints and texts

The hints of failed Booleans, fillets, chamfers, shells, offsets and `cells()` are built from what
the operands show (B19, F8): a tangent face, coincident faces with their place, operands that only
touch, the corner or edge a fillet could not build and the step that failed (`(unable to process
rollover: a side of the round does not reach the edge it should end on)`). The writers' "nothing to
write" names the function (`export_step: nothing to write`). Messages of `section`, the sweep curvature error
(now with the path's smallest radius), the lattice fold, deformation inputs, the font and bytes
readers, and the writers changed too. `KernelError.detail` no longer ends in ". Kernel trace: ...";
`KernelError.trace` holds the kernel's own failure sites (N6). Match the type and the status, not
the text:

```python
try:
    part = part - tool
except KernelError as e:                       # 0.4: matched "combine the tools first" in str(e)
    if e.status == "SM_ERR_NULL_POINTER": ...
    if any("SmFilletExecutive" in t for t in e.trace): ...    # 0.4: "SmFilletExecutive" in e.detail
except ModelingError as e:                     # a wrong result refused; str(e) says why
    ...
```

### Python

- `from smlibpy import *` brings new names, which hide a script's own variables of these names (or
  are hidden by them, defined after the import): `blend`, `fill`, `network`, `nurbs_surface`,
  `fit_curve`, `swing`, `unroll`, `drawing_views`, `export_svg`, `to_svg`, `import_iges`,
  `from_iges`, `import_brep`, `export_brep`, `to_brep`, `from_brep`, `to_step`, `from_step`,
  `from_step_model`, `to_stl`, `from_stl`, `to_obj`, `to_glb`, `to_gltf`, `to_dxf`, `from_dxf`,
  `from_dxf_wires`, `to_usd`, `from_usd`, `to_smb`, `from_smb`, `to_smp`, `from_smp`, `to_file`,
  `from_file`, and the
  classes `AnnularSector`, `ParabolicArc`, `HyperbolicArc`, `ConicArc`, `Spiral`, `StitchReport`,
  `FitReport`, `Problem`, `ClosestPoints`, `Curvature`, `Continuity`, `NurbsSurface`,
  `SectionProperties`, `DrawingView`, `StepFrame`, `StepCurve`, `StepPoint`, `RepairReport`,
  `Pyramid` and `FontError`.

  ```python
  rounding = surface_fillet(floor, wall, 5)    # a variable named blend would hide the new function
  ```
- Kernel steps that can crash run in another process (N1): `remove_fillets`, `remove_faces`,
  `surface_fillet`, `shell`, `offset`, `thicken`, `cells()`, and fillets and chamfers of parts read
  from files. Each step runs once there (it ran again in this process), and is stopped after
  `GUARD_SECONDS` (20 s; fillets of imported parts and `cells()` had no limit in 0.4), with a
  `ModelingError` that says so. On Windows they run in a helper process (`GUARD_PROCESS`), where a
  crash is a `ModelingError`. Where no other process can run a step (a frozen application, a
  helper process that does not start), the kernel's own deadline holds it to `GUARD_SECONDS` (W2):
  it fails as a step that did not finish, where it ran on for good. Code that replaced kernel
  functions to test them runs the steps in this process, without a limit:

  ```python
  monkeypatch.setattr(smlibpy.defeature, "GUARD_SECONDS", 0)   # the kernel in this process
  ```
- Threads (N8): every kernel entry point takes one lock and the long ones let the GIL go.
  `k.boolean`, `k.fillet_edges`, `k.shell_brep` and 19 other functions of `smlibpy._core` are new
  function objects (same name, signature and docstring), whose `RuntimeError` names `nogil.cpp` as
  the binding site where the kernel left no trace. At interpreter exit, a body freed while a daemon
  thread is in a kernel call is left to the process's end.
- The raw layer: `ext.boolean` can return a Brep other than its first operand and delete the
  operands (B6): use its result (`h.brep = ext.boolean(h.brep, ...)`). Ellipse curves of
  `smlibpy._core` are `Ellipse` (a `BSplineCurve`), not `Curve` (C3). The kernel's error callback is
  smlibpy's (N6). `_core.boolean_with_curves` is smlibpy's Boolean plus the edges of the result that
  lie on both operands' surfaces (the kernel's list held edges it had deleted, and reading them
  killed Python; merged coplanar edges are not in it: use `ShapeList.joining`). usd-brep's
  `_core.merge_breps` and `_core.evaluate_csg_tree` delete the operands of a Boolean that fails
  inside them (they consumed them before too, but left them allocated), and raw extended shells and
  offsets that hit an edge an imprint left half made fail with `SM_ERR_BAD_INTERSECTIONS`.
  `ext.round_edges` takes `setback`, `chains`, `law_at` and `law_radii` (trailing, with defaults) and
  returns `stage` and `set_back` (F5, F8, F10).

### smlibwasm

- Options are checked as Python checks keywords (W5): an unknown or Python-spelt key (`{ k_factor:
  0.3 }`) and a number where the options go (`Rectangle(20, 10, 3)`) are a `TypeError` that names
  the right key. `chamfer` takes `ChamferOptions`.
- `ShapeList.at(point)` raises `TypeError` (W6); use `atPoint(point)`.
- Faces, edges and vertices of a disposed body raise `TypeError` (W4).
- C++ exceptions of the kernel's bindings are `Error`s with a message (`RangeError` for invalid
  arguments), no longer opaque `WebAssembly.Exception`s; memory that runs out is a `KernelError` of
  status `SM_ERR_OUT_OF_MEMORY` with a hint that says how far the module's memory grew (W8).
- A crash of the kernel (a trap) is counted (`memoryUsage().crashes`), warns once through
  `setWarningHandler`, names itself before the operation's hint, and ends `removeFillets` and
  `removeFaces` in this kernel with a `ModelingError` (they dropped the step and went on, W10). Every
  other step that would fall back on another kernel call (a Boolean that turns a seam, other sweep
  modes, a raycast through a mesh, `fitCurve`, `decimate`, the importers' repairs) ends with the
  crash's `KernelError`, and until the event loop's task ends no step falls back. A `KernelWorker`
  replaces its worker after such a crash.
- On a page's main thread, where no probe worker runs, `removeFillets` and `removeFaces` hold a
  kernel step to `GUARD_SECONDS` through the kernel's deadline (W2), where it ran for good;
  `setGuardSeconds(0)` runs it without a limit.
- `memoryUsage()` returns `{ used, heap, limit, handles, crashes }` (W8, W9, W10).
- The TypeScript declarations are stricter (W11): free functions have overloads, `render`, `show`
  and `htmlPage` check their options, `load()` gives a union, `Hit` is generic, internal members are
  left out. Code that compiled because a parameter was `unknown` or a result `any` may need a type
  or a narrowing. `offset` returns the type it is given (C7), `Spline`'s `tangents` is a list (C8).
  `exportFile`, `toFile`, `Shape.export` and `Mesh.export` take `FileOptions` (a misspelt key no
  longer compiles), `Part.deform` a `Lattice` and `{ tolerance }`, `Hull` its `HullItem`s and
  `new Locations` its `LocationLike`s (W11).
- Readers of file contents take any bytes, and their `TypeError` says "a string or bytes (a
  Uint8Array or an ArrayBuffer)" (W14); `toStl([])` throws "nothing to write" (X13).
- `k` (the raw layer) has more members (W15): every function of `smlibpy._core`, the methods of its
  classes as `<class>_<method>`, its enums.
- Bundles must include the package's worker files (`_defeature_supervisor.js`,
  `_defeature_worker.js`); a module worker of the page's own needs Vite's `worker: { format: 'es'
  }`, and Vite 5 or webpack 5: Vite 4 cannot build module workers nested three deep, which a worker
  that imports the package is (W7; use the package on the main thread with Vite 4).
- The three.js snippet of the 0.4 docs shaded sharp edges wrongly (averaged normals); take the new
  one.

```js
// options and errors
p.bends({ kFactor: 0.3 })                                     // { k_factor } throws TypeError
faces.atPoint([0, 0, 15])                                     // faces.at([0, 0, 15]) throws
try { build() } catch (e) {
  if (e instanceof KernelError && e.status === 'SM_ERR_OUT_OF_MEMORY') console.warn(e.hint)
}
// after a crash, steps fall back again in the next task of the event loop
let hits
try { hits = part.raycast(origin, direction) } catch (e) {
  if (e instanceof KernelError && /the kernel crashed/.test(e.detail)) await new Promise((r) => setTimeout(r))
}
toFile(part, 'part.stl', { ascii: true })                     // { asci: true } no longer compiles
// types
const part = load('bracket.step')
if (!(part instanceof Part)) throw new Error('bracket.step holds no single part')
const options: RenderOptions = { view: 'top', size: [400, 300] }
// memoryUsage keys
assert.deepEqual(Object.keys(memoryUsage()).sort(), ['crashes', 'handles', 'heap', 'limit', 'used'])
// three.js: a vertex per triangle corner with the kernel's normal
const position = new Float32Array(mesh.triangles.length * 3)
mesh.triangles.forEach((v, i) => position.set(mesh.vertices.subarray(3 * v, 3 * v + 3), 3 * i))
geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
```

## Fixed

### Silent wrong results

Booleans and cells:

- Mirrored bodies with a cavity, cells or open sheets came out inside out where it shows (also in
  0.4): `(Box(20, 20, 20) - Box(10, 10, 10)).mirror(Plane.YZ)` meshed to 9000 for 7000 (STL, OBJ
  and glTF got an inverted cavity), its cavity walls' `normal_at()` pointed into the material and
  their 12 edges read convex; `Box(60, 40, 20).mirror(Plane.YZ).shell(2)` meshed to 80256 for 15744;
  a mirrored rounded box could not be shelled with an open top (O3), a mirrored pin's chamfer was the
  kernel's fitted bevel (F12: 30.8287005 for 30.8290435), and mirrored sheet metal did not unfold
  (D1, D3). The volume and `check()` were right. A mirror now turns every face back over
  (`SmBrep::Mirror` turned their surfaces) and gives straight and circular edges their lines and
  circles again.
- Moved, rotated, mirrored and scaled bodies keep their tolerances (B1). Every transform reset them
  from the box of the body's vertices: a torus (one vertex) got tolerance 0, parts over 500 mm 1e-4.
  An O-ring groove `Cylinder(10, 40) - Torus(10, 1.5).translate(0, 0, 10)` was ignored (12566.37,
  valid), and a moved `Torus(8, 1.5) & Box(4, 4, 4)` gave the whole torus. Now the groove gives
  12358.4417 and the moved torus 28.5863, as OpenCASCADE does. Over two seeded fuzz runs (2,338
  operations) silent wrong Booleans fell from 2.6 % to 0.9 %.
- Booleans in which the faces cross along a curve tangent to the seam of a cylinder, cone, sphere or
  torus are right (B6): smlibpy finds such seams and turns the body of revolution whose seam it is
  about its own axis first, on copies, at up to three angles that clear the seam. A groove pin
  tangent to a bore, `(Box(30, 30, 30) - Cylinder(5, 60)) - Cylinder(2, 60).rotate(Y,
  90).translate(0, 5, 0)`, was 24331.7029 (smlibwasm 24364.1472) and is 24299.2587, the exact value;
  two cross holes were 7057.19 and are 6931.7476; `Cylinder(2.5, 30).rotate(Y, 90) &
  Sphere(2).rotate(X, 90).translate(0, -0.5, 2.5)` was 81.7551, more than the sphere, and is
  13.6259. Over 3,270 fuzz cases (seeds 7, 8 and 11 to 18) silent wrong results fell from 76 to 72
  natively and from 79 to 72 in smlibwasm, crashes from 2 to 1, and no operation went from right to
  wrong.
- `is_valid()` checks Boolean results (B2): they were marked sound when made, so a result of volume
  -776.5, or an intersection of two cylinders larger than its operand, was valid.
- A cut the kernel wrongly returns empty, and an intersection that returns a whole operand, raise
  (B3): `(Sphere(20) - Cylinder(6, 60)) - Cylinder(3, 60).translate(8, 0, 0)` returned `Part(0
  faces)` and its `&` the whole holed sphere (29089.8; right: 929.188). Both are right now (B10).
- `merge` checks its result (B5): one merge gave 518.314 for 586.443; it is 586.4432 now (B6).
- `cells()` of an insert that touches the part around it at a point is right (B8): `Box(20, 20,
  20).merge(Sphere(4).translate(6, 0, 0)).cells()` is [7731.917, 268.083], not [8000.0, 268.083].
- `section()` of a merged part has a region for every cell the plane cuts (B9): the insert's disc
  was dropped (1486.903 instead of 1600). A plane tangent to the top of a torus no longer gives a
  disc that is not in the part (B18: `Torus(10, 2)` at z = 2 gave 314.159).
- Empty results are judged without the kernel's `brep_relationship` (B13), which called overlapping
  bodies "touching" (spheres with 18.6 in common, a pin through a plate): a kernel that returned
  nothing for overlapping spheres was accepted. Over the fuzz seeds 7, 8 and 11 to 14, 61 right
  empty intersections that raised are accepted now.
- `part + sheet` and `part - sheet` returned invalid "Parts" (11 faces, volume 8000, no error) and
  `part & sheet` a "Part" of volume 0 (B12).
- The cells of a merged part all had the first part's name and color, also in STEP (B15); a body in
  a cavity of another was part of the same solid (B16).
- A body scaled differently along its axes had refitted trim curves stored by its first measure,
  which kept the volume of `Cylinder(5, 10).scale((1, 1, 2))` at 1570.795256 (exact 1570.796327)
  without a warning (T6); it is exact now.
- A union that returns one operand with a vertex or two imprinted, although the other reaches out of
  it, is caught and done again with the operands the other way round: `(Cylinder(5, 5) + Box(20,
  4, 16).rotate(X, 90).translate(0, -3, -0.5)) + Cylinder(2, 12).translate(2, -2.3693, 3.5)` is
  1446.6121 (OpenCASCADE 1446.612107; it was 1358.54). A cut that returned a valid body of no volume
  reaching out of the part (`Cylinder(2, 12) - Cylinder(1.5, 30).rotate(Y, 90).translate(1, -0.5,
  2.4787)`, fuzz case csg-8-110) raises.
- Booleans along the seam of an earlier hole (an operand that is no body of revolution), and seams on
  or tangent to B-spline faces, are right (B6): the hole's seam is moved on its face first (its
  solid added and cut away again turned), B-spline faces of the other operand are looked at too, and
  a B-spline body whose seam touches goes in with its faces recognized as cylinders, cones, spheres
  or tori. Against OpenCASCADE, on 160 random cases (holes in a box touched by a sphere, cylinder or
  torus, the same with `to_nurbs()` parts, torus slices; 504 results where OpenCASCADE's own add
  up), wrong results without an error fell from 106 to 7 (torus caps 1e-4 to 2e-4 off, where
  OpenCASCADE and an integral differ by as much, and a torus tool 3.6e-5 off) and errors from 38 to
  8: `(Box(20, 20, 20) - Cylinder(3.174, 40).translate(-2.051, -2.981, 0)) &
  Sphere(3.159).translate(1.123, 0.178, 2.221)` is 111.1921 (it was 6.9039), the groove pin with a
  NURBS part 24299.2603 and with a NURBS pin 24299.2587. A part merged into an earlier merge goes in
  turned or with its seams moved, as in a merge of two.
- Where a seam that no turn moves (a torus' outer equator, a free-form face's seam) touches a face
  of the other operand at a point, the result's faces near it are checked against the operands, and
  a wrong result is done again with NURBS copies of those operands or refused (B6): a holed box's
  union with a torus whose outer equator touches the hole is 23635.9574 (it was 23610.4720, the torus
  inside the hole left out), the intersection 194.5466 (it was the whole torus, 220.0320), and the
  cut raises where it was 23390.44. A split by a plane that such a seam touches keeps only sides that
  hold the part's volume: `Torus(6, 4).rotate(Y, 90)` cut at z = 10 by a plane tilted by 30 degrees
  gives 5.80689 + 1889.15715 in both builds (it gave 5.8069 + 1842.7020 for 1894.9640; smlibwasm
  696.07 above for `Torus(10, 3)`). In the fuzz seeds 7 and 8 the rate of wrong slices without an
  error fell from 0.93 % (smlibwasm 1.85 %) to 0.

Fillets and chamfers:

- A chamfer of an edge whose faces change their angle along it raises (F4): the setback followed the
  angle (from 1 to 3 along the edge where a tilted cylinder meets a plate).
- A `(start, end)` radius with `continuity` made a ruled chamfer, not a blend (F3), and on a closed
  edge or across tangent edges the kernel bent the radii (F5: on a cylinder's rim the radius rose to
  2.90 and fell back to 1 within the last 3 % of the edge). The first and a `(start, end)` radius
  around a closed edge raise now; along tangent edges the law runs along the whole run, linearly in
  its length (the top run of a rounded plate with `(1, 3)`: 1.02 rising to 3.0, it ran 1.07 -> 2.93,
  2.46 -> 1.04, 1.65 -> 1.99 -> 1.07 along its pieces).
- Chamfers of circles are exact cones (F12): the kernel's fitted bevel left the volume of a
  chamfered pin of radius 2 1.1e-5 off (`Cylinder(2, 5)` with both rims chamfered by 1.94:
  30.8290435179, exact; it was 30.8287005); the flange example is 157979.6668 (exact; it was
  157979.6230).

Shells, offsets and defeaturing:

- `shell` and `offset` refuse results whose faces do not meet, shells without a cavity, the part
  given back and closed shells of the wrong volume (O2): `(Box(20, 20, 10) - Cylinder(3,
  20)).shell(4)` returned the plate itself, and closed shells of two imported parts came out near
  the part's own volume.
- `shell` measures walls across the part, not along the world axes (O4): `Box(40, 30, 10)` turned by
  10 or 45 degrees and shelled by 6 gave a valid 10992.0, with no room for two walls.
- A shell opening whose rim meets its neighbours tangentially (the flat top of a box rounded on all
  edges, a rounded cup) gave a body with an open rim (gaps 0.27, and a side opening a wrong volume:
  14134.39 for 13534.39) with only a warning; planar such openings are shelled right now (O3:
  `Box(60, 40, 20)` rounded by 5, open at the top, 2 thick: 11134.3949), also next to an ordinary
  opening (a box with rounded vertical and bottom edges, open at the top and the +x side:
  9869.8523).
- `remove_faces` keeps the face its rounds enclose (O5): removing the rounds around a box's top gave
  the box 2 lower (3200.0 instead of 4000.0).

Sweeps, revolves, extrusions and lofts:

- Sweeps along 3D paths keep the profile's orientation (S1): a rectangle turned by 90 degrees at an
  arc-line joint and by 44 degrees at the closure of a closed loop.
- Profiles along helices no longer roll (S3): a rectangle along `Helix(pitch=5, height=30,
  radius=10)` measured 1.34 to 2.23 by 1.25 to 2.22 at its sections for 2 by 1; now 2.0001 by
  1.0039, and along a conical helix it ends 1.6 degrees off radial (it was 61). Sweeps along long
  helices keep their volume: a rectangle along two 30-turn pieces came out 0.74 % short; circles
  along helices are exact to 2e-7 (they were up to 6e-6 short).
- Asymmetric profiles sit on the path (S2): a triangle swept along `Line((0, 0, 0), (10, 10, 10))`
  started 1.67 before the path, and on a mitered planar path starting at 30 degrees it sat 0.25 off.
  The kernel anchored a profile at the middle of its curves' control points (patched): an 80-degree
  sector of radius 10 sat 0.0211 off along a spline and a mitered path and 0.075 along a 3D
  polyline; 0 now.
- Round a closed 3D path with corners, a profile turned by all of the loop's rotation at the
  closing corner (8.5064, 5.7148 and 29.7502 degrees round three 3D polygons); the turn is spread
  along the path now, so the profile meets itself (S3).
- `extrude(taper=..., direction=...)` ignored the direction and went along the sketch normal, and a
  taper of an open curve was ignored (S8): they raise `ValueError` now, unless the direction runs
  along the normal (either way).
- Sweeps of a profile across the axis of a single arc path gave "valid" bodies that sweep through
  themselves (S8); they raise. Sweeps along single arcs are exact (Pappus to 1e-15; up to 9.4e-6
  off).
- Kinked loops fused into bodies with faces of no area and, now and then, a shell of one such face
  (a void without volume, which OpenCASCADE read from STEP as -1707.27); fused sweeps that were open
  between their faces were returned (S1). Every body smlibpy returns for 60 random kinked loops and
  the plan's three (a circle and a rectangle each, 126 bodies) and for 60 open and 60 closed random
  fillet polylines (240) now reads back into OpenCASCADE as one valid solid of its volume, from STEP
  and from `.brep` (smlibwasm: all but one, under [known kernel
  limitations](#known-kernel-limitations)). Where the halves of a loop meet as the profile meets
  itself, a face's loop can touch itself at a vertex (57 of 63 rectangles), and OpenCASCADE took one
  such face for invalid (a B-spline face of 173.57, kinked loop 44) until the writers wrote such a
  loop as the loops between; the `.brep` writer also leaves out an edge that a loop runs along and
  straight back (a strut a fuse can leave), which OpenCASCADE took for a seam (circles round 3 of 60
  loops). Fused sweeps take the gaps their fuse leaves beyond the tolerances into them, up to 1e-4
  of the body's size: a rectangle round the loop through `(20 cos a, 14 sin a, 6 sin 2a)` had a
  vertex 1.1e-5 from its edge, whose tolerance was 5e-6 (`is_valid(strict=True)` False).
- A tapered extrusion whose hole widens across the region came out shorter than asked without an
  error (S9: `(Circle(10) - Circle(8)).extrude(10, taper=10)` was 5.67 high).
- Extrusions along a direction in a tilted plane came out inside out or open for curved profiles
  (S14: of 1200 random ones 1 at 5.7 degrees off the plane, 25 at 0.6 degrees, 363 at 6e-4 degrees,
  also in 0.4); all 1200 at each of six angles are valid with the exact volume now (where the turned
  extrusions fail too, the profile is swept along the line). A direction in the plane raised a bare
  `KernelError`, and one 0.006 degrees off it made a sliver without a word.
- `loft` of single open curves takes `ruled` and `smooth` (S5); both were ignored.

Sketches and curves:

- 2D Booleans of sketches whose faces touch each other at a point are right or raise (C1): against
  OpenCASCADE, 230 of 560 random results were wrong, now none.
- `Wire.fillet` skipped corners at arcs and splines and points that were no corner, silently (C15).
- `Edge.intersections` counted lines 0.0005 apart as crossing, parallel lines of a 0.01 mm part as
  meeting, an overlap as one point and a closed curve's start twice (C5).
- `Edge.bbox()` of a constructed curve sampled 33 points and was too small (C9): 0.7998 for a curve
  that reaches 1.0069.
- `Part.project` fitted within about 1e-4 (C12): a circle projected onto a sphere of radius 10 was
  9.4e-5 off it; now 1.8e-6.
- Closed splines jumped in curvature at the seam (C13: 0.0135 against 0.0574), a kink in zebra
  pictures of extruded outlines.
- 2D Booleans of faces hundreds of times their size apart misjudged faces that touch (C1): a unit
  square fused to its neighbour at a corner, with a third square 1000 away, became a sliver of
  0.2778 without an error in 9 of 60 random lattices (smlibwasm 12; 46 and 43 more raised "touch
  each other at a point"), and a union of sketches with pieces far apart on both sides gave 9.419 of
  12.427 in smlibwasm. Faces far from the other operand's go into the kernel group by group: 60 of 60
  right in both builds.
- `Part.project` returned a curve that crosses a closed face's seam as two or three pieces (C12);
  they come back joined.

Surfaces:

- B-spline faces with a bump are no longer taken for planes (U1), nor for cylinders, cones,
  spheres, or surfaces of revolution or extrusion: `to_shell()`, `.smb` files, `thicken()`, meshes,
  mirrors and scales that differ between the axes flattened a face parameterized like a plane, or
  shaped like a cylinder, with a bump between the kernel's sample points (10 of 40 random bumps of
  a plane; a cylinder sheet with its first quarter pushed out by 0.5 came back the cylinder: area
  314.16 for 316.27, also from a `.smb` file of 0.4).
- `stitch` ignored its tolerance (U5): the faces of a 200 mm box moved apart by 0.03 came back as a
  "valid" Part with `tolerance=1e-4`, its faces standing off their edges; open results kept mixed
  normals, so `thicken` gave volume 0.

Meshes and drawings:

- Mesh Booleans use the mesh's arrays as they are (M1): after `m.vertices += ...` they used the old
  geometry.
- Meshes keep their tolerance (M2): a sphere's mesh was 0.68 off at a tolerance of 0.01, and a grid
  could miss a free-form bump between its lines.
- Mesh points keep double precision (M3): a sphere 100 m from the origin was meshed 3.8 times the
  tolerance off, a box 1 km out had mesh volume 1107.72 for 1113.12. `Mesh.volume` takes its triple
  products about the middle of the box: 10 km out it measured 1113.0637 for 1113.121.
- Normals at the apex of a cone are right (MESH-APEX): the corner at the tip of `Cone(10, 0, 20)`
  had a normal up to 127 degrees off the surface (a dark wedge in glTF, the viewer and `render`);
  now within 0.02 degrees.
- glTF colors are linear (GLTF-COLOR): viewers showed every color lighter than asked.
- `silhouette` returned the visible curves of a hidden-line pass, not the contour (M4): 9 edges,
  180 mm, of a box seen along (1, 1, 1) for its 6-edge outline of 120 mm, and half the contour of a
  torus.
- `outline` drew a line twice where an edge lies on a longer line of the view (a ring seen from the
  front: 66 mm of lines for its 50) and kept the specks of edges seen end-on (M4).
- OBJ files carry normals (M12): readers smoothed a box across its edges or shaded curved faces
  flat; mesh Boolean results had no normals.

Measuring and analysis:

- `distance_to` between nearly parallel faces is exact (A1): cylinders 2 apart and skewed by 5
  degrees gave 2.485. On 101 random pairs it matches OpenCASCADE to 1e-15 of the distance.
- `distance_to(point)` and `closest_point` stopped at a local minimum where a B-spline face folds
  back towards the point (a sheet fitted around 288 degrees of a tube: 5.83 where it is 5.71, 28 of
  the 1500 points of its cloud); every face and knot span that could hold a nearer point is searched
  now: none of 215 points is farther than a 300 x 300 sampling of the surface.
- `Part.section` cut B-spline faces with the kernel's plane section, which fits its curves within a
  thousandth of each face's size: up to 2.1e-3 off a B-spline sheet 30 x 20, and section areas of a
  part thickened from it up to 0.13 % too large (207.266 for 207.006), also in 0.4. The curves lie
  within 1e-7 of the part's size now (3e-6 off).
- `raycast` missed the hit beside the seam of a cylinder, cone, sphere, torus or surface of
  revolution, also in 0.4: parameters within about 1e-7 of the end of their domain evaluated to the
  seam itself (`SmPolarConversion::ConvertToPolarParameter`, patched), so `Cylinder(10,
  40).raycast((88.98, -1e-8, 4), (-1, 0, 0))` gave only the far side. Rays 1e-12 to 1e-3 beside the
  seams hit every face now.
- `convex()`, `concave()`, `smooth()` and `Edge.convexity` are right on imported parts (T1): the
  answer was noise on edges that lie a little off their faces, and differed between smlibpy and
  smlibwasm. An edge whose faces meet tangentially only at its middle (an angle running from -14
  through 0 to +14 degrees) is no longer "smooth" (A4).
- The deform guides taught `mass_properties(accuracy=1e-10)` and a volume error of 4e-4 that
  `part.volume` no longer has (D4).

Sheet metal and deformations:

- A fold round trip is lossless (D1): a blank folded at R1 with K 0.33 and at R6 with K 0.45
  unfolded to 199.623 or 200.377 with any single K; it unfolds to 200.0.
- A plate bent with `Part.bend` was not sheet metal (D2): `bends()` gave `[]` and `unfold()` raised;
  its bend is two exact cylinders now and unfolds at the K of its neutral layer.
- A hole across a bend was 3 arcs and 2 B-splines in the flat pattern, 1.8e-5 off its circle (D5);
  it is one circle, and the hole's edges after a fold and an unfold are 5e-13 off it.
- A part unfolded with a hole wholly inside a bend zone was not `is_valid()` (D5): the kernel's fit of
  the hole wall grew its domain and its trims fell on the wrong end (area 2.6 for 113). Bend-zone
  faces are fitted keeping their parameters now: the part is valid, its volume the blank's to
  5e-13, and the slanted walls of a square hole come back from a fold and an unfold 3e-14 off (they
  were 1.6e-6 off, area 23.99998 for 24).

Files:

- STEP import makes one vertex per vertex of the file (I1): a rounded box written and read back had
  48 vertices for 24, and loops whose edges did not link.
- A sphere written as an `OFFSET_SURFACE` of another sphere did not import, and smlibwasm built a
  solid of a quarter of its volume (I11); it imports as the sphere it is, exact, in both builds.
- `export_step` of a list left a body without faces out of the file without a word, and
  `export_glb([])`, `export_gltf([])` and `export_obj([])` wrote files with nothing in them (X10);
  they raise `ValueError` and write no file.
- A STEP solid whose faces share no edges was an invalid Part without a warning, which `heal()`
  could not repair (I5); it is stitched now.
- STEP files that color single faces were read with the solid's color only (T5).
- STEP names with non-ASCII characters were written as `?` (I10); `named("Bügel")` comes back as
  `Bügel`, also in OpenCASCADE.
- A body with an offset face went to NURBS whole on STEP export, without a word (I11): `vase.smb`
  written and read back changed its volume by 7.7e-3; now 5.1e-7, with its faces' types kept.
  Imported cylinders were written as rational B-splines, which OpenCASCADE dropped under an offset.
- The STEP uncertainty was 1e-7 in the file's unit (1e-4 mm in a file in meters, I13).
- `import_usd` places bodies as the stage has them (X2): `xformOp`s, `metersPerUnit`, `upAxis`,
  subLayers, references and payloads were ignored, and inactive, abstract and over-only prims gave
  bodies.
- Bodies from other software in a USD file are checked before they are measured (X6), and bad values
  are refused (X1): broken bodies imported as valid Parts of the wrong volume.
- Line edges written to USD are as long as the edges (X4): each was a B-spline 2.5 km long, and such
  a file read back with a bounding box reaching 1234560. Lines, circles and ellipses stay what they
  are through a USD round trip (X5): `Box(20, 20, 10) - Cylinder(4, 20)` came back with 14 B-spline
  edges.
- USD files of bodies read from other software failed NVIDIA's validator (N4: a sphere's loop along
  its seam, BA.763), and an empty body was written as an invalid prim (X10).
- USD bodies take the color of the material bound to them (X12); usd-brep's and Omniverse's files
  gave bodies without a color. Names with characters beyond ASCII were garbled or raised (X3).
- A merged part saved as `.smb` loads with its cells (X8); it came back as a Shell.
- Bodies of mixed dimension (a solid with wire edges, points or loose faces) read from `.smb` or USD
  as invalid Parts without a word (X13); they warn now.

smlibwasm:

- Misspelt or Python-spelt options and extra arguments raise `TypeError` (W5): `p.bends({ k_factor:
  0.3 })` used the default K-factor, `Rectangle(20, 10, 3)` dropped the 3.
- `ShapeList.at(point)` returned the first shape (W6); faces, edges and vertices of a disposed body
  answered with another body's geometry (W4).
- A crash of the kernel hid behind retries and the operation's own hint (W10): `removeFillets` and
  `removeFaces` in this kernel went on with the next step on the damaged memory (four crashes, then
  "could not take out 4 of the 4"; with `partial: true` the part came back unchanged), and shell and
  offset went on after a crash in the check of a result.
- The docs' three.js snippet shaded with averaged normals, up to 88.9 degrees off the surface at a
  box's edges, and the Memory section said that `dispose()` keeps memory flat in loops, which it
  does not (`scope` does).

Python:

- `remove_fillets`, `remove_faces` and `surface_fillet` ran each kernel step twice, once in a copy
  and then in the user's process, where a crash that depends on memory layout could still end it
  (N1).
- docs/files.md said the test suite checks USD files with NVIDIA's validator; nothing did (N4).

Documentation:

- The numbers the docs print agree with what the code prints: every Python block of docs/, the
  README and the skill (161 files, 603 printed lines) and the smlibwasm blocks of the READMEs,
  docs/javascript.md and docs/kernel.md were run against their comments. Corrected: the fits of
  docs/surfaces.md and `surfaces/surface.md` (a largest distance of 0.0010094 printed as `< 0.001`
  True), `surfaces/trim.md` (1169.871 in its example and its measured list), `features/loft.md`
  (3665.191, and the square-to-circle duct's section 660.7 and 566.2: the section of its loft is
  660.69997 now, as a split face and a thin slab measure it, where 0.4's `section` gave 660.2),
  docs/features.md's cells, docs/sketches.md's area, the sheet-metal recipe's bend directions,
  `sketches/Text.md` and the fender of `surfaces/generic.md`; `analysis/outline.md` and
  `files/drawing_views.md` no longer say every outline edge is a B-spline, and docs/kernel.md's
  `KernelError.trace` example fails in the kernel again (the crossing cylinders it showed are fixed,
  B4), with the kernel's lines as the patched kernel reports them (`SmMerge.cpp:7180`, `:4449`). Tests
  read these comments and compare them with what the code prints.
- The docs said more lattice points give more local control; a lattice is a global map, and the
  `Lattice` docstrings and docs/deform.md now point a bump or dent on one face to `Part.push` and
  `Part.warp` (D7).

### Crashes and hangs

- Booleans of crossing holes whose seams lie tangent to the other hole, such as `Box(20, 20, 20) -
  Cylinder(3, 40).translate(0, 3, 0) - Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)`, killed the
  process (B4); the kernel is patched, and smlibpy turns the hole first (B6), so cut, fuse, `&` and
  merge give the right body (the intersection 62.7209, as OpenCASCADE). A cut by a flat end cap
  tangent to a sphere raises instead of killing the process, and so does `cells()` of a merge the
  kernel got wrong (B5). The stitcher behind `cells()` that crashed on a cone and cylinder merge
  runs in another process (N1), and the null polar box it read is patched: `cells()` of that merge
  (fuzz case csg-153) gives three valid cells that add up to it.
- A torus touching a plate at a point, `(Box(20, 16, 4) - Sphere(6).rotate(X, 90).translate(1.4007,
  0, -1.5863)) & Torus(6, 2.5).rotate(Y, 90).translate(7.5, 0, 10.5)`, killed the process in every
  run (smlibwasm trapped): two Vertices of the faces the Boolean deletes shared one vertex Shell,
  which the first deletion freed (kernel patch, `DeleteFaces`). The intersection is the empty part,
  the union 1616.2075, the cuts the operands.
- Chamfers of edges at different angles (all edges of a hexagonal prism) killed the process and
  trapped in smlibwasm (F1); they work.
- Fillets where the kernel has no corner for how the selected edges meet at a vertex killed the
  process at any radius, as did all-edge fillets of 10 of 479 imported parts (F2); they raise
  `KernelError` (`SM_ERR_INVALID_INPUT`) naming the corner. Two more fillet crashes found by 514
  random fillets and chamfers (a missing boundary curve in `SmFilletGeom::MakeFaceBrep`, a missing
  side face in `SmFilletSolver::CreateCliffRollOverSideFG`) raise `KernelError` naming the edge;
  smlibwasm built broken bodies there.
- The all-edge fillet of two cones, `Cone(3, 0, 10).rotate(Y, 90) - Cone(1.5, 0, 8).rotate(X,
  90).translate(0, 1, 0)` (fuzz case fillet-7-185), wrote into freed memory, which killed the process
  on Linux x86_64 (macOS raised `SM_ERR_NULL_POINTER`): the Boolean inside the fillet deleted an
  Edge between the two sides of one Face as if it joined two (kernel patch, `DeleteEdge`). It raises
  `KernelError` (`SM_ERR`) now; r 0.3 rounds as before (90.0851).
- `shell`, `offset` and `thicken` no longer kill the process (O1). Five sites where the offset code
  read memory it had freed are patched (among them the curves of a failed imprint, which crashed the
  extended shells of issue #2's filleted boxes in 7 to 27 of 300 processes, now none, and the
  natural trim curves of a failed `CreateNaturalUVTrimCurves`), and the kernel steps run in another
  process whose body comes back as an exact copy. `Box(40, 30, 10).rotate(X, 45).shell(10, opening)`
  no longer crashes about one run in four (O4). On imported parts the extended offset went on with
  an Edge an imprint had left half made (crescendo part 52: 15 of 20 processes crashed), read a null
  polar box (parts 81 and 19), and left loops naming the edgeuses and vertexuses it had deleted: all
  patched (part 52 now 1 of 20, part 81 3 of 30, part 19 none; the rest is under [Known kernel
  limitations](#known-kernel-limitations), contained by the other process).
- A ProtoEdge the Boolean deletes when it combines two stayed in the overlap lists of other
  ProtoEdges, the coincidence lists of ProtoFaces and, listed twice, its ProtoVertices' lists (kernel
  patch, `SmProtoTopology.cpp`), and was read where the memory layout let it: the extended offsets of
  `tests/test_guards.py` crashed in 1 to 3 runs of 100, the extended offset of a fused cone read it
  in every run under AddressSanitizer and trapped smlibwasm in another layout, and the sweep of
  `Circle(2)` along a closed spline with a kink killed the process on Linux x86_64.
- The fuse of the halves of a loop closed with a kink killed the process (2 of 60 random loops with
  circles): `SmMerge::ManifoldBoolean` marked a vertex it had deleted (S1). Patched; and such loops
  sweep wherever they swept in 0.4 and more (60 of 60 random loops with `Circle(1.5)`; 0.4: 37).
- The 2D union of two exclusive-or sketches whose faces touch at points killed the process in 7 of
  13 runs, in the kernel's planar Boolean (C1); patched, the union is right in every run.
- Copying a face out of an imported body whose faces share no edges killed the process (T2); it
  raises `KernelError`, and what the kernel made for the copy is freed (kernel patches, `SmBrep.cpp`).
- A bad value in a USD file (a sphere whose reference direction is its axis, a weight of 0, a torus
  axis of length 0) crashed the process, a later `mesh()`, or hung `volume` (X1).
- The kernel's curve intersection read past a stack array where a curve's first derivative is zero
  (`sm_FilterSolution`, reached from the check of a body read from a damaged `.brep` file); patched
  (X14).
- *Python*: `export_step` of a body it converts to NURBS read the converted body after freeing it
  (0.4 read the freed memory by luck).
- *Python*: the raw `_core.boolean_with_curves` (usd-brep's binding of `SmApiBooleanWithCurves`)
  handed out edges the kernel had deleted, and reading them killed Python (`Box(10, 10, 10)` and
  `Box(10, 10, 5).translate(5, 0, -2.5)`); it is smlibpy's Boolean with the edges found by
  classification now.
- A body with a face that crosses the seam of its own surface ran `volume` for minutes (A7); it
  raises `KernelError` after about a second.
- smlibwasm: failed kernel calls used up the stack (W1): after about 240,000 failures (11,000 missed
  raycasts) every call failed for good, and before that the stack overwrote static data.
- smlibwasm: `removeFillets`, `removeFaces` and `surfaceFillet` stop a kernel step that loops (W2),
  in Node and in workers of cross-origin isolated pages through the probe worker, and on a page's
  main thread (as in Python where no other process can run it) through a deadline inside the kernel,
  which its surface and topology intersections test: with `GUARD_SECONDS = 2` the enclosure's round
  that looped raises after 2.05 s, and `partial: true` keeps it; a `KernelWorker` stops any call by
  its timeout or signal. On the enclosure example they busy-looped for good and froze a tab.
- smlibwasm: a trap when memory ran out read "the kernel crashed (table index is out of bounds)",
  and C++ exceptions came out as opaque `WebAssembly.Exception`s that every later call threw again
  (W8).

### Leaks

- A failed Boolean kept both operands (B7): about 0.6 MB each time; 100 failing cuts take 7.6 MB
  instead of 52.9 MB (smlibwasm: 3 MB instead of 42 MB). It also left the kernel's mark that a
  Boolean is running, which keeps the kernel from building surface caches.
- STEP import, the seam check and `heal` leaked 3 to 13 KB per round face (I2): 1000 seam checks and
  100 imports grew a process by 16.7 MB, now by less than 0.5 MB.
- Revolves, lofts, open extrusions, tapers, offsets of sketches and mitered sweeps leaked the curve
  copies they gave the kernel, 320 to 2350 bytes a call (S11, N2): 1500 revolves +1.98 MB, now +0.15
  MB.
- A Boolean that failed while the kernel intersected its operands (`SM_ERR_BAD_INTERSECTIONS` and
  others from `IntersectTopology` and `ResolveIntersections`) kept the kernel's intersection
  manager and its curves: about 450 kB per failed Boolean of crossing holes (kernel patch,
  `SmTopologyIntersector.cpp`). The sweeps' clean-up of fused loops kept every copy it failed on:
  73 to 262 kB per failed sweep.
- smlibwasm: meshes kept the kernel's mesh until the garbage collector ran (W3): 60 meshes of a fine
  sphere failed with `std::bad_alloc` at the 51st. Each caught C++ exception kept 108 bytes (W8).
  The port's own intermediates (refused results, tool copies, sketch curves) stayed until the event
  loop turned (W9: a probe of 70 calls left 35 of them; none now), and 26 methods and constructors
  kept theirs until the garbage collector ran (`Sketch.revolve`, 3 kernel objects a call: 400
  revolves grew the process by 267 MB; `outline`, `drawingViews`, `fold`, `Face.wrap`, the primitives
  with `align`, the holes, ...): they run in `scope` now, and a loop that disposes each result stays
  flat.
- The kernel's N-sided fill (`N_FillNSidedHole`, behind `fill()` of three or five and more sides)
  never freed its work stack: 0.1 to 1 MB per fill (an octant bounded by three arcs 91.9 kB,
  smlibwasm 77.3 kB); now 0 (kernel patch, `NL_SrfAdv.cpp`).
- Fillets along tangent edges lost the joined curve of each smooth run and the caches the corners
  built on it: 189 kB for the top run of a rounded plate (smlibwasm 154 kB), also in 0.4; now 0. A
  refused fillet lost the executive's intersection curves and fillet surfaces (24.5 kB, now 45
  bytes), a fillet that failed after making its faces the whole intermediate Brep (348 kB for the
  failed r 0.6 fillet of the two cones above, now 16.4 kB), and corner patches of five or more
  rounded edges the UV curves of their boundaries (kernel patches).
- The kernel's mitered planar sweep lost its copies of profile and path, the extended segments, its
  cutting lines and, where their Boolean failed, the segments: 12.7 kB for a circle swept along two
  lines (smlibwasm 10.5 kB); now 0. A cone that comes to a point lost 72 bytes.
- A failed extended shell lost the offset body with its caches and the trim curves of a failed
  extension: 879 kB for three raw extended shells of filleted boxes (smlibwasm 437 kB), now 128 bytes.
- Face copies the kernel could not build were kept for the life of the process (T2), 118 kB each
  (smlibwasm 82 kB); they are freed now.

## New

Names are smlibpy's; smlibwasm has each one in camelCase, with keywords as options, unless marked.

### Booleans, cells and splits ([features](../../docs/features.md), [selecting](../../docs/selecting.md))

- `Part.classify(point, tol=None)`, `Part.contains(point)`, `Part.cell_at(point)`: inside, outside
  or on a face, edge or vertex, by the kernel's classification with voting rays (B11).
- `Part.split(sheet, keep)` splits along a `Shell` or a face that is not planar, both sides checked
  to add up (B12); a sheet of one face that ends inside the part is extended first (a plane,
  cylinder, cone or sphere as itself); `sheet - part` and `sheet & part` trim a sheet by parts
  (smlibwasm `shell.cut(...)`, `shell.intersect(...)`).
- `Part.imprint(tool, direction=None, *, nearest=True)`: the part's faces split where a part, sheet,
  face or sketch crosses them, or along curves moved onto it along a direction; volume unchanged
  (B14, U3).
- `Part.sources`: the parts a cell of a merged part lies in (B15).
- `smlibpy.defeature.GUARD_BOOLEANS = True` (smlibwasm `setGuardBooleans(true)`): every Boolean and
  merge in another process, for batch runs over unknown inputs (N1).

### Fillets and chamfers ([features](../../docs/features.md))

- `fillet(..., propagate=True)`, `chamfer(..., propagate=True)`, `Edge.tangent_chain()`,
  `ShapeList.tangent_chain()`: rounds follow tangent runs (F6).
- `chamfer(edges, length, *, length2=None, angle=None, reference=None)`: different setbacks on the
  two faces, or a setback and an angle; exact on planar faces (F9), also at sharp wedges whose
  setbacks differ more than the kernel's solver takes (a straight edge between planes, its ends on
  planes at right angles to it, is cut as the bevel's prism).
- `corners="patch" | "mitre"` for `fillet` and `chamfer`: rounds of three convex edges run on until
  they meet, without a corner patch (F10).
- `fillet(..., setback=None)`: set-back corners where three or more rounded edges meet, all convex or
  all concave: the rounds stop `setback` from the corner and one larger patch joins them (all edges
  of a 20 mm cube, r 2, setback 3: 7781.609270, valid; ball corners 7804.696111), the setback checked
  before the kernel and the result after it (F10).
- Radius laws along runs of edges: a `(start, end)` radius runs linearly along each tangent run, a
  dict `{position: radius}` (smlibwasm a `Map`) smoothly through radii at positions along it, also
  around a single closed edge (F5).
- `Part.fillet_preview(edges, radius, *, propagate=True)`: the surfaces of a fillet's rounds as
  untrimmed sheets, one per edge, without changing the part (F11).
- Fillet and chamfer errors name the corner or edge the kernel could not build, why, and the step
  that failed (F8); a failed round near the largest radius is tried again within a finer tolerance
  and comes out exact (F7), and where its rounds nearly fill the room between two edges the result
  is measured for gaps.
- Chamfers of full circles between faces around one axis are exact cones, which meet cylinders and
  cones in exact circles (F12).

### Shells, offsets and direct editing ([features](../../docs/features.md), [surfaces](../../docs/surfaces.md))

- `Part.offset(distance, *, corners="sharp" | "round")`: `"round"` rolls a ball along the part,
  exact, and builds acute wedges and holes that close (O9); sharp offsets of parts with acute edges
  (cones, tapers) are kept (O8).
- `shell(..., corners=None | "round" | "sharp", walls=...)`: pick the cavity's corners (O12), and
  give faces walls of their own thickness (O10); `info()["corners"]` says which a shell or offset
  got.
- `shell` opens planar faces whose rim meets its neighbours tangentially, also next to an ordinary
  opening (O3).
- `Shell.offset(distance)`, `Face.offset(distance)`, and `offset(sheet or face, d)`: offset sheets,
  faces that touch along edges they do not share sewn first (O7); `thicken(surface, t, *,
  both=False)`.
- `Part.move_faces(faces, by)`, `Part.offset_faces(faces, distance)`: move faces by a vector or a
  `Location`, offset them along their normals (push-pull, hole and boss resize), the part rebuilt
  around them exactly; parts with cavities are edited (and drafted) outside and cavity apart, and
  the faces extended around the edited ones keep their cylinders and cones (O10).
- The two-sided draft about a planar parting line, as a recipe in the docs (O11).

### Primitives, sweeps, lofts and extrusions ([parts](../../docs/parts.md))

- Sectors: `Cylinder(..., arc_size=)`, `Cone(..., arc_size=)`, `Sphere(..., arc_size1=, arc_size2=,
  arc_size3=)`, `Torus(..., major_angle=, minor_start_angle=, minor_end_angle=)` (part of the tube's
  circle), and `AnnularSector(inner_radius, outer_radius, height, arc_size)`, with exact faces (S13).
- `Pyramid(length, width, height, align=...)`: five planes, volume l w h / 3 (S13).
- `swing(profile, outline)` and `Sketch.swing(outline)`: a revolve whose circle is any closed
  outline around the axis (bottles, knobs, soap bars) (S12).
- `sweep(..., up=None, twist=0.0, scale=None, anchor="center")` and `Sketch.sweep(...)`: the
  attitude of the profile along the path (an axis, `"frenet"`; a `ValueError` says where the profile
  would spin), a twist (degrees or a function of the length), a scale law (`(start, end)`, points, or
  a function; within 1.3e-6 of the law along any path), and the point of the profile that goes on
  the path (`"center"`, `"origin"` or a point of its plane) (S2, S3, S7). Along helices the axis is
  the default.
- `loft(..., start_tangent=None, end_tangent=None, closed=False)`: end tangents along a direction
  or continuing a face the section lies on, and lofts closed through the first section again
  (S10).
- `loft(sections, rails=...)` for open sections and `sweep(profile, path, rails=rail)` for an open
  profile from the path to a second rail: surfaces through sections and rails exactly (Gordon
  surfaces, `ext.gordon`; the swept profile within 1e-6 of the size) (S10). The sections cross the
  rails at the same parameters exactly, and the rails may spread the sections differently along
  their lengths (one rising over a hump where the other runs straight, a fender's skirt dropping
  lower than its inner side); a corner, or a bend too sharp for a smooth curve to follow, is
  refused.
- `extrude(..., corners="sharp" | "round")`: tapers with plane walls, or with rounded corners (S9).
- Revolves give cylinders, cones, spheres and tori (S4); single line and arc sweeps give planes,
  cylinders, cones and tori, and extrusions along a direction across the normal planes for straight
  edges (S8). Sweeps with the kernel's frame along helices of more than about 60 turns go in pieces
  (C4).

### Curves and sketches ([sketches](../../docs/sketches.md))

- `Edge.trim(start, end)`, `Edge.split(at)`, `Wire.trim`, `Wire.split`, `Edge.param_at_point(point)`
  (build123d's name: the fraction of the nearest point), `Edge.closest_point(point)`,
  `Wire.closest_point(point)` (C2, A2).
- `Edge.extend(distance, *, end="end", continuity="G1")` and `Wire.to_edge()` (C6).
- `Edge.intersections(other, *, tolerance=None)` with edges, wires, faces and bodies,
  `Edge.intersection_params`, `Wire.intersections`, `Edge.self_intersections()` (C5).
- `Edge.offset(distance, *, plane=None)` and `Wire.offset(distance, *, corners="round",
  plane=None)`: parallel curves, lines and arcs exact, splines within 1e-6 of the size, a closed edge
  with a corner where it starts one closed edge; `Stroke` along splines and ellipses (C7).
- `fit_curve(points, *, tolerance=None, degree=3, tangents=None, closed=False)`: a B-spline within a
  tolerance of every point, along a direction at every point where `tangents` has one per point;
  `Spline(..., tangents=[...])` with a direction per point (C8). A least-squares fit of smlibpy's own:
  it averages noise below the tolerance out (80 noisy points round a ring within 0.6: 15 control
  points, where the kernel's approximation took 31 and followed the noise; a quarter circle within
  1e-6: 22, the kernel 47), takes the points' own direction at the ends of an open curve where they
  run smoothly there, and a closed curve is periodic (as smooth at its first point as elsewhere).
- `Edge.curvature_at(t)`, `Edge.radius_at(t)`, `Edge.min_radius()` and `Edge.min_radius_at()` (a
  float and its fraction, as `Face.min_radius()` is a float), `Edge.inflections()`,
  `Wire.min_radius()`, `Wire.min_radius_at()`, `Edge.continuity()`, `Wire.continuity()` (C9, A4).
- `Edge.to_arcs(tolerance=0.01)`, `Wire.to_arcs`, and `export_dxf(..., curves="arcs")`: lines and
  arcs for CNC (C10).
- `Edge.from_nurbs(nurbs)`: an edge from degree, knots, control points and weights (C11).
- `ParabolicArc`, `HyperbolicArc`, `ConicArc(start, apex, end, rho=0.5)` (exact conics) and
  `Spiral(start_radius, end_radius, turns, plane)` (C14).
- `Edge.through(point, *, tangent=None, at=None)` and `Edge.match(*, start=, end=, start_tangent=,
  end_tangent=)`: bend an edge through a point, or onto new ends (C16).
- `Sketch.fillet` and `Sketch.chamfer` at splines and ellipses; `Wire.fillet` at arcs, splines and
  ellipses (C15).
- `Helix` of any number of turns (C4); `Spline` of many points in linear time (1600 points: 5 ms, it
  was 4.2 s), closed ones periodic (C13).
- `Edge.dihedral_angle` (T1), `Edge.tolerance`, `Vertex.tolerance` (T4).
- `Sketch.section_properties()`: area, centroid, second moments, principal axes, radii of gyration,
  section moduli (A5).
- `Text(font=...)` takes a `Font` or the bytes of a font file (W14, X11).

### Surfaces ([surfaces](../../docs/surfaces.md))

- `blend(edge_a, edge_b, *, continuity="G2", tension=(1, 1), join=False)`: a bridge between two
  sheet edges, G1, G2 or G3 across both, untwisted, also between two closed edges (the rims of two
  tubes, bridged all round) (U2).
- `Shell.trim(curves, keep)`, `Face.split(curves)`, `surface_fillet(..., trim=True)`: trim sheets
  with curves that lie on them, also curves that run on past a B-spline sheet's border or across a
  hole (U3).
- `fill(boundary, *, tangent=True)` and `network(u, v)`: Coons and N-sided patches that close a loop
  of curves, tangent to the sheets of its edges (N-sided ones to about 1.4 degrees, checked to 2), and
  surfaces through curve networks (U4).
- `stitch(..., report=True)` and `StitchReport`; `Shell.flipped()`, `Face.flipped()`,
  `Sketch.flipped()` (U5).
- `Face.extend(distance, *, sides=None, continuity="natural")`, `Shell.extend(...)`,
  `Face.untrimmed()` (U6).
- `Part.push(face, at, *, by=None, to=None, normal=None, radius=None, continuity="G1")`, also on
  `Shell`: a smooth dent or bump at a point, the face's edges in place (U7).
- `Part.warp(face, region, by)` and `Part.flatten(face, region, plane)`, also on `Shell`: raise,
  sink or press flat a region of a face, keeping only the knots the result needs within 1e-6 of the
  size (U8).
- `Shell.match_edge(edge, target, *, extent=0.25)`: an edge of a sheet moved onto a curve (U9).
- `Shell.merge_faces(a, b)`: two faces that share a side made one (U10).
- `surface_fillet(..., radius2=None, shape="round" | "chamfer")` (U12).
- `nurbs_surface(points, knots=None, degrees=None, weights=None)` and `Shell.from_nurbs(nurbs)` (the
  data in `NurbsSurface`'s order, as `Edge.from_nurbs` takes a curve's): a surface from NURBS data
  (U13).
- `intersection_curves` with a `Plane` or a `Face` (U14).
- `surface(..., report=True)` and `FitReport`: how far each point of a fit lies from the surface
  (U15).

### Selection, history and topology ([selecting](../../docs/selecting.md))

- `ShapeList.new(since)` and `ShapeList.derived_from(*shapes)`: the faces and edges an operation
  made, and those that come from given bodies, faces or edges, through the kernel's attributes (T3).
- `ShapeList.joining(a, b)`: the edges where two bodies meet, to round next (B17).
- `body.check(level=2)` and `Problem`; `Part.is_valid(strict=True)` (T4).
- `colored(color, faces=...)`, `named(name, faces=...)`, `Face.color`, `Face.name`: colors and names
  of single faces, kept through operations and written to STEP, glTF, USD and pictures (T5).
- `Part.shells()`, `Part.voids()`, `Face.cells`, `ShapeList.shared()`, and `"solids"` and `"voids"`
  in `info()` (T7).
- `ShapeList.g1()`, `ShapeList.g2()` (A4).

### Measuring and analysis ([analysis](../../docs/analysis.md))

- `closest_points(other)` and `ClosestPoints`: the nearest points of two bodies, faces, edges or
  wires, with their faces; `distance_to` of faces, edges and wires (A2).
- `Face.curvature_at(point)` and `Curvature`, `Face.min_radius()`, `Face.nurbs()` and
  `NurbsSurface`, `Face.position_at(u, v)`, `Face.uv_at(point)`, `Face.closest_point(point)`,
  `Face.iso(*, u=, v=)` (smlibwasm `iso({ u, v })`), `Face.major_radius`, `Face.cone_angle` (A3,
  C12).
- `Edge.continuity()` and `Continuity`: G0, G1 or G2 across an edge, with the gap, angle and
  curvature jump (A4).
- `MassProperties.inertia_about(point)`, `moment_about(axis)`, `radii_of_gyration` (A6).
- `Part.project(curve, direction, *, nearest=False)`: only what the curve sees, each piece checked
  between the places where it crosses an edge or silhouette of the body; `Face.project(curve)`
  (normal projection), `Face.wrap(shape, at=None)` (a drawing laid onto a face, lengths kept);
  pieces a closed face's seam cuts come back joined (C12).
- `outline(plane, *, hidden=False, tangent_edges=False)`: the hidden lines of a view too, with
  exact lines and circles where the projections are such (M4).
- `raycast_many(origins, directions)` of bodies and meshes: the first hit of many rays at once, cast
  exactly where a ray grazes the body's mesh within twice its tolerance, so the hits are `raycast`'s
  (M5).
- `compact()`: free what queries kept on a body (N9).

### Meshes ([analysis](../../docs/analysis.md#meshes))

- `Mesh.decimate(fraction=None, *, triangles=None, tolerance=None, feature_angle=30.0)`: fewer
  triangles, a closed mesh kept closed without folded slivers, the distance measured, edges sharper
  than the feature angle kept longest and sharp (M6).
- `Mesh.section(plane)`, `Mesh.slices(step)`, `Part.slices(step)`: sections chained into wires,
  sketches per layer (M7).
- `Mesh.to_part(max_faces=5000)` and `Part.from_mesh(mesh)`: faceted parts of closed meshes (M8).
- `Mesh.fill_holes()` and `Mesh.repaired()` and `RepairReport`: holes closed, points merged,
  triangles turned (M9).
- `max_edge=` on `tessellate`, `mesh()` and the mesh exporters (M10).
- `Mesh.mass_properties(density)`, `Mesh.centroid` (M11).
- `Mesh.translate`, `rotate`, `mirror`, `scale`, `moved` and `Mesh.dispose()` (M1, W3).

### Drawings ([files](../../docs/files.md#drawings))

- `drawing_views(part, views, *, projection="first-angle", hidden=True, tangent_edges=False)` and
  `DrawingView`: the views of a part, or of a list of parts and sheets that hide each other, laid out
  in first- or third-angle projection (M4).
- `export_svg(shapes, path)` and `to_svg`, and `export(..., "x.svg")`: drawings, edges and sketches,
  exact lines and arcs; `export_dxf` writes views on the layers VISIBLE and HIDDEN (dashed) (M4).

### Sheet metal and deformations ([sheet metal](../../docs/sheet-metal.md), [deform](../../docs/deform.md))

- K-factors per bend: `fold` and `flange` record theirs, and `.smp` files keep them; `k_factor=`
  takes a function, a mapping from radius, `(r/t, k)` pairs or `"din6935"`
  (`smlibpy.sheetmetal.din6935`, `KFactor`) (D1).
- `unroll(shape, *, radius, axis=Z, start=None)` and `Part.unroll`: a part wrapped around an axis
  laid flat; `unfold` of rolled parts, curls and bends over 180 degrees; `bend_allowance` up to 360
  degrees (D3).
- `twist`, `taper`, `bend`, `unroll` and `Lattice.apply` deform edges, wires and points (D6).
- Deformations keep analytic faces where the exact image is analytic, and a twist keeps the
  cylinders, cones, spheres and tori about its axis (D2). Bend-zone faces are the exact bend within
  1e-6 (D5).

### Files ([files](../../docs/files.md))

- IGES: `import_iges(path, *, heal=True, strict=False)`, `from_iges`, and `load` of `.igs` and
  `.iges`: solids and trimmed surfaces, in mm, named and colored, with offset curves (entity 130)
  (I14).
- OpenCASCADE `.brep`: `export_brep`, `to_brep`, `import_brep(path, *, heal=False, check=True, strict=False)`,
  `from_brep`, and `.brep` in `export` and `load`: exact bodies for build123d, CadQuery and FreeCAD,
  each edge, vertex and face with a tolerance of its own (X14). Of a corpus of 448 STEP files, all
  585 bodies are written and 557 of the 559 solids read back (the other two are broken as read from
  STEP); OpenCASCADE takes 582 of the 585 for valid.
- SMLib part files: `save(shapes, "x.smp")`, `load`, `to_smp`, `from_smp`: several bodies and curves
  with names and colors, and the K-factors of folded parts (X9, D1).
- Files in memory (*Python*): `to_step`, `from_step`, `from_step_model`, `to_stl`, `from_stl`,
  `to_obj`, `to_glb`, `to_gltf`, `to_dxf`, `from_dxf`, `from_dxf_wires`, `to_usd`, `from_usd`,
  `to_smb`, `from_smb`, `to_smp`, `from_smp`, `from_iges`, `to_brep`, `from_brep` (X11), and
  `to_file(shapes, name)` and `from_file(data, name)`, which pick the format from a name's extension
  as `export` and `load` do (smlibwasm `toFile`, `fromFile`).
- STEP: `import_step(..., strict=False)`, `read_step(..., strict=False)`, `StepModel.skipped` (I6);
  `export_step(..., assembly=True)`: a product per body under a root (I10); `export_step` of edges,
  wires, points and planes, and `StepCurve`, `StepPoint`, `StepFrame` with their colors (I12); offset
  surfaces written exactly, and offsets of planes, spheres, cylinders, cones and tori read as those
  surfaces where the offset build fails (I11); offset curves (along the reference direction x the
  tangent, as OpenCASCADE reads them), edges given only as `PCURVE`s, and assembly placements that
  mirror or scale read (I6, I10); face colors and names in and out (T5).
- USD: `import_usd(path, *, units=None, placement=True, check=True, strict=False)` (X2, X6, X7);
  `export_usd(..., materials=True)` (X12); analytic edges (X5); names of any characters (X3).

### smlibwasm ([JavaScript](../../docs/javascript.md))

- `@classcad/smlibwasm/worker`: `expose(...)` in a worker and `new KernelWorker(...)` on the page,
  with timeouts, abort signals and a new kernel after a crash; bodies cross as `.smb` (W2).
- `@classcad/smlibwasm/init`: `init({ locateFile | wasmBinary | wasmModule | instantiateWasm })` for
  CDNs, Electron and bundlers that leave the `.wasm` out; the loader bundles with webpack, esbuild
  and Vite (W7).
- `memoryUsage()`: `{ used, heap, limit, handles, crashes }` (W8, W9, W10).
- `scope(fn)`: dispose every kernel object `fn` made that its result does not hold (W9).
- `fromFile(data, name)` and `toFile(shapes, name)`, and `BytesLike`: files in memory by their name;
  every reader takes any bytes (W14).
- `@classcad/smlibwasm/kernel`: the raw layer, with every function of `smlibpy._core` (W15).
- `GUARD_SECONDS`, `setGuardSeconds(seconds)`, `GUARD_BOOLEANS` and `setGuardBooleans(on)`: the probe
  worker's time limit, which the kernel's deadline holds on a page's main thread too, and Booleans
  in the probe worker (W2, N1).
- Exported types of options, selections and results (`FileOptions`, `HullItem`, `LocationLike`
  among them), overloads of the free functions (W11).

### Python runtime ([the kernel](../../docs/kernel.md))

- `smlibpy._guard.isolated` and `smlibpy.defeature.GUARD_PROCESS = "auto" | "fork" | "helper"`:
  kernel steps that can crash run in another process that returns their result, also on Windows;
  Ctrl-C stops them (N1).
- Threads: one kernel lock, and the long calls let the GIL go, so other threads run on (N8).
- `KernelError.trace`: where in the kernel a call gave up (N6, both languages).
- A deadline inside the kernel (`smlibpy._core.ext.set_deadline`, kernel patch): a guarded step that
  runs in this process, where no other process can be started, is held to `GUARD_SECONDS` (W2, both
  languages).
- `FontError` in `from smlibpy import *` (W13).

### For contributors and the raw layer

- `tools/fuzz/`: a seeded fuzz run of Booleans, fillets, shells, offsets and slices in both builds,
  with invariants and baselines for darwin-arm64 and linux-x86_64 (N3; the Linux one from local
  emulated runs, which CI's first fuzz job confirms); pull requests run the seeds 7 and 8, the
  nightly run the day's date too.
- `tools/sanitize/run.py` (AddressSanitizer and LeakSanitizer over the tests of the patched kernel
  code and of smlibpy's C++; pytest's verdict counts), `tools/oracles/` (upstream's `prog_test`
  suites, SmPyLib's tests, 200 `.smb` files, crash loops, NVIDIA's USD validator on a shim) and the
  "Checks" workflow (N2, N4).
- NVIDIA's validator itself (`brep_validator.validate_file`, with OpenUSD and the asset validator):
  `tools/oracles/usd_validator.py --nvidia FILE.usda ...`, and tests of both suites on what
  `export_usd` and `toUsd` write (19 files: eleven bodies, among them a non-ASCII name, cells, text
  and NURBS faces; two bodies with meshes; line edges read and written again; five of usd-brep's own
  files read and written again, BA.465 exempt for those); the Python suite's also on a box with a
  vertex moved out of its box, which must fail (BA.310), as upstream's file for BA.000 must (N4). It
  runs on any platform: `pip install "usd-validation-nvidia[usd]"` brings OpenUSD and the asset
  validator, and the tool takes the BrepArray rules and the omniSolid schema from the submodule;
  usd-brep's wheel (`usd-brep[validation]`, Python 3.12 on Linux and Windows) brings all of it. CI's
  Linux job (Python 3.12) installs `usd-brep[validation]`, its macOS job and the JavaScript job
  `usd-validation-nvidia[usd]`, none of them with continue-on-error, and sets
  `SMLIBPY_REQUIRE_USD_VALIDATOR`, which fails these tests instead of skipping them where the
  validator is missing: a green run of those jobs is a run of the validator. On macOS (usd-core
  26.8, usd-validation-nvidia 1.22.0, the submodule's rules at usd-brep 1.0.0) the 40 files of the
  close-out's linux/amd64 container run (usd-brep 1.0.1) get the same verdict each: every file
  passes the BrepArray rules, and of the general rules only `UsdAsciiPerformanceChecker` complains
  (large arrays in a text file).
- `tools/parity.py`: smlibwasm's writers and modelling steps against smlibpy's golden files, and 56
  steps of the capabilities phase 1 added (`capabilities()`), which agree to 1e-7 (N5).
- New `ext` calls of both builds, among them `classify_points`, `boolean` (it clears the kernel's
  Boolean mark and leaves the operands to the caller on failure; it can return a new Brep),
  `edge_angles`, `join_curves`, `nearest_points`, `usd_stage`, `seam_contacts`, `slice`,
  `check_brep`, `round_edges`, `oriented_sweep`, `skin`, `analytic_revolutions`,
  `intersect_curves`, `offset_curve`, `hidden_lines`, `poly_arrays`, `edge_continuity`,
  `stitch_faces`, `fill_loop`, `push_face`, `kernel_trace`, `drop_caches`, and since the close-out
  `seam_touches`, `plane_section`, `nearest_point`, `exact_circles`, `planar_faces`,
  `planar_path_sweep`, `gordon`, `approximate_tangents`, `offset_curve_3d`, `set_deadline` and
  `update_tolerances`;
  `round_edges` takes `setback`, `chains`, `law_at` and `law_radii`, `skin` start and end faces, and
  `curve_sweep` a profile reference.
- smlibwasm's option table (`js/src/_options.ts`) is generated from Python's signatures (W5): after
  adding or renaming a keyword in Python, run `python tools/gen_js_options.py`;
  `tests/test_js_options.py` and `js/test/options.test.ts` fail until it is current.
- Kernel patches: twenty-eight kernel files are built from patched copies in `third_party/patches`
  (twenty-five more than in 0.4, among them a header, `SmMessages.h`), each listed with what it was
  measured to change and confirmed with AddressSanitizer where it fixes a memory defect.

## Behaviour changes

Changes a script notices without having to change, beyond those under Breaking changes.

Operations that raised and now return a result. Code that caught their error to fall back to another
construction gets the result:

- Booleans: crossing holes whose seams lie tangent to each other (B4: `Cylinder(3, 40).translate(0,
  3, 0) & Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)` is 62.7209), a tool beside an earlier
  parallel hole or boss (B10: `(Box(40, 40, 10) - Cylinder(6, 30)) - Cylinder(3, 30).translate(8, 0,
  0)` is 14612.2528, retried with a NURBS copy of the tool), merges along tangent seams (B6), right
  empty intersections far from the origin (B13), a union or intersection of one tool that the kernel
  fails, tried again with the operands the other way round.
- Fillets and chamfers: one edge of a tangent run (F6), all edges of a 10 mm cube with r 4.98 and of
  a 20 mm cube with 9.97 and 9.98, exact (F7).
- Shells and offsets: planar openings whose rim meets its neighbours tangentially, also next to an
  ordinary opening (O3), sharp
  offsets of parts with acute edges (O8: `Cone(5, 2, 10).offset(1)` is 819.1342), offsets of sheets,
  faces, wires and edges (O7, C7).
- Sweeps: loops closed with a kink and circles along closed 3D fillet polylines (S1), mitered planar
  paths in planes that are not horizontal (S2), chains of helices with an even number of turns (S6),
  planar paths whose corners cannot be mitered (S6: piece by piece, with a warning), circles and
  ellipses twisted along a line (S3), revolves through 359.99 to 360 degrees (S4), `Stroke` along
  splines and ellipses (C7), sketch fillets and chamfers at splines and ellipses (C15), helices of
  more than 26 to 79 turns and sweeps along helices of more than about 60 turns (C4), extrusions
  within 0.6 degrees of tilted planes (S14), ellipse curves in Python's sweeps, projections and
  ruled surfaces (C3).
- Queries: `Part.project` of a curve that misses (C12), `intersection_curves` of bodies apart (U14),
  `distance_to` of edges, wires and faces (A2), `Face.interior_point()` of narrow imported faces
  (I9).
- Sheet metal: rolled parts, curls, end bends and bends over 180 degrees unfold (D3); mirrored
  sheet metal parts and files with B-spline edges unfold as 0.4 unfolded them.
- Molding: `Torus(10, 3).parting_line((-1, 0, 0))` returns the parting line (it raised "a face
  still faces both ways", M4).
- Files: STEP files with O-rings (I3), cavities whose faces leave gaps (I4), one unreadable body
  (I6), offset curves or edges given only as `PCURVE`s (I6), assembly placements that mirror or scale
  (I10), offsets of whole spheres (I11); `export_step` of edges, wires, points and planes (I12);
  `load` of `.igs`, `.iges`, `.smp` and `.brep`.

```python
plate = Box(40, 40, 10) - Cylinder(6, 30) - Cylinder(3, 30).translate(8, 0, 0)   # 0.4: KernelError
plate = Box(40, 40, 10) - [Cylinder(6, 30), Cylinder(3, 30).translate(8, 0, 0)]  # the workaround, still exact
```

New warnings (`RuntimeWarning`; smlibwasm: `setWarningHandler`), which scripts that turn warnings
into errors filter: a STEP body left out, stitched or not repairable (I5, I6); `export_step`
converting a body to NURBS (I11); a USD body with gaps below the limit (X6) or of mixed dimension
(X13); an extrusion direction close to the sketch plane (S14); a planar sweep path swept piece by
piece (S6); a sweep along a helix whose profile could not keep its attitude to the axis, a profile
that could not be carried along a 3D path and was swept turned to each edge's start, and one that
could not be made to meet itself where a loop with corners closes (S3, S1: "the profile could not
..."); `max_edge`
that leaves a twisted face off the tolerance (M10); `distance_to` whose points do not settle (A1);
a helper process that does not start (N1); a `.brep` body left out (X14); smlibwasm's first kernel
crash (W10).

Other differences:

- Results that were close are exact now: volumes of chamfered circles (F12), scaled bodies (T6),
  arcs swept (S8), circles along helices (S3), STEP offset faces (I11), twisted cylinders (D2) move
  in the sixth digit or later; sections of B-spline faces by up to 0.13 % of their area
  ([more](#sections)).
- Booleans in which a seam touches the other operand at a point are checked at points of the
  result's faces near it (0.02 to 0.15 s; nothing otherwise), and a split by a plane that touches a
  torus' outer equator takes a few seconds (B6). The kernel's evaluation beside a seam is right now
  (`SmEllipse.cpp`), so Booleans that converged on a point there can go another way: in the suites,
  a cut beside an earlier hole in a sphere that the kernel returned empty fails in the kernel, and
  the NURBS retry gives the right result as before (28160.608).
- `shell` and `offset` accept a result whose faces reach out of the part's box by no more than the
  tolerance of their edges and vertices, at most 1e-4 of the box's size: the kernel's tight box of a
  face takes in surface points within a vertex's tolerance off the face (the deform recipe's twisted
  vase shells in every run, where 5 of 12 runs were refused).
- Meshes of spheres with whole poles, and of tori and other surfaces of revolution whose triangle
  edges strayed beyond the tolerance, get a few more triangles (M2: `Sphere(10).mesh()` 3596 for
  3584, `Torus(20, 5).mesh(0.05)` 4736 for 4096); corner normals at the apex of cones change
  (MESH-APEX).
- A round profile along a closed path of several tangent edges is one sweep closed where its ends
  meet: other faces than 0.4's pieces, the same volume (S1).
- A sweep fused from pieces whose fuse leaves a vertex or edge farther from what it meets than its
  tolerance gets that tolerance raised to the gap (the kernel's `ValidateAndUpdateTolerances`): the
  same faces and volume, and `is_valid(strict=True)` and `check()` find nothing there (S1).
- STEP and `.brep` files of a face whose loop passes a vertex twice hold the loops between, one
  bound or wire each ([more](#step-export)); smlibpy's readers join them again. A `.brep` file leaves
  out an edge that a loop runs along and straight back (its face, volume and the edges around it are
  the same).
- `shell` tries the kernel's plain mode once, then its extended mode, and that once more only after
  a refused result; `offset` once and once more after a refused result (O6). Failing shells return
  up to 8 times sooner; smlibwasm's shells, offsets and thickenings run in the probe worker's
  kernel.
- An empty intersection or cut of operands with tangent or coincident surfaces is checked by
  classifying points of their meshes (B13, B19: 0.03 to 0.2 s); the ball in its own cavity,
  `Sphere(5) & (Box(20, 20, 20) - Sphere(5))`, is the empty part (it raised).
- `KernelError.trace` lists where the kernel gave up, also from the other process and smlibwasm's
  workers (N6).
- Python threads run on while the kernel works, and wait for the kernel's lock when they call it
  (N8).
- The kernel's curve intersection evaluates second derivatives (X14): a little more work, the same
  results.
- MCP: the search ranks `Part.warp` before `Lattice` for "warp the part" and knows new synonyms;
  `save` writes `smp` and `brep`.
- A tapered extrusion carries the sketch's name and color, as a plain extrusion does (S9; it had
  none).
- A scale law along a path whose parameter runs unevenly follows the length within 1.3e-6 (it was
  1.2e-3 off between 65 points), volumes change in the sixth digit (S7).
- smlibwasm: the methods and constructors that make intermediates free them before they return (W9):
  no API change, less memory in loops.
- Tools: `tools/parity.py`'s `golden.json` has a `capabilities` key, and `differences()` writes the
  files from the golden bodies elsewhere than on darwin-arm64; `tools/oracles/smpylib_tests.py`
  leaves 5 more upstream tests out (listed with the reason); `tools/fuzz/baseline.json` has
  `linux-x86_64`; CI's Linux job installs `usd-brep[validation]` (was `usd-brep`), and its macOS and
  JavaScript jobs `usd-validation-nvidia[usd]`, without continue-on-error; with
  `SMLIBPY_REQUIRE_USD_VALIDATOR` set, the tests of NVIDIA's validator fail instead of skipping
  where it is not installed (N4).
- `bbox()` of a part bent with `bend` grows by about 1e-5 across the bend, where the exact cylinders
  replace the fitted faces (D2: the bent bar of deform/bend reads y +-5.00001, it read +-5.0).
- A USD round trip keeps volumes to 1e-11, not 1e-12 (a cone: 2.8e-12 off), now that edges are
  written as lines, circles and ellipses (X5).
- Mirrored bodies (`mirror`, a `Location` or matrix that reflects) are laid out as the body was:
  their faces' surfaces face as the original's did, and their straight and circular edges are lines
  and circles (`geom_type` said `bspline`, and `edges().circles()` of a mirrored part found none). A
  mirrored sheet's normals are the mirror of the sheet's ([more](#mirrored-sheets)). Turning a face
  back over swaps its u and v, so a mirrored freeform face is meshed with other triangles than the
  mirror image of the original's mesh, within the same tolerance: the mesh of a mirrored
  `loft([Rectangle(20, 10), Circle(4).translate((0, 0, 20))])` encloses 2174.682, the original's
  2175.147 (`mesh(0.01)`; both within 0.005 of the exact faces).

## Speed and size

Faster:

- A point along a helix of many turns: 9 ms for 1000 turns (it took a second, and sampling 101
  points 128 s), a curve's arc length walked once per span (C4).
- An empty intersection of two perforated plates of 168 faces took 11.4 s (smlibwasm 10.9 s), now
  0.12 to 0.18 s (B13).
- `named()` and `colored()` copy nothing: 0.79 ms to 0.01 ms on a plate of 86 faces, and the next
  `volume` is free (T8).
- STEP import integrates each shell once (I8: an imported part of 2079 faces 7.8 s to 5.0 s), builds
  each product of an assembly once (I7: 251 instances of 152 bodies in 50.5 s), and narrows face
  domains (I9).
- `Spline` of 1600 points: 4.2 s to 5 ms (smlibwasm 73 to 45 ms) (C13).
- `raycast_many`: 0.01 ms a ray on 250,000 triangles (`Mesh.raycast`: 36 ms), 0.05 ms a ray on a
  plate of 144 holes (M5); `Part.raycast` no longer meshes the body again for every ray the kernel's
  intersection misses.
- Chamfers of 162 hole rims: 1.5 s (the kernel's bevels 3.1 s) (F12). The glTF of a sphere at
  0.001 is 3.3 MB, it was 9.6 MB (M12). Shells and offsets of 154 imported parts: 591 s instead of
  1687 s (O6).
- *Python*: kernel steps in another process run once instead of twice (N1).
- Unfolding parts with holes inside a bend zone: 0.17 to 0.05 s, a square hole in an R20 bend 0.04
  to 0.02 s (D5).

Slower:

- `merge` integrates the volumes of its parts and result (a plate with nine pins: 8 to 24 ms);
  `cells()` checks its sum and finds each cell's sources (28 cells: 33 to 77 ms) (B5, B15).
- `is_valid()` integrates a body once (0.5 ms on a small part, 55 ms on 206 faces, 0.6 s on an
  imported housing) (B2).
- `shell`, `offset` and `thicken` fork and pass the body as `.smb` (about 7 ms a step); a closed
  shell runs a second offset for its check (O1, O2). Fillets and chamfers of parts read from files
  run in another process (about 12 ms more on a small part) (N1). On Windows the helper process
  starts once, in about 0.2 s.
- Meshing checks the triangles against the surfaces (M2: `Sphere(10).mesh(0.01)` 54 to 96 ms).
- Revolves convert and check their faces (S4: a lathe profile 4 to 12 ms); tapered extrusions of
  sharp profiles are drafted (S9: a rectangle 4 to 8 ms); sweeps along helices place more sections
  (S3: an 8-turn spring 71 to 147 ms); extrusions along a direction are checked (S14: a rectangle
  0.6 to 1.2 ms).
- A fillet or chamfer that fails takes up to twice as long (the finer retry, F7). A failing sweep
  along a kinked loop makes up to 13 more tries (S1), and a sweep fused from pieces checks its
  tolerances (about 6 ms round a kinked loop). 2D Booleans of sketches whose faces touch at a
  point take 2 to 18 ms (C1).
- Seam detection costs at most 0.42 ms per Boolean (B6); the kernel lock about 20 ns per kernel call
  (N8). Where a seam touches the other operand at a point, the result is checked: 0.02 to 0.15 s per
  such Boolean, and a split by a plane that touches a torus' outer equator takes a few seconds (B6).
- `distance_to(point)` and `closest_point` of bodies with B-spline faces search every face and span
  that could hold a nearer point: about 2 ms on a part thickened from a B-spline sheet (the kernel's
  0.2 ms); analytic bodies as before (a box 0.01 ms). `Part.section` of such parts: 5 to 10 ms.
- A closed STEP shell of offsets of planes, spheres, cylinders, cones or tori is built twice, as
  offsets and on the surfaces they are (I11).
- `silhouette()` computes the whole contour (M4): a rounded block with three holes from (1, 1, 1)
  24 to 140 ms, the plate of 81 holes 610 to 957 ms (smlibwasm 780 to 1173 ms).
- `section()` checks that its regions lie in the part (B18): a section of a rounded block 0.9 to
  1.8 ms, the plate of 81 holes 33 to 52 ms (XY) and 1.0 to 6.7 ms (XZ) (smlibwasm 44 to 71 ms).
- Copies that add analytic surfaces (`mirror`, `.smb` files, `to_shell()`, offsets and shells)
  check each recognized surface against the B-spline at points in every knot span (U1); a mirror
  turns the faces back and gives edges their lines and circles: a plate of 106 faces mirrors in
  47 ms.

Size:

- smlibwasm's `smlibwasm.wasm` is 9.4 MB (2.22 MB with brotli), up from 6.5 MB (1.60 MB): the
  OpenCASCADE bridge (X14), SmPyLib's binders for the raw layer (W15), the error reports (N6) and
  the new features. The library is 2.2 MB unminified (0.49 MB with brotli), plus the dictionary of
  WOFF2 fonts (79 kB, 59 kB with brotli). A browser loads about 2.8 MB with brotli (0.4: 1.9 MB).
- smlibpy's extension module on macOS arm64 grew from about 11 MB to 13 MB.

## Known kernel limitations

Kernel defects and limits this release leaves, each after a real attempt to fix it. smlibpy refuses
what would come out wrong, or runs the step in another process; the evidence is in the plan
([kernel-deep-dive.md](kernel-deep-dive.md)) and `third_party/patches/README.md`, and
[the kernel](../../docs/kernel.md#known-kernel-limitations) lists them for users.

Booleans:

- **Seams that no turn moves (B6).** Booleans along a torus' outer equator, or along the seam of a
  closed free-form face that is no cylinder, cone, sphere or torus, go wrong in the kernel. Where
  such a seam touches the other operand at a point, smlibpy checks the result's faces against the
  operands (16 x 16 points a face) and does it again with NURBS copies or raises, so some of these
  Booleans raise instead of giving the body (the cut of the torus touching a hole, under
  [Booleans that refuse a wrong result](#booleans-that-refuse-a-wrong-result); a split that no
  half-space size nor the kernel's slice gets to add up). Turning the torus, filling and recutting
  the face, NURBS copies, the operands the other way round and a revolve from another latitude all
  leave the seam where it is: `SmTorus` has no other place for it, and `SmFace::MoveSeam` moves no
  seam edge of a closed face. A wrong body whose faces near the seam agree with the operands at the
  points checked would pass (none in 160 random cases beyond 1e-4 of a piece, where OpenCASCADE and
  an integral differ by as much). Move or turn the tool a little.
- **The kernel's Boolean of meshes (`Mesh` `+ - &`) kills the process for the meshes of two
  internally tangent cylinders at a fine tolerance** (also in 0.4; not located). smlibpy's own
  checks no longer ask it; mesh such pairs at a coarser tolerance.

Fillets and chamfers:

- **Rounds at the very limit, and the stepped block's rollover (F7).** All edges of a 10 mm cube with
  r 4.99 give a 14-face body with gaps of 3.6 (r 4.992: 16 faces) at every approximation tolerance
  tried (4 to 0.1 times the edge's), while 4.985 and 4.995 are exact; mitred corners fail, and
  neither SM_API's global merge (K5) nor the edgeuse order that fixed set-back corners changes the
  bodies. The rollover (r 1.5 on a 1 mm step) fails in the corner computation ("Corner Edge
  Computation Failure"). Both raise `ModelingError` or `KernelError`; take a slightly smaller radius.
- **Set-back corners where a face turns inward, between slanted faces, or with radius laws (F10).**
  `SmFilletConcaveNxNCorner` hands setbacks to the convex corner's code, which builds broken bodies
  (a box with a cube pocket at r 1, setback 1.5: invalid, a volume of 754292 for 3458), so smlibpy
  sets back only corners of all convex or all concave edges. Corners between slanted faces (a
  frustum, a wedge's ridge) come out with gaps up to 5.9 or fail: refused (`KernelError` with the
  setback hint). Radius laws with set-back corners crashed the executive: `ValueError`.
- **Radius laws around closed runs of several edges (F5).** Around the top outline of a rounded
  plate (8 edges) any varying law gives an open body with an extra face (19 faces, the executive
  reporting success), from every starting edge and with the edgeuses reordered: `ValueError`.
  Constant radii, open runs and single closed edges are right.
- **Unequal bevels on sharp wedges beyond straight edges between planes (F9).** The solver offsets
  each face by its own distance and the backwards one only so far; a curved edge, or a straight one
  whose end lies on a slanted face or where another bevelled edge ends, cannot be cut as a prism
  (the prism would leave or take material at the ends): `ModelingError`.

Shells and offsets:

- **The extended offset mode on imported parts (O1).** After this release's patches, crescendo part
  81 still crashes the raw kernel steps (a shell and two offsets, twice) in 3 of 30 processes, on a
  freed Vertex in `SmBrep::GlueVertices` that AddressSanitizer never saw in 36 processes, and part 52
  in 1 of 20, on a Loopuse naming an Edgeuse that `DeleteEdge` freed (moving every Loopuse of the
  Brep off the deleted Edgeuses left 1 of 16 under AddressSanitizer). `shell`, `offset` and `thicken`
  run these steps in a forked copy (smlibwasm: the probe worker), so a crash is a `ModelingError`.
- **A heap overflow in `sm_FixProblemsBySqueezing`** (`SmCurveClassification::FindInterval`, in the
  extended offset's merge), seen once by AddressSanitizer and not again in 48 processes of 8 rounds
  with random allocations between them, six runs of `tests/test_guards.py` and the sanitizer job:
  not located. It stays in `tools/sanitize/known.txt`, and the steps run in the forked copy.
- **Small leaks on failure paths.** The curve copies `SmProtoTopologyManager::CreateProtoEdge` makes
  for EdgeDefinitions that some Booleans drop without imprinting them (152 bytes each, about 24 per
  failed extended shell): freeing them after the imprint read curves of Edges deleted since (crescendo
  part 52 crashed in 9 of 20 processes), so that was taken out again. A fillet that fails in
  `SmFilletGeom::InsertIntersectionTopology` keeps a curve copy of
  `SmCurveClassification::MergeInterval` (about 16 kB).

Sweeps:

- **Loops closed with a kink differ between the builds (S1).** Which fallback goes for such a loop
  (the halves fused, split at 0.4, 0.6, 0.3 or 0.7, the round profile's seam turned) depends on
  rounding inside the kernel's fuse of the halves: of 60 hard loops with `Circle(2)`, 49 build in
  each build and 4 build in one only (2 each way). A native build without fused multiply-adds
  differs on 4 others, so it is not FMA alone. A loop that fails raises; close such paths smoothly
  where you can (`Spline(..., closed=True)`).
- **A circle round one kinked loop in smlibwasm is no valid solid for OpenCASCADE (S1).** Kinked loop 1
  of the 60 (`Circle(1.5)`) goes another fallback in smlibwasm than natively (the rounding above):
  the kernel's fuse leaves an edge whose B-spline repeats a control point inside it (`check()`: "Internal
  Coincident ControlPoints"; `is_valid()` is True, the volume 887.761225 agrees with the native body's
  to 1e-8), and the curves OpenCASCADE makes for the edges of one tube face in its parameters cross
  (`ShapeAnalysis_Wire`: a wire that intersects itself), so it takes that face (591.23) for invalid
  when it reads the STEP file. Not attempted beyond that diagnosis. The `.brep` file,
  which carries smlibwasm's own curves on faces, reads as valid; the native body is valid both ways.
  The other 62 circles and 63 rectangles of both builds read as valid from both files. Of the
  native circles, 7 have such an edge too and read as valid.

Surfaces:

- **`fill` tangent to sheets that stand steep to the loop (U4)**: a cylinder's wall round its open
  top, a sphere cut at its equator. Every route tried folds back over the wall (the kernel's corner
  blend as a Coons patch of the rim cut in four, as an N-sided fill of five and six arcs): a
  four-sided patch over a smooth closed loop has both parameter directions along the loop at its
  corners and cannot meet a wall at 90 degrees there. `fill` raises `ModelingError` ("folds back");
  use `tangent=False`, or build a dome.
- **N-sided fills (five sides and more) are tangent to about 1.4 degrees (U4).** The kernel's corner
  blend approximates the cross tangents between a side's middle and its ends: its angle tolerance
  (0.25 down to 0.01 degrees) and approximation tolerance (1e-5 down to 1e-7 of the size) give 1.346
  to 1.348 degrees every time. `fill` checks 2 degrees.
- **Three-sided tangent fills have a pole (U4)**, and the kernel's offset of such a patch does not
  finish (`thicken` stops at `GUARD_SECONDS`); cut into four sides, the offset fails at once and the
  tangency worsens to 0.06 degrees. The patch sewn to its sheets (`stitch(sheet, patch)`) is a valid
  part.

Drawings:

- **Tilted views (M4).** The kernel's hidden curve removal (`SmHCR`) can misjudge a piece of a view:
  natively, the flange example (`examples/flange.py`) seen along (1, 1, 1) lacks 61.4 mm of visible
  lines (36 edges, 1034.777, where smlibwasm and the same body read back from `.smb` draw 1096.144).
  The body is the same in both builds; the visibility jumps with the HCR's approximation tolerance
  (1e-5: 1096.144, 2e-7: 1034.777, 1e-7: 1066.108), and which of its steps misfires is not located.
  Views along the axes were right in every case tested; check a tilted view of a symmetric part for
  symmetry.

Files:

- **K-factor records in `.smb` files (D1).** The kernel's body writer writes no attributes (a record
  attached to the body, a face, an edge or a vertex came back on none), as `.smb` keeps no names or
  colors. Save `.smp`, or pass `k_factor=` when unfolding a part read from `.smb` or STEP.

Builds:

- **The builds differ in the last bits (W16).** The native build contracts `a * b + c` into one
  instruction (FMA), smlibwasm does not: the all-edge fillets of usd-brep's `vase1.smb` and
  `vase3.smb` succeed natively and fail in smlibwasm, and the fuzz seeds 7 and 8 diverge in 10
  operations. A native arm64 build without the contraction lost those two fillets and diverged in
  12 (libm and the order of the kernel's work differ too), so it buys no parity: the native build
  keeps contracting.

Outside the kernel:

- **Vite 4 cannot bundle a module worker that imports the package (W7).** It cannot build module
  workers nested three deep (reproduced with Vite 4.5.14 on three files that only start each other),
  and a worker that imports the package is three (the app's worker, the package's supervisor, its
  probe worker). Vite 5 and webpack 5 build it; with Vite 4 use the package on the main thread.
- **CI on Linux and Windows (N2, N3).** The suites and the fuzz job run on Linux, and the helper
  process on Windows, in CI's jobs at the first push; they could not run here (macOS only). Three
  Linux-only defects found earlier in an emulated container are fixed, and the Linux fuzz baseline
  comes from that container: CI confirms or replaces it. (NVIDIA's validator, N4, runs here too
  now, with `usd-validation-nvidia[usd]`; usd-brep's Linux wheel ran it in that container.)

## Later

Beyond what the plan's items asked of 0.5.0 (their "Do"), not done now. Asking for one of these
gives a clear error, or there is a documented way round.

Booleans, cells and topology:

- `Part.merge(sheet)`, conformal cells along a sheet (B12): the plan asked for `split(sheet,
  "both")`, which is done; a merge along a sheet is a new operation.
- Splits along sheets of several faces that end inside the part (B12): `Face.extend` grows one
  face, and growing and sewing a sheet of several faces is a new operation (`ModelingError`).
- Pieces a sheet imprints that descend from the sheet (B14): the plan asked for an imprint that keeps
  the volume and returns the new faces; tagging them by the sheet is a new provenance rule.
- History tags for bodies read from files, and on vertices (T3): the plan tags faces and edges of
  bodies smlibpy makes; `.smb` holds no attributes.
- `heal(report=True)` from the kernel's `SmHealData` (T4): the plan item itself leaves it for later.
- Face colors and names in `.smb`, USD `BrepArray` prims, OBJ and the MCP live view (T5): the plan
  asked for STEP, glTF and USD materials; `.smb` keeps no attributes, the schema has no face slot,
  STL has no colors.
- Ellipsoids after a scale, and recognition of B-spline faces read from STEP (T6): the kernel has no
  ellipsoid surface, and recognizing imports is a new importer option.
- A fillet hint naming a vertex where the executive recorded nothing, and offset hints beyond the
  crash note (B19): the plan's hints are the executive's record (F8) and the shell's face; searching
  for a vertex is new.

Fillets, chamfers, shells and offsets:

- Exact bevels of edges that are not full circles (F12): the plan asked to correct the accuracy
  statement; arcs, ellipses and B-spline edges keep the kernel's bevels (within about 1e-6 mm).
- Tangent-rim shell openings that are curved, next to a drafted wall, or two that meet (O3): the plan
  limited the cut-out route to planar openings with smooth rims; these raise with the advice to
  shell first.
- `Shell.offset(corners=...)` (O9): the plan asked for `Part.offset(corners=)`; the kernel's rounded
  mode returns inward offsets of sheets unchanged, so a sheet option needs checks of its own.
- Face edits that change which faces meet (O10): `LocalOperation` moves faces within the part's
  topology; a face that vanishes or runs into another needs a Boolean (`ModelingError`).
- Per-face neutral planes for stepped parting lines (O11): the plan asked for the recipe for planar
  ones.

Sweeps, lofts and primitives:

- A named mode for the kernel's rolling frame (S3): the plan asked for `up=` and `twist=`; the
  kernel's frame stays reachable through `orient=False`.
- The helix frame for curves only near a helix (S3): paths within 1e-5 of a helix get it; treating
  near-helices as helices is a new heuristic.
- Mitered planar paths with `up`, `twist` or `scale` (S7): the kernel's planar-path sweep keeps its
  frame and the profile's size; such paths go piece by piece, and `sharp_corners=True` raises.
- Analytic walls of translational sweeps along arcs (S8): the plan covered lines, and arcs swept with
  `orient`; the translational walls are exact B-splines.
- A spine, and closed sections or profiles along rails (S10): the plan named rails and two-rail
  sweeps; a Gordon surface is open, and through closed sections it left a crease of 22 degrees, so
  they raise `ValueError`.
- `swing` with analytic faces or about other axes (S12): the plan's `swing` is exact with B-spline
  faces.

Curves and sketches:

- Offsets of curves that are not planar, and trimmed cusps (C7): a 3D curve has no side without a
  surface or a direction; offsets that would fold over raise saying where.
- `Face.wrap` keeping every length (C12): no map does on a doubly curved face.
- Rounding arc and spline corners of non-planar wires (C15): the plan asked to round planar line-arc
  corners and raise for the others.
- A global `Edge.through`, and `Wire.match_to` (C16): the plan asked for the local minimum-norm move
  and `Edge.match`.

Surfaces:

- `Shell.trim` along a direction (U3): project the curve first (`sheet.project(curve, direction)`).
- `fill` of mixed loops with `tangent=True` (U4): free sides would need cross tangents of their own;
  `ValueError` (use `tangent=False`).
- `Face.extend` keeping trims, and extending sheets of several faces (U6): the plan's `extended`,
  `extend` and `untrimmed` exist (trims dropped, documented).
- Pushes at edges and across seams (U7): the plan's push refines or raises where an edge would move.
- `flatten(side=)` and `Shell.bead` (U8): not in the plan's "Do", and left for later by it.
- Tangency across `match_edge`'s side edges, and `stitch(match=True)` (U9): it needs the neighbour's
  rows edited too; the crease (10 to 20 degrees) is documented.
- `stitch(merge=True)` and `Part.merge_faces` (U10): the plan asked for `Shell.merge_faces`.
- The face-to-face fillet with base trimming (U12): left for later by the plan.

Meshes and drawings:

- Dimensions and a title block (M4): the plan asked for the views with visible and hidden lines.
- Non-planar regions in `Mesh.to_part` (M8): fitting surfaces to mesh regions is new.
- A curved patch in `fill_holes` (M9): the kernel lays a flat patch, as documented.
- `max_edge` with halving, and `max_aspect_ratio` (M10): the halving is the kernel's and takes no
  longest edge, and the kernel's aspect ratio changes no triangle.

Sheet metal and deformations:

- K-factor records in STEP files (D1): STEP has no entity for them.
- Torus and sphere images of bends (D2): SMLib's torus keeps its seam at the outer equator, so a
  bent tube's torus needs the deformed face's seam moved first; the fitted faces are within the
  tolerance.
- Rolled parts and end bends that span only part of the width (D3): the plan asked to unroll bodies
  without a flat region and to document the limits.

Files:

- Moved copies written as STEP instances (I10): knowing a copy needs provenance through every move.
- Offsets of C0 bases for OpenCASCADE (I11): the file is exact STEP; `export_step(part.to_nurbs(),
  ...)` writes NURBS.
- IGES writing, binary and compressed IGES, further entity forms (I14): the plan's item is a reader;
  a body left out names its entity.
- USD inherits, specializes and variant sets (X2), circles on NURBS faces and other writers' ellipses
  (X5), face materials, collection bindings and textures (X12), and curves (X13): beyond the plan's
  composition, reader and writer, colors and warnings.
- `.smp` placements, points and meshes, `.smb` names and colors (X9): the plan asked for names and
  colors in `.smp` or `.smb`.
- Binary `.brep` writing, names and colors, curves and points outside faces (X14): the format has no
  names or colors, OpenCASCADE's tools read ASCII, and loose wires and points are counted in a
  warning.

smlibwasm and the runtime:

- `scope` following async functions (W9): browsers have no `AsyncLocalStorage` (AsyncContext is a
  proposal).
- Loading the module again after a crash (W10): optional in the plan; live bodies would point into
  the old memory, and a `KernelWorker` starts a new kernel.
- Variable font instances, and fonts of a collection other than the first (W13): new options for
  both readers.
- *Python*: SmPyLib's short class methods keep the GIL, free-threaded Python is not declared, and
  forking with threads warns (N8): releasing would cost a thread switch per call in selector loops,
  free threading needs an audit of every binding, and `GUARD_PROCESS = "helper"` avoids the fork.
- Automatic compaction (N9): cached queries are 1.2 to 1.96 times as fast, so `compact()` stays the
  explicit call.
