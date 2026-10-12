# Training: surfaces · stitch

**Date:** 2026-10-12

## Goal

APIs: `stitch(*pieces, tolerance=None)`, `Face.to_shell`

Expected from the docstring: sews faces and sheets along common edges; Part when the result
encloses a volume, otherwise Shell; `tolerance` = largest gap (default 1e-4 of the model size).

Questions:
- Inputs: Faces, Shells, Sketches, Parts, lists, nested lists, *args?
- Open set of faces: Shell; how many free edges remain? How to find them?
- Gaps: which gap sizes close with the default and with `tolerance`?
- Face orientation: do inconsistent normals get unified? Volume sign?
- Overlaps, non-manifold edges, duplicated faces.
- Realistic: freeform top + ruled sides + planar bottom → closed solid.

## Log

### 01-inputs.py
All of these give the same `Part` (6 faces, 12 edges, volume 1000.0, valid): a list of
`to_shell()` sheets, the `ShapeList` of faces directly, the faces as `*args`, nested lists, and a
Part alone. Five faces: `Shell`, 12 edges, 4 free edges (`len(e.faces()) == 1`), area 500. Two
adjacent faces: Shell, 7 edges (one shared), 6 free. Two disjoint faces: Shell, 8 free.
`stitch([])` → `ValueError: nothing to stitch`.
**📌 doc:** free edges = `[e for e in r.edges() if len(e.faces()) == 1]`; 0 means sewn shut.

### 02-gaps.py, 03-gap-scale.py, 04-gap-limit.py
Top face of a 10 mm cube lifted by g. Without `tolerance` gaps up to 0.06 close into a Part,
0.07 and more stay a Shell with 8 free edges. Side gaps: 0.05 closes, 0.08 not. Scale: a 1 mm
cube closes 0.005 but not 0.01; 100 and 1000 mm cubes close 0.05. So the default closes gaps up
to roughly 0.35 % of the bbox diagonal, regardless of `tolerance`. The docstring says "default:
1e-4 of the model size".
`tolerance=2*g` for g = 0.1 / 0.5: a Shell with **0 free edges** that is not manifold
(`is_manifold_solid()` False). `heal()` on it → manifold; `stitch()` again → Part.
`tolerance` smaller than the gap: Shell, 8 free edges.
→ TODO defect (tolerance semantics, sewn shell not returned as Part).

### 05-tolerance-workaround.py, 06-gap-body.py
`stitch(stitch(pieces, tolerance=2*g))` and `stitch(first.heal())`: Part, valid, volume 1010 /
1050 / 1100 = the faces where they are (top face at 5+g), but `bbox().max.z` 5.0 and vertex z
only ±5: the top face floats 0.5 mm above its own edges. STEP round trip keeps volume 1050.
A cut through it gives 918.05 (consistent with the face at 5.5).
**📌 doc:** stitch never moves geometry; it joins topology and puts the gap into the
tolerances. A large `tolerance` gives a "valid" Part with real gaps. Close gaps in the
geometry (build the pieces from shared curves) instead.
![gap05](files/05-tolerance-workaround-gap05.png)

### 07-orientation.py
Cube from six `ruled` faces with five different mixes of normal directions: always Part,
volume +1000.000, valid, and every face's `normal_at()` points outward afterwards.
**📌 doc:** input normals do not matter; stitch makes them consistent and outward.

### 08-bad-sets.py
- cube + duplicate top face: Shell, 7 faces, 4 free edges. No error.
- cube + fin sharing an edge (3 faces on one edge): Shell, 4 free edges. No error.
- cube with the top face shifted 3 sideways: Shell, 8 free edges.
- `ruled` per edge of a 3-segment Polyline, stitched: Shell, 3 faces, 10 edges (2 shared),
  8 free; `thicken(1)` 311.803 = length·10·1, valid.
**📌 doc:** a failed close is not an error: check `isinstance(r, Part)`.

### 09-closed-block.py
Freeform top (`surface`, 13x9 points) + 4 `ruled` walls from the top's edges down to lines at
z=0 (same direction) + `make_face(Polyline(..., close=True))` bottom → Part, valid, 6 faces,
volume 23997.28; numerical integral of h over the rectangle 23997.27.
![block](files/09-closed-block-block.png)

### 10-closed-surfaces.py
Closed grid tube + caps `make_face(e)` from its own boundary edges: Part 9424.761 (exact
9424.778), valid. With exact circle caps (0.02 deviation from the grid circle): Part 9424.762.
Revolved tube + caps: 9424.779. Torus grid (closed both ways) alone: `stitch(torus)` → Part,
9869.97 vs 9869.60 exact.
**📌 doc:** closed surfaces close into solids with caps; that works where thickening them fails.

### 11-doc-example.py / 12-free-edge-report.py
Doc example (the closed block with a free-edge check): True 23997.28 6. Used unchanged in
`stitch.md`. Leaving out one wall: Shell with 4 free edges at x = 0 (centers (0,20,10), (0,0,5),
(0,40,5), (0,20,0)) — the report points at the hole.

Coverage: ran; all input forms; tolerance tried smaller and larger than the gap; default
measured at four scales; orientation; bad sets; realistic block, tube with caps, torus.
