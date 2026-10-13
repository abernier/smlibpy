// SPDX-License-Identifier: Apache-2.0
//
// USD files of exact bodies (usd.cpp): the BrepArray prims of NVIDIA's omniSolid schema (usd-brep's
// format), read and written as .usda text. Plain C++, shared by the Python extension and the
// JavaScript module.

#pragma once

#include <string>
#include <vector>

class SmBrep;

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
};

// The .usda text of a stage: under /World, a BrepArray prim per item with a body (the exact B-rep),
// and a Mesh prim per item with a mesh (for tools that do not read B-reps), named after the items.
// up_axis "Y" or "Z"; meters_per_unit: 0.001 for millimetres.
std::string usd_text(const std::vector<UsdItem>& items, const std::string& up_axis, double meters_per_unit);

// The bodies of every BrepArray prim of a .usda text, in the order of the file (a BrepArray prim may
// hold several: they are named prim, prim_1, ...). heal: run the kernel's import healer on them.
std::vector<UsdItem> usd_read(const std::string& text, bool heal);

}  // namespace smlibpy
