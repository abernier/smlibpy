// SPDX-License-Identifier: Apache-2.0
//
// Analytic edge curves back from B-splines (see analytic.h).

#include "kernel.h"
#include "analytic.h"

#include <SmApiGeneral.h>
#include <SmCircle.h>
#include <SmCone.h>
#include <SmCopyBrepMap.h>
#include <SmLine.h>
#include <SmPlane.h>
#include <SmSphere.h>

#include <cmath>
#include <stdexcept>
#include <utility>
#include <vector>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

double length(const SmVector3d& a) { return std::sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }

SmVector3d scaled(const SmVector3d& a, double f) { return SmVector3d(a.x * f, a.y * f, a.z * f); }

double dot(const SmVector3d& a, const SmVector3d& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

SmVector3d cross(const SmVector3d& a, const SmVector3d& b)
{
    return SmVector3d(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

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

// The unit axis and the origin of a cone's or cylinder's placement (heights along the axis from the
// origin are its STEP v parameters: SmCone::GetRadius).
bool cone_axis(const SmCone* cone, SmPoint3d& origin, SmVector3d& axis)
{
    const SmAxis2Placement& pos = cone->GetPosition();
    axis = cross(pos.GetXAxisRef(), pos.GetYAxisRef());
    if (!(length(axis) > 0))
        return false;
    axis = scaled(axis, 1.0 / length(axis));
    origin = pos.GetOriginRef();
    return true;
}

}  // namespace

namespace smlibpy {

bool exact_circle(SmEdge* edge, SmPoint3d& center, SmVector3d& normal, double& radius)
{
    SmTArray<SmFace*> faces;
    edge->GetFaces(faces);
    if (faces.GetSize() != 2 || faces[0] == faces[1])
        return false;
    const SmSurface* s0 = faces[0]->GetSurface();
    const SmSurface* s1 = faces[1]->GetSurface();
    if (s0 == nullptr || s1 == nullptr)
        return false;
    // two cones or cylinders about one axis: the circle at the height where their radii agree
    if (s0->IsKindOf(SmCone_TYPE) && s1->IsKindOf(SmCone_TYPE))
    {
        const SmCone* c0 = static_cast<const SmCone*>(s0);
        const SmCone* c1 = static_cast<const SmCone*>(s1);
        SmPoint3d o0, o1;
        SmVector3d z0, z1;
        if (!cone_axis(c0, o0, z0) || !cone_axis(c1, o1, z1) || length(cross(z0, z1)) > 1e-9)
            return false;
        const SmVector3d off = o1 - o0;
        const double size = 1.0 + length(off) + std::fabs(c0->GetRadius(0.0)) + std::fabs(c1->GetRadius(0.0));
        if (length(off - scaled(z0, dot(off, z0))) > 1e-9 * size)
            return false;  // (not about one axis)
        // a point at height h along z0 from o0 is at height (h - dot(off, z0)) * sign along z1 from o1
        const double sign = dot(z0, z1) > 0 ? 1.0 : -1.0, shift = dot(off, z0);
        const double a0 = c0->GetRadius(0.0), b0 = c0->GetRadius(1.0) - a0;
        const double a1 = c1->GetRadius(0.0), b1 = c1->GetRadius(1.0) - a1;
        // a0 + b0 h = a1 + b1 sign (h - shift)
        const double slope = b0 - b1 * sign;
        if (std::fabs(slope) < 1e-9)
            return false;  // (parallel walls: they meet along a band, if at all)
        const double h = (a1 - b1 * sign * shift - a0) / slope;
        radius = a0 + b0 * h;
        center = o0 + scaled(z0, h);
        normal = z0;
        return radius > 0;
    }
    for (int k = 0; k < 2; ++k)
    {
        const SmSurface* plane = faces[k]->GetSurface();
        const SmSurface* other = faces[1 - k]->GetSurface();
        if (!plane->IsKindOf(SmPlane_TYPE))
            continue;
        const SmAxis2Placement& pp = static_cast<const SmPlane*>(plane)->GetPosition();
        const SmPoint3d p0 = pp.GetOriginRef();
        SmVector3d n = cross(pp.GetXAxisRef(), pp.GetYAxisRef());
        if (!(length(n) > 0))
            return false;
        n = scaled(n, 1.0 / length(n));
        if (other->IsKindOf(SmCone_TYPE))
        {
            const SmCone* cone = static_cast<const SmCone*>(other);
            SmPoint3d origin;
            SmVector3d axis;
            if (!cone_axis(cone, origin, axis) || length(cross(axis, n)) > 1e-9)
                return false;
            const double along = dot(p0 - origin, n) / dot(axis, n);
            center = origin + scaled(axis, along);
            radius = cone->GetRadius(along);
            normal = n;
            return radius > 0;
        }
        if (other->IsKindOf(SmSphere_TYPE))
        {
            const SmSphere* sphere = static_cast<const SmSphere*>(other);
            const SmPoint3d c = sphere->GetOrigin();
            const double h = dot(c - p0, n), r = sphere->GetRadius();
            if (!(r * r - h * h > 0))
                return false;
            center = c - scaled(n, h);
            radius = std::sqrt(r * r - h * h);
            normal = n;
            return true;
        }
        return false;
    }
    return false;
}

SmCurve* as_circle(SmEdge* edge, const SmCurve* curve)
{
    SmPoint3d center;
    SmVector3d normal;
    double radius = 0.0;
    if (!exact_circle(edge, center, normal, radius))
        return nullptr;
    SmExtent1d ivl = curve->GetNaturalInterval();
    const double t0 = ivl.GetMin(), t1 = ivl.GetMax();
    if (!(t1 > t0))
        return nullptr;
    // on the circle: in its plane and at its radius from its center
    auto onto = [&](const SmPoint3d& p, SmPoint3d& q) {
        SmVector3d v = p - center;
        v = v - scaled(normal, dot(v, normal));
        const double l = length(v);
        if (!(l > 0))
            return false;
        q = center + scaled(v, radius / l);
        return length(q - p) <= 1e-5 * (1.0 + radius);
    };
    SmPoint3d samples[17];
    for (int i = 0; i <= 16; ++i)
    {
        SmPoint3d p;
        if (curve->EvaluatePoint(t0 + (t1 - t0) * i / 16.0, p) != SM_SUCCESS || !onto(p, samples[i]))
            return nullptr;
    }
    const bool closed = length(samples[0] - samples[16]) <= 1e-9 * (1.0 + radius);
    SmCircle* circle = closed ? new (ctx()) SmCircle(samples[0], samples[5], samples[11], 3, TRUE, &ctx())
                              : new (ctx()) SmCircle(samples[0], samples[8], samples[16], 3, FALSE, &ctx());
    // the same way round (the circle's parameters are not the curve's: its point a third of the way
    // lies near the curve's, not on it), and from the same start
    SmExtent1d civl = circle->GetNaturalInterval();
    SmPoint3d a, b, m;
    if (circle->EvaluatePoint(civl.GetMin(), a) != SM_SUCCESS || circle->EvaluatePoint(civl.GetMax(), b) != SM_SUCCESS ||
        circle->EvaluatePoint(civl.GetMin() + (civl.GetMax() - civl.GetMin()) * (closed ? 5.0 : 8.0) / 16.0, m) != SM_SUCCESS ||
        length(a - samples[0]) > 1e-9 * (1.0 + radius) || length(b - samples[closed ? 0 : 16]) > 1e-9 * (1.0 + radius) ||
        length(m - samples[closed ? 5 : 8]) > 0.25 * radius)
    {
        delete circle;
        return nullptr;
    }
    return circle;
}
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

namespace smlibpy {

SmBrep* exact_circles(const SmBrep* brep)
{
    if (brep == nullptr)
        throw std::invalid_argument("brep is None");
    SmTArray<SmEdge*> edges;
    brep->GetEdges(edges);
    std::vector<std::pair<SmEdge*, SmCurve*>> found;  // an edge of brep, its circle
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        const SmCurve* curve = edges[i]->GetCurve();
        if (curve == nullptr || curve->GetType() != SmBSplineCurve_TYPE)
            continue;
        const SmExtent1d ivl = curve->GetNaturalInterval(), on = edges[i]->GetInterval();
        const double eps = 1e-12 * (1.0 + std::fabs(ivl.GetMin()) + std::fabs(ivl.GetMax()));
        if (std::fabs(ivl.GetMin() - on.GetMin()) > eps || std::fabs(ivl.GetMax() - on.GetMax()) > eps)
            continue;  // (a circle keeps the B-spline's interval, which must be the edge's)
        if (SmCurve* circle = as_circle(edges[i], curve))
            found.emplace_back(edges[i], circle);
    }
    if (found.empty())
        return nullptr;
    SmCopyBrepMap map;  // original -> copy
    SmBrep* copy = new (ctx()) SmBrep(*brep, nullptr, &map, TRUE, FALSE);
    for (auto& [edge, circle] : found)
    {
        SmEdge* e = static_cast<SmEdge*>(map.GetAt(edge));
        if (e == nullptr || copy->ReplaceCurve(e, circle) != SM_SUCCESS)
            delete circle;
    }
    return copy;
}

}  // namespace smlibpy
