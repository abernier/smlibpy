// SPDX-License-Identifier: Apache-2.0
//
// Analytic edge curves back from B-splines (see analytic.h).

#include "kernel.h"
#include "analytic.h"

#include <SmApiGeneral.h>
#include <SmLine.h>

#include <cmath>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

double length(const SmVector3d& a) { return std::sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }

SmVector3d scaled(const SmVector3d& a, double f) { return SmVector3d(a.x * f, a.y * f, a.z * f); }

// A line with the parameters of `curve` on ivl, if the curve runs straight at constant speed there (a
// straight cubic, as LocalOperation makes them), else null.
SmCurve* as_line(const SmCurve* curve, const SmExtent1d& ivl)
{
    double t0 = ivl.GetMin(), t1 = ivl.GetMax();
    SmPoint3d p0, p1;
    if (!(t1 > t0) || curve->EvaluatePoint(t0, p0) != SM_SUCCESS || curve->EvaluatePoint(t1, p1) != SM_SUCCESS)
        return nullptr;
    SmVector3d span = p1 - p0;
    double len = length(span);
    if (!(len > 0))
        return nullptr;
    for (int i = 1; i < 8; ++i)
    {
        double f = i / 8.0;
        SmPoint3d p;
        if (curve->EvaluatePoint(t0 + f * (t1 - t0), p) != SM_SUCCESS || length(p - (p0 + scaled(span, f))) > 1e-12 * (1.0 + len))
            return nullptr;
    }
    SmVector3d direction = scaled(span, 1.0 / len);
    return new (ctx()) SmLine(p0 - scaled(direction, t0 * len / (t1 - t0)), direction, ivl, len / (t1 - t0), 3);
}

}  // namespace

namespace smlibpy {

long restore_analytic_curves(SmBrep* brep, bool circles_on_nurbs)
{
    SmTArray<SmEdge*> edges;
    brep->GetEdges(edges);
    long changed = 0;
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        SmCurve* curve = edges[i]->GetCurve();
        if (curve == nullptr || curve->GetType() != SmBSplineCurve_TYPE)
            continue;
        // (the edge takes the new curve's whole interval: a line is made for the edge's, a circle
        // keeps the B-spline's, which must be the edge's)
        const SmExtent1d ivl = curve->GetNaturalInterval(), on = edges[i]->GetInterval();
        const double eps = 1e-12 * (1.0 + std::fabs(ivl.GetMin()) + std::fabs(ivl.GetMax()));
        const bool spans = std::fabs(ivl.GetMin() - on.GetMin()) <= eps && std::fabs(ivl.GetMax() - on.GetMax()) <= eps;
        SmCurve* exact = nullptr;
        if (curve->CreateAnalyticCurve(ctx(), on, exact) != SM_SUCCESS || exact == nullptr)
            exact = as_line(curve, on);
        if (exact == nullptr)
            continue;
        if (exact->GetType() != SmLine_TYPE && !spans)
        {
            delete exact;
            continue;
        }
        if (!circles_on_nurbs && exact->GetType() != SmLine_TYPE)
        {
            SmTArray<SmFace*> faces;
            edges[i]->GetFaces(faces);
            bool nurbs = false;
            for (ULONG f = 0; f < faces.GetSize() && !nurbs; ++f)
                nurbs = faces[f]->GetSurface() == nullptr || faces[f]->GetSurface()->GetType() == SmBSplineSurface_TYPE;
            if (nurbs)
            {
                delete exact;
                continue;
            }
        }
        if (brep->ReplaceCurve(edges[i], exact) == SM_SUCCESS)
            ++changed;
        else
            delete exact;
    }
    return changed;
}

}  // namespace smlibpy
