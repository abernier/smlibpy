// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's distance between bodies (distance.cpp): the nearest points of two bodies, refined from
// a point near one of them. Plain C++, shared by the Python extension and the JavaScript module.

#pragma once

#include <vector>

class SmBrep;
class SmCurve;
class SmFace;

namespace smlibpy {

struct NearestPoints
{
    double a[3] = {}, b[3] = {};  // on the first body and on the second
    double distance = 0.0;
    double gain = 0.0;  // how much the last step still gained (0 once the points settle)
    bool converged = false;
    long steps = 0;
    const SmFace* face_a = nullptr;  // the faces the points lie on (at an edge or a corner, one of
    const SmFace* face_b = nullptr;  // the faces there); none on a curve
    double t = 0.0;                  // nearest_curve_points: the curve parameter of b
};

// The nearest points of two bodies from a point near the first (x, y, z): a local minimum of the
// distance between their surfaces.
NearestPoints nearest_points(const SmBrep* a, const SmBrep* b, const std::vector<double>& near_a);

// The nearest points of a body (a) and a curve over [t0, t1] (b), from the curve's point at near_t.
NearestPoints nearest_curve_points(const SmBrep* body, const SmCurve* curve, double t0, double t1, double near_t);

}  // namespace smlibpy
