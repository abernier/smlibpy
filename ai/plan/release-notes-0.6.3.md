# smlibpy, smlibwasm and smlibpy-three 0.6.3

A patch release. Code written for 0.6.2 runs unchanged.

Everything applies to smlibpy (Python) and smlibwasm (JavaScript and TypeScript) alike, unless
marked *Python*, *smlibwasm* or *smlibpy-three*.

## Added

- *Python*: `machining_setup` lays a part on a 3-axis router, the tool coming from a face, an axis
  or a vector, and sorts its faces into the layers a CNC shop reads from a DXF: `OUTLINE` (the
  footprint, exact for parts cut from flat stock), `THROUGH` (the holes), `POCKET_D<depth>` (the
  pockets open on the top face, by depth, islands kept, stepped pockets on several layers) and
  `LABEL` (a text and a grain arrow). What the setup cannot cut comes back with the reason and the
  direction another setup needs: a pocket of the other face, a mortise in an edge, a void, a face
  no vertical cutter follows. `export_dxf(setup.layers, path, curves="arcs")` writes the file.
  The smlibwasm port is still to come.

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
