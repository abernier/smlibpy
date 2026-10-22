// SPDX-License-Identifier: Apache-2.0
//
// Extending a face's surface past its sides, and the whole surface of a face (`smlibpy._core.ext`):
//
//   extend_face(face, distance, edges, continuity)   a sheet of one face, grown past the sides
//   untrim_face(face)                                a sheet of one face over the whole surface
//
// The kernel extends B-spline surfaces (SmBSplineSurface::CreateExtendedSurface over
// N_SrfExtendByDist). Its distance is approximate: the parameter step comes from the average of five
// iso-curves, and where the extension fails it halves the distance, and then doubles it again only
// while it stays below half of what was asked, so a surface can come back extended by half the
// distance or less without an error. Closed directions and sides at a pole are skipped silently.
// The base SmSurface::CreateExtendedSurface returns SM_ERR (only B-splines and offsets extend), and an
// analytic surface's NURBS extends as a B-spline. So here: the sides are chosen and checked first
// (closed and pole sides refused), planes grow their own rectangle (they stay planes, exactly), other
// surfaces are cut to the face's parameter rectangle and extended side by side, and each side is
// measured along the surface across its middle: extended again where it fell short, cut back where
// it ran past. The result's normal follows the face's outward normal.
#include "kernel.h"
#include "extend.h"
#include "ext_shared.h"

#include <SmApiGeneral.h>
#include <SmPlane.h>

#include <algorithm>
#include <cmath>
#include <memory>
#include <stdexcept>
#include <string>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(status, what, __FILE__, __LINE__);
}

constexpr int UMIN = 1, UMAX = 2, VMIN = 4, VMAX = 8;
constexpr int SIDES[4] = {UMIN, UMAX, VMIN, VMAX};

struct SurfaceDeleter
{
    void operator()(SmSurface* s) const
    {
        if (s && s->GetOwner() == nullptr)
            delete s;
    }
};
using SurfacePtr = std::unique_ptr<SmSurface, SurfaceDeleter>;

SmPoint3d at(const SmSurface& s, double u, double v)
{
    SmPoint3d p;
    check(s.EvaluatePoint(SmPoint2d(u, v), p), "SmSurface::EvaluatePoint");
    return p;
}

// The length of the surface's iso-curve at `fixed`, from t0 to t1: along u (v = fixed) or along v.
double iso_length(const SmSurface& s, bool along_u, double fixed, double t0, double t1)
{
    const int n = 256;
    double length = 0.0;
    SmPoint3d prev = along_u ? at(s, t0, fixed) : at(s, fixed, t0);
    for (int i = 1; i <= n; ++i)
    {
        const double t = t0 + (t1 - t0) * i / n;
        const SmPoint3d p = along_u ? at(s, t, fixed) : at(s, fixed, t);
        length += prev.DistanceBetween(p);
        prev = p;
    }
    return length;
}

bool along_u(int side) { return side == UMIN || side == UMAX; }
bool at_min(int side) { return side == UMIN || side == VMIN; }
double lo(const SmExtent2d& b, bool u) { return u ? b.GetMin().x : b.GetMin().y; }
double hi(const SmExtent2d& b, bool u) { return u ? b.GetMax().x : b.GetMax().y; }

// How far the surface reaches past the side of `inner`, out to the side of `outer` (both in the
// surface's parameters), measured along the iso-curve across the middle of the side.
double reach(const SmSurface& s, const SmExtent2d& inner, const SmExtent2d& outer, int side)
{
    const bool u = along_u(side);
    const double mid = 0.5 * (lo(inner, !u) + hi(inner, !u));
    return at_min(side) ? iso_length(s, u, mid, lo(outer, u), lo(inner, u)) : iso_length(s, u, mid, hi(inner, u), hi(outer, u));
}

// The surface closes around across the two sides along u (or v): the points on them coincide.
bool closes(const SmSurface& s, const SmExtent2d& box, bool u, double tol)
{
    for (int k = 0; k <= 4; ++k)
    {
        const double t = lo(box, !u) + (hi(box, !u) - lo(box, !u)) * k / 4.0;
        const SmPoint3d a = u ? at(s, lo(box, true), t) : at(s, t, lo(box, false));
        const SmPoint3d b = u ? at(s, hi(box, true), t) : at(s, t, hi(box, false));
        if (a.DistanceBetween(b) > tol)
            return false;
    }
    return true;
}

// The side shrinks to a point (a pole, the tip of a cone).
bool pole(const SmSurface& s, const SmExtent2d& box, int side, double tol)
{
    const bool u = along_u(side);
    const double fixed = at_min(side) ? lo(box, u) : hi(box, u);
    return iso_length(s, !u, fixed, lo(box, !u), hi(box, !u)) <= tol;
}

