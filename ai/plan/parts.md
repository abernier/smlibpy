# Plan: parts

Parts: primitives, holes, Booleans and the Part class.

Docs go to `src/smlibpy/skill/references/parts/`. Work through the rows in order.

| # | Doc | APIs | Must cover | Done |
|---|---|---|---|---|
| 1 | `generic.md` | Part | what a Part is, named/colored/name/color, info(), is_valid(), solids(), several bodies in one Part, repr | [ ] |
| 2 | `Box.md` | Box | sizes, align, placement, zero or negative sizes | [ ] |
| 3 | `Cylinder.md` | Cylinder | radius, height, align, angle (partial cylinder) if any | [ ] |
| 4 | `Cone.md` | Cone | bottom/top radius, a point cone, align | [ ] |
| 5 | `Sphere.md` | Sphere | radius, partial spheres if any, align | [ ] |
| 6 | `Torus.md` | Torus | major/minor radius, align | [ ] |
| 7 | `Wedge.md` | Wedge | every parameter, the resulting shape | [ ] |
| 8 | `Hole.md` | Hole | how a hole is placed and cut (on a face? depth? through?), with GridLocations | [ ] |
| 9 | `CounterBoreHole.md` | CounterBoreHole | parameters, placement, measured dimensions | [ ] |
| 10 | `CounterSinkHole.md` | CounterSinkHole | parameters, angle, placement, measured dimensions | [ ] |
| 11 | `booleans.md` | fuse, cut, intersect, +, -, & | lists of tools, disjoint results (several solids), touching faces, coincident faces, tools that miss, failures and what to do | [ ] |
