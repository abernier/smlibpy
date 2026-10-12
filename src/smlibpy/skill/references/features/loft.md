# loft

A solid through a series of cross sections (closed sections), or a surface through open curves.

## Signature
`loft(sections, *, ruled=False, smooth=True)`

- `sections`: two or more, in order. Closed: sketches, planar faces, closed wires (`Polyline(..., close=True)`).
  Open: edges or open wires (result is a `Shell`). Do not mix closed and open.
- `ruled=True`: straight transitions between neighbouring sections (degree 1).
- `smooth`: only matters with **four or more** sections (cubic instead of quadratic). With three
  sections the loft is quadratic either way; with two it is always straight.
- There is no `closed` option (no loft back to the first section).

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
- **Holes in a section are dropped silently.** A ring section `Circle(10) - Circle(5)` lofted
  to a `Circle(10)` 20 above gives the full cylinder (6283.19). Loft the outside, then subtract
  a loft of the inside.
- A section with two separate regions raises `ValueError: a loft section must be a single region`.
- Smooth lofts overshoot between sections: a 15/25/10 vase reaches radius 25.047 at the bulge.
  Use `ruled=True` when a section must stay the widest.
- Sections out of order (z 0, 20, 10) loop back and overshoot (z max 20.37) without an error.
- Open curves must run the same way: two lines in opposite directions make a bow-tie surface
  (area 55.9 instead of 111.8). Single-edge open curves ignore `ruled`.
- Two sections in the same plane: `KernelError: loft failed (SM_ERR_INVALID_INPUT): sections
  should be closed, ordered and not intersect each other`.

## Errors
- `ValueError: loft needs at least two sections`
- `ValueError: loft sections must be all closed (solid) or all open (surface)`
- `ValueError: a loft section must be a single region`

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
```

Shelling a loft: opening the bottom (planar polygon) face works; opening the circular top
of the duct above fails (`shell failed`). Subtract an inner loft instead.

## Related
`sweep` (constant profile along a path), `extrude(taper=...)`, `ruled`, `surface`, `shell`.
