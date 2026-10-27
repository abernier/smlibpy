# heal

Runs the kernel's B-rep healer on a copy of a part or shell.

## Signature
`part.heal()` (also `Shell.heal()`, `Sketch.heal()`). No parameters.

## Returns
A new body of the same type; a `Shell` whose faces close around a volume once healed comes back
as a `Part` (the six faces of `Box(10, 10, 10)` added together as sheets with `+`: a `Shell`,
healed a valid `Part` of 1000.0; `stitch` makes them a `Part` itself). What the healer does:
adjusts tolerances to measured gaps,
removes degenerate pieces, repairs periodic seams. It does not merge vertices that lie on top of
each other (`import_step` makes one vertex per vertex of the file), close real gaps, refit curves
or rebuild faces.

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
`import_step`, `is_valid`, `analysis/check` (what is still wrong, and where), `to_nurbs`,
`stitch` (faces to a solid).
