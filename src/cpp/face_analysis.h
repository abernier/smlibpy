// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's face and edge analysis (face_analysis.cpp): curvature with its principal directions,
// the smallest radius of curvature of a face, iso-parametric curves clipped to a face, and the
// continuity of the two faces at an edge. Plain C++, shared by the Python extension and the
// JavaScript module.

#pragma once

#include <vector>

class SmBrep;
class SmCurve;
class SmEdge;
class SmFace;

namespace smlibpy {

struct FaceCurvature
{
    double point[3] = {}, normal[3] = {};  // the outward normal of the face
    double k1 = 0.0, k2 = 0.0;             // principal curvatures, k1 >= k2 (convex positive)
    double d1[3] = {}, d2[3] = {};         // their directions (unit, tangent to the face)
};

// The curvature of a face's surface at (u, v); at a singular point (a pole) a little towards the
// middle of the face's parameter box.
FaceCurvature face_curvature(const SmFace* face, double u, double v);

struct MinRadius
{
    double radius = 0.0;  // infinity where the face does not curve
    double point[3] = {};
    double uv[2] = {};
    long evaluations = 0;
};

// The smallest radius of curvature of a face (1 / the largest |principal curvature|): sampled on a
// grid x grid net of its parameter box, then refined by a pattern search that stays on the face.
MinRadius face_min_radius(const SmFace* face, int grid);

// The curves of constant u (constant_u) or constant v at `value` of the face's surface, clipped
// to the face: one standalone curve per piece that lies on it. The caller owns them.
std::vector<SmCurve*> face_iso_curves(const SmFace* face, bool constant_u, double value);

struct EdgeContinuity
{
    int samples = 0;
    double gap = 0.0;        // the largest distance between the two faces along the edge
    double angle = 0.0;      // the largest angle between their outward normals (degrees)
    double jump = 0.0;       // the largest difference of their normal curvatures across the edge
    double curvature = 0.0;  // the largest |normal curvature| across the edge (either face)
    double tolerance = 0.0;  // the edge's own tolerance (how far apart its faces may be)
    double length = 0.0;     // the edge's length
    double gap_at[3] = {}, angle_at[3] = {}, jump_at[3] = {};  // where on the edge
};

// How the two faces of an edge meet, at `samples` points along it: their gap, the angle between
// their normals and the jump of their normal curvatures across the edge (in the direction across
// the edge, tangent to the faces). An edge used twice by one face (a seam) compares the face with
// itself on either side. Throws for an edge that does not lie between two faces.
EdgeContinuity edge_continuity(const SmEdge* edge, int samples);

// The kernel's outer angle (degrees, SmEdge::CalcOuterAngle) of each edge at `samples` points
// along it (empty where the edge does not lie between two faces of a solid).
std::vector<std::vector<double>> edge_outer_angles(const SmBrep* brep, const std::vector<SmEdge*>& edges, int samples);

}  // namespace smlibpy
