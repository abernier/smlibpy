# draft

Tilts faces of a part by a draft angle so that it comes out of a mold or a casting die. Each
face turns about the line where it meets the neutral plane and keeps its size there.

## Signature
`part.draft(faces, angle, neutral_plane)`

- `faces`: faces of this part: a selection, one `Face` or a list. Faces of an earlier version
  of the part are matched by position and area.
- `angle`: degrees, between -90 and 90, not 0.
- `neutral_plane`: a `Plane` or a planar face. The faces keep their size where they meet it, and
  its normal is the pull direction (the way the mold half moves off the part). A face's normal
  points out of the part: `faces().top()` pulls up, `faces().bottom()` pulls **down**. For a
  part standing on XY that should narrow upwards, pass `Plane.XY` (moved to the bottom).

## The sign
A positive angle turns each face to look more along the pull direction: the part narrows and
pockets and holes widen along the normal, on both sides of the plane. `draft_analysis` of that
direction then finds `angle` more draft on each drafted face. Negative angles turn the other
way. `Box(40, 30, 20)`, its four walls drafted 3 degrees:

| `neutral_plane` | Top | Bottom | Volume |
|---|---|---|---|
| `Plane.XY.offset(-10)` (the bottom, normal +Z) | 37.904 x 27.904 | 40 x 30 | 22561.879 |
| `box.faces().top()` (normal +Z) | 40 x 30 | 42.096 x 32.096 | 25496.715 |
| `box.faces().bottom()` (normal -Z) | 42.096 x 32.096 | 40 x 30 | 25496.715 |
| `Plane.XY` (through the walls) | 38.952 x 28.952 | 41.048 x 31.048 | 24007.324 |

The results are exact: the walls are planes, the volumes those of the frusta.

## What can be drafted
- Planes that cross the neutral plane at an angle: walls, ribs, pocket and boss sides. A face
  need not touch the neutral plane; the line where its plane meets the neutral plane is used.
  Flat B-spline faces (`is_planar` True: control points in one plane, such as the walls of
  `extrude(taper=..., corners="round")`) are planes here too.
- Cylinders and cones whose axis runs along the normal: a cylinder becomes a cone with the draft
  as its half angle (a pin narrows, a hole widens along the pull direction), a cone gets steeper
  or flatter.
- Faces that have draft already get `angle` on top: a tapered extrusion drafted again by 2
  degrees is the extrusion with `taper=5`, by -3 it is straight again (cylinders, not cones).
- The faces around the drafted ones are extended or trimmed: planes, cylinders, cones and
  B-spline faces (a free-form top). Straight edges stay lines and circles stay circles.

## Refused
`ModelingError`; the part is not changed:
- A face that meets a drafted face tangentially must be drafted with it. The round between two
  walls (a cylinder along the normal) can be: add it, it becomes a cone. A round along the top
  or the floor cannot: draft first, round afterwards.
- Faces parallel to the neutral plane (tops, floors), a face in the plane, spheres, tori,
  free-form faces, cylinders whose axis is off the normal.
- A face whose draft would reach 89 degrees, a cone that would narrow to a point, an angle at
  which drafted faces run into each other or a face around them vanishes.
