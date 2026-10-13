# Checking a part for molding or casting

A part that is molded or cast leaves a two-part mold (or sand mold, die) along a pull
direction: one half moves up, the other down. Every face must release from the half that forms
it: it needs draft, an angle towards the direction that half moves. Faces turned away from both
are undercuts (side actions, cores). The two halves meet at the parting line.

## Steps

1. Choose the pull direction: usually the axis along which the part is lowest (Z for a part
   designed standing on XY).
2. Parting line: `lines = part.parting_line(Z)`. One closed wire around the part is the normal
   case; look where it runs (`lines[0].bbox()`). Several wires on a simple part point to faces
   neither half can reach.
3. Draft for each half: `up = part.draft_analysis(Z, min_angle=1)` and
   `down = part.draft_analysis(-Z, min_angle=1)`. A face is fine when it is in `up.positive` or
   in `down.positive`.
4. The rest: faces in `vertical` for both need draft (walls along the pull direction, ribs);
   faces in `insufficient` need more; a face whose angles cross 0 (`up.angles(face)`: least
   below 0, greatest above) is split by the parting line, which is fine when that is where you
   want the line.
5. Fix the design: taper the walls (`extrude(..., taper=deg)`, a tapered tool for pockets), and
   check again.

Typical minimum draft: 0.5 to 2 degrees for injection molding, more for textured surfaces and
for sand casting. The analysis judges faces by their own normals; it does not check whether
another part of the body hides a face from a half (the inside of a closed cover, a groove under
an overhang).

## Example
```python
cover = RoundedRectangle(80, 50, 6).extrude(25, taper=2)      # outside, 2 degrees
cover -= RoundedRectangle(74, 44, 3).extrude(23, taper=1.5)   # inside, open at the bottom, 1.5 degrees

lines = cover.parting_line(Z)
print(len(lines), round(lines[0].length, 3), lines[0].bbox().max.z)   # 1 249.699 0.0: the bottom rim

up = cover.draft_analysis(Z, min_angle=1)       # the half that moves up: outside and top
down = cover.draft_analysis(-Z, min_angle=1)    # the half that moves down: inside and rim
print(len(up.positive), len(down.positive))     # 9 10
need = [f for f in cover.faces() if f not in up.positive and f not in down.positive]
print(len(need))                                # 0: every face releases from one half

ribbed = cover + Box(2, 44, 10, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 23)
up, down = ribbed.draft_analysis(Z), ribbed.draft_analysis(-Z)
need = [f for f in ribbed.faces() if f not in up.positive and f not in down.positive]
print(len(need), [round(up.angles(f)[0], 6) for f in need])   # 2 [0.0, 0.0]: the rib's sides need draft
```

The inside of the same cover tapered the wrong way (`taper=-1.5`: wider at the top) gives 3
parting lines (z = 0, 23 and 0): the inside faces up, and the lower half could not come out.

Guides: `analysis/draft_analysis`, `analysis/parting_line`, `features/extrude` (taper),
`features/draft`.