// The side of the face's parameter rectangle the edge lies along (0 if none).
int side_of(const SmFace* face, const SmEdge* edge, const SmExtent2d& box)
{
    const SmEdgeuse* eu = edge ? edge->GetEdgeuseOfFace(face) : nullptr;
    if (!eu)
        throw std::invalid_argument("extend_face: an edge does not bound the face");
    const double tu = 1e-6 * std::max(box.GetMax().x - box.GetMin().x, 1e-300);
    const double tv = 1e-6 * std::max(box.GetMax().y - box.GetMin().y, 1e-300);
    int sides = UMIN | UMAX | VMIN | VMAX;
    const SmExtent1d ivl = edge->GetInterval();
    for (int i = 0; i < 5; ++i)
    {
        SmPoint3d pos;
        SmVector3d inward;
        SmPoint2d uv;
        check(eu->EvaluateBinormal(ivl.Evaluate((i + 0.5) / 5.0), TRUE, pos, inward, nullptr, nullptr, &uv),
              "SmEdgeuse::EvaluateBinormal");
        if (std::abs(uv.x - box.GetMin().x) > tu) sides &= ~UMIN;
        if (std::abs(uv.x - box.GetMax().x) > tu) sides &= ~UMAX;
        if (std::abs(uv.y - box.GetMin().y) > tv) sides &= ~VMIN;
        if (std::abs(uv.y - box.GetMax().y) > tv) sides &= ~VMAX;
    }
    for (int side : SIDES)
        if (sides & side)
            return side;
    return 0;
}

// The smallest rectangle in the surface's parameters around the face's edges: each edge sampled,
// each extreme refined by golden-section search between the samples next to it. (A plane's own
// rectangle, and with it the face's UV domain, is arbitrary: 1.1 times a sketched circle's square.)
SmExtent2d tight_box(const SmFace* face)
{
    SmTArray<SmEdge*> edges;
    face->GetEdges(edges);
    double mn[2] = {1e300, 1e300}, mx[2] = {-1e300, -1e300};
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        const SmEdgeuse* eu = edges[i]->GetEdgeuseOfFace(face);
        if (!eu)
            continue;
        const SmExtent1d ivl = edges[i]->GetInterval();
        auto uv_at = [&](double t) {
            SmPoint3d pos;
            SmVector3d inward;
            SmPoint2d uv;
            check(eu->EvaluateBinormal(t, TRUE, pos, inward, nullptr, nullptr, &uv), "SmEdgeuse::EvaluateBinormal");
            return uv;
        };
        const int n = 64;
        std::vector<SmPoint2d> uvs(n + 1);
        std::vector<double> ts(n + 1);
        for (int j = 0; j <= n; ++j)
            ts[j] = ivl.GetMin() + (ivl.GetMax() - ivl.GetMin()) * j / n, uvs[j] = uv_at(ts[j]);
        for (int c = 0; c < 2; ++c)
            for (int sign = -1; sign <= 1; sign += 2)
            {
                // the extreme of coordinate c (sign -1: least, +1: greatest)
                auto f = [&](const SmPoint2d& p) { return sign * (c ? p.y : p.x); };
                int best = 0;
                for (int j = 1; j <= n; ++j)
                    if (f(uvs[j]) > f(uvs[best]))
                        best = j;
                double a = ts[std::max(best - 1, 0)], b = ts[std::min(best + 1, n)];
                double value = f(uvs[best]);
                const double g = 0.5 * (std::sqrt(5.0) - 1.0);
                double x1 = b - g * (b - a), x2 = a + g * (b - a);
                double f1 = f(uv_at(x1)), f2 = f(uv_at(x2));
                for (int it = 0; it < 60 && b - a > 1e-15 * std::max(1.0, std::abs(a)); ++it)
                {
                    if (f1 > f2)
                        b = x2, x2 = x1, f2 = f1, x1 = b - g * (b - a), f1 = f(uv_at(x1));
                    else
                        a = x1, x1 = x2, f1 = f2, x2 = a + g * (b - a), f2 = f(uv_at(x2));
                }
                value = std::max({value, f1, f2});
                if (sign < 0)
                    mn[c] = std::min(mn[c], -value);
                else
                    mx[c] = std::max(mx[c], value);
            }
    }
    if (!(mn[0] < mx[0]) || !(mn[1] < mx[1]))
        return face->GetUVDomain();
    return SmExtent2d(SmPoint2d(mn[0], mn[1]), SmPoint2d(mx[0], mx[1]));
}

