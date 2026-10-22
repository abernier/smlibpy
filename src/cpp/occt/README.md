# OpenCASCADE `.brep` bridge (from usd-brep)

smlibpy reads and writes OpenCASCADE's `.brep` files (`import_brep`, `export_brep`; in
JavaScript `importBrep`, `fromBrep`, `exportBrep`, `toBrep`) with the bridge NVIDIA's usd-brep
ships between that format and its BrepArray arrays. The bridge needs no OpenCASCADE: it parses
and writes the files itself. Its sources are copied here from the usd-brep submodule
(`third_party/usd-brep`, Apache-2.0, release 1.0.0, commit c9c5979) and compiled into the Python
extension and the WebAssembly module (`CMakeLists.txt`, `js/CMakeLists.txt`, the
`SMLIBPY_OCCT_SOURCES` lists); smlibpy's own code around them is `src/cpp/occt.cpp` (reading:
parse, stage, check the arrays, build SMLib bodies as `usd.cpp` does) and
`src/cpp/occt_pcurves.cpp` (writing: the curves of edges in the parameters of their faces).

| Copied from `source/` | Files |
|---|---|
| `OCCT_BREP_IMPORT` | `OcctAsciiParser`, `OcctBinaryParser`, `OcctFileRecords.h`, `OcctFileSource`, `OcctGeometryConvert`, `OcctStagingDriver` (not `OcctFileConverter`, which writes USD stages) |
| `OCCT_BREP_EXPORT` | `OcctAsciiWriter`, `OcctExport`, `UsdBrepToOcctModel` |
| `BREP_STAGING` | all of it (`BrepUsdWriter` without its USD stage writer) |
| `BREP_USD_DATA` | `UsdBrepBuilder` (`UsdBrepArrayData` and the headers are in `src/cpp/usd`) |
| `USD_BREP_UTILS` | `UsdBrepGeometryEval`, `UsdBrepIterator`, `UsdBrepKnots`, `UsdBrepPacking`, `UsdBrepTopologyQueries`, `UsdBrepUtilsConfig.h` |

`pxr/base/...` holds headers in place of OpenUSD's that the copied files include: each includes
`src/cpp/usd/pxr_lite.h`, which has the few OpenUSD types they use (ranges, 4 x 4 matrices,
spans, with OpenUSD's semantics).

The files are as published except these, each with a notice at its top (Apache License 2.0,
section 4(b)) and every change marked `smlibpy:` in a comment:

| File | Change | Why |
|---|---|---|
| `BrepUsdWriter.h`, `BrepUsdWriter.cpp` | `StagedBrepUsdWriter::WriteBrepArrayPrim` and the includes of OpenUSD's stages left out | it writes a prim of an OpenUSD stage |
| `OcctStagingDriver.cpp` | the faces of every shell of a solid take their sense in the solid (`bExpectedShellSame` is true) | the staging read every cavity inside out: a box with a box-shaped cavity, written by OpenCASCADE with a forward or a reversed inner shell, came in with its cavity as a second solid (volume 9000 for 7000, "Bad Inner shells") |
| `UsdBrepToOcctModel.cpp` | every shell of a solid is written forward | the inner shells were written reversed over faces that already face out of the material: OpenCASCADE read a box with a cavity at volume 9000 for 7000 |
| `UsdBrepToOcctModel.cpp` | the u offset of a re-aligned cylinder or cone frame is a whole number of periods | it was the sum of the face's u range, right only for a whole turn: the curves of a quarter cylinder (a fillet) came out a quarter turn from their edges |
| `UsdBrepToOcctModel.cpp` | where every coedge of a face has a pcurve: a degenerate edge where a loop jumps along a pole (as OpenCASCADE writes spheres and cones), the wires of a face whose loops run clockwise in its surface's parameters turned (with its seams' two pcurves and its references in shells) | without them OpenCASCADE read spheres, tori and concave faces (the inner side of their surface, as SMLib keeps a concave fillet) as invalid faces, some of the wrong volume |
| `UsdBrepToOcctModel.cpp` | the faces of an open component that share no edge go into shells of their own in a compound | OpenCASCADE took one shell of them for invalid ("NotConnected") |
| `UsdBrepToOcctModel.cpp` | where one coedge of a loop ends at another vertex than the next starts, at the same place within the tolerance, the two are written as one vertex | SMLib keeps such twins (a STEP file's corner made twice); OpenCASCADE takes a wire whose edges do not share their vertices for one that does not close |

The rest of what the writer needs, it gets from `occt_pcurves.cpp`: the BrepArray arrays SMLib's
conversion makes carry trim curves for B-spline faces only, in SMLib's parameters of the curve;
the writer made curves for analytic faces only where an edge runs along a parameter line. Every
edgeuse of a curved face now gets a curve that runs with its edge's own parameter, on the right
side of each seam.

To update to a new usd-brep release, copy the files again and apply the marked changes where
the defects are still there; then read the corpus of `third_party/usd-brep/TestFiles/occt_breps`
and the files of the tests back, and check what `export_brep` writes with OpenCASCADE
(`tests/test_lane_IX.py` holds OpenCASCADE's figures for its files).
