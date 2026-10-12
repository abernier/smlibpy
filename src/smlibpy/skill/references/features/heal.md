# heal

Runs the kernel's B-rep healer on a copy of a part or shell.

## Signature
`part.heal()` (also `Shell.heal()`, `Sketch.heal()`). No parameters.

## Returns
A new body of the same type. What the healer does: adjusts tolerances to measured gaps,
merges coincident vertices, removes degenerate pieces, repairs periodic seams. It does not
close real gaps, refit curves or rebuild faces.

## When to call it
- On data from outside: an imported STEP whose `is_valid()` is False, or that fails in a later
  Boolean or fillet. Try `heal()`, then check `is_valid()` and the volume again.
- Not as a fix for a failed feature: a healed bad result is still bad. Fix the input of the
  feature instead.
- On clean parts it changes nothing measurable (same faces, volume to 1e-6) and costs a few
  milliseconds; there is no need to call it after normal modeling.

## Example
```python
part = Box(40, 30, 20) - Cylinder(8, 30)
fixed = part.heal()                                     # same volume, same faces on clean parts
print(fixed.is_valid(), round(fixed.volume, 3))         # True 19978.761
```

## Related
`import_step`, `is_valid`, `to_nurbs`, `stitch` (faces to a solid).
