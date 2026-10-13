# fillets

Selects the fillet faces among faces: rounds of convex edges, fillets of concave edges and the
corner patches where they meet. Found by geometry, so it works on imported parts too.

## Signature
`faces.fillets(max_radius=None)` on a `ShapeList`, mostly `part.faces().fillets()`.

- `max_radius`: keep only fillets of at most this radius. Not positive:
  `ValueError: fillets: max_radius must be positive`.

## What counts
- **Edge fillet**: a curved face that meets two faces tangentially (normals within 2 degrees)
  along edges that run across its curvature (its rails), where those two faces are walls, not
  fillets. Circular rounds (cylinders), ring fillets around a boss or a hole (surfaces of
  revolution), variable-radius fillets and G2/G3 blends (B-splines) all count.
- **Corner patch**: a curved face with three or more edges, all tangential, that joins two or
  more edge fillets and is curved about as tightly as they are: the 8 spheres of a box rounded
  on every edge, the 4 saddle patches at the foot of a rounded rectangular boss.
- **Not**: planes; hole walls and bosses (their edges are sharp); the side of a disc rounded at
  both ends (its tangent edges run along its curvature); a whole sphere or torus (no edges).
- **Lookalikes**: the round ends of a slot or an obround plate are geometrically fillets with
  half the width as radius. `max_radius` below that keeps them out (`Slot(40, 12).extrude(5)`:
  2 fillets, 0 with `max_radius=5`).

## Radius
Measured where the face is curved most, at a point inside it:
- circular rounds: the fillet radius (3.0 for r 3);
- variable radius: the radius in the middle of the face (2.96 for 2..4, so `max_radius=3` keeps it);
- G2/G3 blends: their tightest curvature, smaller than the radius they were made with (1.97 for a
  G2 blend made with 3: `max_radius=2` still selects it);
- corner patches: the largest radius of the fillets they join.

`face.radius` works only on cylinders, spheres and tori. Ring fillets are surfaces of revolution:
`face.radius` raises `ValueError: a revolution face has no radius`; filter with `max_radius`.

## Returns
A `ShapeList` of the same `Face` objects, so other selectors chain: `.fillets().cylinders()`,
`.fillets().top()`. A plain box gives an empty list. About 1 ms for 26 faces.

## Example
```python
box = Box(40, 30, 20)
rounded = box.fillet(box.edges(), 3)              # 12 rounds, 8 corner spheres
found = rounded.faces().fillets()
print(len(found), len(found.cylinders()))         # 20 12
print(len(rounded.faces().fillets(max_radius=2))) # 0: all are r 3

disc = Cylinder(10, 8)
disc = disc.fillet(disc.edges(), 2)
print([f.geom_type for f in disc.faces().fillets()])   # ['revolution', 'revolution']: the side is a wall

slot = Slot(40, 12).extrude(5)                    # round ends look like r 6 fillets
print(len(slot.faces().fillets()), len(slot.faces().fillets(max_radius=5)))  # 2 0
```

## Related
`remove_fillets` (takes them out), `fillet`, `selection/convexity` (`smooth()` edges are the
rails of fillets).
