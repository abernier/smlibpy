// SPDX-License-Identifier: Apache-2.0
//
// The shells of a body: which faces bound the space around it, its cavities and its cells
// (shells.cpp, kernel plan T7). Plain C++, shared by the Python extension and the JavaScript module.

#pragma once

#include "value.h"

class SmBrep;

namespace smlibpy {

// Every shell of every region of a body, in the order of the regions: per shell a dict with "kind"
// ("outside": a shell of the space around the body; "void": of a cavity; "cell": of a closed region
// that is not a cavity, a cell of a merged part), "region" (the region's index), "cell" (the cell's
// index among the cells, as region_shells and Part.cells count them; -1 for the other kinds),
// "closed" and "faces" (the indices of the faces the shell uses, each once, in the Brep's order).
// A face between two cells is in a shell of each; one inside a cell (used from both sides) in one.
Value brep_shells(const SmBrep* brep);

}  // namespace smlibpy
