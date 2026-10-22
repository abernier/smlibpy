// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's lofts with end tangents and closed lofts (skins.cpp). Plain C++, shared by the Python
// extension and the JavaScript module.

#pragma once

#include <vector>

class SmBrep;
class SmCurve;

namespace smlibpy {

// A skin (loft) through sections, each a loop or chain of curves: `counts[i]` curves of `curves` for
// section i, joined into one curve each. `degree` along the skin. `start_tangent` and `end_tangent`
// (x, y, z, or empty): the direction the skin leaves the first section in and arrives at the last in
// (the kernel's cross-boundary derivative strips: the section moved along the direction). With
// `closed` the skin runs on from the last section to the first, smoothly (C1) where it closes (no
// tangents then). With `cap_ends` (closed sections, not `closed`) the ends are capped with planar faces
// (a solid), otherwise the result is a sheet. `deviation[0]` and `[1]` get the largest angle (radians)
// between the skin's direction across its first and last section and the asked-for tangent (0 where
// none was asked for): the kernel drops the tangents silently where it cannot meet them. The caller
// owns the result; throws where the kernel cannot skin.
SmBrep* skin(const std::vector<SmCurve*>& curves, const std::vector<unsigned long>& counts, unsigned degree,
             const std::vector<double>& start_tangent, const std::vector<double>& end_tangent, bool closed,
             bool cap_ends, double deviation[2]);

}  // namespace smlibpy
