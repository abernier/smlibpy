// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's sheet metal bends (sheetmetal.cpp): the kernel's space bend and unbend, redone. Plain
// C++, shared by the Python extension and the JavaScript module. Both change the Brep in place.

#pragma once

#include <vector>

class SmBrep;
class SmFace;

namespace smlibpy {

// The numbers of faces in, before and after the bend region.
struct BendFaces
{
    unsigned long in = 0, before = 0, after = 0;
};

// Bend a Brep in place by `angle` degrees about the axis through `axis_point` along `axis`, with
// inside radius `radius`. `direction` points from the axis to the sheet (perpendicular to it); the
// region spans [0, length] along the axis from `axis_point`. The part on the side of
// cross(direction, axis) stays in place.
BendFaces sheet_bend(SmBrep* brep, double angle, double radius, double k_factor, double thickness,
                     const std::vector<double>& axis_point, const std::vector<double>& axis,
                     const std::vector<double>& direction, double length);

// The inverse of sheet_bend, with `direction` pointing from the axis to the middle of the bent
// region. The side that holds `anchor` stays in place (without one, the side of
// cross(direction, axis)). Returns -1 if the side of cross(direction, axis) stayed, +1 if the other.
int sheet_unbend(SmBrep* brep, double angle, double radius, double k_factor, double thickness,
                 const std::vector<double>& axis_point, const std::vector<double>& axis,
                 const std::vector<double>& direction, double length, SmFace* anchor);

}  // namespace smlibpy
