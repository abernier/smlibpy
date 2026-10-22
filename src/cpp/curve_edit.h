// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's curve editing (curve_edit.cpp): B-splines raised in degree and refined by knots (exact),
// and curves whose ends move to new points and directions (SmCurve::DeformToEndPointTargets). Plain
// C++, shared by the Python extension and the JavaScript module.

#pragma once

#include <vector>

class SmBSplineCurve;
class SmCurve;

namespace smlibpy {

// A B-spline copy of `curve` (a B-spline itself) of at least `degree` with `knots` inserted
// (SmBSplineCurve::DegreeElevate and InsertKnots): the same curve, more control points. A knot given
// twice is inserted twice. The curve is the caller's (ext.delete_curve).
SmBSplineCurve* refine_curve(const SmCurve* curve, int degree, const std::vector<double>& knots);

// A B-spline copy of `curve` (a B-spline itself) whose start and end move to the points given (empty:
// stays) and whose directions there become the ones given (empty: as they were), bent smoothly in
// between (SmCurve::DeformToEndPointTargets: the end parts move as rigid bodies, the middle blends;
// cubic at least). `deviation`: the largest distance of an end from its target and of a direction
// from its target (as the length of the difference of the unit vectors). The curve is the caller's.
struct EditedCurve
{
    SmBSplineCurve* curve = nullptr;
    double deviation = 0.0;
};
EditedCurve deform_ends(const SmCurve* curve, const std::vector<double>& start, const std::vector<double>& end,
                        const std::vector<double>& start_tangent, const std::vector<double>& end_tangent);

}  // namespace smlibpy
