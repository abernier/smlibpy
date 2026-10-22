// SPDX-License-Identifier: Apache-2.0
//
// Analytic images for deform.cpp: a face or edge whose exact image under a deformation is a
// plane, cylinder, cone, line or circle (or a moved copy of the original) gets that geometry
// instead of a fitted NURBS. Plain C++, shared by the Python extension and the JavaScript module.

#pragma once

#include <functional>
#include <utility>
#include <vector>

#include "kernel.h"

namespace smlibpy::analytic {

// The deformation of one face or edge: a point before -> the point after.
using Map = std::function<SmPoint3d(const SmPoint3d&)>;

// A line in space (a candidate axis of a cylinder or cone image).
struct Line3
{
    SmPoint3d origin;
    SmVector3d direction;  // unit
};

// What a face's surface or an edge's curve becomes. `same`: the parameters of the original are
// kept (the trim curves stay valid); otherwise the geometry is new and the trims must be built
// again (swap_in). The caller owns the geometry.
struct SurfaceImage
{
    SmSurface* surface = nullptr;
    bool same = false;
};

struct CurveImage
{
    SmCurve* curve = nullptr;
    bool same = false;
};

// The exact image of a face's surface when it is analytic: a copy of the original moved by the
// similarity the map is on the face (a rigid motion and a uniform scale), a cone or cylinder
// about the image of the original's axis with its parameters, or a new plane, cylinder or cone
// (about one of `axes`). `box` is the part of the surface the face uses; `tol` the largest
// distance of a sample from the candidate. Null when the image is none of these.
SurfaceImage surface_image(SmFace* face, const SmExtent2d& box, const Map& map, const std::vector<Line3>& axes,
                           double tol);

// The exact image of an edge's curve when it is analytic: a moved copy, a line with the same
// parameters, or a new line or circle. Null otherwise.
CurveImage curve_image(SmEdge* edge, const Map& map, double tol);
// The same for a curve over the interval `ivl` of its parameters (a standalone curve, deform_curve).
CurveImage curve_image(const SmCurve* curve, const SmExtent1d& ivl, const Map& map, double tol);

// Put new surfaces and curves (images with new parameters) into a Brep and build the trim
// curves of the faces they touch again, dropping the edges onto the surfaces within `drop_tol`.
// Takes ownership of the geometry. False when a trim curve cannot be built within `gap` of its
// edge: the Brep is then broken, and the caller throws it away.
bool swap_in(SmBrep& brep, const std::vector<std::pair<SmFace*, SmSurface*>>& faces,
             const std::vector<std::pair<SmEdge*, SmCurve*>>& edges, double gap, double drop_tol);

}  // namespace smlibpy::analytic
