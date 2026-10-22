// SPDX-License-Identifier: Apache-2.0
//
// The cells of a non-manifold body (cells.cpp). Plain C++, shared by the Python extension and the
// JavaScript module.

#pragma once

#include <vector>

class SmBrep;

namespace smlibpy {

// Every closed region of a body that is not a cavity (the cells of a merged part): the solid inside
// each of its shells, the outer shell's first, then its cavities'. Owned by the caller.
std::vector<std::vector<SmBrep*>> region_shells(const SmBrep* brep);

// Every cavity of a body (kernel plan T7): the solid inside its wall first, then the solids of the
// bodies floating in it (their outsides are the cavity's other shells). Owned by the caller.
std::vector<std::vector<SmBrep*>> void_shells(const SmBrep* brep);

}  // namespace smlibpy
