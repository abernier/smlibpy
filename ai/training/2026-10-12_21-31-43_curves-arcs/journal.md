# Training: curves · arcs

**Date:** 2026-10-12

## Goal

APIs: `CenterArc`, `ThreePointArc`, `RadiusArc`, `SagittaArc`, `TangentArc`, `EllipticalArc`.

Questions:
- CenterArc: where does it start, which way does it run, what does a negative size do,
  is the center in plane coordinates?
- ThreePointArc: through the middle point exactly? arcs over 180 degrees?
- RadiusArc / SagittaArc: which side for which sign? which of the two arcs?
- TangentArc: does it leave start along the tangent? what if the tangent points backwards?
- EllipticalArc: parametric or polar angles? direction? arcs across 0 degrees?
- Arcs as sweep paths.

## Log

### 01-centerarc.py
Start at `start_angle` ccw from the plane X axis, runs ccw for positive `arc_size`, cw for
negative. `CenterArc((0,0),10,0,90)`: (10,0)->(0,10), t0 (0,1,0), normal +Z. `0,-90`:
(10,0)->(0,-10), normal **-Z** (the normal follows the direction). 360 and -360: full circle
starting at the start angle, `is_closed` True, length 62.83185. `arc_size` > 360 (450) is
clamped to a full circle. Start angles -30 and 720 work. **Defect:** `arc_size=0` returns a
full circle (length 62.83) instead of raising. radius 0 or negative: `ValueError: radius must
be positive`. A center 3-tuple `(0,0,7)` lifts the arc to z=7.
![arcs](files/01-centerarc-arcs.png)

### 02-centerarc-plane.py
`plane=` uses the plane's X axis for angle 0 and its Y axis for 90: XZ: (10,0,0)->(0,0,10),
normal (0,-1,0); YZ/right: (0,10,0)->(0,0,10); back: (-10,0,0)->(0,0,10); bottom:
(10,0,0)->(0,-10,0). `center` is in plane coordinates: (5,2) on XZ -> world (5,0,2);
(1,2) on XY.offset(5) -> (1,2,5). `.on(Plane.XZ)` gives the same edge as `plane=Plane.XZ`.
📌 doc: center in plane coordinates (PolarLine differs).

### 03-threepointarc.py
Passes exactly through all three points (distance to `through` ~1e-15). Upper half
(-10,0)->(0,10)->(10,0): normal -Z (cw), lower half normal +Z. Major arcs fine: (10,0) via
(-10,0) to (0,-10) length 47.12 (270 degrees). 3D tilted points fine (r 7.5). Collinear or
coincident points: `ValueError: the three points are collinear` (also for start == end).
Nearly collinear (through 1e-9 off the chord): r = 1.25e10 and the end misses by 1.9e-6.

### 04-radiusarc.py
Positive radius bulges to the left of start->end (for (0,0)->(10,0): mid (5,1.34)), negative
to the right; always the shorter arc (length 10.47 for r=10). |r| = half chord: half circle.
Swapping the points with the same sign flips the side. `|r| < chord/2`:
`ValueError: radius 4.999 is too small for points 10.0 apart`; r=0 same message. Equal points:
`ValueError: cannot normalize a zero-length vector`. `plane=` only defines "left" (via its
normal); the points are world points and the plane's origin is ignored: on XZ (normal -Y)
left of +X is +Z; on back (normal +Y) it is -Z. A chord along the plane normal (chord along
X with Plane.YZ, or along Z with Plane.XY): `cannot normalize a zero-length vector`.
![radius](files/04-radiusarc-radiusarcs.png)

### 05-sagittaarc.py
Middle of the arc is exactly `sagitta` from the chord midpoint, positive left. r = (s² +
c²/4) / 2|s| as expected (s=2, chord 10: r 7.25). |s| > half chord gives the major arc
(s=8: length 22.52). s=0 or 1e-12: `ValueError: the three points are collinear`. Plane rule as
RadiusArc (XZ: +Z, back: -Z).

