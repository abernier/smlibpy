// SPDX-License-Identifier: Apache-2.0
//
// USD files of exact bodies (usd.cpp): the BrepArray prims of NVIDIA's omniSolid schema (usd-brep's
// format), read and written as .usda text. Plain C++, shared by the Python extension and the
// JavaScript module.

#pragma once

#include <map>
#include <string>
#include <vector>

class SmBrep;
namespace UsdBrepData {
class UsdBrepArrayData;
}

namespace smlibpy {

// One shape of a stage.
struct UsdItem
{
    SmBrep* brep = nullptr;         // a body (written: not changed; read: the caller's); none: a mesh only
    std::string name;               // the prim's name
    std::vector<double> color;      // r, g, b from 0 to 1, or nothing
    std::vector<double> points;     // a mesh to write next to the body: x, y, z per point
    std::vector<long> triangles;    // and three point indices per triangle (counterclockwise from outside)
    std::vector<double> normals;    // and a normal per triangle corner (x, y, z), or nothing (computed)
    std::vector<double> face_colors;  // and r, g, b per triangle (the colors of the body's faces, kernel
                                      // plan T5), or nothing: `color` for all
};

// The .usda text of a stage: under /World, a BrepArray prim per item with a body (the exact B-rep),
// and a Mesh prim per item with a mesh (for tools that do not read B-reps), named after the items.
// up_axis "Y" or "Z"; meters_per_unit: 0.001 for millimetres. materials: a Material with a
// UsdPreviewSurface of each color under /World/Looks, bound to the prims of the items of that color.
std::string usd_text(const std::vector<UsdItem>& items, const std::string& up_axis, double meters_per_unit,
                     bool materials = false);

// The assets a .usda text names (its subLayers, the references and payloads of its prims), each once,
// as written: the layers a caller reads for usd_stage.
std::vector<std::string> usd_assets(const std::string& text);

// One layer of a stage: its .usda text, and what the caller read for each asset it names (usd_assets):
// the id of that layer, or why none was read (the file is not there, it is binary USD, ...).
struct UsdLayer
{
    std::string id;  // the layer's name in messages (its path)
    std::string text;
    std::map<std::string, std::string> links;    // asset as written -> id of the layer read for it
    std::map<std::string, std::string> missing;  // asset as written -> why no layer was read
};

struct UsdReadOptions
{
    bool heal = false;       // run the kernel's import healer on the bodies
    bool check = true;       // check each body with the kernel (SmBrep::AssertValid) before anything measures
                             // it; one with gaps above 1e-3 of its size is refused (not those smlibpy wrote)
    bool placement = true;   // place the bodies as the stage does: the transforms of their prims and of the
                             // prims above them (xformOps), and the stage's up axis turned to Z
    double units = 0.0;      // millimeters per unit of the stage; 0: its metersPerUnit (as it is if it has none)
    bool partial = false;    // leave out the bodies that cannot be read (UsdStage::skipped says why) instead of
                             // throwing for the first one
};

// The bodies of a stage and what was noted on the way. A body's color is that of the material bound to
// it (the diffuseColor of its UsdPreviewSurface), or else its prim's displayColor.
struct UsdStage
{
    std::vector<UsdItem> items;
    std::vector<std::string> warnings;    // bodies with small gaps, transforms that have no value, ...
    std::vector<std::string> unresolved;  // subLayers, references and payloads that were not read
    std::vector<std::string> skipped;     // (partial) the bodies left out and why: "body 1 of the BrepArray
                                          // \"/World/ball\" could not be built (SM_ERR)", "the BrepArray ... is malformed: ..."
};

// The bodies of the BrepArray prims of a stage, layers[0] its root layer: composed (subLayers, references
// and payloads; class, inactive and over-only prims hold none), in the order of the stage, named after
// their prims (by path where two have one name; a prim that holds several: prim, prim_1, ...), placed
// and in millimeters, their B-spline edges that are lines and circles made analytic again (not in bodies
// smlibpy wrote, whose edges are written as they are). A malformed
// BrepArray throws std::invalid_argument naming the prim, the body, the face or edge and the rule of
// usd-brep's validator (a body the kernel cannot build, std::runtime_error); with options.partial such
// bodies are left out instead (UsdStage::skipped).
UsdStage usd_stage(const std::vector<UsdLayer>& layers, const UsdReadOptions& options);

// The bodies of every BrepArray prim of a .usda text, in the order of the file (a BrepArray prim may
// hold several: they are named prim, prim_1, ...), checked (see usd_stage), as the file has them
// (without transforms or units). heal: run the kernel's import healer on them.
std::vector<UsdItem> usd_read(const std::string& text, bool heal);

// The checks usd_stage makes, for readers of other files that build their bodies through the BrepArray
// arrays (occt.cpp). usd_check_arrays: what is wrong with the arrays against the rules of usd-brep's
// validator that its conversion relies on ("" nothing; directions made unit as usd_stage does).
// usd_kernel_check: the kernel's check of a body built from them (SmBrep::AssertValid), "" when it finds
// nothing; `refuse` when a gap is more than 1e-3 of the body's size or not a number.
std::string usd_check_arrays(UsdBrepData::UsdBrepArrayData& a);
std::string usd_kernel_check(SmBrep* brep, bool& refuse);

// The tolerances of each edge, vertex and face of a body built from the arrays, made what its geometry
// needs where the arrays' one tolerance for the body is larger (usd_stage and occt_read call it before
// the check).
void usd_tighten_tolerances(SmBrep* brep);

}  // namespace smlibpy
