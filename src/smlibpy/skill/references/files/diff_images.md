# diff_images

Compares two pictures of the same size pixel by pixel: how many pixels changed, where, and a
picture with the changes in red. For before/after checks of a model change.

## Signature
`diff_images(a, b, tolerance=0)`

- `a`, `b`: pictures from `render`, PNG bytes, PNG file paths, or `(height, width, 3)` `uint8`
  arrays, in any mix.
- `tolerance`: the largest difference per color channel (0 to 255) that still counts as the
  same. 0 (default) because renders are deterministic: the same model gives the same pixels.

## Returns
An `ImageDiff` with
- `changed`: the number of pixels that differ, `total`, `fraction` (`changed / total`),
- `bbox`: `(x0, y0, x1, y1)` of the changed pixels, inclusive, or `None` when nothing changed,
- `picture`: a `Picture` (PNG bytes with `.pixels`) of `b` faded to light gray with the changed
  pixels red; `.save(path)` writes it.

## Use it with a pinned frame
`render` fits every picture to its model. When the model changes, the fit changes and every
pixel moves, so render the second picture with the frame of the first:
```python
part = Box(40, 30, 10)
before = render(part)
after = render(part - Cylinder(3, 20).translate(12, 0, 0), frame=before)
d = diff_images(before, after)
print(d.changed, round(d.fraction, 4), d.bbox)   # 3526 0.0073 (477, 286, 563, 336)
d.save("diff.png")
```
Same view, same size, same `supersample`. A change that is not visible in the view does not
show: a hole inside a box seen shaded from the side changes nothing; use `lines=True`,
`xray=True` or a `section` for inner changes.

In the MCP server: `snapshot(...)` reports `frame: {...}`; a later
`snapshot(frame={...}, compare="<path of the earlier PNG>")` reports the changed pixels and adds
the red picture.

## Errors
- `ValueError: diff_images: the pictures differ in size (...)`.
- `ValueError: not a PNG file`; `only 8-bit, non-interlaced gray, RGB and RGBA PNG files can be
  read` for other PNG kinds.

## Related
`render` (`frame=`, `Picture.frame`).
