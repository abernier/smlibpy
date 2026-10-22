// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's removal of sliver faces (slivers.cpp). Plain C++, shared by the Python extension and
// the JavaScript module.

#pragma once

#include <vector>

class SmBrep;
class SmFace;

namespace smlibpy {

// A copy of `brep` without `faces` (faces of `brep` that enclose no area), stitched into a solid
// again: the edges of the faces around them are glued together within `tolerance` at most. The
// caller owns the copy; where the kernel cannot (an edge left with a face on one side only, no
// solid) it throws.
SmBrep* remove_slivers(const SmBrep* brep, const std::vector<SmFace*>& faces, double tolerance);

}  // namespace smlibpy
