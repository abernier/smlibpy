# smlibpy and smlibwasm 0.6.1

A patch release: the fixes merged into `next` after 0.6.0. Code written for 0.6.0 runs unchanged.

Everything applies to smlibpy (Python) and smlibwasm (JavaScript and TypeScript) alike, unless
marked *Python* or *smlibwasm*.

## Fixed

- **`fill` closes a round hole whose rim touches the sheet's knot lines** (#32). SMLib builds the
  tangency along each side of a four-sided patch from a field of cross tangents, which returns its
  stored corner tangents within 1e-8 of its ends. It took its derivative across that zone. Where a
  side's first knot span was shorter than 1e-4, the patch's twist at that corner came out 1.85 to
  2.7 times too large, and the patch tilted off the sheet near the corner. A rim gets such a span
  where it touches the sheet's knot lines at the patch's corners, because the rim has knots
  there. On a paraboloid sheet with knots every 5, round holes of radius 5 at x 0, 5 and 7 and of
  radius 2.5 at x 2.5 were refused, 1.65 to 20.6 degrees off. The kernel patch takes the
  derivative between two points of the field itself, past those zones. They fill within 0.009
  degrees. Holes that filled before keep their patches: the same angles, and a sphere's caps
  within 2.5e-4 of their volume.
