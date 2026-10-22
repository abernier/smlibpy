// SPDX-License-Identifier: Apache-2.0
//
// Analytic faces and edges recognized in a body (`smlibpy._core.ext`, kernel plan T6):
//
//   recognize_analytics(brep, tolerance)   a copy with planes, cylinders, ... for B-splines, or None
//
// SmBrep::Transform with a scale that differs between the axes, or a shear, turns every face and edge
// into a B-spline: a box scaled by (2, 1, 1) has six B-spline faces and twelve B-spline edges, a
// cylinder scaled along its axis three B-spline faces. Selections by kind (`cylinders()`, `radius`)
// then find nothing, STEP files get B-splines, and the first measure refits the faces' UV trim curves
// and stores them in the Brep: the scaled cylinder's volume came out 6.8e-7 too small.
//
// The kernel recognizes analytic geometry in B-splines when it copies a Brep with bAddAnalytics (the
// copy constructor; SmBSplineSurface::CopyAndAddAnalytics finds planes, cones and cylinders, spheres,
// surfaces of revolution and of extrusion), as it does for every .smb file it reads, and
// SmBrep::ConvertCurvesToAnalytics turns straight B-spline edges into lines. The circles of an
// axis-aligned scale stay B-splines (the kernel recognizes no circles there).
//
// The copy is checked against the Brep: the same counts of faces, edges and vertices, the vertices in
// place, and every face's new surface within `tolerance` of the old one at a grid of points over the
// face's parameter box, every edge's new curve at points along the edge.

#include "kernel.h"
#include "analytics.h"

#include <SmApiGeneral.h>
#include <SmApiQueries.h>

#include <algorithm>
#include <memory>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

constexpr int grid = 4;      // a face: (grid + 1)^2 points over its parameter box
constexpr int along = 8;     // an edge: along + 1 points

// The largest distance from points of a face's old surface to its new one; -1 where a point cannot
// be evaluated or projected.
double surface_gap(const SmFace* before, const SmFace* after)
{
    const SmSurface* old_surface = before->GetSurface();
    const SmSurface* new_surface = after->GetSurface();
    if (old_surface == nullptr || new_surface == nullptr)
        return -1.0;
    const SmExtent2d box = before->GetUVDomain();
    const SmPoint2d lo = box.GetMin(), hi = box.GetMax();
    double worst = 0.0;
    for (int i = 0; i <= grid; ++i)
        for (int j = 0; j <= grid; ++j)
        {
            const SmPoint2d uv(lo.x + (hi.x - lo.x) * i / grid, lo.y + (hi.y - lo.y) * j / grid);
            SmPoint3d p, closest;
            SmTArray<SmPoint2d> uvs;
            double d = 0.0;
            if (old_surface->EvaluatePoint(uv, p) != SM_SUCCESS ||
                SmApiSurfaceClosestPoint(new_surface, p, closest, uvs, d) != SM_SUCCESS)
                return -1.0;
            worst = std::max(worst, d);
        }
    return worst;
}

// The largest distance from points of an edge's old curve to its new one; -1 as above.
double curve_gap(const SmEdge* before, const SmEdge* after)
{
    const SmCurve* old_curve = before->GetCurve();
    const SmCurve* new_curve = after->GetCurve();
    if (old_curve == nullptr || new_curve == nullptr)
        return -1.0;
    const SmExtent1d ivl = before->GetInterval();
    double worst = 0.0;
    for (int i = 0; i <= along; ++i)
    {
        SmPoint3d p, closest;
        double t = 0.0, d = 0.0;
        if (old_curve->EvaluatePoint(ivl.GetMin() + (ivl.GetMax() - ivl.GetMin()) * i / along, p) != SM_SUCCESS ||
            SmApiCurveClosestPoint(new_curve, p, closest, t, d) != SM_SUCCESS)
            return -1.0;
        worst = std::max(worst, d);
    }
    return worst;
}

bool spline(const SmSurface* s) { return s != nullptr && s->GetType() == SmBSplineSurface_TYPE; }
bool spline(const SmCurve* c) { return c != nullptr && c->GetType() == SmBSplineCurve_TYPE; }

}  // namespace

namespace smlibpy {

SmBrep* recognize_analytics(const SmBrep* brep, double tolerance)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    if (!(tolerance > 0.0))
        throw std::invalid_argument("recognize_analytics: the tolerance must be positive");
    SmTArray<SmFace*> faces;
    SmTArray<SmEdge*> edges;
    SmTArray<SmVertex*> vertices;
    brep->GetFaces(faces);
    brep->GetEdges(edges);
    brep->GetVertices(vertices);
    bool any = false;
    for (ULONG i = 0; i < faces.GetSize() && !any; ++i)
        any = spline(faces[i]->GetSurface());
    for (ULONG i = 0; i < edges.GetSize() && !any; ++i)
        any = spline(edges[i]->GetCurve());
    if (!any)
        return nullptr;

    std::unique_ptr<SmBrep> copy(new (ctx()) SmBrep(*brep, nullptr, nullptr, TRUE, TRUE));
    ULONG curves = 0, uv_curves = 0;
    if (copy->ConvertCurvesToAnalytics(curves, uv_curves) != SM_SUCCESS)
        return nullptr;

    SmTArray<SmFace*> new_faces;
    SmTArray<SmEdge*> new_edges;
    SmTArray<SmVertex*> new_vertices;
    copy->GetFaces(new_faces);
    copy->GetEdges(new_edges);
    copy->GetVertices(new_vertices);
    if (new_faces.GetSize() != faces.GetSize() || new_edges.GetSize() != edges.GetSize() ||
        new_vertices.GetSize() != vertices.GetSize())
        return nullptr;

    bool changed = false;
    for (ULONG i = 0; i < vertices.GetSize(); ++i)
        if ((vertices[i]->GetPoint() - new_vertices[i]->GetPoint()).Length() > tolerance)
            return nullptr;
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        if (!spline(faces[i]->GetSurface()))
            continue;
        if (spline(new_faces[i]->GetSurface()))
            continue;  // (copied as it was)
        const double gap = surface_gap(faces[i], new_faces[i]);
        if (gap < 0.0 || gap > tolerance)
            return nullptr;
        changed = true;
    }
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        if (!spline(edges[i]->GetCurve()) || spline(new_edges[i]->GetCurve()))
            continue;
        const double gap = curve_gap(edges[i], new_edges[i]);
        if (gap < 0.0 || gap > tolerance)
            return nullptr;
        changed = true;
    }
    return changed ? copy.release() : nullptr;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_analytics(py::module_ m)
{
    m.def("recognize_analytics", &smlibpy::recognize_analytics, py::arg("brep"), py::arg("tolerance"),
          py::return_value_policy::take_ownership,
          "A copy of a Brep with its B-spline faces and edges as planes, cylinders, cones, spheres, surfaces of "
          "revolution or extrusion, and lines where they are such (the kernel's recognition when it reads a file); "
          "None where nothing was recognized, or where the copy's faces or edges lie more than `tolerance` off the "
          "Brep's.");
}
#endif  // SMLIBPY_PYTHON
