# smlibpy, smlibwasm and smlibpy-three 0.6.3

A patch release. Code written for 0.6.2 runs unchanged.

Everything applies to smlibpy (Python) and smlibwasm (JavaScript and TypeScript) alike, unless
marked *Python*, *smlibwasm* or *smlibpy-three*.

## Added

- **Exploded views**: `render_exploded(parts, offsets)` (`renderExploded` in smlibwasm and
  smlibpy-three) draws an assembly with each part moved by its offset, the assembly axes dashed,
  numbered balloons and a parts list (number, name, count), in software like `render`, the text in
  the renderer's own capitals. `assembly_axes(parts, offsets)` gives the axes as numbers
  (`AssemblyAxis`): for every two parts that touch in the assembled model and move by different
  offsets, the centroid of their contact area and that point moved with each part. The contact is
  measured on the faces near it, tessellated, with the kernel's point classification: a peg of
  radius 5 in a hole 15 deep gives z = 11.4288 (11.428571 by hand) and 549.70 mm² (175π = 549.78).
  A part that touches no other is refused.

## Changed

- *Python*: the `test` and `docs` extras are ranges again, as before 0.6.2 (pytest 8 or later,
  websockets 13 or later; mkdocs-material 9.5 and mkdocstrings 0.26 or later). CI and the release
  build pin every package they install from PyPI in `uv.lock` instead, for every Python and
  platform, and Dependabot raises the lock once a week.
- The documentation's API reference is a folder of three pages: [Python](https://smlibpy.classcad.ch/docs/api)
  (where it was), [WASM](https://smlibpy.classcad.ch/docs/api/wasm) (smlibwasm's, out of the JavaScript
  page) and [three.js](https://smlibpy.classcad.ch/docs/api/three).
- *smlibpy-three*: its guide is a page of the documentation,
  [three.js](https://smlibpy.classcad.ch/docs/three), beside JavaScript (WASM); the README is
  shorter and links there, and `API.md` points to its API page.
