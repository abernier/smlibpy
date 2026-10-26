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
// SmBrep::ConvertCurvesToAnalytics turns straight B-spline edges into lines. It leaves the circles of
// an axis-aligned scale B-splines; SmCurve::CreateAnalyticCurve finds them (restore_analytic_curves,
// as for mirrored bodies), on edges whose faces are no B-splines.
//
// The copy is checked against the Brep: the same counts of faces, edges and vertices, the vertices in
// place, and every face's new surface within `tolerance` of the old one at points in every knot span
// of the old B-spline across the face's parameter box, every edge's new curve at points in every span
// of the old curve along the edge. (A fixed grid of 5 x 5 points missed a bump in the middle of a
// span: the kernel's recognition samples the iso curves of a cylinder at fixed parameters only, and a
// cylinder sheet with its first quarter pushed out came back a cylinder after scale((1, 1, 2)).)

#include "kernel.h"
#include "analytics.h"
#include "analytic.h"
#include "deform_analytic.h"

#include <SmApiGeneral.h>
#include <SmApiQueries.h>
#include <SmBSplineCurve.h>
#include <SmBSplineSurface.h>
#include <SmPlane.h>

#include <algorithm>
#include <memory>
#include <vector>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

constexpr int per_span = 4;    // steps per knot span: its start and three points inside
constexpr size_t max_spans = 64;  // more spans in one direction: 64 even steps instead

