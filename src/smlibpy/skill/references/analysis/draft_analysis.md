# draft_analysis

Measures the draft of every face of a part for a pull direction and sorts the faces by whether
they release from a mold half (or a casting pattern) that moves away along that direction.

## Signature
`part.draft_analysis(direction, *, min_angle=1.0) -> DraftAnalysis`

- `direction`: the pull direction, an `Axis` (`Z`) or a vector (`(0, 0, 5)`; length does not
  matter). Zero raises `ValueError: draft_analysis: the direction must not be zero`.
- `min_angle`: the draft a face needs, in degrees, at least 0 and below 90
  (`ValueError: draft_analysis: min_angle must be at least 0 and less than 90 degrees`).

The draft angle at a point is the angle between the face and the direction:
`asin(n . d)` for the outward normal `n`. +90 where the face looks along the direction, 0 on a
wall parallel to it, negative where it turns away.

## Returns
A `DraftAnalysis`:
- `positive`: faces with at least `min_angle` everywhere (they release);
- `insufficient`: nowhere negative, but less than `min_angle` somewhere;
- `vertical`: 0 everywhere (within 1e-6 degrees): walls along the direction, they need draft;
- `undercut`: negative somewhere: the face turns away from the direction and locks that mold half;
- `faces`: one `FaceDraft(face, min_angle, max_angle, kind)` per face; iterate the analysis
  itself (`for fd in da`), `len(da)`;
- `angles(face)`: `(least, greatest)` draft of a face of the part, in degrees;
- `ok`: every face positive; `direction` (unit), `min_angle`.

The four groups are `ShapeList`s of the part's own faces: chain selectors on them, pass them on
as a selection (to highlight them in a picture, or to `remove_faces`).

## Accuracy
Planes, cylinders and cones are exact: a 3 degree taper reads 3.000000000, a cone with radii 10
and 5 over 20 reads 14.036243468 (atan(5/20)). Other faces are sampled on a grid of their
parameters and along their edges, then the least and greatest values are refined. 1 to 4 ms per
part for the examples here.

## Gotchas
- One pull direction: every face that turns away from it is an `undercut`, the bottom of a box
  too (-90). For a two-part mold run it twice: faces positive for `Z` come out of the upper half,
  faces positive for `-Z` out of the lower half, the parting line divides them. A face positive
  in neither needs draft (see `recipes/mold-check`).
- Curved faces that turn over (a sphere: -90 to 90, a cylinder lying across the direction) are
  `undercut` for either direction: the parting line runs through them. Their angles go to 0 at
  the line, so their halves are at best `insufficient` near it (a hemisphere: 0 to 90).
- The draft is judged by each face's own normals. Whether another part of the body hides a face
  from the mold half (the inside of a closed cover, a groove under an overhang) is not checked;
  more than one parting line on a simple part points to such faces.

## Example
```python
core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)
da = core.draft_analysis(Z, min_angle=1)
print(da)        # DraftAnalysis(direction=(0, 0, 1), min_angle=1: 9 positive, 0 insufficient, 0 vertical, 1 undercut)
wall = da.positive.filter(lambda f: f.geom_type == "plane" and f.center().z < 19).first
print(da.angles(wall))                            # (3.0..., 3.0...): the taper
print(core.draft_analysis(Z, min_angle=5).insufficient.__len__())   # 8 walls with less than 5 degrees

box = Box(40, 30, 20)
check = box.draft_analysis(Z)
print(len(check.vertical), len(check.undercut), check.ok)          # 4 1 False: the walls need draft
for fd in Sphere(10).draft_analysis(Z):
    print(fd.kind, round(fd.min_angle, 6), round(fd.max_angle, 6))  # undercut -90.0 90.0
```

## Related
`parting_line`, `recipes/mold-check`, `extrude` (`taper=` drafts walls), `features/draft`,
`silhouette`.
