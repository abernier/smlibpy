# draft

Drafting faces of an existing part is **not available**. `Part.draft(faces, angle, neutral_plane)`
exists but always raises:

`NotImplementedError: face drafts are not available in the open-source kernel yet; use Sketch.extrude(taper=...) for drafted extrusions`

Build drafted walls into the shape instead.

## All side walls: tapered extrusion
`sketch.extrude(amount, taper=deg)`: positive `taper` narrows away from the sketch. Exact:
a `RoundedRectangle(60, 40, 5)` with `taper=3` over 20 is 57.904 wide at the top
(60 − 2·20·tan 3°). Rounded corners stay rounded. See `extrude` for the limits; **holes in the
profile are lost with taper**, cut them as their own tapered extrusions.

## Pockets and bosses with draft
A tapered tool from a face: `Rectangle(30, 20).on(top).extrude(-10, taper=5)` is 30 x 20 at the
face and 28.25 x 18.25 at the bottom (it narrows away from the face), which is the usual mold
draft for a pocket. Subtract it.

## One wall only: split with a tilted plane
Put a plane through the edge where the draft starts (the neutral line), tilt its normal by the
draft angle, point the normal into the part and keep "above". See `split`.

## Other ways
- `loft` between the bottom outline and a smaller top outline (`ruled=True` for flat walls).
- Rotated tool bodies subtracted from the part.

## Example
```python
# draft
core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)  # every side wall drafted 3 degrees
blk = Box(60, 40, 20)
blk -= Rectangle(30, 20).on(blk.faces().top()).extrude(-10, taper=5)  # pocket 30x20 at the top, narrower at the bottom
```
One drafted wall:
```python
wall = Box(40, 30, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
a = math.radians(5)
drafted = wall.split(Plane(origin=(20, 0, 0), z_dir=(-math.cos(a), 0, -math.sin(a))))
print(round(drafted.volume, 3))                         # 23475.068
```

## Related
`extrude` (taper), `split`, `loft`.
