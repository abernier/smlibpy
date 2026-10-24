// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's curve operations (curve_ops.cpp): offsets of curves in a plane, curves fitted to points
// within a tolerance or through points with a tangent at each, the geometry of a curve (curvature,
// torsion, inflections, the smallest radius, the exact box) and curves as lines and circular arcs.
// Plain C++, shared by the Python extension and the JavaScript module.

#pragma once

#include "value.h"

#include <string>
#include <vector>

class SmBSplineCurve;
class SmCurve;

namespace smlibpy {

// A new curve and how far it is from what was asked of it. `curve` is the caller's
// (ext.delete_curve); offset_curve leaves it null where the offset cannot be made (see `tight`).
struct CurveResult
{
    SmBSplineCurve* curve = nullptr;
    double deviation = 0.0;
    // offset_curve: a parameter of the curve where it bends on the side it moves to with a radius
    // of the distance or less (the offset would have a cusp or a loop there), else NaN.
    double tight = 0.0;
};

// The curve moved `distance` sideways in the plane with normal `normal`: positive to the left of its
// direction seen from the side the normal points to. SmBSplineCurve::CreateSimpleOffset with an
// approximation tolerance of `tolerance` (lines and circles stay exact). Checked first: where the
// curve bends toward that side with a radius of `distance` or less, no curve is made (`tight`).
// `deviation`: the largest error of the offset (the kernel's gap, and the distance from the exact
// offset points of 129 parameters to it).
CurveResult offset_curve(const SmCurve* curve, const std::vector<double>& normal, double distance, double tolerance);

// A non-rational B-spline near points (x, y, z flat): within `tolerance` of every point
// (SmBSplineCurve::ApproximatePoints, which raises the degree up to `degree` and removes knots until
// it is), or, for a tolerance of 0, the least-squares curve of `degree`. Start and end tangents
// (empty: free) are directions; `closed` closes the curve. `deviation`: the largest distance from a
// point to the curve.
CurveResult approximate_points(const std::vector<double>& points, int degree, double tolerance,
                               const std::vector<double>& start_tangent, const std::vector<double>& end_tangent,
                               bool closed);

// A B-spline of `degree` (2 or 3) through points with the direction of the curve given at every point
// (SmBSplineCurve::CreateInterpolatingCurve, chord-length parameters). `deviation`: the largest
// distance from a point to the curve.
CurveResult interpolate_tangents(const std::vector<double>& points, const std::vector<double>& tangents, int degree);

// A cubic B-spline within `tolerance` of the points (x, y, z flat) along a tangent direction at each:
// the curve through them and their tangents with its knots removed within the tolerance (the end
// tangents kept); deviation is the largest distance of a point from it.
CurveResult approximate_tangents(const std::vector<double>& points, const std::vector<double>& tangents,
                                 double tolerance);

// The curve's geometry at parameter t (SmCurve::EvaluateGeometric): {"point", "derivative" (the
// first), "curvature" (toward the center of curvature, of length 1/radius; zero where straight),
// "torsion" (along the binormal, of length the torsion; zero for planar curves)}.
Value curve_geometry(const SmCurve* curve, double t);

// Places on the curve over [t0, t1] (SmCurve::GlobalPropertyAnalysis): kind "inflections" (where the
// curvature vanishes), "min_radius" / "max_radius" (the smallest / largest radius of curvature),
// "radius" (where the radius of curvature is `value`). [{"t", "end"}], "end" set (else None) for a
// stretch where it holds throughout.
Value curve_properties(const SmCurve* curve, double t0, double t1, const std::string& kind, double value,
                       double tolerance);

// The exact box of the curve over [t0, t1]: its ends, its corners and the points where its tangent is
// perpendicular to an axis. ((xmin, ymin, zmin), (xmax, ymax, zmax)).
Value curve_box(const SmCurve* curve, double t0, double t1);

// The curve as lines and circular arcs within `tolerance` (SmBSplineCurve::SubdivideToLinesAndArcs):
// {"pieces": [{"kind": "line" | "arc", "start", "mid", "end"}], "deviation": d}, the pieces end to
// end in the curve's direction ("mid": a point halfway along), d the largest distance between the
// pieces and the curve, measured both ways.
Value lines_and_arcs(const SmCurve* curve, double tolerance);

}  // namespace smlibpy
