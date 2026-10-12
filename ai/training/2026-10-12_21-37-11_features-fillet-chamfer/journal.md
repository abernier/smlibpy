# Training: features · fillet and chamfer

**Date:** 2026-10-12

## Goal

APIs: `Part.fillet`, `fillet`, `Part.chamfer`, `chamfer`

Questions:
- Edge selection forms (list, single edge, faces, edges of an earlier version).
- Variable radius: which end is start? Per-edge lists. G1/G2/G3 and fullness: what changes?
- Where are the limits, what is raised, does anything slip through?
- Order with Booleans and with other fillets.
- Chamfer: length meaning on non-perpendicular faces, angle / two distances?

## Fillet

### 01-fillet-basic.py
- 4 vertical edges r5 on 40x30x20: dV -429.2037 = 4·(25-25π/4)·20 exact. Single edge -107.3009 exact.
- `fillet(edges, r)` same. `box.fillet(box.faces().top(), 3)` rounds the face's 4 edges.
- All 12 edges r3: vol 23340.8494 = exact rounded box formula.
- Edges selected on the box before cutting a hole: matched on the cut part (valid).
- Cylinder top edge r2: dV -51.5253 = Pappus -51.5258.
![allr](files/01-fillet-basic-allr.png)

### 02-fillet-variants.py
- `(2, 8)` on edge from (20,15,-10) to (20,15,10): removed area at z=-9.99 0.8585 (r2: 0.8584),
  at z=9.99 13.7352 (r8: 13.7345) → start radius at `edge.start`. dV -120.184 vs linear -120.177.
- List [2,4,6,8]: dV -515.0444 exact. Wrong length → `ValueError: 2 radii for 4 edges`.
  3-tuple → TypeError (float() argument...).
- continuity None/G1/G2/G3: dV -429.2/-400.0/-270.7/-212.0; `2` and `"g2"` accepted; `"G4"` →
  `ValueError: continuity must be G1, G2 or G3`.
- G2 fullness 0.5/0.8/1.0/1.2: dV -587.5/-385.9/-270.7/-170.7; 1.5 and 2.0 → KernelError
  "the radius may be too large". Circular + fullness=2: ignored (same as circular).

### 03-fillet-setback.py
All variants touch the faces at setback 5.0000 (x and y); only the bulge differs (corner gap
2.17 circular, 1.66 G2, 1.46 G3, 1.25 G2 fullness 1.2). **📌 doc:** radius = setback for blends.

### 04-fillet-limits.py / 05-fillet-r499.py / 07-fillet-onecall.py
- Cube 10 all edges: r4..4.97, 4.999 exact (formula); **r4.99: valid=True, vol 11.19 (exact
  525.17), 14 faces, tessellation fails** — deterministic (3 repeats); 20 cube r9.98 same (89.5).
  r5: KernelError; r5.01: ModelingError with "largest possible setback here: 5".
- One vertical edge: up to r10 (quarter cylinder 785.398 exact); r11 → ModelingError (limit 10).
- Plate 4 thick, top edges: up to r4 valid (faces 6 at r4), r5 ModelingError.
- r=0, r=-1: KernelError "the radius may be too large" (misleading).
- Cylinder all edges: seam skipped, valid. Only smooth edges / empty selection → ValueError.
- Foreign edge → `ValueError: Edge(line, ...) is not an edge of this part`;
  `fillet([], 1)` → "these edges do not belong to a part; call part.fillet(edges, ...) instead".
- One call r8 (vertical) + r3 (top) via list: 25154.747, same as r8 first.

### 06-fillet-concave-order.py
- Boss root (concave circle) r2: dV +56.3447 = Pappus +56.3448.
- Fillet corners then hole = hole then fillet (18324.4603); hole rim r1 convex, valid.
- r8 then r3: 25154.747 clean; r3 then r8: 25199.45 dented corner (picture).
![order](files/06-fillet-concave-order-order.png)

## Chamfer

### 08-chamfer.py
- Signature `(edges, length)` only; tuple → TypeError.
- 4 vertical L2: dV -160 exact. Top face / its edges / function form identical.
- All edges L2: 23322.667 = exact (edge prisms 624 + 8 corners·(5/6)L³).
- Perpendicular L3: chamfer face from x 17..20, y 12..15 (setback 3).
- Acute edge (normals 153.4°): both new corners 2.0000 from the old corner.
- Cube all edges L4.9: 186.861 exact; L5 KernelError; L5.1+ ModelingError (limit 5).
  One edge L10: 500 (half cube), L11 ModelingError. L0/L-1 KernelError.
- Cylinder top L2: dV -117.2936 (Pappus -117.2861). Hole rim L1.5 -38.872 exact. Concave +134.04.
![chamfers](files/08-chamfer-chamfers.png)

### 09/10-doc-*.py
Doc examples, values as commented.

## Coverage
All parameters and modes tried; limits found; errors recorded; realistic use (boss root, hole
rim, mixed radii). Gap: variable radius with G3 not tried separately (G2 + variable works).
