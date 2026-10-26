// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's distance between bodies (distance.cpp): the nearest points of two bodies, refined from
// a point near one of them. Plain C++, shared by the Python extension and the JavaScript module.

#pragma once

#include <vector>

class SmBrep;
class SmCurve;
class SmFace;
class SmSurface;

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

struct NearestPoint
{
    double p[3] = {};
    double distance = 0.0;
    const SmFace* face = nullptr;  // the face it lies on (at an edge or a corner, one of the faces there)
};

// A part of a surface where the point nearest to a point may lie: its parameter box, and how near
// the point it can come at best (0: no bound).
struct SurfacePatch
{
    double bound = 0.0;
    double u0 = 0.0, u1 = 0.0, v0 = 0.0, v1 = 0.0;
};

// The patches of a surface over `dom` (u0, u1, v0, v1), nearest first: for a B-spline surface its knot spans, each
// bounded by the box of the control points that shape it (the convex hull property: the span lies
// inside them, however it folds); otherwise one patch, `dom` itself, without a bound.
std::vector<SurfacePatch> surface_patches(const SmSurface* surface, const std::vector<double>& dom, const std::vector<double>& point);

// The point of a surface over `dom` (u0, u1, v0, v1) nearest to `point` from (u, v): a local minimum
// of the distance by damped Newton steps held to the box (u, v: where it lies). Its distance.
double nearest_on_surface(const SmSurface* surface, const std::vector<double>& dom, const std::vector<double>& point,
                          double& u, double& v);

// The point of a body nearest to a point (x, y, z): the global minimum, also where a B-spline face
// folds back towards the point (where the kernel's own closest point stops at a local minimum).
// With `only`, the point of that face (within its boundary) nearest to it; `brep` may then be null.
NearestPoint nearest_point(const SmBrep* brep, const std::vector<double>& point, const SmFace* only = nullptr);

}  // namespace smlibpy
