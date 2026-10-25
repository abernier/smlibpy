// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's measures (measure.cpp): area, volume and moments of a Brep or a face, integrated with
// an error estimate, and arc lengths of curves. Plain C++, shared by the Python extension and the
// JavaScript module; each of them converts the results for its language.

#pragma once

#include <utility>

class SmBrep;
class SmFace;
class SmCurve;

namespace smlibpy {

// About `origin` (the bounding box centre); the second moments in the order xx, yy, zz, yz, zx, xy.
struct BrepMeasure
{
    double area = 0.0, volume = 0.0;
    double origin[3] = {}, first_moments[3] = {}, second_moments[6] = {};
    double closure[3] = {};        // the integral of the outward normal: zero for a closed surface
    double field_volumes[3] = {};  // the volume from the x, the y and the z field
    struct Errors
    {
        double area = 0.0, volume = 0.0, first_moments[3] = {}, second_moments[6] = {};
    } error;
    double relative_error = 0.0, size = 0.0;
    bool converged = false;
    long panels = 0, evaluations = 0;
    long exhausted = -1;  // a face (index) the integration ran out of its evaluation budget on, -1 if none
};

struct FaceMeasure
{
    double area = 0.0, signed_area = 0.0;
    double origin[3] = {}, first_moments[3] = {};
    double error = 0.0, relative_error = 0.0;
    bool converged = false;
    long panels = 0, evaluations = 0;
    bool exhausted = false;  // the integration ran out of the face's evaluation budget
};

BrepMeasure brep_measure(const SmBrep* brep, double tolerance);
FaceMeasure face_measure(const SmFace* face, double tolerance);
double curve_length(const SmCurve* curve, double t0, double t1, double tolerance);
// The parameter at signed arc length `length` from t_start, and whether the curve ended first.
std::pair<double, bool> curve_parameter_at_length(const SmCurve* curve, double t_start, double length, double tolerance);

}  // namespace smlibpy
