// SPDX-License-Identifier: Apache-2.0
//
// Analytic faces and edges recognized in a body (analytics.cpp, kernel plan T6). Plain C++, shared by
// the Python extension and the JavaScript module.

#pragma once

class SmBrep;

namespace smlibpy {

// A copy of a Brep whose B-spline faces and edges are planes, cylinders, cones, spheres, surfaces of
// revolution or of extrusion, and lines, where they are such (SmBSplineSurface::CopyAndAddAnalytics,
// as the kernel recognizes them when it reads a file, and SmBrep::ConvertCurvesToAnalytics). None
// (nullptr) where nothing was recognized, and where the copy is not the same body: other counts of
// faces, edges or vertices, a vertex moved, or a face or edge whose new geometry lies more than
// `tolerance` off the old one at points sampled over it. Owned by the caller.
SmBrep* recognize_analytics(const SmBrep* brep, double tolerance);

}  // namespace smlibpy
