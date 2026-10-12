# Training: features · mirror, split, section, draft, heal, to_nurbs

**Date:** 2026-10-12

## Goal

APIs: `mirror`, `Shape.mirror`, `split`, `Part.split`, `section`, `Part.section`, `Part.draft`,
`Part.heal`, `to_nurbs`

Questions:
- mirror: default plane, fuse with the original, faces as planes, sketches.
- split: which side is kept, faces as planes, other bodies, empty results.
- section: result type, plane placement, holes, misses.
- draft: does it exist? What to do instead.
- heal: what does it repair? to_nurbs: what changes, why.

## Scripts

### 01-mirror.py
- Signature default `Plane.XZ` (flips Y): `half.mirror()` of a part at y ±5 is unchanged-looking
  (symmetric in y) — bbox (0..20). `Plane.YZ` → x -20..0. `YZ.offset(30)` → x 40..60. Tilted ok.
- `half + half.mirror(YZ)`: 1 solid, 14 faces (coplanar faces merged), vol 2×1968.7316.
- `mirror(face)` → `AttributeError: 'Face' object has no attribute 'z_dir'`; `face.plane` works.
- Gap → 2 solids; overlap → 5000 exact.
- **Mirrored sketch normal (0,0,-1)**; extrude(5) → z -5..0.

### 02-split.py
- Halves of a symmetric part: 9989.3805 each (= half). `"both"` returns (above, below).
- `Plane.bottom` (normal -Z) "above" keeps z < 0. Tilted plane fine.
- Part's own top face: "above" → **empty Part** (valid False, 0 faces, bbox ±1e20), "below" → whole part.
- Another body's bottom face at z=3 → keeps z ≤ 3 (12986.19).
- Plane above the part, keep above → empty Part, no error.
- `keep="left"` → ValueError; curved face → ValueError; `split(Sphere)` → `TypeError: cannot use Part as a plane`.
- `part & tool` + `part - tool` = 19978.762 total.
![split](files/02-split-split.png)

### 03-section.py
- XY: Sketch, area 998.9381 exact, 1 inner wire, plane = the given plane.
- XZ: 2 faces, 480 exact (plane z (0,-1,0)). Tilted, sphere (201.062 exact), two solids (2 faces).
- On the top face → face area. Miss → `ValueError: the plane does not cut the part`.
- Section extrude(3) → z 5..8. Rounded box section edges: all 'bspline'.

### 04-draft.py
- `Part.draft` → `NotImplementedError: face drafts are not available in the open-source kernel yet; use Sketch.extrude(taper=...) for drafted extrusions`.
- Taper 3 on RoundedRectangle(60,40,5): top 57.904 exact.
- One wall by split with tilted plane: 23475.068 exact (first attempt with the wrong normal sign
  gave an empty part; second with keep="below" gave nothing cut — the side rule matters).
- Tapered pocket tool (extrude(-10, taper=5) from the top face): 30x20 at the face, 28.25x18.25 deep.
![draft](files/04-draft-draft.png)

### 05-heal-nurbs.py / 11-heal-shell.py
- to_nurbs: all face/edge types 'bspline', volume +0.002 (1e-7 rel), face count same, time 2 ms.
  Booleans, fillet, shell after it: valid (shell result reports analytic types again).
  `circles()` 10 → 0, `cylinders()` 5 → 0, `face.radius` → ValueError. STEP 11820 → 18137 bytes,
  reimport vol same. Shell and Sketch convert too.
- heal on a clean part: same, 4 ms. Shell/Sketch heal keep type and area.

### 06-heal-broken.py
heal does not repair: crossing revolve (-1570.8 stays), 360° arc sweep (2 solids → 1, volume
stays -1579.1), disconnected sweep (invalid stays), r4.99 cube (11.19 stays), taper 90 (invalid).
STEP round trip: valid before and after.

### 07..12-doc-*.py
Doc examples, values as commented.

## Coverage
All APIs and parameters tried. split "by other bodies" answered (not supported, Booleans).
Gap: heal on a really broken import (no such file at hand); documented what it does not fix.
