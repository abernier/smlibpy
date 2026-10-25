// SPDX-License-Identifier: Apache-2.0
//
// Editing sheets face by face, surfaces from NURBS data, and how far points lie from a surface
// (sheet_edit.cpp). Plain C++, shared by the Python extension and the JavaScript module.

#pragma once

#include <vector>

class SmBrep;
class SmCurve;
class SmEdge;
class SmFace;
class SmSurface;

namespace smlibpy {

// A copy of the body (owned by the caller) whose edge runs along `curve` (its whole length, either
// way round). The faces of the edge change within `extent` (a fraction of the face's parameter range
// across from the edge, above 0 and below 1) and meet the rest of themselves with degree-1 continuity
// (SmBSplineSurface::AdjustBoundaryCurve). Where the curve's ends are not the edge's, the edge's
// vertices move to them, the edges next to it with them, and the faces on the other side of those
// edges are matched to their new curves in turn. Every face that changes must be bounded by its
// surface's four sides (no trims, no holes, no seam), the edge it is matched along one whole side.
SmBrep* match_edge(const SmBrep* brep, const SmEdge* edge, const SmCurve* curve, double extent);

// A sheet of one face (owned by the caller) on one surface that covers the two faces of a body:
// both bounded by their surfaces' four sides, sharing one whole side (made compatible and joined by
// NLib on copies, the knot at the joint removed where it is not needed). Its normal follows face
// `a`'s outward normal. Refused where the joined surface misses either face by more than the body's
// tolerance (their parameters along the shared side differ) or their normals disagree.
SmBrep* merge_faces(const SmFace* a, const SmFace* b);

// A B-spline surface (owned by the caller) from its NURBS data: degrees, `nu` x `nv` control points
// x, y, z (flat, `nu` rows along u of `nv` points along v), the knot vectors with every knot as often
// as its multiplicity (`nu + du + 1` and `nv + dv + 1` knots, not decreasing; the ends need not
// repeat: the surface spans knots[d] to knots[n]), and a positive weight per control point (empty:
// non-rational).
SmSurface* nurbs_surface(int du, int dv, int nu, int nv, const std::vector<double>& poles,
                         const std::vector<double>& u_knots, const std::vector<double>& v_knots,
                         const std::vector<double>& weights);

// How far each point (x, y, z flat) lies from the surface over its whole parameter domain: to its
// closest point, from the nearest samples of a grid by Newton's method.
std::vector<double> surface_distances(const SmSurface* surface, const std::vector<double>& points);

}  // namespace smlibpy