- The kernel (SMLib's `LocalOperation`) rebuilds the part, and it can close it with faces that do
  not meet. smlibpy measures the gaps between the vertices, edges and faces of the result and
  checks that it is a valid solid with as many faces as before; a result that fails says so.
  Seen next to a sphere where the sphere's seam crosses an edge of a drafted face.

## Errors
- `ModelingError: draft: the cylinder face at (-18.18, 13.18, 0) meets the drafted plane face at (0, 15, 0) tangentially, so it must be drafted with it; add it to the faces`
- `ModelingError: draft: the cylinder face at (-18.97, 0, 8.854) meets the drafted plane face at (-20, 0, -1.5) tangentially, so it must be drafted with it, but a cylinder face cannot be drafted about this plane; draft before rounding or blending there, and round afterwards`
- `ModelingError: draft: the plane face at (0, 0, 10) is parallel to the neutral plane; only faces that cross the plane's normal at an angle can be drafted (walls, not tops or floors)`
- `ModelingError: draft: the plane face at (0, 0, -10) lies in the neutral plane; there is no line in it to turn it about`
- `ModelingError: draft: the sphere face at (0, 0, 0) cannot be drafted; draft turns planes, and cylinders and cones whose axis runs along the normal of the neutral plane`
- `ModelingError: draft: the axis of the cylinder face at (0, 0, 0) is 90 degrees off the normal of the neutral plane; a cylinder or cone can be drafted only when its axis runs along that normal`
- `ModelingError: draft: at 30 degrees the cylinder face at (0, 0, 0) would narrow to a point; use a smaller angle`
- `ModelingError: draft: at 89.5 degrees the plane face at (-20, 0, 0) would have 89.5 degrees of draft and lie almost flat; a face can have up to 89 degrees`
- `ModelingError: draft: the drafted faces do not close the part again: at this angle a face around them vanishes, or drafted faces run into each other; use a smaller angle`
- `ValueError: draft: the angle is 0; nothing to do`; `ValueError: draft: the angle must be between -90 and 90 degrees (got 90)`;
  `ValueError: draft: no faces selected`; `ValueError: draft: the neutral plane must be a Plane or a planar face; ...`

## Two-sided draft (a parting line in the middle)
A part molded in two halves is drafted away from the parting line on both sides. `draft` turns a
face crossing the neutral plane as a whole (its lower part then leans the wrong way for the lower
mold half). With a planar parting line: `split` the part there, draft each half about the plane
(the lower half with the plane flipped, its pull direction), and fuse the halves. Exact:
`Box(40, 30, 20)` about `Plane.XY`, 3 degrees: 23273.6153 (= 2 * integral of (40 - 2z tan 3)(30 -
2z tan 3) over 0..10), 40 x 30 at the parting line, 38.952 x 28.952 at top and bottom;
`draft_analysis(Z)` finds 3 degrees on the upper walls and -3 on the lower ones (they release
towards the lower half). A stepped parting line needs a neutral plane per step: split the part
at each step and draft each piece about its own plane before fusing them.

## Other ways
- All side walls of a profile: `sketch.extrude(amount, taper=deg)`. Positive `taper` narrows
  away from the sketch: a `RoundedRectangle(60, 40, 5)` with `taper=3` over 20 is 57.904 wide at
  the top (60 − 2·20·tan 3°). Rounded corners stay rounded, holes in the profile are drafted the
  other way. See `extrude`.
- A pocket or boss with draft: a tapered tool from a face,
  `Rectangle(30, 20).on(top).extrude(-10, taper=5)` (30 x 20 at the face, 28.25 x 18.25 at the
  bottom), subtracted or added.
- One wall: `split` with a plane through the edge where the draft starts (the neutral line), its
  normal tilted by the angle and pointing into the part, keeping "above" (example below).
- `loft` between a bottom outline and a smaller top outline (`ruled=True` for flat walls).

## Example
```python
box = Box(40, 30, 20)
walls = box.faces().filter(lambda f: abs(f.normal_at().z) < 0.5)
core = box.draft(walls, 3, Plane.XY.offset(-10))   # the bottom keeps 40 x 30, the top narrows
print(round(core.volume, 3))                        # 22561.879
print(round(core.faces().top().one().bbox().size.x, 3))   # 37.904 = 40 - 2 * 20 * tan(3)
print(sorted(round(fd.min_angle, 6) for fd in core.draft_analysis(Z)))   # [-90.0, 3.0, 3.0, 3.0, 3.0, 90.0]

# a pocket that opens upwards: the rim keeps its size, the floor gets smaller
block = Box(60, 40, 20) - Box(30, 20, 10, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 10)
pocket = block.faces().filter(lambda f: abs(f.normal_at().z) < 0.5 and abs(f.center().x) < 29 and abs(f.center().y) < 19)
opened = block.draft(pocket, 3, block.faces().top())
print(round(opened.volume, 3))                      # 42258.377

# a cylinder becomes a cone; the rounds between walls are drafted with the walls
pin = Cylinder(10, 20)
pin = pin.draft(pin.faces().cylinders(), 5, Plane.XY.offset(-10))
print([f.geom_type for f in pin.faces()], [round(e.radius, 4) for e in pin.edges().circles()])   # ['cone', 'plane', 'plane'] [10.0, 8.2502]
rounded = box.fillet(box.edges().parallel_to(Z), 5)
sides = rounded.faces().filter(lambda f: abs(f.normal_at(f.interior_point()).z) < 0.5)   # 4 walls, 4 rounds
print(round(rounded.draft(sides, 3, Plane.XY.offset(-10)).volume, 3))   # 22216.363, as RoundedRectangle(40, 30, 5).extrude(20, taper=3)

# drafted by tapered extrusions instead
core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)  # every side wall drafted 3 degrees
blk = Box(60, 40, 20)
blk -= Rectangle(30, 20).on(blk.faces().top()).extrude(-10, taper=5)  # pocket 30x20 at the top, narrower at the bottom
```
Both halves drafted away from a parting line in the middle:
```python
box = Box(40, 30, 20)
upper, lower = box.split(Plane.XY, "both")
side = lambda p: p.faces().filter(lambda f: abs(f.normal_at().z) < 0.5)
molded = upper.draft(side(upper), 3, Plane.XY) + lower.draft(side(lower), 3, Plane.XY.flipped())
print(round(molded.volume, 4), len(molded.faces()))    # 23273.6153 10
print(sorted(round(fd.min_angle, 4) for fd in molded.draft_analysis(Z)))   # [-90.0, -3.0 (x4), 3.0 (x4), 90.0]
```
One drafted wall with `split`:
```python
wall = Box(40, 30, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
a = math.radians(5)
drafted = wall.split(Plane(origin=(20, 0, 0), z_dir=(-math.cos(a), 0, -math.sin(a))))
print(round(drafted.volume, 3))                         # 23475.068
```

## Related
`extrude` (taper), `split`, `loft`, `fillet` (round after drafting), `move_faces` (tilt a face
by a Location about any axis); `analysis/draft_analysis`
measures the draft of every face, `analysis/parting_line` finds where the mold halves meet,
`recipes/mold-check` puts it together.
