# Curves and wires

Curves are 1D shapes. Every curve constructor returns an `Edge` (one curve) or a `Wire` (a
chain of edges). They are used for outlines (`make_face`), sweep paths, loft sections, and
open surfaces (an open wire extruded or revolved gives a `Shell`).

## Edges

- `Line`, `PolarLine`, `CenterArc`, `ThreePointArc`, `RadiusArc`, `SagittaArc`, `TangentArc`,
  `EllipticalArc`, `Spline`, `Bezier`, `Helix` return an `Edge`.
- `Polyline` and `FilletPolyline` return a `Wire`.
- Edges taken from bodies (`part.edges()`, `face.outer_wire()`) are the same `Edge` type and
  mix freely with constructed ones.
- `Edge()` cannot be called directly.
- Points are 2-tuples (z = 0), 3-tuples, lists, `Vector` or `Vertex`.
- `edge.start`, `edge.end`, `edge.length`, `edge.point_at(t)`, `edge.tangent_at(t)`: `t` is
  the fraction of the arc length, 0 at `start`, 1 at `end`. `tangent_at` is a unit vector
  along the direction of travel.
- `geom_type` is `"line"`, `"circle"` (arcs too), `"ellipse"` or `"bspline"`. `direction` works
  only on lines, `radius`, `arc_center`, `normal` only on circles. Otherwise they raise
  `ValueError`.
- `edge.reversed()` swaps start and end. `edge.intersections(other)` gives crossing points.

## Wires

`Wire([e1, e2, ...])` chains edges head to tail and flips edges where needed. `a + b` does the
same. The first edge you pass keeps its direction and sets the direction of the wire. A
closed wire starts at the start of the first edge you pass. `is_closed` uses a tolerance of
1e-6. See `Wire.md`.

## From wires to sketches

A closed, planar wire becomes a region with `make_face(outer, *holes)` or `wire.to_sketch()`.
A single closed edge (a full circle) also works as an outline or hole.

```python
outline = Polyline((0, 0), (50, 0), (50, 10), (20, 30), (0, 30), close=True)
bolt_hole = Wire([CenterArc((12, 12), 4, 0, 360)])
bracket = make_face(outline, bolt_hole).extrude(5)    # volume 5748.67, z 0..5
```

- The direction of travel does not matter: a clockwise outline gives the same region.
- A hole that crosses the outline is subtracted like a Boolean; a hole outside does nothing.
- An open wire raises `ValueError: a sketch region needs closed wires; use wire.close()`.
- A non-planar or self-crossing wire raises `KernelError: make face failed (SM_ERR): the wire
  must be planar and must not cross itself`.

## 2D curves on planes

Points are world points; a 2-tuple lies in world XY. Some constructors take `plane=`, with
two different meanings:
- `CenterArc`, `EllipticalArc`: the center is in plane coordinates and the curve lies in
  the plane. `CenterArc((5, 2), 10, 0, 90, plane=Plane.XZ)` is centered at world (5, 0, 2).
- `PolarLine`, `RadiusArc`, `SagittaArc`: the points stay world points; the plane only sets
  the angle axes (PolarLine) or which side is "left" (the arcs). Its origin is ignored.

Any edge or wire can be moved with `.on(plane_or_face)`, `translate`, `rotate`,
`Pos(...) *`, `Rot(...) *`. On `Plane.XZ` the local X is world +X and local Y is world +Z.
Drawing in XY and calling `.on(plane)` is the most predictable way.

**Sketch normal trap.** A sketch made from a wire does not keep the plane the wire was drawn
on. Its normal points to +Z, or, for a vertical wire, to +X or +Y. A wire on `Plane.XZ` gives
a sketch with normal +Y, while `Rectangle(...).on(Plane.XZ)` has normal -Y: `extrude(5)` goes
the other way. To keep the plane, make the face on XY first and place the sketch:

```python
profile = make_face(Polyline((-10, -5), (10, -5), (10, 5), (-10, 5), close=True)).on(Plane.XZ)
wall = profile.extrude(5)    # y -5..0, like Rectangle(20, 10).on(Plane.XZ).extrude(5)
```

## Wires as paths

A sweep path is an `Edge` or a `Wire` of connected edges. A `Polyline` path gives mitered
corners; round the corners with `FilletPolyline` for a bent pipe.

```python
path = FilletPolyline((0, 0, 0), (0, 0, 30), (30, 0, 30), radius=8)
pipe = sweep(Circle(3), path)    # valid, volume = pi * 3**2 * path.length
```

- `sweep` centers the profile's bounding box on `path.start` and turns it to face along the
  path; draw the profile in XY around the origin.
- A closed path made of one edge (a full `CenterArc`, a closed `Spline`) is split into two
  halves automatically: `sweep(Circle(2), CenterArc((0, 0), 20, 0, 360))` is one ring.
- An `EllipticalArc` cannot be a path (TypeError); see `EllipticalArc.md`.
- `Helix` is limited to about 26 to 58 turns, depending on the radius; chain helices.

## Gotchas

- `mirror()`, a uniform `scale()`, `rotate`, `translate` and `.on()` keep lines and circles.
  A per-axis scale turns them into `bspline` edges (straight ones still count as lines).
- For an outline of lines and arcs drawn one after the other, `Profile` (sketches) does the
  bookkeeping of end points and tangents: `Profile((0, 0)).line_to(20, 0).arc(5, 90).wire()`.
- `Wire([...])` does not check that the edges connect. Edges with a gap or a branch are kept
  in the given order, and the wire is just "open". A sweep along such a path raises
  `ValueError: the sweep path is not connected: a gap of ...`. Check `wire.is_closed` for
  outlines and compare `wire.start` / `wire.end` with what you expect for paths.
- Two separately built but identical edges are not `==` (equality is identity).
- `bbox()` of a constructed curve (not one taken from a body) samples 33 points and can miss
  the extremes of splines: sample `point_at(i / n)` densely when extents matter.
- Pass points as separate arguments: `Polyline(*pts)`, `Spline(*pts)`. A single list of 2 or
  3 points raises TypeError.

## Related
`Wire.md`, `Line.md`, `Polyline.md`, `CenterArc.md`, `Spline.md`, `Helix.md`,
`sketches/make_face`, `features/sweep`, `features/extrude`.