### 06-tangentarc.py
Leaves `start` exactly along `tangent` (angle 0 in all cases), magnitude ignored. Tangent
(0,1): half circle r 5 over the top; (1,1): r 7.07 short arc; a backward tangent (-1,1) gives
the major arc (length 33.3). Tangent along the chord: a `Line`. **Defect:** tangent exactly
backwards (-1,0) also returns a Line going forward (tangent violated by 180°, no error).
(0,0): `ValueError: cannot normalize a zero-length vector`; equal points: `a line needs two
distinct points`. 3D works: the arc lies in the plane of tangent and chord. Chaining with
`prev.tangent_at(1)` gives tangent joints (0.0° at each joint); slot area 278.5398 (exact).
![tangent](files/06-tangentarc-tangent.png)

### 07-ellipticalarc.py
Full ellipse by default (`geom_type` "ellipse", even for rx == ry). Angles are
**parametric**: 45 deg gives (rx cos45, ry sin45) = (14.14, 7.07), not the polar 45 deg point.
Always counterclockwise from start to end; end < start wraps (90..0 is the 270 deg arc).
`start == end` (30..30) or 90..450 gives the full ellipse starting at angle 0 (start ignored).
**Defect:** arcs that pass through angle 0 fail: -90..90 and 270..450 raise `KernelError:
EllipticalArc failed (SM_ERR)`. rx or ry 0 or negative: `KernelError ... (SM_ERR_INVALID_INPUT)`.
`plane=` and center in plane coordinates like CenterArc. make_face of a full ellipse: area
628.3186 (exact 628.3185).

### 08-ellipse-across-zero.py
Fails: 350..10, -10..10, 359..1. Works: 270..360, 180..0 (= 180..360), 1..0 (almost full).
Workarounds: `Wire([EllipticalArc(c, rx, ry, 270, 360), EllipticalArc(c, rx, ry, 0, 90)])`, or
`EllipticalArc(c, rx, ry, 90, 270).rotate(Z, 180)` (still an ellipse, start (0,-10)).

### 09-arc-outlines.py
D plate: `Wire([Line((-20,0),(20,0)), RadiusArc((20,0),(-20,0),20)])` puts the arc **below**
(left of travel -X is -Y): mid (0,-20). Volume 3141.5928 (exact). Lens of two SagittaArcs: area
81.42202 (exact). Keyhole from CenterArc + lines: valid.
![outlines](files/09-arc-outlines-outlines.png)

### 10-arc-path.py
CenterArc on XZ as path: tube valid, volume 394.7841 (exact 394.7842). **Defect:** a full
circle as path gives `is_valid() True` but volume -1579.13 (inside out).
![tube](files/10-arc-path-tube.png)

### 11-closed-path.py
Full circle path: volume -1579.13, faces 3, picture shows a flat disk-like body. Two half
circles in a Wire: correct (1579.1369). `revolve` of the circle: 1579.137. Closed Spline as
path: valid True, volume 0.0. **Defect:** any EllipticalArc as sweep path raises `TypeError:
curve_sweep(): incompatible function arguments`. Open ellipse extrude to a shell and a loft
from an ellipse face work.

### 12-ellipse-extrude.py
Open ellipse arc extruded: area = 5 * length (198.318). Full ellipse extrude volume exact.

### 13-ellipse-path-workaround.py
`e.mirror(Plane.XZ).mirror(Plane.XZ)` converts the ellipse to an exact B-spline (deviation
6.5e-13); sweep along it valid, volume 498.4276 (π·4·L = 498.4275).

## Coverage

All parameters of the six arc constructors tried, all signs, planes, errors; realistic
outlines and paths. Gaps: none.

### 14-doc-examples.py, 15-doc-centerarc.py
Code blocks of CenterArc, ThreePointArc, RadiusArc, SagittaArc, TangentArc and
EllipticalArc docs, verbatim: all ran; the numbers in the comments match (D plate arc mid
(0, 20) with radius -20, volume 3141.5926; CenterArc plate (1200 - 36π)·5 = 5434.513;
lens bbox y -3..3; slot 278.5398).
