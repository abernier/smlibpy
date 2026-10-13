// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's additions to the kernel bindings (ext.cpp): exact geometry and topology as plain data,
// lifetime control of kernel objects, transforms, copies, face extraction and body separation.
// Plain C++, shared by the Python extension and the JavaScript module. Kernel objects returned
// here are owned by the caller unless noted.

#pragma once

#include "value.h"

#include <string>
#include <utility>
#include <vector>

class SmBrep;
class SmBSplineCurve;
class SmCurve;
class SmEdge;
class SmFace;
class SmObject;
class SmPolyBrep;
class SmSurface;
class SmVertex;

namespace smlibpy {

// Exact definitions: kind, NURBS data (degree, poles, knots, weights) and analytic parameters.
Value curve_data(const SmCurve* curve, bool nurbs);
Value surface_data(const SmSurface* surface, bool nurbs);
// Topology (regions, shells, faces with both faceuses and their loops, edges, vertices) and
// optionally exact geometry of a Brep.
Value brep_dump(const SmBrep* brep, bool geometry);

// Indices (in edge order) of the seam edges of a Brep.
std::vector<long> seam_edges(const SmBrep* brep);
// The index of each given face / edge / vertex in the Brep's own lists (-1 if not there).
std::vector<long> face_indices(const SmBrep* brep, const std::vector<SmFace*>& faces);
std::vector<long> edge_indices(const SmBrep* brep, const std::vector<SmEdge*>& edges);
std::vector<long> vertex_indices(const SmBrep* brep, const std::vector<SmVertex*>& vertices);

// A copy of a Brep, with the given topology of the original mapped onto the copy (owned by it).
struct CopyMap
{
    SmBrep* brep = nullptr;
    std::vector<SmFace*> faces;
    std::vector<SmEdge*> edges;
    std::vector<SmVertex*> vertices;
};
CopyMap copy_with_map(const SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<SmEdge*>& edges,
                      const std::vector<SmVertex*>& vertices);

// A row-major 4x4 matrix applied to a Brep in place (rigid, scaling and mirroring).
void transform_brep(SmBrep* brep, const std::vector<double>& matrix);
// Faces of a Brep copied into a new Brep (no merge, no stitching).
SmBrep* copy_faces(const SmBrep* brep, const std::vector<SmFace*>& faces);
// A sheet Brep with one face covering the whole (copied) surface.
SmBrep* face_from_surface(const SmSurface* surface);
// All faces of several Breps copied into one new Brep, without Booleans (for disjoint bodies).
SmBrep* combine(const std::vector<SmBrep*>& breps);
// A copy of a Brep split into one Brep per connected body.
std::vector<SmBrep*> separate_bodies(const SmBrep* brep);

void delete_brep(SmBrep* brep);
// Standalone curves and surfaces only: those owned by a Brep are left alone.
void delete_curve(SmCurve* curve);
void delete_surface(SmSurface* surface);
void delete_polybrep(SmPolyBrep* poly);

SmCurve* copy_curve(const SmCurve* curve);
// A standalone copy of a curve restricted to [t0, t1].
SmCurve* trimmed_curve(const SmCurve* curve, double t0, double t1);
// A standalone copy of an ellipse over the ellipse angles [start, end] in degrees
// (-360 <= start < end <= 360, at most 360 apart).
SmCurve* ellipse_arc(const SmCurve* curve, double start, double end);
// A standalone copy of an edge's curve over the edge's interval.
SmCurve* edge_curve(const SmEdge* edge);
// Reverses a standalone curve in place; returns its new interval.
std::pair<double, double> reverse_curve(SmCurve* curve);
// A NURBS approximation of any curve that keeps its parameterisation.
SmBSplineCurve* approximate_curve(const SmCurve* curve, double tolerance);

// The kernel's precise integration: {area, origin, first_moments, signed_area} of a face;
// {area, volume, mass, origin, moments} of a Brep.
Value face_properties(const SmFace* face, double accuracy);
Value brep_properties(const SmBrep* brep, double accuracy, double density);

// The point and the derivatives [p, dp/dt, ...] at parameter t, as (x, y, z) tuples.
Value curve_eval(const SmCurve* curve, double t, int derivatives);

// Profile curves swept along a path with all of the kernel's sweep options. Profile and path are
// copied, not consumed.
SmBrep* curve_sweep(const std::vector<SmCurve*>& profile, SmBSplineCurve* path, bool cap_ends, bool center,
                    bool orient, bool translational, SmBSplineCurve* scale_reference, SmBSplineCurve* scale_curve);

std::string curve_kind(const SmCurve* curve);
std::string surface_kind(const SmSurface* surface);
std::string object_class(const SmObject* object);

}  // namespace smlibpy