// The face's outward normal at uv of its surface (as SmFace's outward_normal_at_uv).
SmVector3d outward(const SmFace* face, const SmSurface& surface, const SmPoint2d& uv)
{
    SmVector3d n;
    check(surface.EvaluateNormal(uv, TRUE, TRUE, n), "SmSurface::EvaluateNormal");
    const SmBrep* brep = face->GetBrep();
    const SmFaceuse* upward = face->GetUpwardFaceuse();
    if (brep && upward && upward->GetShell() && brep->GetInfiniteRegion() != upward->GetShell()->GetRegion())
        n = n * -1.0;
    return n;
}

// A sheet of one face over the surface's `domain`, its normal along `normal` at uv (the surface is
// the sheet's afterwards, also when this fails).
SmBrep* sheet(SurfacePtr surface, const SmExtent2d& domain, const SmPoint2d& uv, const SmVector3d& normal)
{
    SmBrep* out = new (ctx()) SmBrep();
    SmFace* face = nullptr;
    SmSurface* owned = surface.release();
    const SmStatus st = out->CreateFaceFromSurface(owned, domain, face);
    if (st != SM_SUCCESS || !face)
    {
        if (owned->GetOwner() == nullptr)
            delete owned;
        delete out;
        check(st != SM_SUCCESS ? st : SM_ERR, "SmBrep::CreateFaceFromSurface");
    }
    try
    {
        if (outward(face, *face->GetSurface(), uv).Dot(normal) < 0.0)
            check(face->SwapUV(), "SmFace::SwapUV");
    }
    catch (...)
    {
        delete out;
        throw;
    }
    return out;
}

SmExtent2d grown(const SmExtent2d& box, int side, double by)
{
    SmPoint2d mn = box.GetMin(), mx = box.GetMax();
    switch (side)
    {
    case UMIN: mn.x -= by; break;
    case UMAX: mx.x += by; break;
    case VMIN: mn.y -= by; break;
    default: mx.y += by; break;
    }
    return SmExtent2d(mn, mx);
}

SmSurfParamType param_of(int side)
{
    switch (side)
    {
    case UMIN: return SM_SP_UMIN;
    case UMAX: return SM_SP_UMAX;
    case VMIN: return SM_SP_VMIN;
    default: return SM_SP_VMAX;
    }
}

// A plane over its rectangle grown past the sides (its own parameters are lengths times a scale):
// null where the plane's parameters are not its STEP parameters.
SurfacePtr grown_plane(const SmPlane* plane, const SmExtent2d& box, int sides, double distance, SmExtent2d& domain)
{
    const SmExtent2d nat = plane->GetNaturalUVDomain(), step = plane->GetSTEPUVDomain();
    const double eps = 1e-12 * std::max({1.0, std::abs(nat.GetMin().x), std::abs(nat.GetMax().x), std::abs(nat.GetMin().y),
                                         std::abs(nat.GetMax().y)});
    if (std::abs(nat.GetMin().x - step.GetMin().x) > eps || std::abs(nat.GetMax().x - step.GetMax().x) > eps ||
        std::abs(nat.GetMin().y - step.GetMin().y) > eps || std::abs(nat.GetMax().y - step.GetMax().y) > eps)
        return nullptr;
    const SmPoint2d a = box.GetMin(), b = box.GetMax();
    const double su = at(*plane, a.x, a.y).DistanceBetween(at(*plane, b.x, a.y)) / (b.x - a.x);
    const double sv = at(*plane, a.x, a.y).DistanceBetween(at(*plane, a.x, b.y)) / (b.y - a.y);
    if (!(su > 0.0) || !(sv > 0.0))
        return nullptr;
    domain = box;
    for (int side : SIDES)
        if (sides & side)
            domain = grown(domain, side, distance / (along_u(side) ? su : sv));
    SmSurface* copy = nullptr;
    check(plane->Copy(ctx(), copy), "SmPlane::Copy");
    SurfacePtr out(copy);
    SmPlane* p = SM_CAST_PTR(SmPlane, copy);
    if (!p || p->AdjustSTEPUVDomain(domain) != SM_SUCCESS)
        return nullptr;
    const SmExtent2d got = p->GetNaturalUVDomain();
    const double size = at(*plane, a.x, a.y).DistanceBetween(at(*plane, b.x, b.y));
    if (std::abs(got.GetMin().x - domain.GetMin().x) * su > 1e-9 * size || std::abs(got.GetMax().x - domain.GetMax().x) * su > 1e-9 * size ||
        std::abs(got.GetMin().y - domain.GetMin().y) * sv > 1e-9 * size || std::abs(got.GetMax().y - domain.GetMax().y) * sv > 1e-9 * size)
        return nullptr;
    for (int i = 0; i < 2; ++i)
        for (int j = 0; j < 2; ++j)
        {
            const double u = i ? b.x : a.x, v = j ? b.y : a.y;
            if (at(*p, u, v).DistanceBetween(at(*plane, u, v)) > 1e-9 * size)
                return nullptr;
        }
    return out;
}

}  // namespace

