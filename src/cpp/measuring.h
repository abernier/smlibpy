// SPDX-License-Identifier: Apache-2.0
//
// Measuring queries the kernel answers loosely (measuring.cpp): plane sections fitted within a
// tolerance. Plain C++, shared by the Python extension and the JavaScript module.

#pragma once

#include <vector>

class SmBrep;
class SmCurve;

namespace smlibpy {

// The curves where a plane through `point` with normal `normal` cuts a body, each fitted within
// `tolerance` of the body's faces (SmBrep::CreatePlanarSectionCurves; the kernel's own plane section,
// SmApiIntersectBrepWithPlane, fits them within a thousandth of each face's size). The caller's.
std::vector<SmCurve*> plane_section(const SmBrep* brep, const std::vector<double>& point,
                                    const std::vector<double>& normal, double tolerance);

}  // namespace smlibpy
