// SPDX-License-Identifier: Apache-2.0
//
// Analytic edge curves back from B-splines (analytic.cpp): for Breps the kernel rebuilt (face drafts)
// and bodies read from files that write every edge as a B-spline (USD). Plain C++, shared by the
// Python extension and the JavaScript module.

#pragma once

class SmBrep;
class SmCurve;
class SmEdge;
class SmPoint3d;
class SmVector3d;

namespace smlibpy {

// Lines and circles among the B-spline edges of a Brep get their exact analytic curve back (the
// kernel's own SmBrep::ConvertCurvesToAnalytics only takes lines of degree 1): a B-spline that is
// a line or a circular arc exactly (SmCurve::CreateAnalyticCurve), or a straight one at constant
// speed (as SmBrep::LocalOperation makes them): a line spans the edge, a circle only where the
// B-spline does. The analytic curve keeps the parameters of the B-spline; the kernel drops the
// edge's UV curves and makes them again from it. circles_on_nurbs false: circles only for edges whose faces all lie on analytic
// surfaces (UV curves that a file gives on B-spline surfaces stay: made again from a circle, the
// kernel's can go wrong; from a line they do not). Returns the number of edges changed.
long restore_analytic_curves(SmBrep* brep, bool circles_on_nurbs = true);

// The exact circle where the two faces of an edge meet: a plane and a cylinder, cone or sphere about an
// axis along the plane's normal, or two cylinders or cones about one axis (where their radii agree).
// False if the edge is not such an edge.
bool exact_circle(SmEdge* edge, SmPoint3d& center, SmVector3d& normal, double& radius);

// The edge's B-spline curve as the exact arc or circle of exact_circle, from its start to its end and
// the same way round (its own parameters), or null. The curve must lie on the circle within 1e-5 of
// its radius. The caller owns it.
SmCurve* as_circle(SmEdge* edge, const SmCurve* curve);

// A copy of the Brep (the caller's) whose B-spline edges that are such circles (as_circle: the
// kernel fits the circle where a cone meets a cylinder, to about 1e-6 of the radius) have their
// exact curve, or null where it has none.
SmBrep* exact_circles(const SmBrep* brep);

}  // namespace smlibpy
