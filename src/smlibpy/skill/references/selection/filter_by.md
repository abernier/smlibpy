# filter_by, filter

Keep the shapes that pass a test.

## Signature
- `sl.filter(predicate)`: keeps `s` where `predicate(s)` is true. Works on any shapes.
- `sl.filter_by(criterion)`: dispatches on the argument type:
  - an `Axis` (`X`, `Y`, `Z`, `-Z`, `Axis(...)`) → `parallel_to(axis)`
  - a `str` → `of_type(name)` (case-insensitive: `"CYLINDER"` works)
  - anything else → `filter(criterion)`

## Returns
A new ShapeList in the original order. Empty when nothing passes; no error.

## Faces versus edges
`filter_by(Z)` is `parallel_to(Z)`, which means different things:
- edges: straight edges running along Z (the vertical edges of a box);
- faces: planar faces whose normal is along Z (the top and bottom faces).
See `parallel_to`. A string selects surface types on faces (`"plane"`, `"cylinder"`, ...) and curve
types on edges (`"line"`, `"circle"`, ...); see `types`.

## Gotchas
- `filter_by((0, 0, 1))` and `filter_by(Plane.XY)` do not work: the tuple or plane is treated as
  a function, `TypeError: 'tuple' object is not callable`. Pass an Axis (`Z`) or call
  `parallel_to((0, 0, 1))`, which accepts vectors.
- Unknown type names (`"arc"`, `"cylindrical"`) silently match nothing.
- A predicate that raises stops the whole selection: `lambda e: e.radius > 2` raises
  `ValueError: not a circular edge but a line` on the first line. Narrow first:
  `edges().circles().filter(lambda e: e.radius > 2)`, or test `e.geom_type` in the predicate.
- Compare floats with a tolerance in predicates (`abs(f.radius - 6) < 1e-6`, `abs(z - 8) < 1e-6`):
  face centers are integrated and carry noise in the last digits (8.5e-11 off the axis on a
  cylinder's side face).
- `filter` is the escape hatch for everything the named selectors cannot say: by length, radius,
  area, a coordinate range, `is_closed`, distance to a point.

## Useful predicates
```python
part = Box(40, 30, 16, align=(Align.CENTER, Align.CENTER, Align.MIN)) - Cylinder(3, 40) - Cylinder(6, 40).translate(12, 0, 0)
print(len(part.edges().filter(lambda e: e.geom_type == "line" and e.length > 35)))   # 4
print(len(part.faces().cylinders().filter(lambda f: abs(f.radius - 3) < 1e-6)))     # 1: holes of r 3
print(len(part.edges().circles().filter(lambda e: e.is_closed)))                    # 4: full circles only
print(len(part.edges().filter(lambda e: abs(e.center().z - 8) < 1e-6)))             # 4: edges at z = 8
```

## Example
```python
part = Box(40, 30, 20) - Cylinder(6, 30)
print(len(part.edges().filter_by(Z)))                        # 4  (= parallel_to(Z))
print(len(part.edges().filter_by("circle")))                 # 2  (= of_type("circle"))
print(len(part.faces().filter_by(lambda f: f.area > 700)))   # 5  (= filter(...))
long_x = part.edges().filter(lambda e: e.geom_type == "line" and e.length > 35)
print(len(long_x))                                           # 4
```

## Related
`parallel_to`, `types` (`of_type`), `generic`.
