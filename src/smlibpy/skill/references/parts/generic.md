# Part

A `Part` is a solid: one or more closed bodies held in one kernel Brep. Primitives, extrusions,
revolves, lofts, sweeps and Booleans return Parts.

## Making one

You never call `Part()` (it raises `TypeError: create a Part with the constructors`). Use
`Box`, `Cylinder`, `Cone`, `Sphere`, `Torus`, `Wedge`, `sketch.extrude(...)`,
`sketch.revolve(...)`, `loft`, `sweep`, or combine parts with `+`, `-`, `&`.

Every operation returns a new Part; the input is unchanged. Reassigning is the normal style:
`plate -= Cylinder(3, 20)`.

## What a Part knows

| Member | Returns | Notes |
|---|---|---|
| `volume`, `area` | float | exact integration, relative accuracy about 1e-7 |
| `center()` | Vector | center of mass, not the bbox center |
| `bbox()` | BoundBox | tight; `.min`, `.max`, `.size` |
| `is_valid()` | bool | closed manifold solid with a positive volume; see the gotchas |
| `solids()` | ShapeList[Part] | the separate bodies (also one inside a cavity of another), each with the part's name and color |
| `info()` | dict | `type`, `faces`, `edges`, `vertices` (kernel counts, seams included), `bbox`, `solids`, `voids` (cavities); for the result of `shell` or `offset` also `corners` (`"round"` or `"sharp"`) |
| `faces()`, `edges()`, `vertices()` | ShapeList | see `selection/*` |
| `name`, `color` | None by default | set with `named()` / `colored()` |
| `repr(part)` | `Part('plate', 10 faces, volume=18295.2)` | |

## Name and color

`part.named("plate")` and `part.colored("steelblue")` return the part with that metadata (a new
shape that shares the kernel body: no copy, its measures already known). Exporters (STEP, glTF)
and the viewer use them. With `faces=...` they name or color single faces instead (see
`files/face_colors`). Colors: one of about 60 CSS names (`"red"`,
`"steelblue"`, `"gold"`, ...), `"#4682b4"`, `"#48b"`, or a tuple `(r, g, b)` in 0..1 (any value
above 1 switches to 0..255).

Metadata survives `translate`, `rotate`, cuts and `solids()`. A Boolean keeps the left
operand's name and color: `Cylinder(2, 10).colored("red") + plate` is red and unnamed. Name
and color the finished part last.

## Several bodies in one Part

Fusing disjoint parts, or a cut that splits a part, gives one Part with several bodies.
`len(part.solids())` tells you how many. `sum([...])` of parts works. Before delivering a
part that should be one piece, check `len(part.solids()) == 1`.

## Gotchas

- `info()["edges"]` counts seam edges; `len(part.edges())` does not (a cylinder: 3 vs 2).
- `repr` computes the volume with accuracy 1e-5 and prints six digits, so the last digit can
  be off (`Torus(20, 4)`: repr 6316.8, `.volume` 6316.548). Use `.volume` for numbers.
- `is_valid()` can be True for a wrong body: a sweep whose profile overlaps itself counts the
  overlap twice. Compare the volume with a formula as well.
- A fuse where a face only touches a curved face (tangent contact) raises `ModelingError`.
  See `booleans`. Fillet, chamfer, shell and offset refuse an invalid part.
- A cut or intersection can return an empty Part (0 faces, volume 0, `is_valid()` False)
  without an error.
- `solids()` separates a body that floats inside a cavity of another (a captive part) from it;
  the touching cells of a merged part stay one solid.
- `colored()` accepts any value; an unknown color name fails only at export
  (`ValueError: unknown color 'lightgreen'`).
- `part.name = "x"` mutates the part in place. Use `named()`.
- Primitive size errors are `ValueError`, not `ModelingError`. Kernel failures are
  `KernelError` (a `ModelingError`).

## Example

```python
plate = Box(60, 40, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
plate -= GridLocations(40, 20, 2, 2) * Cylinder(3, 20)
plate = plate.named("plate").colored("steelblue")
print(plate)                      # Part('plate', 10 faces, volume=18295.2)
print(plate.is_valid(), round(plate.volume, 3), len(plate.solids()))
print(plate.info())

pair = Box(10, 10, 10) + Box(10, 10, 10).translate(30, 0, 0)
print(len(pair.solids()), [round(s.volume, 3) for s in pair.solids()])   # 2 [1000.0, 1000.0]
pins = sum(Cylinder(2, 10).translate(i * 10, 0, 0) for i in range(4))    # one Part, 4 bodies
print(len(pins.solids()))
```

## Related

`Box`, `Cylinder`, `Cone`, `Sphere`, `Torus`, `Wedge`, `booleans`, `Hole`;
`analysis/*` for mass properties and distances; `selection/*` for faces and edges.
