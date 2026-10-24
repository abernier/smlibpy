# loft

A solid through a series of cross sections (closed sections), or a surface through open curves.

## Signature
`loft(sections, *, ruled=False, smooth=True, start_tangent=None, end_tangent=None, closed=False, rails=None)`

- `sections`: two or more, in order. Closed: sketches, planar faces, closed wires (`Polyline(..., close=True)`).
  Open: edges or open wires (result is a `Shell`). Do not mix closed and open. Closed sections
  may have holes; every section needs the same number of them.
- `ruled=True`: straight transitions between neighbouring sections (degree 1), for closed and
  open sections alike (three lines: two flat faces).
- `smooth`: only matters with **four or more** sections (cubic instead of quadratic). With three
  sections the loft is quadratic either way; with two it is always straight (unless tangents are
  given).
- `start_tangent`, `end_tangent`: an `Axis` or a direction the loft leaves the first section in
  and reaches the last in: across the section, usually its normal (`Z` for sections in XY), so the
  loft meets an extrusion of the end section smoothly (a bottle neck on its body). Only the
  direction counts; each one is one more condition (two sections and both tangents: cubic). Not
  with `ruled=True`. The kernel drops tangents it cannot meet; the loft checks them and raises
  `ModelingError` ("cannot leave the first section along start_tangent").
  Or a **face** that ends at the first (last) section, the section lying on it (usually along its
  edge: a can's top rim on its wall, `can.faces().cylinders()`): the loft leaves the section
  continuing the face, tangent to it all along the section, and runs into it at the end (within
  1e-6 radians where the face is a plane, cylinder, cone or sphere about the section, 1e-3 on
  freeform faces). A section off the face raises `ValueError` ("must lie on it").
- `closed=True`: run on from the last section through the first again, smoothly (C1): a ring
  without end faces (three sections or more; no tangents).
- `rails`: a curve (an edge or a wire) or a list of them for **open** sections (a surface): each
  runs from the first section to the last and crosses every section once, and the loft passes
  through them exactly, as through the sections (a Gordon surface; within 1e-7). Rails may run on
  past the first and last section (they are cut there) and in either direction. Where no rail
  runs along the sections' starts or ends, the border there runs smoothly through them. Sections
  and rails must be smooth curves (each is joined into one; a corner raises `ModelingError`: "must
  be smooth curves"). Not with `ruled`, the tangents or `closed`; closed sections along rails are
  not supported (`ValueError`).

## Returns
A `Part` for closed sections, a `Shell` for open curves. Sections are placed where they are:
move them with `.translate(0, 0, z)` or `.on(plane)`. Sections may be tilted
(`Circle(10).on(Plane(origin=(0, 0, 20), z_dir=(0, 0.5, 1)))`) and given in descending order.

## How sections are matched
The kernel joins the outer loops by where they start and how they are parametrized, and that
depends on how each section was made (`Circle` has its seam at +X, `RegularPolygon(r, 6)` starts
at -60°, a `Rectangle` at a corner). Do not predict it; measure it. **Sections whose starts do
not suit each other give a twisted, pinched loft** that `is_valid()` still accepts:
- `loft([Rectangle(20, 20), RegularPolygon(10, 6).translate(0, 0, 20)], ruled=True)` is an
  hourglass (mid-section area 6.4 instead of ~320).
- Fix polygons by drawing them as a closed `Polyline` whose first point lies in the same
  direction as the other section's start (corner by corner).
- Fix circles by turning them: `Circle(r).rotate(Z, 45)` suits a centered `Rectangle`. For other
  shapes measure: try angles and keep the one with the largest middle section (example below).
- Always check the middle: `part.section(Plane.XY.offset(mid)).area` against the average of the
  end areas, and look at a snapshot.

## Gotchas
- Sections with holes make a hollow solid: each hole is joined to the nearest hole of the next
  section and runs through the whole loft. `loft([Circle(10) - Circle(5), (Circle(8) -
  Circle(3)).translate(0, 0, 20)])` is a hollow frustum (4 faces, 4084.071). A different
  number of holes raises `ValueError`.
- A section with two separate regions raises `ValueError: a loft section must be a single region`.
- Smooth lofts overshoot between sections: a 15/25/10 vase reaches radius 25.047 at the bulge.
  Use `ruled=True` when a section must stay the widest.
- Sections out of order (z 0, 20, 10) loop back and overshoot (z max 20.37) without an error.
- Open curves must run the same way: two lines in opposite directions make a bow-tie surface
  (area 55.9 instead of 111.8).
- Two sections in the same plane: `KernelError: loft failed (SM_ERR_INVALID_INPUT): sections
  should be closed, ordered and not intersect each other`.

## Errors
- `ValueError: loft needs at least two sections`
- `ValueError: loft: start_tangent lies in the plane of the section; it must run across it`
- `ValueError: loft: a ruled loft runs straight to its ends; start_tangent and end_tangent need ruled=False`
- `ValueError: loft: a closed loft has no ends; start_tangent and end_tangent need closed=False`
- `ValueError: loft: a closed loft needs three sections or more`
- `ValueError: loft sections must be all closed (solid) or all open (surface)`
- `ValueError: a loft section must be a single region`
- `ValueError: loft: every section needs the same number of holes (a hole runs through the whole loft)`
- `ValueError: loft: start_tangent is a face the loft continues, so the section must lie on it (where the face ends); it lies 1 off the face`
- `ValueError: loft: rails= takes open sections (edges or wires: a surface through them and the rails); closed sections along rails are not supported`
- `ValueError: loft: rail 1 and section 2: the curves do not cross (within ...)`
- `ModelingError: loft: the sections and rails must be smooth curves; a smooth curve stays ... off one of them (a corner: ...)`
- `ModelingError` when the kernel returns an inside-out or volume-less body.

## Example
```python
vase = loft([Circle(15), Circle(25).translate(0, 0, 30), Circle(10).translate(0, 0, 60)])
print(vase.is_valid(), vase.bbox().max.x)               # True 25.047: overshoots the 25 section

cone = loft([Circle(10), Circle(5).translate(0, 0, 20)])  # two sections: straight sides
print(round(cone.volume, 3))                            # 3665.192 = exact frustum

# square to circle: turn the circle so its seam suits the square (45 for a centered Rectangle)
duct = loft([Rectangle(30, 30), Circle(12).rotate(Z, 45).translate(0, 0, 25)])
print(round(duct.section(Plane.XY.offset(12.5)).area, 1))  # 660.2 (unturned circle: 565.9)

# square to hexagon: draw the hexagon as a closed Polyline that starts near the square's start
hexagon = Polyline(*[(10 * math.cos(math.radians(120 + 60 * i)), 10 * math.sin(math.radians(120 + 60 * i)), 20)
                     for i in range(6)], close=True)
prism = loft([Rectangle(20, 20), hexagon], ruled=True)
print(round(prism.volume, 1))                           # 6512.7 (RegularPolygon(10, 6): 2284.7, pinched)

# pick the best seam angle by measuring the middle section
base = Rectangle(30, 30)
best = max(range(0, 360, 15), key=lambda a: loft([base, Circle(12).rotate(Z, a).translate(0, 0, 20)]).section(Plane.XY.offset(10)).area)
print(best)                                             # 45

sheet = loft([Line((0, 0, 0), (10, 0, 0)), Line((0, 10, 5), (10, 10, 5))])  # open curves -> Shell
print(type(sheet).__name__, round(sheet.area, 3))       # Shell 111.803

# a neck that leaves the body and reaches the mouth straight up: smooth joints
neck = loft([Circle(10), Circle(4).translate(0, 0, 30)], start_tangent=Z, end_tangent=Z)
bottle = Circle(10).extrude(-40) + neck + Circle(4).translate(0, 0, 30).extrude(10)
print(bottle.is_valid(), len(bottle.faces()))           # True 5

# a neck that continues the can's wall (tangent to the face along the rim)
can = Cylinder(10, 20)
rim = max((e for e in can.edges() if e.geom_type == "circle"), key=lambda e: e.center().z)
cap = loft([rim, Circle(4).translate(0, 0, 30)], start_tangent=can.faces().cylinders())
print(cap.is_valid(), round(cap.volume, 3))             # True 4264.352

# a panel through three arcs and the two rails they span between
r1 = Spline((0, 0, 0), (-2, 10, 1), (0, 20, 0))
r2 = Spline((20, 0, 0), (24, 10, 2), (20, 20, 0))
arcs = [ThreePointArc(r1.point_at(t), (r1.point_at(t) + r2.point_at(t)) * 0.5 + Vector(0, 0, 3 + 2 * t), r2.point_at(t))
        for t in (0, 0.5, 1)]
panel = loft(arcs, rails=[r1, r2])
print(type(panel).__name__, round(max(panel.faces()[0].distance_to(r1.point_at(i / 10)) for i in range(11)), 6))  # Shell 0.0

# a closed loft: 16 circles about a circle make (nearly) a torus
ring = loft([Rot(z=22.5 * i) * Pos(10, 0, 0) * Rot(x=90) * Circle(2) for i in range(16)], closed=True)
print(round(ring.volume, 1))                            # 789.5 (torus 789.6)
```

Shelling a loft: opening the bottom (planar polygon) face works; opening the circular top
of the duct above fails (`shell failed`). Subtract an inner loft instead.

## Related
`sweep` (constant profile along a path; `sweep(..., rails=)` along two rails), `extrude(taper=...)`, `ruled`,
`surface`, `network`, `shell`.
