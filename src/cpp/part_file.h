// SPDX-License-Identifier: Apache-2.0
//
// SMLib part files (.smp, part_file.cpp): the kernel's container of curves, surfaces and bodies with
// their attributes, read and written in memory. Plain C++, shared by the Python extension and the
// JavaScript module.

#pragma once

#include <string>
#include <vector>

class SmBrep;
class SmCurve;

namespace smlibpy {

// One item of a part file: a body or a curve.
struct PartItem
{
    SmBrep* brep = nullptr;      // a body (written: not changed; read: the caller's)
    SmCurve* curve = nullptr;    // or a curve (written: not changed; read: the caller's)
    std::string name;            // "" for none
    std::vector<double> color;   // r, g, b from 0 to 1, or nothing
    long wire = -1;              // a curve's wire: the number of the wire it is an edge of, -1 for none
};

// The contents of a part file (SmBrepData::WritePartToDB, ASCII or binary) of the items, in their
// order: copies of the bodies and curves, each with its color in the kernel's color attribute
// (SM_AI_COLOR, which SMLib's own tools read) and its name, place and wire in an attribute of
// smlibpy's.
std::string part_bytes(const std::vector<PartItem>& items, bool ascii);

// The items of a part file's contents (ASCII or binary, told apart by the first bytes): its bodies,
// its loose surfaces each as a sheet of one face over the whole surface, and its curves, in the
// order smlibpy wrote them (a file of another program: curves, surfaces, bodies, as the file has
// them). Throws std::invalid_argument for contents that are no part file, std::runtime_error for
// one the kernel cannot read.
std::vector<PartItem> part_items(const std::string& data);

}  // namespace smlibpy
