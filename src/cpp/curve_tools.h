// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's curve tools (curve_tools.cpp): curve intersections with a tolerance, curve x face
// intersections, extended curves, and the kernel limits smlibpy raises at start. Plain C++, shared
// by the Python extension and the JavaScript module.

#pragma once

#include "value.h"

#include <vector>

class SmBSplineCurve;
class SmCurve;
class SmFace;

namespace smlibpy {

// Raise the kernel's limits that smlibpy does not want: NLib's cap on the control points of a
// spiral fit (NL_CCPLIM, 1000), which made helices of more than about 26 to 79 turns fail.
// Called once when the module loads.
void init_kernel_limits();

// Where two curves meet over [a0, a1] and [b0, b1], within `tolerance` (a 3D distance):
// [{"t": (ta, tb), "end": (ta1, tb1) or None, "distance": d}], "end" set where they overlap
// (from t to end). No solution is an empty list.
Value intersect_curves(const SmCurve* a, double a0, double a1, const SmCurve* b, double b0, double b1,
                       double tolerance);

// Where a curve crosses itself over [t0, t1]: [{"t": (ta, tb), ...}] as above, ta < tb.
Value self_intersections(const SmCurve* curve, double t0, double t1, double tolerance);

// Where a curve over [t0, t1] meets faces: [{"t": t, "face": index, "point": (x, y, z)}], one
// entry per point on a face (on its boundary too). Where the curve lies on a face's surface,
// the points where it starts and stops lying on the face.
Value intersect_curve_faces(const SmCurve* curve, double t0, double t1, const std::vector<SmFace*>& faces,
                            double tolerance);

// The curve made longer by `distance` at its start or end: SmBSplineCurve::CreateExtendedCurve,
// continuity 1 (G1: along the end tangent), 2 (G2: keeping the curvature) or 0 (the curve's own
// polynomial continued). A new standalone B-spline; the curve itself is not changed.
SmBSplineCurve* extend_curve(const SmCurve* curve, double distance, bool at_start, int continuity);

}  // namespace smlibpy