namespace smlibpy {

SmBrep* extend_face(const SmFace* face, double distance, const std::vector<SmEdge*>& edges, int continuity)
{
    if (!face || !face->GetSurface())
        throw std::invalid_argument("extend_face: no face");
    if (!(distance > 0.0) || !std::isfinite(distance))
        throw std::invalid_argument("extend_face: the distance must be positive");
    if (continuity < 0 || continuity > 2)
        throw std::invalid_argument("extend_face: continuity must be 0 (natural), 1 (G1) or 2 (G2)");
    const SmSurface* surface = face->GetSurface();
    const bool is_plane = SM_CAST_PTR(SmPlane, surface) != nullptr;
    const SmExtent2d box = is_plane ? tight_box(face) : face->GetUVDomain();
    const SmPoint2d center((box.GetMin().x + box.GetMax().x) / 2, (box.GetMin().y + box.GetMax().y) / 2);
    double size = 0.0;
    {
        SmExtent3d bb;
        check(face->CalculateBoundingBox(bb), "SmFace::CalculateBoundingBox");
        size = bb.GetMin().DistanceBetween(bb.GetMax());
    }
    const double tol = std::max(1e-9 * size, face->GetBrep() ? double(face->GetBrep()->GetTolerance()) : 1e-9);

    int open = 0;  // the sides that can grow
    const bool closed_u = closes(*surface, box, true, tol), closed_v = closes(*surface, box, false, tol);
    for (int side : SIDES)
        if (!(along_u(side) ? closed_u : closed_v) && !pole(*surface, box, side, tol))
            open |= side;
    int sides = 0;
    if (edges.empty())
    {
        sides = open;
        if (!sides)
            throw std::invalid_argument("extend_face: the surface closes around and ends in poles: there is no side to "
                                        "extend past");
    }
    else
        for (const SmEdge* e : edges)
        {
            const int side = side_of(face, e, box);
            if (!side)
                throw std::invalid_argument("extend_face: an edge does not run along a side of the face's surface "
                                            "rectangle (it is a trim across the surface): only edges along the sides "
                                            "can be extended past");
            if (!(open & side))
                throw std::invalid_argument("extend_face: an edge lies where the surface closes around (a seam) or at "
                                            "a pole; the surface cannot be extended past it");
            sides |= side;
        }
    const SmVector3d normal = outward(face, *surface, center);

    // planes: their own rectangle, grown (any continuity is the plane)
    if (const SmPlane* plane = SM_CAST_PTR(SmPlane, surface))
    {
        SmExtent2d domain;
        SurfacePtr p = grown_plane(plane, box, sides, distance, domain);
        if (p)
            return sheet(std::move(p), domain, center, normal);
    }

    const SmBSplineSurface* bs = SM_CAST_PTR(SmBSplineSurface, surface);
    if (!bs)
        throw std::invalid_argument("extend_face: only faces of planes, analytic and B-spline surfaces can be extended "
                                    "(this face lies on an offset surface)");
    SmBSplineSurface* sub = nullptr;
    check(bs->CopySubPatch(ctx(), box, sub), "SmBSplineSurface::CopySubPatch");
    SurfacePtr cur(sub);
    const SmExtent2d inner = cur->GetNaturalUVDomain();
    const SmContinuityType kind = continuity == 0 ? SM_CT_CINFINITY : continuity == 1 ? SM_CT_G1R : SM_CT_G1_G2;
    const double accept = 1e-3 * distance;
    for (int side : SIDES)
    {
        if (!(sides & side))
            continue;
        double need = distance, got = 0.0;
        for (int round = 0; round < 4 && got < distance - accept; ++round)
        {
            SmSurface* extended = nullptr;
            const SmStatus st = SM_CAST_PTR(SmBSplineSurface, cur.get())->CreateExtendedSurface(ctx(), param_of(side), need, kind, extended);
            if (st != SM_SUCCESS || !extended)
            {
                if (extended && extended->GetOwner() == nullptr)
                    delete extended;
                throw std::runtime_error("extend_face: the kernel could not extend the surface past a side; try a "
                                         "shorter distance or G1");
            }
            cur.reset(extended);
            got = reach(*cur, inner, cur->GetNaturalUVDomain(), side);
            need = distance - got;
        }
        if (got < distance - accept)
            throw std::runtime_error("extend_face: the kernel extended the surface past a side by " + std::to_string(got) +
                                     " only, not " + std::to_string(distance) + "; try a shorter distance or G1");
        if (got > distance + accept)
        {
            // cut back to where the middle iso-curve reaches the distance
            const SmExtent2d dom = cur->GetNaturalUVDomain();
            const bool u = along_u(side);
            double near = at_min(side) ? lo(inner, u) : hi(inner, u), far = at_min(side) ? lo(dom, u) : hi(dom, u);
            const double mid = 0.5 * (lo(inner, !u) + hi(inner, !u));
            const double from = near;
            for (int it = 0; it < 60; ++it)
            {
                const double t = 0.5 * (near + far);
                const double l = iso_length(*cur, u, mid, std::min(from, t), std::max(from, t));
                (l < distance ? near : far) = t;
            }
            const double t = 0.5 * (near + far);
            SmPoint2d mn = dom.GetMin(), mx = dom.GetMax();
            (u ? (at_min(side) ? mn.x : mx.x) : (at_min(side) ? mn.y : mx.y)) = t;
            SmBSplineSurface* cut = nullptr;
            check(SM_CAST_PTR(SmBSplineSurface, cur.get())->CopySubPatch(ctx(), SmExtent2d(mn, mx), cut),
                  "SmBSplineSurface::CopySubPatch");
            cur.reset(cut);
        }
    }
    // the original rectangle still maps onto the face's surface
    if (at(*cur, center.x, center.y).DistanceBetween(at(*surface, center.x, center.y)) > 1e3 * tol)
        throw std::runtime_error("extend_face: the extended surface moved off the face's surface");
    // continued as it is, an analytic surface's NURBS is the same analytic surface: its type again
    if (continuity == 0 && SM_CAST_PTR(SmBSplineSurface, surface) && smlibpy::surface_kind(surface) != "bspline")
    {
        SmSurface* analytic = nullptr;
        if (SM_CAST_PTR(SmBSplineSurface, cur.get())->CopyAndAddAnalytics(ctx(), analytic) == SM_SUCCESS && analytic)
            cur.reset(analytic);
        else if (analytic && analytic->GetOwner() == nullptr)
            delete analytic;
    }
    const SmExtent2d dom = cur->GetNaturalUVDomain();
    return sheet(std::move(cur), dom, center, normal);
}

SmBrep* untrim_face(const SmFace* face)
{
    if (!face || !face->GetSurface())
        throw std::invalid_argument("untrim_face: no face");
    const SmSurface* surface = face->GetSurface();
    const bool is_plane = SM_CAST_PTR(SmPlane, surface) != nullptr;
    const SmExtent2d box = is_plane ? tight_box(face) : face->GetUVDomain();
    const SmPoint2d center((box.GetMin().x + box.GetMax().x) / 2, (box.GetMin().y + box.GetMax().y) / 2);
    const SmVector3d normal = outward(face, *surface, center);
    SmSurface* copy = nullptr;
    check(surface->Copy(ctx(), copy), "SmSurface::Copy");
    SurfacePtr owned(copy);
    const SmExtent2d domain = is_plane ? box : copy->GetNaturalUVDomain();
    return sheet(std::move(owned), domain, center, normal);
}

SmExtent2d face_parameter_box(const SmFace* face)
{
    if (!face || !face->GetSurface())
        throw std::invalid_argument("face_parameter_box: no face");
    return SM_CAST_PTR(SmPlane, face->GetSurface()) != nullptr ? tight_box(face) : face->GetUVDomain();
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_extend(py::module_ m)
{
    m.def("extend_face", &smlibpy::extend_face, py::arg("face"), py::arg("distance"), py::arg("edges"),
          py::arg("continuity") = 0, py::return_value_policy::take_ownership,
          "A sheet of one face: the face's surface over its parameter rectangle, grown by `distance` past the sides "
          "the edges lie on (all sides that can grow when there are none); continuity 0 natural, 1 G1, 2 G2.");
    m.def("untrim_face", &smlibpy::untrim_face, py::arg("face"), py::return_value_policy::take_ownership,
          "A sheet of one face over the face's whole surface (a plane over the face's parameter rectangle).");
}
#endif  // SMLIBPY_PYTHON
