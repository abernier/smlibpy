// SPDX-License-Identifier: Apache-2.0
//
// Trimming and splitting faces with curves that lie on them (trim.cpp). Plain C++, shared by the
// Python extension and the JavaScript module.

#pragma once

#include <vector>

class SmBrep;
class SmCurve;

namespace smlibpy {

// A copy of a body whose faces are trimmed by curves that lie on them (SmBrep::TrimSurfaces): each
// curve is cut where it passes from one face to another, and each piece merged into its face.
// `trim_type` 0 keeps the side of the curves nearest to `point` (x, y, z), 1 removes it, 2 splits
// the faces and keeps both sides. `tolerance`: how far the curves may lie off the faces. The curves
// are not consumed. Owned by the caller.
SmBrep* trim_with_curves(const SmBrep* brep, const std::vector<SmCurve*>& curves, const std::vector<double>& point,
                         int trim_type, double tolerance);

}  // namespace smlibpy
