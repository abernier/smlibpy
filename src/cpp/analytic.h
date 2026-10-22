// SPDX-License-Identifier: Apache-2.0
//
// Analytic edge curves back from B-splines (analytic.cpp): for Breps the kernel rebuilt (face drafts)
// and bodies read from files that write every edge as a B-spline (USD). Plain C++, shared by the
// Python extension and the JavaScript module.

#pragma once

class SmBrep;

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

}  // namespace smlibpy
