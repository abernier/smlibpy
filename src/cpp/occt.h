// SPDX-License-Identifier: Apache-2.0
//
// OpenCASCADE's .brep files (occt.cpp): the B-rep format of OpenCASCADE and of the tools built on it
// (build123d, CadQuery, FreeCAD's Part), read and written through the bridge of NVIDIA's usd-brep
// (src/cpp/occt): an OCCT shape becomes the BrepArray arrays of a USD body, which become an SMLib body
// as usd.cpp's do, and back. Plain C++, shared by the Python extension and the JavaScript module.

#pragma once

#include <string>
#include <vector>

class SmBrep;
namespace UsdBrepData {
class UsdBrepArrayData;
}
namespace occt {
struct SOcctModel;
}

namespace smlibpy {

struct OcctReadOptions
{
    bool heal = false;   // run the kernel's import healer on the bodies
    bool check = true;   // check each body with the kernel (SmBrep::AssertValid) before anything measures it;
                         // one with gaps above 1e-3 of its size is refused
};

// The bodies of a .brep file and what was noted on the way.
struct OcctRead
{
    std::vector<SmBrep*> bodies;          // the caller's: one per solid, shell or face of the file, in its order
    std::vector<std::string> warnings;    // small gaps, parts of the file that are not read (curves, points, ...)
};

// The bodies of a .brep file's contents, ASCII (BRepTools) or binary (BinTools): one per solid, shell
// and face of its shape (a compound's in its order), placed as the file has them (its locations), with
// their exact curves and surfaces (planes, cylinders, cones, spheres, tori, B-splines, ...). A file that
// cannot be read throws std::invalid_argument saying why; a shape the kernel cannot build,
// std::runtime_error.
OcctRead occt_read(const std::string& data, const OcctReadOptions& options);

// The ASCII .brep text (BRepTools, "CASCADE Topology V3") of bodies: one shape, a compound when there
// are several. Breps are not changed. Throws std::runtime_error when a body cannot be converted, or when
// the text written would not read back.
std::string occt_text(const std::vector<SmBrep*>& breps);

// (occt_pcurves.cpp) Every edgeuse of a curved face of the arrays gets its trim curve in the parameters of the
// face's surface, running with its edge's own parameter (OpenCASCADE's pcurves), each loop continuing from
// one edgeuse to the next across seams. Throws std::runtime_error where a loop cannot close.
void occt_trim_curves(UsdBrepData::UsdBrepArrayData& arrays);

// (occt_check.cpp) What OpenCASCADE's own check would find wrong with the faces of a shape about to be
// written ("" nothing): an edge without its curve on a curved face, a curve that strays from its edge by
// more than the edge's tolerance, a wire that does not close in its face's parameters, wires that run
// clockwise.
std::string occt_check(const occt::SOcctModel& model);

}  // namespace smlibpy