// Parameters from lo to hi: the knots between them and three points inside every span (eight steps
// across a single span), or 64 even steps where there are more than max_spans spans.
std::vector<double> span_samples(const SmTArray<double>& knots, double lo, double hi)
{
    std::vector<double> breaks{lo};
    for (ULONG i = 0; i < knots.GetSize(); ++i)
        if (knots[i] > lo && knots[i] < hi)
            breaks.push_back(knots[i]);
    breaks.push_back(hi);
    int steps = per_span;
    if (breaks.size() - 1 > max_spans)
        breaks = {lo, hi}, steps = 64;
    else if (breaks.size() == 2)
        steps = 8;
    std::vector<double> out;
    for (size_t s = 0; s + 1 < breaks.size(); ++s)
        for (int i = 0; i < steps; ++i)
            out.push_back(breaks[s] + (breaks[s + 1] - breaks[s]) * i / steps);
    out.push_back(hi);
    return out;
}

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
    SmTArray<double> uknots, vknots;
    if (old_surface->GetType() == SmBSplineSurface_TYPE)
    {
        const auto* spline = static_cast<const SmBSplineSurface*>(old_surface);
        if (spline->GetKnots(SM_SP_U, uknots) != SM_SUCCESS || spline->GetKnots(SM_SP_V, vknots) != SM_SUCCESS)
            return -1.0;
    }
    const std::vector<double> us = span_samples(uknots, lo.x, hi.x), vs = span_samples(vknots, lo.y, hi.y);
    double worst = 0.0;
    for (double u : us)
        for (double v : vs)
        {
            const SmPoint2d uv(u, v);
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
    SmTArray<double> knots;
    if (old_curve->GetType() == SmBSplineCurve_TYPE &&
        static_cast<const SmBSplineCurve*>(old_curve)->GetKnots(knots) != SM_SUCCESS)
        return -1.0;
    double worst = 0.0;
    for (double s : span_samples(knots, ivl.GetMin(), ivl.GetMax()))
    {
        SmPoint3d p, closest;
        double t = 0.0, d = 0.0;
        if (old_curve->EvaluatePoint(s, p) != SM_SUCCESS ||
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
    // (and circles, which ConvertCurvesToAnalytics leaves B-splines: the rims of a cylinder, cone or
    // sphere scaled along its axis, where no face along the edge stays a B-spline)
    restore_analytic_curves(copy.get(), false);

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

SmBrep* planar_faces(const SmBrep* brep, double tolerance)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    if (!(tolerance > 0.0))
        throw std::invalid_argument("planar_faces: the tolerance must be positive");
    std::unique_ptr<SmBrep> copy(new (ctx()) SmBrep(*brep, nullptr, nullptr, FALSE, FALSE));
    SmTArray<SmFace*> faces;
    copy->GetFaces(faces);
    std::vector<std::pair<SmFace*, SmSurface*>> swaps;
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        const SmSurface* surface = faces[i]->GetSurface();
        if (!spline(surface))
            continue;
        const auto* bs = static_cast<const SmBSplineSurface*>(surface);
        ULONG nu = 0, nv = 0;
        SmTArray<SmPoint3d> poles;
        SmTArray<double> weights;
        if (bs->GetControlPointNet(nu, nv, poles, weights) != SM_SUCCESS || poles.GetSize() < 3)
            continue;
        bool positive = true;  // (a rational surface lies in the hull of its control points where its weights are positive)
        for (ULONG k = 0; k < weights.GetSize(); ++k)
            positive = positive && weights[k] > 0.0;
        if (!positive)
            continue;
        // the plane through the control points: the normal of the largest triangle among the first,
        // the farthest from it and the farthest from the line between those two
        const SmPoint3d a = poles[0];
        ULONG ib = 0, ic = 0;
        double far = -1.0;
        for (ULONG k = 0; k < poles.GetSize(); ++k)
            if ((poles[k] - a).Length() > far)
                far = (poles[k] - a).Length(), ib = k;
        if (!(far > tolerance))
            continue;
        const SmVector3d ab = (poles[ib] - a) / far;
        far = -1.0;
        for (ULONG k = 0; k < poles.GetSize(); ++k)
        {
            const SmVector3d v = poles[k] - a;
            const double off = (v - v.Dot(ab) * ab).Length();
            if (off > far)
                far = off, ic = k;
        }
        if (!(far > tolerance))
            continue;
        SmVector3d n = ab * (poles[ic] - a);
        n = n / n.Length();
        bool flat = true;
        for (ULONG k = 0; k < poles.GetSize() && flat; ++k)
            flat = std::abs((poles[k] - a).Dot(n)) <= tolerance;
        if (!flat)
            continue;
        // facing as the face's surface does
        const SmExtent2d box = faces[i]->GetUVDomain();
        SmVector3d sn;
        if (surface->EvaluateNormal(box.GetMid(), TRUE, TRUE, sn) != SM_SUCCESS)
            continue;
        if (sn.Dot(n) < 0.0)
            n = -n;
        const SmVector3d x0 = std::abs(n.x) < 0.9 ? SmVector3d(1, 0, 0) * n : SmVector3d(0, 1, 0) * n;
        const SmVector3d x = x0 / x0.Length();
        const SmVector3d y = n * x;
        SmExtent2d dom;
        double size = 0.0;
        for (ULONG k = 0; k < poles.GetSize(); ++k)
        {
            dom.AddPoint2d(SmPoint2d((poles[k] - a).Dot(x), (poles[k] - a).Dot(y)));
            size = std::max(size, (poles[k] - a).Length());
        }
        dom.ExpandAbsolute(1e-7 * std::max(size, 1.0));
        swaps.emplace_back(faces[i], new (ctx()) SmPlane(a, x, y, SmVector2d(1.0, 1.0), dom, &ctx()));
    }
    if (swaps.empty())
        return nullptr;
    if (!analytic::swap_in(*copy, swaps, {}, 10.0 * tolerance, tolerance))
        return nullptr;
    ULONG curves = 0, uv_curves = 0;
    copy->ConvertCurvesToAnalytics(curves, uv_curves);
    return copy.release();
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_analytics(py::module_ m)
{
    m.def("planar_faces", &smlibpy::planar_faces, py::arg("brep"), py::arg("tolerance"),
          py::return_value_policy::take_ownership,
          "A copy of a Brep whose B-spline faces with all their control points within `tolerance` of a plane are "
          "planes (their trims built again), and straight B-spline edges lines; None where there is no such face or "
          "the trims cannot be built. The caller checks the copy (valid, the same volume).");
    m.def("recognize_analytics", &smlibpy::recognize_analytics, py::arg("brep"), py::arg("tolerance"),
          py::return_value_policy::take_ownership,
          "A copy of a Brep with its B-spline faces and edges as planes, cylinders, cones, spheres, surfaces of "
          "revolution or extrusion, and lines where they are such (the kernel's recognition when it reads a file); "
          "None where nothing was recognized, or where the copy's faces or edges lie more than `tolerance` off the "
          "Brep's.");
}
#endif  // SMLIBPY_PYTHON
