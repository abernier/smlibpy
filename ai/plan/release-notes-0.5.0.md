# smlibpy and smlibwasm 0.5.0

This release comes out of a review of smlibpy and smlibwasm against the SMLib kernel they wrap
([kernel-deep-dive.md](kernel-deep-dive.md)). It fixes the silent wrong results, crashes, hangs and
leaks the review found, and adds most of what it found missing: direct editing of faces, fills and
blends of sheets, curve tools, mesh tools, drawings with hidden lines, IGES and OpenCASCADE files, a
worker entry for smlibwasm, and more.

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

- Booleans refuse a wrong empty cut, an intersection that gives an operand back unchanged, a merge
  that loses or gains volume, and cells that do not add up to their part
  ([more](#booleans-that-refuse-a-wrong-result)).
- `is_valid()` is False for a body whose faces leave gaps that make its volume uncertain by 1e-2 or
  more, and features refuse such a body ([more](#is_valid-checks-booleans-and-gaps)).
- Fillets refuse a `(start, end)` radius with `continuity`, on a closed edge, or along a tangent
  run; chamfers refuse an edge whose angle changes along it
  ([more](#radius-laws-and-chamfers-that-raise)).
- `shell`, `offset` and `thicken` refuse results with gaps, without a cavity or of the wrong volume,
  and walls that do not fit; a step longer than 20 s is stopped
  ([more](#shells-and-offsets-that-raise)).
- Sweeps, extrusions and tapers that made bodies through themselves, open bodies or bodies shorter
  than asked raise; an extrusion direction in the sketch plane is a `ValueError`
  ([more](#sweeps-and-extrusions-that-raise)).
- `section()` with a plane that only touches the part raises `ValueError` ([more](#sections)).
- 2D Booleans of faces that touch at a point raise where no way gives a sound region
  ([more](#2d-booleans)).
- `Wire.fillet` raises for points that are not corners, and rounds corners at arcs and splines
  ([more](#wirefillet)).
- `import_usd` refuses malformed values and broken bodies of other software; an empty body cannot be
  meshed or written to USD ([more](#usd), [more](#empty-bodies)).

Defaults and results that changed:

- `fillet` and `chamfer` round the whole tangent run of a selected edge (`propagate=True`)
  ([more](#fillets-and-chamfers-follow-tangent-runs)).
- `unfold`, `flat_pattern` and `bends` take each bend's own K-factor; the default `k_factor` is
  `None` ([more](#k-factors)).
- `stitch` closes gaps up to `tolerance` only, returns Parts when closed and turns open sheets to
  agree ([more](#stitch)).
- `Edge.intersections` has a tolerance that scales with the size, returns `[]` for no hit and each
  point once ([more](#edge-intersections)).
- `import_step` leaves out a body it cannot read, with a warning, and stitches bodies whose faces
  share no edges ([more](#step-import)).
- `silhouette()` returns the whole contour, seen and hidden ([more](#silhouette)).
- Closed `Spline`s are curvature continuous at the seam; a list of tangents as long as the points is
  one per point ([more](#splines)).
- Profiles keep their attitude along 3D paths and helices, and asymmetric profiles sit on the path
  by the center of their own box ([more](#where-a-swept-profile-sits)).
- A selection taken before an edit stands for the pieces of its faces and edges
  ([more](#old-selections-stand-for-their-pieces)).
- `named()` and `colored()` share the body; their faces compare equal
  ([more](#named-and-colored-share-the-body)).
- `cells()` are named and colored after the parts they lie in; `solids()` separates a body in a
  cavity ([more](#cells-and-solids)).
- Seam edges of a tool that would run tangent to the other operand lie elsewhere
  ([more](#seam-edges-of-tools)).
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
extrusions, deformations, scales that differ between the axes, chamfers of circles, USD round trips
and STEP round trips of imported cylinders ([more](#analytic-faces-and-edges)).

Files that are written differently: glTF (linear colors, node translations, indexed triangles, a
primitive per face color), OBJ (normals, 12 digits), USD (analytic edges, display names, a color per
triangle, no open UV loops), STEP (offset surfaces, cylinders, encoded names, face colors, the
uncertainty in mm) ([glTF and OBJ](#gltf-and-obj), [USD](#usd), [STEP](#step-export)).

Messages that changed: hints of Booleans, fillets, chamfers, shells, offsets and `cells()`, and
`KernelError.detail` ([more](#messages)).

Python: new names in `from smlibpy import *`, fonts read without fontTools, guarded steps in another
process, a kernel lock for threads ([more](#python), [fonts](#fonts)).

smlibwasm: options, `at(point)` and disposed bodies raise `TypeError`, C++ exceptions are `Error`s,
kernel crashes end the steps that retried on them, stricter TypeScript types, a larger module
([more](#smlibwasm)).

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
Select such edges and vertices by geometry, not by position:

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
section of a merged part has a region for every cell the plane cuts (B9: 1600, not 1486.903):

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
- A `(start, end)` radius on a closed edge or on selected edges that meet tangentially raises
  `ValueError` (F5): the kernel bent the radii. On an edge with a tangential run-on it raises too
  (F6), since the law cannot follow the run.
- A chamfer of an edge whose faces change their angle along it raises `ModelingError` (F4): the
  setback followed the angle. Round such edges with `fillet`.

```python
part.fillet(edge, (1, 2), propagate=False)           # a law on the selected edge only
part.fillet(edges, 2, continuity="G2")               # a blend needs a constant radius
```

```js
part.fillet(edge, [1, 2], { propagate: false })
```

#### Chamfers of circles are cones

A chamfer of a full circle between faces around one axis (a shaft's end, a hole's rim, a revolved
part) is an exact cone now (F12): its face is a `cone` (it was a `bspline`), the edge where it
meets a plane at right angles to the axis is a circle (so `edges().circles()` finds it), and
volumes move to the exact value by up to 1.2e-5 (the flange example: 157979.6230 to 157979.6668).
The edge where the cone meets a cylinder stays a fitted B-spline (see Not done):

```python
pin = Cylinder(2, 5).chamfer(Cylinder(2, 5).edges(), 1)
pin.faces().of_type("cone")               # the two bevels (0.4: geom_type "bspline")
pin.edges().circles()                     # the bevels' edges on the end faces (0.4: none)
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
than `GUARD_SECONDS` (20 s) is stopped (O1, N1):

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
  its size (a triangle at 30 degrees: 845.8564, it was 839.8564). Along a single full circle whose
  plane faced against the path's start it is no longer mirrored (S8: 279.6017, it was 285.8849).

There is no option for the old frames. Drop workarounds; to put another point of the profile on the
path, draw the profile around it:

```python
thread = sweep(Rectangle(2, 1), h)                     # 0.4: a loft through placed copies, 8 a turn
body = sweep(tri.translate(-cx, -cy, 0), path)         # the point (cx, cy) of the profile on the path
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
  that the kernel built inside out or open is made again turned, or raises `ModelingError`.

```python
pipe = sweep(Circle(8), CenterArc((0, 0), 10, 0, 90))      # Circle(12) raises: it crosses the axis
ring = sweep(Circle(2), Spline(*pts, closed=True))         # rather than Spline(*pts, pts[0])
ring = (Circle(10) - Circle(8)).extrude(5, taper=10)       # 10 raises: the hole closes the ring
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
| `scale` that differs between the axes, shears (T6) | planes, cylinders, cones, surfaces of revolution and extrusion, lines | B-splines |
| chamfers of full circles (F12) | cones, and circles where they meet planes | B-splines |
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
(C1):

```python
try:
    region = abc & t
except ModelingError:            # 0.4: a region of the wrong area, no error
    ...
```

#### Projections

`Part.project` returns `[]` for a curve that misses the body (it raised `KernelError`), and its
pieces are fitted within 1e-7 of the size, with more control points (C12). smlibwasm:
`project(curve, direction, { nearest })`, and `Face.iso(u, v)` is positional (`iso(null, 0.5)`).

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
pos = accessor_positions(doc, mesh=0) + doc["nodes"][0].get("translation", [0, 0, 0])
acc = doc["accessors"][prim["indices"]]
index = np.frombuffer(buf, np.uint16 if acc["componentType"] == 5123 else np.uint32,
                      acc["count"], doc["bufferViews"][acc["bufferView"]]["byteOffset"])
tris = positions[index].reshape(-1, 3, 3)                       # 0.4: positions.reshape(-1, 3, 3)
triangles = [p for p in doc["meshes"][0]["primitives"] if p["mode"] == 4]   # one per face color
srgb = 1.055 * c ** (1 / 2.4) - 0.055                           # a color read back (12.92 * c below 0.0031308)
a, b, c = (int(x.split("/")[0]) for x in line.split()[1:])     # an OBJ face line
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
For the lines of a view use `outline`:

```python
seen = Torus(20, 5).outline(Plane.YZ)                          # visible lines of the view
seen, hidden = Torus(20, 5).outline(Plane.YZ, hidden=True)
```

#### Empty bodies

`tessellate` of a body with no faces (a Boolean that left nothing) raises `ValueError` ("the Part is
empty"; smlibwasm `RangeError`), and so do `export_stl`, `export_obj`, `export_glb`, `mesh()`,
`render` and `show` of it; `export_usd` raises where it wrote an invalid file (X10). `except
KernelError` does not catch it:

```python
if result.faces():
    export_stl(result, "r.stl")
```

### Sheet metal and deformations

#### K-factors

`fold` and `flange` record their K-factor on the part, and `unfold`, `flat_pattern` and `bends` use
each bend's own; their `k_factor` default is `None` (as folded, else 0.44) where it was 0.44 (D1). A
part folded with another K now unfolds to its blank (200.0, not 199.623). `FlatPattern.k_factor` is
None where bends differ, and `Bend` shows `k_factor`. A plate made by `Part.bend` is sheet metal now
(D2): `bends()` finds the bend and `unfold()` uses the K of its neutral layer (200.0, it was 199.058
with 0.44). The record is not saved in files: a part read back unfolds at 0.44.

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
differs. `FlatPattern.part` is placed by its edges (its bottom at z = 0), and `FlatPattern.size`
measures edges:

```python
holes = pattern.outline.edges().circles()      # 0.4: arcs and B-splines
```

#### Deformations

Faces and edges whose exact image is analytic are planes, cylinders, cones, lines and circles (D2),
with the analytic surface's parameters (`position_at`, `uv_at`, `nurbs()` of such a face differ).
`twist`, `taper`, `bend`, `unroll` and `Lattice.apply` deform edges, wires and points where they
raised `TypeError` (D6); the error for other inputs reads "expected a Part, a Shell, an Edge, a Wire
or points". The raw layer's deformation spec takes `analytic=False` for NURBS everywhere
(`smlibpy._core.deform.deform_brep`).

```python
bend_faces = bent.faces().filter(lambda f: not f.is_planar)   # 0.4: geom_type == "bspline"
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
  type OFFSET_CURVE_3D (#203)`).
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

```python
export_step(vase.to_nurbs(), "vase.step")       # 0.4's output (approximated offsets)
export_step([part, *edges], "p.step")           # filter edges out for 0.4's file
warnings.filterwarnings("ignore", "export STEP")
```

#### USD

- `import_usd` places bodies as the stage has them (X2): `xformOp`s, `metersPerUnit` (to mm),
  `upAxis` (to Z up), subLayers, references and payloads; inactive, abstract and over-only prims
  hold no bodies; bodies of prims with the same leaf name are named by their path.
- Malformed values raise `ValueError` naming prim, body and rule (X1), and bodies of other software
  are checked by the kernel before they are measured (X6): gaps over 1e-3 of the size raise, smaller
  ones warn; `check=False` reads them as they are. `partial=True` leaves out bodies that cannot be
  read (X7), and the `KernelError` of one names it.
- Names: a body is named by its prim's `displayName`, which smlibpy writes for names that are no
  prim names ("Bracket #1 (left)", "Größe", X3).
- Edges: lines, circles and ellipses are written as the schema's analytic edges (X5); readers that
  read only `edge3dNurb` must read those too. Other writers' B-spline edges that are lines (and
  circles on analytic faces) come back as `line` and `circle`.
- Colors: a body takes the color of its bound material's `UsdPreviewSurface` before its prim's
  `displayColor` (X12); a body with face colors gets a color per triangle on its mesh (T5).
- A loop whose UV curves do not close is written without them (N4).
- Solids with wire edges, points or loose faces warn when read (X13).

```python
import_usd("a.usda", units="mm", placement=False)       # 0.4's reading of a stage
import_usd("broken.usda", check=False)                    # read bodies the check refuses
export_usd(part.to_nurbs(), "p.usda", mesh=False)        # B-spline edges and faces only, as 0.4
warnings.filterwarnings("ignore", "load: .* also holds")
```

```js
importUsd('a.usda', { units: 'mm', placement: false, check: false, partial: true })
```

#### SMB and SMP

- A merged part saved as `.smb` loads as a `Part` with its cells (X8; it was a `Shell`), and so does
  a broken solid, whose `is_valid()` is False.
- `save(shapes, "x.smp")` writes an SMLib part file with names, colors, curves and several bodies
  (X9); 0.4 wrote an `.smb` file under any name. Save `.smb` files with `.smb`.
- `load` reads `.igs`, `.iges`, `.smp` and `.brep`, and `export` writes `.smp`, `.svg` and `.brep`,
  where they raised `ValueError`; the messages for unknown extensions list them.

```python
save(part, "cache.smb")      # the .smb file, as before; "cache.smp" is a part file now
```

#### Fonts

*Python*: `font.py` no longer uses fontTools: WOFF2, CFF2 and seac fonts are read by its own reader
(W13). A glyph it cannot draw raises `FontError` also where fontTools is installed (none is known),
and damaged WOFF data raises `FontError` (a `ValueError`) where it raised `zlib.error`. *smlibwasm*:
damaged WOFF data is a `FontError` where it was node's zlib error.

```python
except FontError: ...        # 0.4: except zlib.error
```

### Messages

#### Error classes

| Where | Now | 0.4 |
|---|---|---|
| refused Booleans, merges, cells, shells, offsets, sweeps (see above) | `ModelingError` | a wrong result |
| `split()` of a merged or invalid part; `shell` of a region thinner than two walls; a cell whose inner cells cannot be cut out | `ModelingError` | `KernelError` |
| `fillet` with `(start, end)` and continuity, on closed edges or tangent runs (F3, F5, F6); USD values (X1, X6); `classify` with a tolerance of 0 or less; `Edge.dihedral_angle` of an edge without two faces; `section` with a touching plane (B18); an extrusion direction in the plane (S14); `tessellate` and `export_usd` of an empty body (X10); `unfold(fixed=...)` of a rolled part (D3) | `ValueError` (smlibwasm `RangeError`) | `KernelError`, `ModelingError` or a wrong result |
| `offset` of an object without one (O7); `part + sheet`, `part - sheet` (B12); writers given edges, vertices or meshes (X13); `save(mesh)` | `TypeError` that says what to use | `AttributeError` or Python's own `TypeError` |
| `Face.interior_point()`, `Edge.distance_to()` (I9) | `KernelError` | `RuntimeError` |

#### Hints and texts

The hints of failed Booleans, fillets, chamfers, shells, offsets and `cells()` are built from what
the operands show (B19, F8): a tangent face, coincident faces with their place, operands that only
touch, the corner or edge a fillet could not build. Messages of `section`, the sweep curvature error
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
  `from_dxf_wires`, `to_usd`, `from_usd`, `to_smb`, `from_smb`, `to_smp`, `from_smp`, and the
  classes `AnnularSector`, `ParabolicArc`, `HyperbolicArc`, `ConicArc`, `Spiral`, `StitchReport`,
  `FitReport`, `Problem`, `ClosestPoints`, `Curvature`, `Continuity`, `NurbsSurface`,
  `SectionProperties`, `DrawingView`, `StepFrame`, `StepCurve`, `StepPoint`.

  ```python
  rounding = surface_fillet(floor, wall, 5)    # a variable named blend would hide the new function
  ```
- Kernel steps that can crash run in another process (N1): `remove_fillets`, `remove_faces`,
  `surface_fillet`, `shell`, `offset`, `thicken`, `cells()`, and fillets and chamfers of parts read
  from files. Each step runs once there (it ran again in this process). On Windows they run in a
  helper process (`GUARD_PROCESS`), where a crash is a `ModelingError`. Code that replaced kernel
  functions to test them runs the steps in this process:

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
  smlibpy's (N6).

### smlibwasm

- Options are checked as Python checks keywords (W5): an unknown or Python-spelt key (`{ k_factor:
  0.3 }`) and a number where the options go (`Rectangle(20, 10, 3)`) are a `TypeError` that names
  the right key. `chamfer` takes `ChamferOptions`.
- `ShapeList.at(point)` raises `TypeError` (W6); use `atPoint(point)`.
- Faces, edges and vertices of a disposed body raise `TypeError` (W4).
- C++ exceptions of the kernel's bindings are `Error`s with a message (`RangeError` for invalid
  arguments), no longer opaque `WebAssembly.Exception`s; memory that runs out is a `KernelError` of
  status `SM_ERR_OUT_OF_MEMORY` with a hint (W8).
- A crash of the kernel (a trap) is counted (`memoryUsage().crashes`), warns once through
  `setWarningHandler`, names itself before the operation's hint, and ends `removeFillets` and
  `removeFaces` in this kernel with a `ModelingError` (they dropped the step and went on, W10). A
  `KernelWorker` replaces its worker after such a crash.
- `memoryUsage()` returns `{ used, heap, limit, handles, crashes }` (W8, W9, W10).
- The TypeScript declarations are stricter (W11): free functions have overloads, `render`, `show`
  and `htmlPage` check their options, `load()` gives a union, `Hit` is generic, internal members are
  left out. Code that compiled because a parameter was `unknown` or a result `any` may need a type
  or a narrowing. `offset` returns the type it is given (C7), `Spline`'s `tangents` is a list (C8).
- Readers of file contents take any bytes, and their `TypeError` says "a string or bytes (a
  Uint8Array or an ArrayBuffer)" (W14); `toStl([])` throws "nothing to write" (X13).
- `k` (the raw layer) has more members (W15): every function of `smlibpy._core`, the methods of its
  classes as `<class>_<method>`, its enums.
- Bundles must include the package's worker files (`_defeature_supervisor.js`,
  `_defeature_worker.js`); a module worker of the page's own needs Vite's `worker: { format: 'es'
  }`.
- The three.js snippet of the 0.4 docs shaded sharp edges wrongly (averaged normals); take the new
  one.

```js
// options and errors
p.bends({ kFactor: 0.3 })                                     // { k_factor } throws TypeError
faces.atPoint([0, 0, 15])                                     // faces.at([0, 0, 15]) throws
try { build() } catch (e) {
  if (e instanceof KernelError && e.status === 'SM_ERR_OUT_OF_MEMORY') console.warn(e.hint)
}
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

Fillets and chamfers:

- A chamfer of an edge whose faces change their angle along it raises (F4): the setback followed the
  angle (from 1 to 3 along the edge where a tilted cylinder meets a plate).
- A `(start, end)` radius with `continuity` made a ruled chamfer, not a blend (F3), and on a closed
  edge or across tangent edges the kernel bent the radii (F5: on a cylinder's rim the radius rose to
  2.90 and fell back to 1 within the last 3 % of the edge); both raise now.
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
  `Box(60, 40, 20)` rounded by 5, open at the top, 2 thick: 11134.3949).
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
- Sweeps of a profile across the axis of a single arc path gave "valid" bodies that sweep through
  themselves (S8); they raise. Sweeps along single arcs are exact (Pappus to 1e-15; up to 9.4e-6
  off).
- Kinked loops fused into bodies with faces of no area and, now and then, a shell of one such face
  (a void without volume, which OpenCASCADE read from STEP as -1707.27); fused sweeps that were open
  between their faces were returned (S1). Every body returned for 120 random kinked loops and 20
  closed fillet polylines now reads back into OpenCASCADE as one valid solid of its volume.
- A tapered extrusion whose hole widens across the region came out shorter than asked without an
  error (S9: `(Circle(10) - Circle(8)).extrude(10, taper=10)` was 5.67 high).
- Extrusions along a direction in a tilted plane came out inside out or open for curved profiles
  (S14: of 1200 random ones 1 at 5.7 degrees off the plane, 25 at 0.6 degrees, 363 at 6e-4 degrees,
  also in 0.4); every body returned now is valid with the exact volume. A direction in the plane
  raised a bare `KernelError`, and one 0.006 degrees off it made a sliver without a word.
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

Surfaces:

- B-spline faces with a bump are no longer taken for planes (U1): `to_shell()`, `.smb` files,
  `thicken()` and meshes flattened a face parameterized like a plane with a bump between the
  kernel's sample points (10 of 40 random bumps).
- `stitch` ignored its tolerance (U5): the faces of a 200 mm box moved apart by 0.03 came back as a
  "valid" Part with `tolerance=1e-4`, its faces standing off their edges; open results kept mixed
  normals, so `thicken` gave volume 0.

Meshes and drawings:

- Mesh Booleans use the mesh's arrays as they are (M1): after `m.vertices += ...` they used the old
  geometry.
- Meshes keep their tolerance (M2): a sphere's mesh was 0.68 off at a tolerance of 0.01, and a grid
  could miss a free-form bump between its lines.
- Mesh points keep double precision (M3): a sphere 100 m from the origin was meshed 3.8 times the
  tolerance off, a box 1 km out had mesh volume 1107.72 for 1113.12.
- Normals at the apex of a cone are right (MESH-APEX): the corner at the tip of `Cone(10, 0, 20)`
  had a normal up to 127 degrees off the surface (a dark wedge in glTF, the viewer and `render`);
  now within 0.02 degrees.
- glTF colors are linear (GLTF-COLOR): viewers showed every color lighter than asked.
- `silhouette` returned the visible curves of a hidden-line pass, not the contour (M4): 9 edges,
  180 mm, of a box seen along (1, 1, 1) for its 6-edge outline of 120 mm, and half the contour of a
  torus.
- OBJ files carry normals (M12): readers smoothed a box across its edges or shaded curved faces
  flat; mesh Boolean results had no normals.

Measuring and analysis:

- `distance_to` between nearly parallel faces is exact (A1): cylinders 2 apart and skewed by 5
  degrees gave 2.485. On 101 random pairs it matches OpenCASCADE to 1e-15 of the distance.
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

Files:

- STEP import makes one vertex per vertex of the file (I1): a rounded box written and read back had
  48 vertices for 24, and loops whose edges did not link.
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

### Crashes and hangs

- Booleans of crossing holes whose seams lie tangent to the other hole, such as `Box(20, 20, 20) -
  Cylinder(3, 40).translate(0, 3, 0) - Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)`, killed the
  process (B4); the kernel is patched, and smlibpy turns the hole first (B6), so cut, fuse, `&` and
  merge give the right body (the intersection 62.7209, as OpenCASCADE). A cut by a flat end cap
  tangent to a sphere raises instead of killing the process, and so does `cells()` of a merge the
  kernel got wrong (B5). The stitcher behind `cells()` that crashed on a cone and cylinder merge
  runs in another process (N1).
- Chamfers of edges at different angles (all edges of a hexagonal prism) killed the process and
  trapped in smlibwasm (F1); they work.
- Fillets where the kernel has no corner for how the selected edges meet at a vertex killed the
  process at any radius, as did all-edge fillets of 10 of 479 imported parts (F2); they raise
  `KernelError` (`SM_ERR_INVALID_INPUT`) naming the corner. Two more fillet crashes found by 514
  random fillets and chamfers (a missing boundary curve in `SmFilletGeom::MakeFaceBrep`, a missing
  side face in `SmFilletSolver::CreateCliffRollOverSideFG`) raise `KernelError` naming the edge;
  smlibwasm built broken bodies there.
- `shell`, `offset` and `thicken` no longer kill the process (O1). Five sites where the offset code
  read memory it had freed are patched (among them the curves of a failed imprint, which crashed the
  extended shells of issue #2's filleted boxes in 7 to 27 of 300 processes, now none, and the
  natural trim curves of a failed `CreateNaturalUVTrimCurves`), and the kernel steps run in another
  process whose body comes back as an exact copy. `Box(40, 30, 10).rotate(X, 45).shell(10, opening)`
  no longer crashes about one run in four (O4).
- The fuse of the halves of a loop closed with a kink killed the process (2 of 60 random loops with
  circles): `SmMerge::ManifoldBoolean` marked a vertex it had deleted (S1). Patched; and such loops
  sweep wherever they swept in 0.4 and more (60 of 60 random loops with `Circle(1.5)`; 0.4: 37).
- The 2D union of two exclusive-or sketches whose faces touch at points killed the process in 7 of
  13 runs, in the kernel's planar Boolean (C1); patched, the union is right in every run.
- Copying a face out of an imported body whose faces share no edges killed the process (T2).
- A bad value in a USD file (a sphere whose reference direction is its axis, a weight of 0, a torus
  axis of length 0) crashed the process, a later `mesh()`, or hung `volume` (X1).
- The kernel's curve intersection read past a stack array where a curve's first derivative is zero
  (`sm_FilterSolution`, reached from the check of a body read from a damaged `.brep` file); patched
  (X14).
- *Python*: `export_step` of a body it converts to NURBS read the converted body after freeing it
  (0.4 read the freed memory by luck).
- A body with a face that crosses the seam of its own surface ran `volume` for minutes (A7); it
  raises `KernelError` after about a second.
- smlibwasm: failed kernel calls used up the stack (W1): after about 240,000 failures (11,000 missed
  raycasts) every call failed for good, and before that the stack overwrote static data.
- smlibwasm: `removeFillets`, `removeFaces` and `surfaceFillet` stop a kernel step that loops (W2),
  in Node and in workers of cross-origin isolated pages; on a page's main thread, a `KernelWorker`
  stops a call by its timeout or signal. On the enclosure example they busy-looped for good and
  froze a tab.
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
- smlibwasm: meshes kept the kernel's mesh until the garbage collector ran (W3): 60 meshes of a fine
  sphere failed with `std::bad_alloc` at the 51st. Each caught C++ exception kept 108 bytes (W8).
  The port's own intermediates (refused results, tool copies, sketch curves) stayed until the event
  loop turned (W9: a probe of 70 calls left 35 of them; none now).

## New

Names are smlibpy's; smlibwasm has each one in camelCase, with keywords as options, unless marked.

### Booleans, cells and splits ([features](../../docs/features.md), [selecting](../../docs/selecting.md))

- `Part.classify(point, tol=None)`, `Part.contains(point)`, `Part.cell_at(point)`: inside, outside
  or on a face, edge or vertex, by the kernel's classification with voting rays (B11).
- `Part.split(sheet, keep)` splits along a `Shell` or a face that is not planar, both sides checked
  to add up (B12); `sheet - part` and `sheet & part` trim a sheet by parts (smlibwasm
  `shell.cut(...)`, `shell.intersect(...)`).
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
  two faces, or a setback and an angle; exact on planar faces (F9).
- `corners="patch" | "mitre"` for `fillet` and `chamfer`: rounds of three convex edges run on until
  they meet, without a corner patch (F10).
- Fillet and chamfer errors name the corner or edge the kernel could not build, and why (F8); a
  failed round near the largest radius is tried again within a finer tolerance and comes out exact
  (F7).
- Chamfers of full circles between faces around one axis are exact cones (F12).

### Shells, offsets and direct editing ([features](../../docs/features.md), [surfaces](../../docs/surfaces.md))

- `Part.offset(distance, *, corners="sharp" | "round")`: `"round"` rolls a ball along the part,
  exact, and builds acute wedges and holes that close (O9); sharp offsets of parts with acute edges
  (cones, tapers) are kept (O8).
- `shell(..., corners=None | "round" | "sharp", walls=...)`: pick the cavity's corners (O12), and
  give faces walls of their own thickness (O10); `info()["corners"]` says which a shell or offset
  got.
- `shell` opens planar faces whose rim meets its neighbours tangentially (O3).
- `Shell.offset(distance)`, `Face.offset(distance)`, and `offset(sheet or face, d)`: offset sheets
  (O7); `thicken(surface, t, *, both=False)`.
- `Part.move_faces(faces, by)`, `Part.offset_faces(faces, distance)`: move faces by a vector or a
  `Location`, offset them along their normals (push-pull, hole and boss resize), the part rebuilt
  around them exactly (O10).
- The two-sided draft about a planar parting line, as a recipe in the docs (O11).

### Primitives, sweeps, lofts and extrusions ([parts](../../docs/parts.md))

- Sectors: `Cylinder(..., arc_size=)`, `Cone(..., arc_size=)`, `Sphere(..., arc_size1=, arc_size2=,
  arc_size3=)`, `Torus(..., major_angle=)`, and `AnnularSector(inner_radius, outer_radius, height,
  arc_size)`, with exact faces (S13).
- `swing(profile, outline)` and `Sketch.swing(outline)`: a revolve whose circle is any closed
  outline around the axis (bottles, knobs, soap bars) (S12).
- `sweep(..., up=None, twist=0.0, scale=None)` and `Sketch.sweep(...)`: the attitude of the profile
  along the path (an axis, `"frenet"`), a twist (degrees or a function of the length), and a scale
  law (`(start, end)`, points, or a function) (S3, S7). Along helices the axis is the default.
- `loft(..., start_tangent=None, end_tangent=None, closed=False)`: end tangents, and lofts closed
  through the first section again (S10).
- `extrude(..., corners="sharp" | "round")`: tapers with plane walls, or with rounded corners (S9).
- Revolves give cylinders, cones, spheres and tori (S4); single line and arc sweeps give planes,
  cylinders, cones and tori (S8).

### Curves and sketches ([sketches](../../docs/sketches.md))

- `Edge.trim(start, end)`, `Edge.split(at)`, `Wire.trim`, `Wire.split`, `Edge.param_at(point)`,
  `Edge.param_at_point(point)`, `Edge.closest_point(point)`, `Wire.closest_point(point)` (C2, A2).
- `Edge.extend(distance, *, end="end", continuity="G1")` and `Wire.to_edge()` (C6).
- `Edge.intersections(other, *, tolerance=None)` with edges, wires, faces and bodies,
  `Edge.intersection_params`, `Wire.intersections`, `Edge.self_intersections()` (C5).
- `Edge.offset(distance, *, plane=None)` and `Wire.offset(distance, *, corners="round",
  plane=None)`: parallel curves, lines and arcs exact, splines within 1e-6 of the size; `Stroke`
  along splines and ellipses (C7).
- `fit_curve(points, *, tolerance=None, degree=3, tangents=None, closed=False)`: a B-spline within a
  tolerance of every point; `Spline(..., tangents=[...])` with a direction per point (C8).
- `Edge.curvature_at(t)`, `Edge.radius_at(t)`, `Edge.min_radius()`, `Edge.inflections()`,
  `Wire.min_radius()`, `Edge.continuity()`, `Wire.continuity()` (C9, A4).
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
  sheet edges, G1, G2 or G3 across both, untwisted (U2).
- `Shell.trim(curves, keep)`, `Face.split(curves)`, `surface_fillet(..., trim=True)`: trim sheets
  with curves that lie on them (U3).
- `fill(boundary, *, tangent=True)` and `network(u, v)`: Coons and N-sided patches that close a loop
  of curves, tangent to the sheets of its edges, and surfaces through curve networks (U4).
- `stitch(..., report=True)` and `StitchReport`; `Shell.flipped()`, `Face.flipped()`,
  `Sketch.flipped()` (U5).
- `Face.extended(distance, *, sides=None, continuity="natural")`, `Shell.extend(...)`,
  `Face.untrimmed()` (U6).
- `Part.push(face, at, *, by=None, to=None, normal=None, radius=None, continuity="G1")`, also on
  `Shell`: a smooth dent or bump at a point, the face's edges in place (U7).
- `Part.warp(face, region, by)` and `Part.flatten(face, region, plane)`, also on `Shell`: raise,
  sink or press flat a region of a face (U8).
- `Shell.match_edge(edge, target, *, extent=0.25)`: an edge of a sheet moved onto a curve (U9).
- `Shell.merge_faces(a, b)`: two faces that share a side made one (U10).
- `surface_fillet(..., radius2=None, shape="round" | "chamfer")` (U12).
- `nurbs_surface(points, knots=None, degrees=None, weights=None)`: a surface from NURBS data (U13).
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
  `Face.isocurve(u=, v=)`, `Face.iso(u=, v=)`, `Face.major_radius`, `Face.cone_angle` (A3, C12).
- `Edge.continuity()` and `Continuity`: G0, G1 or G2 across an edge, with the gap, angle and
  curvature jump (A4).
- `MassProperties.inertia_about(point)`, `moment_about(axis)`, `radii_of_gyration` (A6).
- `Part.project(curve, direction, *, nearest=False)`: only what the curve sees;
  `Face.project(curve)` (normal projection), `Face.wrap(shape, at=None)` (a drawing laid onto a
  face, lengths kept) (C12).
- `outline(plane, *, hidden=False, tangent_edges=False)`: the hidden lines of a view too (M4).
- `raycast_many(origins, directions)` of bodies and meshes: the first hit of many rays at once (M5).
- `compact()`: free what queries kept on a body (N9).

### Meshes ([analysis](../../docs/analysis.md#meshes))

- `Mesh.decimate(fraction=None, *, triangles=None, tolerance=None)`: fewer triangles, a closed mesh
  kept closed, the distance measured (M6).
- `Mesh.section(plane)`, `Mesh.slices(step)`, `Part.slices(step)`: sections chained into wires,
  sketches per layer (M7).
- `Mesh.to_part(max_faces=5000)` and `Part.from_mesh(mesh)`: faceted parts of closed meshes (M8).
- `Mesh.fill_holes()` and `Mesh.repaired()`: holes closed, points merged, triangles turned (M9).
- `max_edge=` on `tessellate`, `mesh()` and the mesh exporters (M10).
- `Mesh.mass_properties(density)`, `Mesh.centroid` (M11).
- `Mesh.translate`, `rotate`, `mirror`, `scale`, `moved` and `Mesh.dispose()` (M1, W3).

### Drawings ([files](../../docs/files.md#drawings))

- `drawing_views(part, views, *, projection="first-angle", hidden=True, tangent_edges=False)` and
  `DrawingView`: the views of a part laid out in first- or third-angle projection (M4).
- `export_svg(shapes, path)` and `to_svg`, and `export(..., "x.svg")`: drawings, edges and sketches,
  exact lines and arcs; `export_dxf` writes views on the layers VISIBLE and HIDDEN (dashed) (M4).

### Sheet metal and deformations ([sheet metal](../../docs/sheet-metal.md), [deform](../../docs/deform.md))

- K-factors per bend: `fold` and `flange` record theirs; `k_factor=` takes a function, a mapping
  from radius, `(r/t, k)` pairs or `"din6935"` (`smlibpy.sheetmetal.din6935`, `KFactor`) (D1).
- `unroll(shape, *, radius, axis=Z, start=None)` and `Part.unroll`: a part wrapped around an axis
  laid flat; `unfold` of rolled parts, curls and bends over 180 degrees; `bend_allowance` up to 360
  degrees (D3).
- `twist`, `taper`, `bend`, `unroll` and `Lattice.apply` deform edges, wires and points (D6).
- Deformations keep analytic faces where the exact image is analytic (D2).

### Files ([files](../../docs/files.md))

- IGES: `import_iges(path, *, heal=True, strict=False)`, `from_iges`, and `load` of `.igs` and
  `.iges`: solids and trimmed surfaces, in mm, named and colored (I14).
- OpenCASCADE `.brep`: `export_brep`, `to_brep`, `import_brep(path, *, heal=False, check=True)`,
  `from_brep`, and `.brep` in `export` and `load`: exact bodies for build123d, CadQuery and FreeCAD
  (X14).
- SMLib part files: `save(shapes, "x.smp")`, `load`, `to_smp`, `from_smp`: several bodies and curves
  with names and colors (X9).
- Files in memory (*Python*): `to_step`, `from_step`, `from_step_model`, `to_stl`, `from_stl`,
  `to_obj`, `to_glb`, `to_gltf`, `to_dxf`, `from_dxf`, `from_dxf_wires`, `to_usd`, `from_usd`,
  `to_smb`, `from_smb`, `to_smp`, `from_smp`, `from_iges`, `to_brep`, `from_brep` (X11).
- STEP: `import_step(..., strict=False)`, `read_step(..., strict=False)`, `StepModel.skipped` (I6);
  `export_step(..., assembly=True)`: a product per body under a root (I10); `export_step` of edges,
  wires, points and planes, and `StepCurve`, `StepPoint`, `StepFrame` (I12); offset surfaces written
  exactly (I11); face colors and names in and out (T5).
- USD: `import_usd(path, *, units=None, placement=True, check=True, partial=False)` (X2, X6, X7);
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
  worker's time limit, and Booleans in it (W2, N1).
- Exported types of options, selections and results, overloads of the free functions (W11).

### Python runtime ([the kernel](../../docs/kernel.md))

- `smlibpy._guard.isolated` and `smlibpy.defeature.GUARD_PROCESS = "auto" | "fork" | "helper"`:
  kernel steps that can crash run in another process that returns their result, also on Windows;
  Ctrl-C stops them (N1).
- Threads: one kernel lock, and the long calls let the GIL go, so other threads run on (N8).
- `KernelError.trace`: where in the kernel a call gave up (N6, both languages).

### For contributors and the raw layer

- `tools/fuzz/`: a seeded fuzz run of Booleans, fillets, shells, offsets and slices in both builds,
  with invariants and a baseline (N3).
- `tools/sanitize/run.py`, `tools/oracles/` (upstream's `prog_test` suites, SmPyLib's tests, 200
  `.smb` files, crash loops, NVIDIA's USD validator on a shim) and the "Checks" workflow (N2, N4).
- `tools/parity.py`: smlibwasm's writers and modelling steps against smlibpy's golden files (N5).
- New `ext` calls of both builds, among them `classify_points`, `boolean` (it clears the kernel's
  Boolean mark and leaves the operands to the caller on failure; it can return a new Brep),
  `edge_angles`, `join_curves`, `nearest_points`, `usd_stage`, `seam_contacts`, `slice`,
  `check_brep`, `round_edges`, `oriented_sweep`, `skin`, `analytic_revolutions`,
  `intersect_curves`, `offset_curve`, `hidden_lines`, `poly_arrays`, `edge_continuity`,
  `stitch_faces`, `fill_loop`, `push_face`, `kernel_trace` and `drop_caches`.
- smlibwasm's option table (`js/src/_options.ts`) is generated from Python's signatures (W5): after
  adding or renaming a keyword in Python, run `python tools/gen_js_options.py`;
  `tests/test_js_options.py` and `js/test/options.test.ts` fail until it is current.
- Kernel patches: fifteen kernel files are built from patched copies in `third_party/patches`
  (twelve more than in 0.4, among them a header, `SmMessages.h`), each listed with what it was
  measured to change and confirmed with AddressSanitizer where it fixes a memory defect.

## Behaviour changes

Changes a script notices without having to change, beyond those under Breaking changes.

Operations that raised and now return a result. Code that caught their error to fall back to another
construction gets the result:

- Booleans: crossing holes whose seams lie tangent to each other (B4: `Cylinder(3, 40).translate(0,
  3, 0) & Cylinder(3, 40).rotate(Y, 90).translate(0, 0, 3)` is 62.7209), a tool beside an earlier
  parallel hole or boss (B10: `(Box(40, 40, 10) - Cylinder(6, 30)) - Cylinder(3, 30).translate(8, 0,
  0)` is 14612.2528, retried with a NURBS copy of the tool), merges along tangent seams (B6), right
  empty intersections far from the origin (B13).
- Fillets and chamfers: one edge of a tangent run (F6), all edges of a 10 mm cube with r 4.98 and of
  a 20 mm cube with 9.97 and 9.98, exact (F7).
- Shells and offsets: planar openings whose rim meets its neighbours tangentially (O3), sharp
  offsets of parts with acute edges (O8: `Cone(5, 2, 10).offset(1)` is 819.1342), offsets of sheets,
  faces, wires and edges (O7, C7).
- Sweeps: loops closed with a kink and circles along closed 3D fillet polylines (S1), mitered planar
  paths in planes that are not horizontal (S2), chains of helices with an even number of turns (S6),
  planar paths whose corners cannot be mitered (S6: piece by piece, with a warning), circles and
  ellipses twisted along a line (S3), revolves through 359.99 to 360 degrees (S4), `Stroke` along
  splines and ellipses (C7), sketch fillets and chamfers at splines and ellipses (C15), helices of
  more than 26 to 79 turns (C4), ellipse curves in Python's sweeps, projections and ruled surfaces
  (C3).
- Queries: `Part.project` of a curve that misses (C12), `intersection_curves` of bodies apart (U14),
  `distance_to` of edges, wires and faces (A2), `Face.interior_point()` of narrow imported faces
  (I9).
- Sheet metal: rolled parts, curls, end bends and bends over 180 degrees unfold (D3).
- Files: STEP files with O-rings (I3), cavities whose faces leave gaps (I4), or one unreadable body
  (I6); `export_step` of edges, wires, points and planes (I12); `load` of `.igs`, `.iges`, `.smp`
  and `.brep`.

```python
plate = Box(40, 40, 10) - Cylinder(6, 30) - Cylinder(3, 30).translate(8, 0, 0)   # 0.4: KernelError
plate = Box(40, 40, 10) - [Cylinder(6, 30), Cylinder(3, 30).translate(8, 0, 0)]  # the workaround, still exact
```

New warnings (`RuntimeWarning`; smlibwasm: `setWarningHandler`), which scripts that turn warnings
into errors filter: a STEP body left out, stitched or not repairable (I5, I6); `export_step`
converting a body to NURBS (I11); a USD body with gaps below the limit (X6) or of mixed dimension
(X13); an extrusion direction close to the sketch plane (S14); a planar sweep path swept piece by
piece (S6); an asymmetric profile on a mitered path with a spline (S2); `max_edge` that leaves a
twisted face off the tolerance (M10); `distance_to` whose points do not settle (A1); a helper
process that does not start (N1); smlibwasm's first kernel crash (W10).

Other differences:

- Results that were close are exact now: volumes of chamfered circles (F12), scaled bodies (T6),
  arcs swept (S8), circles along helices (S3), STEP offset faces (I11) move in the sixth digit or
  later.
- Meshes of spheres with whole poles, and of tori and other surfaces of revolution whose triangle
  edges strayed beyond the tolerance, get a few more triangles (M2: `Sphere(10).mesh()` 3596 for
  3584, `Torus(20, 5).mesh(0.05)` 4736 for 4096); corner normals at the apex of cones change
  (MESH-APEX).
- A round profile along a closed path of several tangent edges is one sweep closed where its ends
  meet: other faces than 0.4's pieces, the same volume (S1).
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

## Speed and size

Faster:

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
  along a kinked loop makes up to 13 more tries (S1). 2D Booleans of sketches whose faces touch at a
  point take 2 to 18 ms (C1).
- Seam detection costs at most 0.42 ms per Boolean (B6); the kernel lock about 20 ns per kernel call
  (N8).

Size:

- smlibwasm's `smlibwasm.wasm` is 9.2 MB (2.17 MB with brotli), up from 6.5 MB (1.60 MB): the
  OpenCASCADE bridge (X14), SmPyLib's binders for the raw layer (W15), the error reports (N6) and
  the new features. The library is 1.9 MB unminified (0.48 MB with brotli), plus the dictionary of
  WOFF2 fonts (79 kB, 59 kB with brotli). A browser loads about 2.8 MB with brotli (0.4: 1.9 MB).
- smlibpy's extension module on macOS arm64 grew from about 11 MB to 13 MB.

## Not done

What the review found and this release leaves open.

Kernel defects that remain (smlibpy runs the steps that can crash in another process):

- Booleans along a seam that cannot be turned away still return a valid body of the wrong volume
  (B6): the seam of an operand that is no body of revolution (an earlier hole in it), a torus' outer
  equator (no turn about the axis moves it), a seam on a B-spline face; merges of more than two
  parts turn seams only while two solids are merged.
- A union that returns its first operand unchanged although the other reaches out of it is not
  detected (`(Cylinder(5, 5) + Box(20, 4, 16).rotate(X, 90).translate(0, -3, -0.5)) + Cylinder(2,
  12).translate(2, -2.3693, 3.5)`: 1358.54, right 1446.61).
- `(Box(20, 16, 4) - Sphere(6).rotate(X, 90).translate(1.4007, 0, -1.5863)) & Torus(6,
  2.5).rotate(Y, 90).translate(7.5, 0, 10.5)` kills the process (smlibwasm traps); not located.
- The extended offset mode still crashes on some imported parts (contained by the other process):
  one where the imprint leaves an edge half made, two in `SmBezierAux2d::BuildPolarBox`;
  AddressSanitizer also reports a heap overflow in `sm_FixProblemsBySqueezing` and a deleted
  ProtoEdge read in `ResolveOverlappingProtoEdges`, both depending on memory layout. The all-edge
  fillet of two cones (`Cone(3, 0, 10).rotate(Y, 90) - Cone(1.5, 0, 8).rotate(X, 90).translate(0, 1,
  0)`) writes freed memory under AddressSanitizer (the normal build raises).
- The kernel's mesh Boolean of two internally tangent cylinders' meshes at a fine tolerance kills
  the process (smlibpy's own checks no longer ask it). The kernel's set-back fillet corners read
  freed memory (no `setback=`). `SmApiBooleanWithCurves` hands out freed edges (smlibpy does not use
  it).
- Leaks on failure paths: the kernel's mitered planar sweep (about 10 kB a sweep),
  `CreateProtoEdge`, about 4.7 KB per failed extended shell, and a face copy the kernel fails on,
  kept for the life of the process (T2).

Booleans, cells and topology:

- A sheet that ends inside a part is extended for `split` only when it is one B-spline face, and
  `Part.merge(sheet)` (conformal cells along a sheet) is not there (B12). Pieces a sheet imprints
  descend only from the face they come from (B14).
- Bodies read from files get new history tags, and vertices have none (T3). The healer's own report
  (`heal(report=True)`) is not exposed (T4).
- `.smb` files hold no face colors or names (`.smp` does), nor do USD `BrepArray` prims, OBJ and
  STL; the MCP live view shows body colors only (T5).
- After a scale that differs between the axes, circular rims stay B-spline edges and ellipsoids
  B-spline faces; STEP imports are not recognized (T6).
- The fillet hint names no degenerate vertex (B19); offsets get only the crash note.

Fillets, chamfers, shells and offsets:

- The edge where an exact conical chamfer meets a cylinder is a fitted B-spline (its length 8e-6
  short of the circle's on a pin of radius 2; the volume is exact): the tool's faces are cones now
  (S4), and the kernel's intersection of a cone with a cylinder fits the circle (F12).
- SM_API's global merge request (K5) is not landed: measured, it changed no near-limit fillet and
  made two chamfers open. All edges of a 10 mm cube with r 4.99 and the stepped block's rollover
  still fail (F7). The fillet executive's status is private (F8).
- Radius laws along whole chains of edges, setbacks (F10), `fillet_preview` (F11), unequal bevels on
  sharp wedges beyond what the solver takes (F9), and exact bevels of edges that are not full
  circles (F12).
- `shell` openings with a tangent rim that are curved, lie next to another opening or a drafted wall
  (O3); sheets whose faces do not share edges offset face by face (O7); `Shell.offset` has no
  `corners` (O9).
- `move_faces` and `offset_faces` refuse parts with a cavity (the kernel drops cavities; `draft` of
  such a part raises a misleading message), cannot change which faces meet, and extended rounds can
  come back as surfaces of extrusion (O10). No per-face neutral planes for stepped parting lines
  (O11).

Sweeps, lofts, extrusions and primitives:

- No `anchor=` for sweeps; asymmetric profiles on mitered paths with splines sit by their box along
  the path's plane (warning); the kernel's anchor uses control-polygon boxes, so arcs that do not
  span whole quadrants can sit a little off (S2). One of 60 hard kinked loops sweeps natively but
  not in smlibwasm (S1).
- No option for the kernel's rolling frame; `up="frenet"` spins where a path nearly straightens; the
  helix default covers fitted helices only; a twist along a closed path with corners is not made to
  meet; mitered planar paths take no `up`, `twist` or `scale` (S3, S7).
- No rails, spine or `sweep(rails=)`: the kernel's rails need as many sections as control points,
  and its two-rail sweep only approximates them (S10). End tangency comes from a direction, not a
  face.
- Translational arc sweeps and oblique translational extrusions keep B-spline walls (S8);
  `extrude(taper=...)` still ignores `direction`; a scale law along a path not parameterized by
  length is exact at 65 points only (S7).
- `Torus` has no angles around the tube and there is no `Pyramid` (S13); swing faces are B-splines,
  about Z only (S12); 16 of 1200 random extrusions within 0.6 degrees of tilted planes still raise
  (S14).

Curves and sketches:

- 2D Booleans of faces hundreds of times their size apart can still come out wrong where faces share
  edges (a unit square fused to its neighbour, a third square 1000 away: a sliver in 15 of 60 random
  lattices); why the planar intersection leaves a wire edge is not located (C1).
- Sweeps along helices of more than about 60 turns fail (C4). No offset of curves that are not
  planar; a closing corner at the seam of a closed single edge raises; offsets that would cusp are
  refused, not trimmed (C7). `fit_curve` with a direction at every point and a tolerance (C8).
- `Face.wrap` keeps lengths along two parameter lines only; curves across a closed face's seam come
  back cut; `nearest=True` samples 17 points a piece (C12). Non-planar wires round only between
  lines (C15). `Edge.through` is local; no `Wire.match_to` (C16).

Surfaces:

- `blend` of closed edges (U2); `Shell.trim` along a direction, and curves past a B-spline sheet's
  edge (U3); `fill` of mixed loops with `tangent=True`, of steep sheets, N-sided fills tangent to
  only 1.4 degrees, three-sided tangent fills with a pole (U4); `Face.extended` keeps no trims, and
  sheets of several faces are not extended (U6).
- `flatten(side=)`, `Shell.bead` and knot removal after a warp; pushes at edges and seams are
  refused (U7, U8). No tangency across `match_edge`'s side edges, no `stitch(match=True)` or
  `stitch(merge=True)`, no `Part.merge_faces` (U9, U10). The face-to-face fillet with base trimming
  (U12).
- `Part.section` still cuts with the kernel's plane section (up to 2.1e-3 off B-spline faces);
  `distance_to` of a point can miss the nearest point of a folded B-spline face; `raycast` misses a
  hit next to a cylinder's seam.

Meshes and drawings:

- `raycast_many` can miss a ray that grazes a curved face within the mesh tolerance (M5).
  `drawing_views` draws one body, without dimensions or a title block (M4). Decimation leaves a few
  folded slivers and has fixed angles (M6); `fill_holes` lays a flat patch (M9); `to_part` merges
  only planar regions (M8); `max_edge` cannot be combined with halving, and `max_aspect_ratio` is
  not exposed (M10).

Sheet metal and deformations:

- K-factor records are not written to files: a part read back unfolds at 0.44 (D1). No torus or
  sphere images of deformations (a bent tube stays fitted) (D2). Rolled parts and end bends must
  span the sheet's width (D3). Bend-zone faces stay the kernel's 1e-4 fits, and a part unfolded with
  a hole wholly inside a bend zone is not `is_valid()` (D5). There is no separate `map_point` (D6).

Files:

- STEP: `OFFSET_CURVE_3D` and edges given only as `PCURVE`s are not read (left out with a warning);
  moved copies are not written as instances; mirrored assembly placements are not read; an offset of
  a whole sphere does not import; OpenCASCADE cannot read an offset whose basis is a B-spline with
  C0 knots; coordinate systems are written without color (I6, I10, I11, I12). `export_step` of a
  list leaves an empty body out silently; `export_glb([])` and `export_obj([])` write empty files
  (X10).
- IGES is read, not written; binary and compressed IGES, offset curves (130) and some surface forms
  are not read (I14).
- USD: inherits, specializes and variant sets are not composed (X2); circles on faces written as
  NURBS stay NURBS edges, other writers' ellipses are not restored (X5); materials of faces,
  collection bindings and textures (X12); curves are read as a Shell without faces and not written
  (X13).
- `.smp` holds no assembly placements, points or meshes; `.smb` still no name or color (X9).
- `.brep`: binary files are read, not written; no names or colors; curves and points outside faces
  are not read; 4 of 557 corpus solids read back refused (edges staged backwards), and 2 of 585
  bodies are refused by the writer (X14).

smlibwasm and the runtime:

- No deadline counter inside the kernel, so a step that loops on a page's main thread still does not
  return; use a `KernelWorker` (W2). Vite 4 cannot bundle a module worker that imports the package
  (W7). A real out-of-memory trap is not in the tests (W8). `scope` cannot follow async functions
  (W9). After a crash the module is not loaded again; retry loops other than shell, offset and
  defeaturing still go on after one (W10). Some options stay loosely typed (W11). Variable fonts at
  their default instance only, a WOFF2 collection's first font only (W13).
- The all-edge fillets of usd-brep's `vase1.smb` and `vase3.smb` succeed natively on arm64 and fail
  in smlibwasm: the native build contracts `a * b + c` into one instruction (FMA); the build flags
  are left as they are (W16).
- The CI jobs of N2 have not run on Linux, and the helper process not on Windows (tested on macOS by
  forcing it); the fuzz baseline is for darwin-arm64 only (N3); the USD validator runs on a shim,
  not on `usd-brep[validation]` (N4); parity covers 18 modelling steps (N5).
- *Python*: SmPyLib's class methods and short calls keep the GIL (they take the lock); free-threaded
  Python is not declared supported; forking with threads warns (N8). Nothing compacts by itself
  (N9).
