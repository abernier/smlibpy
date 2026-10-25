// SPDX-License-Identifier: Apache-2.0
//
// Editing sheets face by face, surfaces from NURBS data, distances to a surface (`smlibpy._core.ext`):
//
//   match_edge(brep, edge, curve, extent)                   a copy of the body whose edge runs along a curve
//   merge_faces(face_a, face_b)                             one face over two faces that share a side
//   nurbs_surface(du, dv, nu, nv, poles, uk, vk, weights)   a B-spline surface from its NURBS data
//   surface_distances(surface, points)                      how far points lie from a surface
//
// match_edge: SmBSplineSurface::AdjustBoundaryCurve (N_SrfModifyBoundaryCrv with NL_CMAX; in the kernel,
// not in SM_API) makes a curve the boundary of a B-spline surface, exactly (7e-15): it adds the
// difference between the curve and the old boundary, blended out within a part of the domain. Where the
// curve's ends are not the old corners, the two sides next to the boundary move too (near the corners):
// the edges there take the new sides as their curves, the vertices move, and the faces on the other side
// of those edges are matched to their new curves the same way, until no edge moves. (Refusing such moves
// would refuse what the call is for: closing a gap to a neighbour's edge.) The body keeps its topology:
// edges get their new curves (SmBrep::ReplaceCurve), vertices their points (SmVertex::SetPoint), faces
// their surfaces (SmBrep::ReplaceSurface, which builds the trims again from the edges), and every edge of
// a changed face is measured against it afterwards.
//
// merge_faces: SmBSplineSurface::JoinSurface makes its two surfaces compatible in place
// (N_MakeSrfsCompatible elevates degrees, inserts knots, reparameterizes) on a stack of its own, which it
// frees on return: a surface that needed it is left with arrays in freed memory. Its header has u and v
// the other way round (step_build.cpp's move_seam follows the code), and it never checks that the
// boundaries meet: the wrong flag gives SM_SUCCESS and a surface 3 mm off. Here the same NLib steps
// (N_MakeSrfsCompatible, N_SrfJoin) run on copies on a stack of this file, with the surfaces turned so
// that a's u = max side meets b's u = min side, and the result is copied out and measured against both
// faces. Surfaces are turned through their canonical data (SmBSplineSurface::Reverse reverses its NLib
// data in place on a stack of its own too).
//
// The bridge between NLib and SMLib (ai/plan/kernel-deep-dive.md, U11): NLib data is edited only on
// stacks of this file or inside kernel calls that copy their result out (AdjustBoundaryCurve); surfaces
// come back through the copying constructor (SmBSplineSurface(const gw_SURFACE*)), never the storing one
// that SmBSplineSurface::CreateHelicalSweep calls with a surface on its stack (then freed); analytic
// faces are edited as their exact B-splines (smlibpy::face_bspline: CopyAnalyticAsNurb, cut to the face),
// as an edit of an analytic surface's NURBS data changes nothing.
//
// nurbs_surface: SmBSplineSurface::CreateCanonical from unique knots and multiplicities. A knot vector
// whose ends do not repeat degree + 1 times is clamped first: knots inserted at the ends of the domain
// (Boehm, on the homogeneous control points), and what lies outside dropped.
//
// surface_distances: each point's closest point from the nearest samples of a grid over the surface (by
// its number of control points, up to 65 x 65), refined by Newton's method on the squared distance,
// held to the domain at its sides. (A fit's own error, fit.cpp, is measured at the parameters the fit
// gave the points, not at their closest points: 18.3 for a cloud whose worst point lies 7.4 from it.)

#include "kernel.h"
#include "sheet_edit.h"
#include "distance.h"
#include "ext_shared.h"
#include "extend.h"
#include "shape_edit.h"

#include <SmApiGeneral.h>
#include <nurbs.h>
#include <NL_SrfTool.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <deque>
#include <limits>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(status, what, __FILE__, __LINE__);
}

std::string fmt(double x)
{
    char buf[32];
    std::snprintf(buf, sizeof buf, "%.3g", x);
    return buf;
}

struct SurfaceDeleter
{
    void operator()(SmSurface* s) const
    {
        if (s && s->GetOwner() == nullptr)
            delete s;
    }
};
using SplinePtr = std::unique_ptr<SmBSplineSurface, SurfaceDeleter>;

struct CurveDeleter
{
    void operator()(SmCurve* c) const
    {
        if (c && c->GetOwner() == nullptr)
            delete c;
    }
};
using CurvePtr = std::unique_ptr<SmBSplineCurve, CurveDeleter>;

struct BrepDeleter
{
    void operator()(SmBrep* b) const { smlibpy::delete_brep(b); }
};
using BrepPtr = std::unique_ptr<SmBrep, BrepDeleter>;

// An NLib stack: what is allocated on it is freed with it.
struct Stack
{
    NL_STACKS s;
    Stack() { N_InitNurbs(&s); }
    ~Stack() { N_EndNurbs(&s); }
    Stack(const Stack&) = delete;
    Stack& operator=(const Stack&) = delete;
};

SmPoint3d at(const SmSurface& s, double u, double v)
{
    SmPoint3d p;
    check(s.EvaluatePoint(SmPoint2d(u, v), p), "SmSurface::EvaluatePoint");
    return p;
}

SmPoint3d at(const SmSurface& s, const SmPoint2d& uv) { return at(s, uv.x, uv.y); }

SmPoint3d curve_at(const SmCurve& c, double t)
{
    SmPoint3d p;
    check(c.EvaluatePoint(t, p), "SmCurve::EvaluatePoint");
    return p;
}

SmPoint3d curve_start(const SmCurve& c) { return curve_at(c, c.GetNaturalInterval().GetMin()); }
SmPoint3d curve_end(const SmCurve& c) { return curve_at(c, c.GetNaturalInterval().GetMax()); }

// Where the point lies on the surface (closest), and how far from it.
SmPoint2d drop(const SmSurface& s, const SmPoint3d& p, double& gap)
{
    SmBoolean ok = FALSE, multi = FALSE;
    SmPoint2d uv;
    gap = 0.0;
    check(s.DropPoint(p, s.GetNaturalUVDomain(), nullptr, ok, uv, gap, multi), "SmSurface::DropPoint");
    if (!ok)
        gap = 1e300;
    return uv;
}

double box_size(const SmExtent3d& box) { return box.GetMin().DistanceBetween(box.GetMax()); }

// How far an edge may lie off its face: the body's tolerance, between 1e-9 and 1e-6 of the size.
double tolerance_of(const SmBrep* brep, double size)
{
    double t = brep ? double(brep->GetTolerance()) : 0.0;
    if (!(t > 0.0))
        t = 1e-6 * size;
    return std::max(1e-9 * std::max(size, 1e-300), std::min(t, 1e-6 * size));
}

// ---------------------------------------------------------------- B-spline data

// A B-spline surface's canonical data: control points by rows along u, each nv points along v.
struct Net
{
    ULONG du = 0, dv = 0;
    std::vector<SmPoint3d> poles;
    std::vector<double> weights;  // empty: non-rational
    std::vector<double> uk, vk;   // unique knots
    std::vector<ULONG> um, vm;    // their multiplicities
    size_t nu() const
    {
        size_t n = 0;
        for (ULONG m : um)
            n += m;
        return n - du - 1;
    }
    size_t nv() const
    {
        size_t n = 0;
        for (ULONG m : vm)
            n += m;
        return n - dv - 1;
    }
};

Net net_of(const SmBSplineSurface& s)
{
    ULONG du = 0, dv = 0;
    SmTArray<SmPoint3d> poles;
    SmBSplineSurfaceForm form;
    SmTArray<ULONG> um, vm;
    SmTArray<double> uk, vk, w;
    SmKnotType kt;
    check(s.GetCanonical(du, dv, poles, form, um, vm, uk, vk, kt, w), "SmBSplineSurface::GetCanonical");
    Net n;
    n.du = du, n.dv = dv;
    for (ULONG i = 0; i < poles.GetSize(); ++i)
        n.poles.push_back(poles[i]);
    for (ULONG i = 0; i < w.GetSize(); ++i)
        n.weights.push_back(w[i]);
    for (ULONG i = 0; i < uk.GetSize(); ++i)
        n.uk.push_back(uk[i]), n.um.push_back(um[i]);
    for (ULONG i = 0; i < vk.GetSize(); ++i)
        n.vk.push_back(vk[i]), n.vm.push_back(vm[i]);
    if (n.poles.size() != n.nu() * n.nv())
        throw std::runtime_error("the kernel's control net of a surface does not match its knots");
    return n;
}

SplinePtr spline_of(const Net& n)
{
    SmTArray<SmPoint3d> poles;
    for (const SmPoint3d& p : n.poles)
        poles.Add(p);
    SmTArray<double> uk, vk, w;
    SmTArray<ULONG> um, vm;
    for (size_t i = 0; i < n.uk.size(); ++i)
        uk.Add(n.uk[i]), um.Add(n.um[i]);
    for (size_t i = 0; i < n.vk.size(); ++i)
        vk.Add(n.vk[i]), vm.Add(n.vm[i]);
    for (double x : n.weights)
        w.Add(x);
    SmBSplineSurface* out = nullptr;
    check(SmBSplineSurface::CreateCanonical(ctx(), n.du, n.dv, poles, SM_SF_UNSPECIFIED, um, vm, uk, vk,
                                            SM_KT_UNSPECIFIED, n.weights.empty() ? nullptr : &w, nullptr, out),
          "SmBSplineSurface::CreateCanonical");
    if (!out)
        throw std::runtime_error("the kernel made no surface");
    return SplinePtr(out);
}

// The surface's parameter in u (or v) running the other way (the same domain).
void reverse(Net& n, bool in_u)
{
    std::vector<double>& k = in_u ? n.uk : n.vk;
    std::vector<ULONG>& m = in_u ? n.um : n.vm;
    const double sum = k.front() + k.back();
    std::reverse(k.begin(), k.end());
    for (double& x : k)
        x = sum - x;
    std::reverse(m.begin(), m.end());
    const size_t nu = n.nu(), nv = n.nv();
    std::vector<SmPoint3d> p(n.poles.size());
    std::vector<double> w(n.weights.size());
    for (size_t i = 0; i < nu; ++i)
        for (size_t j = 0; j < nv; ++j)
        {
            const size_t from = in_u ? (nu - 1 - i) * nv + j : i * nv + (nv - 1 - j);
            p[i * nv + j] = n.poles[from];
            if (!w.empty())
                w[i * nv + j] = n.weights[from];
        }
    n.poles.swap(p);
    n.weights.swap(w);
}

// u and v swapped.
void swap_uv(Net& n)
{
    const size_t nu = n.nu(), nv = n.nv();
    std::vector<SmPoint3d> p(n.poles.size());
    std::vector<double> w(n.weights.size());
    for (size_t i = 0; i < nu; ++i)
        for (size_t j = 0; j < nv; ++j)
        {
            p[j * nu + i] = n.poles[i * nv + j];
            if (!w.empty())
                w[j * nu + i] = n.weights[i * nv + j];
        }
    n.poles.swap(p);
    n.weights.swap(w);
    std::swap(n.du, n.dv);
    std::swap(n.uk, n.vk);
    std::swap(n.um, n.vm);
}

// A B-spline copy of a curve: exact for lines, arcs, ellipses and B-splines, else within 1e-7 of the size.
CurvePtr bspline_copy(const SmCurve& c, double size)
{
    SmBSplineCurve* out = nullptr;
    if (c.IsKindOf(SmBSplineCurve_TYPE))
    {
        ULONG dim = 0, degree = 0;
        SmTArray<SmPoint3d> poles;
        SmBSplineCurveForm form;
        SmTArray<ULONG> mults;
        SmTArray<double> knots, weights;
        SmKnotType kt;
        check(static_cast<const SmBSplineCurve&>(c).GetCanonical(dim, degree, poles, form, mults, knots, kt, weights),
              "SmBSplineCurve::GetCanonical");
        check(SmBSplineCurve::CreateCanonical(ctx(), 3, degree, poles, SM_CF_UNSPECIFIED, mults, knots, SM_KT_UNSPECIFIED,
                                              weights.GetSize() ? &weights : nullptr, nullptr, out),
              "SmBSplineCurve::CreateCanonical");
    }
    else
    {
        SmTArray<double> breaks;
        const SmExtent1d ivl = c.GetNaturalInterval();
        breaks.Add(ivl.GetMin());
        breaks.Add(ivl.GetMax());
        double gap = 0.0;
        check(c.ApproximateCurve(ctx(), breaks, 1e-7 * std::max(size, 1e-300), gap, out, FALSE, TRUE),
              "SmCurve::ApproximateCurve");
    }
    if (!out)
        throw std::runtime_error("the kernel made no B-spline of a curve");
    return CurvePtr(out);
}

CurvePtr reversed_copy(const SmBSplineCurve& c, double size)
{
    CurvePtr out = bspline_copy(c, size);
    SmExtent1d ivl;
    check(out->ReverseParameterization(out->GetNaturalInterval(), ivl), "SmCurve::ReverseParameterization");
    return out;
}

// ---------------------------------------------------------------- faces bounded by their four sides

constexpr int UMIN = 0, UMAX = 1, VMIN = 2, VMAX = 3;
bool u_side(int side) { return side == UMIN || side == UMAX; }  // u constant: the side runs along v
bool min_side(int side) { return side == UMIN || side == VMIN; }
double side_lo(const SmExtent2d& d, int side) { return u_side(side) ? d.GetMin().y : d.GetMin().x; }
double side_hi(const SmExtent2d& d, int side) { return u_side(side) ? d.GetMax().y : d.GetMax().x; }
double fixed_of(const SmExtent2d& d, int side)
{
    switch (side)
    {
    case UMIN: return d.GetMin().x;
    case UMAX: return d.GetMax().x;
    case VMIN: return d.GetMin().y;
    default: return d.GetMax().y;
    }
}
SmPoint2d side_uv(const SmExtent2d& d, int side, double t)
{
    return u_side(side) ? SmPoint2d(fixed_of(d, side), t) : SmPoint2d(t, fixed_of(d, side));
}

// An edge along a side of a face's surface: which side, and from where to where along it.
struct OnSide
{
    int side = -1;
    double t0 = 0.0, t1 = 0.0;
};

// A face bounded by the four sides of its surface, as an exact B-spline over its parameter rectangle.
struct Patch
{
    SmFace* face = nullptr;
    SplinePtr s;
    SmExtent2d dom;
    std::vector<std::pair<SmEdge*, OnSide>> edges;
    const OnSide* find(const SmEdge* e) const
    {
        for (const auto& item : edges)
            if (item.first == e)
                return &item.second;
        return nullptr;
    }
};

const char* ONLY = "only faces bounded by the four sides of their surface (no hole, no trimmed border, no seam, "
                   "no pole) can be ";

// The intervals cover [lo, hi].
bool covers(std::vector<std::pair<double, double>> parts, double lo, double hi)
{
    std::sort(parts.begin(), parts.end());
    const double eps = 1e-6 * (hi - lo);
    double reach = lo;
    for (const auto& [a, b] : parts)
    {
        if (a > reach + eps)
            return false;
        reach = std::max(reach, b);
    }
    return reach >= hi - eps;
}

Patch patch_of(SmFace* face, double size, const char* what, const char* verb)
{
    const std::string only = std::string(what) + ": " + ONLY + verb;
    Patch p;
    p.face = face;
    p.s.reset(smlibpy::face_bspline(face, what));
    SmTArray<SmLoop*> loops;
    face->GetLoops(loops);
    if (loops.GetSize() != 1)
        throw std::invalid_argument(only + " (a face has a hole)");
    SmTArray<SmEdge*> edges;
    face->GetEdges(edges);
    // A face cut from its surface along curves of constant parameter (a sheet split in two) is the
    // surface over the rectangle around its edges.
    {
        const SmExtent2d whole = p.s->GetNaturalUVDomain();
        SmExtent2d box;
        for (ULONG i = 0; i < edges.GetSize(); ++i)
        {
            const SmCurve* c = edges[i]->GetCurve();
            if (!c)
                continue;
            const SmExtent1d ivl = edges[i]->GetInterval();
            for (int k = 0; k <= 32; ++k)
            {
                double gap = 0.0;
                box.AddPoint2d(drop(*p.s, curve_at(*c, ivl.Evaluate(k / 32.0)), gap));
            }
        }
        if (!box.IsInit())
        {
            const double eu = 1e-9 * (whole.GetMax().x - whole.GetMin().x), ev = 1e-9 * (whole.GetMax().y - whole.GetMin().y);
            SmPoint2d mn = box.GetMin(), mx = box.GetMax();
            mn.x = mn.x - whole.GetMin().x <= 1e3 * eu ? whole.GetMin().x : mn.x;
            mn.y = mn.y - whole.GetMin().y <= 1e3 * ev ? whole.GetMin().y : mn.y;
            mx.x = whole.GetMax().x - mx.x <= 1e3 * eu ? whole.GetMax().x : mx.x;
            mx.y = whole.GetMax().y - mx.y <= 1e3 * ev ? whole.GetMax().y : mx.y;
            if (mn.x < mx.x && mn.y < mx.y && (mn.x > whole.GetMin().x || mn.y > whole.GetMin().y ||
                                               mx.x < whole.GetMax().x || mx.y < whole.GetMax().y))
            {
                SmBSplineSurface* sub = nullptr;
                check(p.s->CopySubPatch(ctx(), SmExtent2d(mn, mx), sub), "SmBSplineSurface::CopySubPatch");
                if (!sub)
                    throw std::runtime_error(std::string(what) + ": the kernel could not cut a face's surface to the face");
                p.s.reset(sub);
            }
        }
    }
    p.dom = p.s->GetNaturalUVDomain();
    const double close = 1e-6 * size;
    std::vector<std::pair<double, double>> cover[4];
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        SmEdge* e = edges[i];
        const SmCurve* c = e->GetCurve();
        if (!c)
            throw std::invalid_argument(only + " (a face has an edge without a curve)");
        const SmExtent1d ivl = e->GetInterval();
        bool on[4] = {true, true, true, true};
        double lo[4], hi[4];
        std::fill(lo, lo + 4, std::numeric_limits<double>::infinity());
        std::fill(hi, hi + 4, -std::numeric_limits<double>::infinity());
        constexpr int n = 16;
        for (int k = 0; k <= n; ++k)
        {
            const SmPoint3d q = curve_at(*c, ivl.Evaluate(double(k) / n));
            double gap = 0.0;
            const SmPoint2d uv = drop(*p.s, q, gap);
            for (int side = 0; side < 4; ++side)
            {
                if (!on[side])
                    continue;
                const double t = u_side(side) ? uv.y : uv.x;
                if (at(*p.s, side_uv(p.dom, side, t)).DistanceBetween(q) > close)
                    on[side] = false;
                else
                    lo[side] = std::min(lo[side], t), hi[side] = std::max(hi[side], t);
            }
        }
        const int count = int(on[0]) + int(on[1]) + int(on[2]) + int(on[3]);
        if (count == 0)
            throw std::invalid_argument(only + " (a face is trimmed: an edge runs across its surface, not along a side)");
        if ((on[UMIN] && on[UMAX]) || (on[VMIN] && on[VMAX]))
            throw std::invalid_argument(only + " (a face closes around: its surface's opposite sides meet at a seam)");
        int side = 0;
        while (!on[side])
            ++side;
        if (count > 1)  // an edge of no length at a corner
            continue;
        p.edges.push_back({e, OnSide{side, lo[side], hi[side]}});
        cover[side].push_back({lo[side], hi[side]});
    }
    for (int side = 0; side < 4; ++side)
        if (!covers(cover[side], side_lo(p.dom, side), side_hi(p.dom, side)))
            throw std::invalid_argument(only + " (a side of a face has no edge along all of it: a pole, a trimmed corner "
                                               "or a gap)");
    return p;
}

// The largest distance of points along a side of the surface (over the edge's range) from the curve.
double side_off(const SmSurface& s, const SmExtent2d& dom, const OnSide& os, const SmCurve& c, double tol)
{
    const SmExtent1d ci = c.GetNaturalInterval();
    double worst = 0.0;
    for (int k = 0; k <= 32; ++k)
    {
        const SmPoint3d p = at(s, side_uv(dom, os.side, os.t0 + (os.t1 - os.t0) * k / 32.0));
        SmBoolean ok = FALSE;
        double t = 0.0, d = 0.0;
        check(c.DropPointSTEP(ci, p, tol, nullptr, ok, t, d), "SmCurve::DropPointSTEP");
        worst = std::max(worst, ok ? d : 1e300);
    }
    return worst;
}

// The curve along a side of the surface, over the edge's range on it.
CurvePtr side_curve(const SmBSplineSurface& s, const SmExtent2d& dom, const OnSide& os)
{
    const bool u = u_side(os.side);
    const SmExtent2d range = u ? SmExtent2d(SmPoint2d(dom.GetMin().x, os.t0), SmPoint2d(dom.GetMax().x, os.t1))
                               : SmExtent2d(SmPoint2d(os.t0, dom.GetMin().y), SmPoint2d(os.t1, dom.GetMax().y));
    SmBSplineCurve* c = nullptr;
    check(s.CreateIsoParametricCurve(ctx(), u ? SM_SP_U : SM_SP_V, fixed_of(dom, os.side), 0.0, c, &range),
          "SmBSplineSurface::CreateIsoParametricCurve");
    if (!c)
        throw std::runtime_error("the kernel made no curve along a side of a face");
    return CurvePtr(c);
}

// The NURBS data of a surface copied onto an NLib stack.
void nl_copy(SmBSplineSurface& s, NL_SURFACE& out, Stack& stack)
{
    N_SrfInitArrays(&out);
    NL_SURFACE* src = s.GetOrCreateGwNurbPointer();
    if (!src || N_SrfCopy(src, &out, &stack.s))
        throw std::runtime_error("the kernel could not copy a surface's NURBS data");
}

// ---------------------------------------------------------------- clamping knot vectors

using Blocks = std::vector<std::vector<double>>;

// A knot inserted at u (Boehm): the blocks are the homogeneous control points along the direction.
void insert_knot(Blocks& h, std::vector<double>& knots, int p, double u)
{
    int k = 0;
    for (int i = 0; i + 1 < int(knots.size()); ++i)
        if (knots[i] <= u)
            k = i;
    k = std::min(k, int(h.size()) - 1);
    Blocks q(h.size() + 1);
    for (int i = 0; i <= int(h.size()); ++i)
    {
        if (i <= k - p)
            q[i] = h[i];
        else if (i > k)
            q[i] = h[i - 1];
        else
        {
            const double a = (u - knots[i]) / (knots[i + p] - knots[i]);
            q[i].resize(h[i].size());
            for (size_t c = 0; c < h[i].size(); ++c)
                q[i][c] = (1.0 - a) * h[i - 1][c] + a * h[i][c];
        }
    }
    knots.insert(knots.begin() + k + 1, u);
    h.swap(q);
}

// The same spline with knots[p] and knots[n] repeated p + 1 times, what lies outside them dropped.
void clamp(Blocks& h, std::vector<double>& knots, int p)
{
    const double lo = knots[p], hi = knots[knots.size() - p - 1];
    auto mult = [&](double u) { return int(std::count(knots.begin(), knots.end(), u)); };
    if (mult(lo) >= p + 1 && mult(hi) >= p + 1 && knots.front() == lo && knots.back() == hi)
        return;
    for (double u : {lo, hi})
        while (mult(u) < p)
            insert_knot(h, knots, p, u);
    const int first = int(std::find(knots.begin(), knots.end(), lo) - knots.begin());
    const int s = first + mult(lo) - 1 - p;  // the control point at the start
    std::vector<double> inner;
    for (double x : knots)
        if (x > lo && x < hi)
            inner.push_back(x);
    std::vector<double> out(p + 1, lo);
    out.insert(out.end(), inner.begin(), inner.end());
    out.insert(out.end(), p + 1, hi);
    const int count = int(out.size()) - p - 1;
    h = Blocks(h.begin() + s, h.begin() + s + count);
    knots.swap(out);
}

// ---------------------------------------------------------------- distances to a surface

// The parameters of the closest point to p from uv: Newton's method on the squared distance (Gauss-Newton
// where its Hessian is not positive), held to the domain.
SmPoint2d foot(const SmSurface& s, const SmExtent2d& dom, const SmVector3d& p, SmPoint2d uv)
{
    const double ru = dom.GetMax().x - dom.GetMin().x, rv = dom.GetMax().y - dom.GetMin().y;
    for (int it = 0; it < 40; ++it)
    {
        SmVector3d d[9];
        if (s.Evaluate(uv, 2, 2, TRUE, TRUE, FALSE, d, FALSE) != SM_SUCCESS)
            break;
        const SmVector3d r = d[0] - p;
        const SmVector3d& su = d[3];
        const SmVector3d& sv = d[1];
        const double gu = r.Dot(su), gv = r.Dot(sv);
        double a = su.Dot(su) + r.Dot(d[6]), b = su.Dot(sv) + r.Dot(d[4]), c = sv.Dot(sv) + r.Dot(d[2]);
        if (!(a > 0.0 && a * c - b * b > 0.0))
            a = su.Dot(su), b = su.Dot(sv), c = sv.Dot(sv);
        // at a side of the domain, along it only
        const bool fix_u = (uv.x <= dom.GetMin().x && gu > 0.0) || (uv.x >= dom.GetMax().x && gu < 0.0);
        const bool fix_v = (uv.y <= dom.GetMin().y && gv > 0.0) || (uv.y >= dom.GetMax().y && gv < 0.0);
        double du = 0.0, dv = 0.0;
        if (fix_u && fix_v)
            break;
        if (fix_u)
            dv = c > 0.0 ? gv / c : 0.0;
        else if (fix_v)
            du = a > 0.0 ? gu / a : 0.0;
        else
        {
            const double det = a * c - b * b;
            if (!(det > 0.0))
                break;
            du = (c * gu - b * gv) / det;
            dv = (a * gv - b * gu) / det;
        }
        // (no step larger than a quarter of the domain)
        du = std::max(-0.25 * ru, std::min(0.25 * ru, du));
        dv = std::max(-0.25 * rv, std::min(0.25 * rv, dv));
        const SmPoint2d next(std::min(dom.GetMax().x, std::max(dom.GetMin().x, uv.x - du)),
                             std::min(dom.GetMax().y, std::max(dom.GetMin().y, uv.y - dv)));
        const bool done = std::abs(next.x - uv.x) <= 1e-14 * ru && std::abs(next.y - uv.y) <= 1e-14 * rv;
        uv = next;
        if (done)
            break;
    }
    return uv;
}

}  // namespace

namespace smlibpy {

SmBrep* match_edge(const SmBrep* brep, const SmEdge* edge, const SmCurve* curve, double extent)
{
    const char* what = "match_edge";
    if (!brep || !edge || !curve)
        throw std::invalid_argument("match_edge: no body, edge or curve");
    if (!(extent > 0.0 && extent < 1.0))
        throw std::invalid_argument("match_edge: the extent is a part of the face across from the edge: above 0 and below 1");
    smlibpy::CopyMap map = smlibpy::copy_with_map(brep, {}, {const_cast<SmEdge*>(edge)}, {});
    BrepPtr body(map.brep);
    SmEdge* first = map.edges.empty() ? nullptr : map.edges[0];
    if (!first)
        throw std::invalid_argument("match_edge: the edge is not an edge of the body");
    SmExtent3d box;
    check(body->CalculateBoundingBox(box), "SmBrep::CalculateBoundingBox");
    const double size = box_size(box);
    const double tol = tolerance_of(body.get(), size);

    SmTArray<SmFace*> faces;
    first->GetFaces(faces);
    if (faces.GetSize() == 0)
        throw std::invalid_argument("match_edge: the edge bounds no face");

    // Each face that changes: matched along one edge to its new curve; where its other edges move, they
    // take its new sides and the faces beyond them follow.
    struct Job
    {
        SmFace* face;
        SmEdge* edge;
        const SmBSplineCurve* curve;
    };
    std::map<SmFace*, Patch> done;
    std::map<SmEdge*, CurvePtr> curves;
    std::map<SmVertex*, SmPoint3d> points;
    std::deque<Job> queue;
    curves[first] = bspline_copy(*curve, size);
    for (ULONG i = 0; i < faces.GetSize(); ++i)
        queue.push_back({faces[i], first, curves[first].get()});
    while (!queue.empty())
    {
        const Job job = queue.front();
        queue.pop_front();
        auto found = done.find(job.face);
        if (found != done.end())
        {
            // a face that changed already: its side must run along the edge's new curve
            const Patch& p = found->second;
            const OnSide* os = p.find(job.edge);
            if (!os || side_off(*p.s, p.dom, *os, *job.curve, tol) > 10.0 * tol)
                throw std::invalid_argument("match_edge: the change runs around the sheet and back into a face it has "
                                            "changed already; match an edge of a sheet that does not close around");
            continue;
        }
        if (done.size() >= 4096)
            throw std::runtime_error("match_edge: the change does not end");
        Patch p = patch_of(job.face, size, what, "matched");
        const OnSide* os = p.find(job.edge);
        if (!os)
            throw std::runtime_error("match_edge: an edge is not on its face's sides");
        const double lo = side_lo(p.dom, os->side), hi = side_hi(p.dom, os->side);
        if (os->t0 > lo + 1e-6 * (hi - lo) || os->t1 < hi - 1e-6 * (hi - lo))
            throw std::invalid_argument(std::string("match_edge: the edge is only a part of a side of ") +
                                        (job.edge == first ? "its face" : "a face next to it") +
                                        "; a face changes along whole sides of its surface");
        // the curve running the way the side does
        const SmPoint3d c0 = at(*p.s, side_uv(p.dom, os->side, lo)), c1 = at(*p.s, side_uv(p.dom, os->side, hi));
        const SmPoint3d a = curve_start(*job.curve), b = curve_end(*job.curve);
        CurvePtr turned;
        const SmBSplineCurve* along = job.curve;
        if (a.DistanceBetween(c1) + b.DistanceBetween(c0) < a.DistanceBetween(c0) + b.DistanceBetween(c1))
        {
            turned = reversed_copy(*job.curve, size);
            along = turned.get();
        }
        SplinePtr s2 = spline_of(net_of(*p.s));
        check(s2->AdjustBoundaryCurve(along, u_side(os->side) ? SM_SP_U : SM_SP_V, min_side(os->side) ? TRUE : FALSE,
                                      extent),
              "SmBSplineSurface::AdjustBoundaryCurve");
        s2->SetBSplineSurfaceForm(SM_SF_UNSPECIFIED);
        const SmExtent2d d2 = s2->GetNaturalUVDomain();
        if (d2.GetMin().DistanceBetween(p.dom.GetMin()) > 1e-9 * (hi - lo) ||
            d2.GetMax().DistanceBetween(p.dom.GetMax()) > 1e-9 * (hi - lo))
            throw std::runtime_error("match_edge: the kernel changed the parameters of a face's surface");
        const double off = side_off(*s2, p.dom, OnSide{os->side, lo, hi}, *along, tol);
        if (off > tol)
            throw std::runtime_error("match_edge: the kernel did not put the face's side onto the curve (" + fmt(off) + " off)");
        // the face's other edges
        for (const auto& [g, gs] : p.edges)
        {
            if (g == job.edge)
                continue;
            double moved = 0.0;
            for (int k = 0; k <= 16; ++k)
            {
                const SmPoint2d uv = side_uv(p.dom, gs.side, gs.t0 + (gs.t1 - gs.t0) * k / 16.0);
                moved = std::max(moved, at(*s2, uv).DistanceBetween(at(*p.s, uv)));
            }
            if (moved <= tol)
                continue;
            if (curves.find(g) == curves.end())
                curves[g] = side_curve(*s2, p.dom, gs);
            SmTArray<SmFace*> beyond;
            g->GetFaces(beyond);
            for (ULONG i = 0; i < beyond.GetSize(); ++i)
                if (beyond[i] != job.face)
                    queue.push_back({beyond[i], g, curves[g].get()});
        }
        // its corners
        SmTArray<SmVertex*> vertices;
        job.face->GetVertices(vertices);
        for (ULONG i = 0; i < vertices.GetSize(); ++i)
        {
            SmVertex* v = vertices[i];
            double gap = 0.0;
            const SmPoint3d moved = at(*s2, drop(*p.s, v->GetPoint(), gap));
            if (moved.DistanceBetween(v->GetPoint()) <= tol)
                continue;
            auto it = points.find(v);
            if (it != points.end() && it->second.DistanceBetween(moved) > 10.0 * tol)
                throw std::runtime_error("match_edge: two faces move a vertex to different points");
            points[v] = moved;
        }
        p.s = std::move(s2);
        done.emplace(job.face, std::move(p));
    }
    // every face at a vertex that moves changes with it
    for (const auto& item : points)
    {
        SmTArray<SmFace*> around;
        item.first->GetFaces(around);
        for (ULONG i = 0; i < around.GetSize(); ++i)
            if (done.find(around[i]) == done.end())
                throw std::invalid_argument("match_edge: a corner that moves is a corner of a face whose edges do not "
                                            "move with it (faces that meet at a point only)");
    }

    // The body takes the new geometry: points, curves (from their start vertex to their end vertex),
    // then the surfaces, whose trims are built again from the edges.
    for (const auto& [v, p] : points)
        v->SetPoint(p);
    for (auto& [g, c] : curves)
    {
        const SmPoint3d s0 = g->GetStartVertex()->GetPoint(), s1 = g->GetEndVertex()->GetPoint();
        const SmPoint3d a = curve_start(*c), b = curve_end(*c);
        CurvePtr use = a.DistanceBetween(s1) + b.DistanceBetween(s0) < a.DistanceBetween(s0) + b.DistanceBetween(s1)
                           ? reversed_copy(*c, size)
                           : std::move(c);
        const double ends = std::max(curve_start(*use).DistanceBetween(s0), curve_end(*use).DistanceBetween(s1));
        if (ends > 10.0 * tol)
            throw std::runtime_error("match_edge: an edge's new curve does not end at its vertices (" + fmt(ends) + " off)");
        SmBSplineCurve* raw = use.release();
        const SmStatus st = body->ReplaceCurve(g, raw);
        if (st != SM_SUCCESS)
        {
            if (raw->GetOwner() == nullptr)
                delete raw;
            check(st, "SmBrep::ReplaceCurve");
        }
    }
    std::vector<SmFace*> changed;
    for (auto& [f, p] : done)
    {
        SmBSplineSurface* raw = p.s.release();
        const SmStatus st = body->ReplaceSurface(f, raw, FALSE, nullptr, TRUE);
        if (st != SM_SUCCESS)
        {
            if (raw->GetOwner() == nullptr)
                delete raw;
            check(st, "SmBrep::ReplaceSurface");
        }
        changed.push_back(f);
    }
    double worst = 0.0;
    for (SmFace* f : changed)
    {
        SmTArray<SmEdge*> edges;
        f->GetEdges(edges);
        for (ULONG i = 0; i < edges.GetSize(); ++i)
        {
            const SmCurve* c = edges[i]->GetCurve();
            const SmExtent1d ivl = edges[i]->GetInterval();
            for (int k = 0; k <= 8; ++k)
            {
                double gap = 0.0;
                drop(*f->GetSurface(), curve_at(*c, ivl.Evaluate(k / 8.0)), gap);
                worst = std::max(worst, gap);
            }
        }
    }
    if (worst > 10.0 * tol)
        throw std::runtime_error("match_edge: an edge ended " + fmt(worst) + " off its face");
    return body.release();
}

SmBrep* merge_faces(const SmFace* face_a, const SmFace* face_b)
{
    const char* what = "merge_faces";
    if (!face_a || !face_b)
        throw std::invalid_argument("merge_faces: no face");
    if (face_a == face_b)
        throw std::invalid_argument("merge_faces: the two faces are one face");
    const SmBrep* brep = face_a->GetBrep();
    if (!brep || face_b->GetBrep() != brep)
        throw std::invalid_argument("merge_faces: the faces are not faces of one body");
    SmFace* a = const_cast<SmFace*>(face_a);
    SmFace* b = const_cast<SmFace*>(face_b);
    SmExtent3d box, box_b;
    check(a->CalculateBoundingBox(box), "SmFace::CalculateBoundingBox");
    check(b->CalculateBoundingBox(box_b), "SmFace::CalculateBoundingBox");
    box.AddPoint3d(box_b.GetMin());
    box.AddPoint3d(box_b.GetMax());
    const double size = box_size(box);
    const double tol = tolerance_of(brep, size);
    const Patch pa = patch_of(a, size, what, "merged");
    const Patch pb = patch_of(b, size, what, "merged");

    // the side they share
    int sa = -1, sb = -1;
    std::vector<std::pair<double, double>> ca, cb;
    for (const auto& [e, os] : pa.edges)
    {
        const OnSide* ob = pb.find(e);
        if (!ob)
            continue;
        if (sa >= 0 && (os.side != sa || ob->side != sb))
            throw std::invalid_argument("merge_faces: the faces share edges on more than one side");
        sa = os.side, sb = ob->side;
        ca.push_back({os.t0, os.t1});
        cb.push_back({ob->t0, ob->t1});
    }
    if (sa < 0)
        throw std::invalid_argument("merge_faces: the faces share no edge");
    if (!covers(ca, side_lo(pa.dom, sa), side_hi(pa.dom, sa)) || !covers(cb, side_lo(pb.dom, sb), side_hi(pb.dom, sb)))
        throw std::invalid_argument("merge_faces: the faces share only a part of a side; they must meet along a whole "
                                    "side of each");

    // a's shared side to u = max, b's to u = min, both running the same way along it
    Net na = net_of(*pa.s), nb = net_of(*pb.s);
    switch (sa)
    {
    case UMIN: reverse(na, true); break;
    case VMAX: swap_uv(na); break;
    case VMIN: reverse(na, false), swap_uv(na); break;
    default: break;
    }
    switch (sb)
    {
    case UMAX: reverse(nb, true); break;
    case VMIN: swap_uv(nb); break;
    case VMAX: reverse(nb, false), swap_uv(nb); break;
    default: break;
    }
    SplinePtr A = spline_of(na), B = spline_of(nb);
    auto corners = [&](SmPoint3d& a0, SmPoint3d& a1, SmPoint3d& b0, SmPoint3d& b1) {
        const SmExtent2d da = A->GetNaturalUVDomain(), db = B->GetNaturalUVDomain();
        a0 = at(*A, da.GetMax().x, da.GetMin().y), a1 = at(*A, da.GetMax().x, da.GetMax().y);
        b0 = at(*B, db.GetMin().x, db.GetMin().y), b1 = at(*B, db.GetMin().x, db.GetMax().y);
    };
    SmPoint3d a0, a1, b0, b1;
    corners(a0, a1, b0, b1);
    if (a0.DistanceBetween(b1) + a1.DistanceBetween(b0) < a0.DistanceBetween(b0) + a1.DistanceBetween(b1))
    {
        reverse(nb, false);
        B = spline_of(nb);
        corners(a0, a1, b0, b1);
    }
    const double apart = std::max(a0.DistanceBetween(b0), a1.DistanceBetween(b1));
    if (apart > 10.0 * tol)
        throw std::invalid_argument("merge_faces: the faces' shared side ends at different corners (" + fmt(apart) + " apart)");

    // NLib on copies on this file's stack: compatible along v, joined across u
    Stack stack;
    NL_SURFACE la, lb, lj;
    nl_copy(*A, la, stack);
    nl_copy(*B, lb, stack);
    NL_SURFACE* both[2] = {&la, &lb};
    if (N_MakeSrfsCompatible(both, 1, NL_VDIR, &stack.s))
        throw std::runtime_error("merge_faces: the kernel could not make the two surfaces compatible along the shared side");
    N_SrfInitArrays(&lj);
    if (N_SrfJoin(&la, &lb, NL_UDIR, tol, &lj, &stack.s))
        throw std::runtime_error("merge_faces: the kernel could not join the two surfaces");
    SplinePtr J(new (ctx()) SmBSplineSurface(static_cast<const gw_SURFACE*>(&lj)));
    J->SetBSplineSurfaceForm(SM_SF_UNSPECIFIED);

    // the joined surface covers both faces' surfaces
    double off = 0.0;
    for (const SmBSplineSurface* s : {A.get(), B.get()})
    {
        const SmExtent2d d = s->GetNaturalUVDomain();
        for (int i = 0; i <= 8; ++i)
            for (int j = 0; j <= 8; ++j)
            {
                double gap = 0.0;
                drop(*J, at(*s, d.Evaluate(i / 8.0, j / 8.0)), gap);
                off = std::max(off, gap);
            }
    }
    if (off > 10.0 * tol)
        throw std::invalid_argument("merge_faces: the surfaces do not join into one (the joined surface misses them by " +
                                    fmt(off) + "): their parameters along the shared side differ; merge faces split from "
                                    "one surface or built through the same curves");
    // its normal follows a's (and must follow b's)
    const SmPoint2d ua = pa.dom.Evaluate(0.5, 0.5), ub = pb.dom.Evaluate(0.5, 0.5);
    const SmVector3d n_a = smlibpy::face_outward_normal(a, *pa.s, ua), n_b = smlibpy::face_outward_normal(b, *pb.s, ub);
    double gap = 0.0;
    const SmPoint2d ja = drop(*J, at(*pa.s, ua), gap), jb = drop(*J, at(*pb.s, ub), gap);
    SmVector3d nja, njb;
    check(J->EvaluateNormal(ja, TRUE, TRUE, nja), "SmSurface::EvaluateNormal");
    check(J->EvaluateNormal(jb, TRUE, TRUE, njb), "SmSurface::EvaluateNormal");
    if ((nja.Dot(n_a) > 0.0) != (njb.Dot(n_b) > 0.0))
        throw std::invalid_argument("merge_faces: the faces' normals point to opposite sides; turn one of them over first");
    const SmExtent2d dj = J->GetNaturalUVDomain();
    return smlibpy::surface_sheet(J.release(), dj, ja, n_a);
}

SmSurface* nurbs_surface(int du, int dv, int nu, int nv, const std::vector<double>& poles,
                         const std::vector<double>& u_knots, const std::vector<double>& v_knots,
                         const std::vector<double>& weights)
{
    if (du < 1 || du > 32 || dv < 1 || dv > 32)
        throw std::invalid_argument("nurbs_surface: the degrees must be 1 to 32");
    if (nu < du + 1 || nv < dv + 1)
        throw std::invalid_argument("nurbs_surface: a degree d needs at least d + 1 control points in its direction");
    const size_t n = size_t(nu) * size_t(nv);
    if (poles.size() != 3 * n)
        throw std::invalid_argument("nurbs_surface: expected " + std::to_string(n) + " control points");
    if (!weights.empty() && weights.size() != n)
        throw std::invalid_argument("nurbs_surface: expected a weight per control point");
    const std::pair<const std::vector<double>*, std::pair<int, int>> dirs[2] = {{&u_knots, {du, nu}}, {&v_knots, {dv, nv}}};
    for (int d = 0; d < 2; ++d)
    {
        const std::vector<double>& k = *dirs[d].first;
        const int p = dirs[d].second.first, count = dirs[d].second.second;
        const char* name = d == 0 ? "u" : "v";
        if (int(k.size()) != count + p + 1)
            throw std::invalid_argument(std::string("nurbs_surface: ") + name + " needs " + std::to_string(count + p + 1) +
                                        " knots (control points + degree + 1), got " + std::to_string(k.size()));
        for (size_t i = 0; i < k.size(); ++i)
        {
            if (!std::isfinite(k[i]))
                throw std::invalid_argument("nurbs_surface: the knots must be finite numbers");
            if (i > 0 && k[i] < k[i - 1])
                throw std::invalid_argument(std::string("nurbs_surface: the ") + name + " knots must not decrease");
        }
        if (!(k[p] < k[count]))
            throw std::invalid_argument(std::string("nurbs_surface: the ") + name + " knots span nothing (knots[degree] "
                                        "must lie below knots[count of control points])");
        for (size_t i = 0; i < k.size(); ++i)
            if (k[i] > k[p] && k[i] < k[count] && std::count(k.begin(), k.end(), k[i]) > p)
                throw std::invalid_argument(std::string("nurbs_surface: an inner ") + name + " knot repeats more often "
                                            "than the degree (the surface would come apart there)");
    }
    for (double x : poles)
        if (!std::isfinite(x))
            throw std::invalid_argument("nurbs_surface: the control points must be finite numbers");
    for (double w : weights)
        if (!(w > 0.0) || !std::isfinite(w))
            throw std::invalid_argument("nurbs_surface: the weights must be positive numbers");

    // homogeneous control points by rows along u, clamped along u, then along v
    Blocks rows(nu);
    for (int i = 0; i < nu; ++i)
        for (int j = 0; j < nv; ++j)
        {
            const size_t at = size_t(i) * nv + j;
            const double w = weights.empty() ? 1.0 : weights[at];
            rows[i].insert(rows[i].end(), {poles[3 * at] * w, poles[3 * at + 1] * w, poles[3 * at + 2] * w, w});
        }
    std::vector<double> uk = u_knots, vk = v_knots;
    clamp(rows, uk, du);
    nu = int(rows.size());
    Blocks cols(nv);
    for (int j = 0; j < nv; ++j)
        for (int i = 0; i < nu; ++i)
            cols[j].insert(cols[j].end(), rows[i].begin() + 4 * j, rows[i].begin() + 4 * j + 4);
    clamp(cols, vk, dv);
    nv = int(cols.size());

    Net net;
    net.du = ULONG(du), net.dv = ULONG(dv);
    for (int i = 0; i < nu; ++i)
        for (int j = 0; j < nv; ++j)
        {
            const double* h = &cols[j][4 * i];
            net.poles.push_back(SmPoint3d(h[0] / h[3], h[1] / h[3], h[2] / h[3]));
            if (!weights.empty())
                net.weights.push_back(h[3]);
        }
    for (int d = 0; d < 2; ++d)
    {
        const std::vector<double>& k = d == 0 ? uk : vk;
        std::vector<double>& unique = d == 0 ? net.uk : net.vk;
        std::vector<ULONG>& mult = d == 0 ? net.um : net.vm;
        for (double x : k)
        {
            if (!unique.empty() && unique.back() == x)
                ++mult.back();
            else
                unique.push_back(x), mult.push_back(1);
        }
    }
    return spline_of(net).release();
}

std::vector<double> surface_distances(const SmSurface* surface, const std::vector<double>& points)
{
    if (!surface)
        throw std::invalid_argument("surface_distances: no surface");
    if (points.size() % 3 != 0)
        throw std::invalid_argument("surface_distances: the points must be x, y, z triples");
    const SmExtent2d dom = surface->GetNaturalUVDomain();
    int gu = 33, gv = 33;
    if (const SmBSplineSurface* b = SM_CAST_PTR(SmBSplineSurface, surface))
    {
        gu = int(std::min<ULONG>(65, std::max<ULONG>(17, 4 * b->GetNumberControlPoints(SM_SP_U) + 1)));
        gv = int(std::min<ULONG>(65, std::max<ULONG>(17, 4 * b->GetNumberControlPoints(SM_SP_V) + 1)));
    }
    std::vector<SmPoint3d> grid;
    std::vector<SmPoint2d> params;
    grid.reserve(size_t(gu) * gv);
    for (int i = 0; i < gu; ++i)
        for (int j = 0; j < gv; ++j)
        {
            const SmPoint2d uv = dom.Evaluate(double(i) / (gu - 1), double(j) / (gv - 1));
            params.push_back(uv);
            grid.push_back(at(*surface, uv));
        }
    std::vector<double> out;
    out.reserve(points.size() / 3);
    for (size_t k = 0; k + 2 < points.size(); k += 3)
    {
        const SmPoint3d p(points[k], points[k + 1], points[k + 2]);
        // the three nearest samples
        size_t near[3] = {0, 0, 0};
        double dist[3] = {1e300, 1e300, 1e300};
        for (size_t g = 0; g < grid.size(); ++g)
        {
            const double dx = grid[g].x - p.x, dy = grid[g].y - p.y, dz = grid[g].z - p.z;
            const double d = dx * dx + dy * dy + dz * dz;
            if (d < dist[2])
            {
                int at_ = 2;
                while (at_ > 0 && d < dist[at_ - 1])
                {
                    dist[at_] = dist[at_ - 1], near[at_] = near[at_ - 1];
                    --at_;
                }
                dist[at_] = d, near[at_] = g;
            }
        }
        double best = std::sqrt(dist[0]);
        const SmVector3d pv(p.x, p.y, p.z);
        for (size_t s = 0; s < 3 && dist[s] < 1e300; ++s)
        {
            const SmPoint2d uv = foot(*surface, dom, pv, params[near[s]]);
            best = std::min(best, at(*surface, uv).DistanceBetween(p));
        }
        // Where the surface folds, a nearer point can lie between the samples: every knot span that
        // could hold one (by the box of its control points) is sampled, and Newton's method (held to
        // the domain) starts from its nearest samples (a fit around 330 degrees of a tube: up to 1.12
        // nearer than the samples and their feet found).
        const std::vector<double> q = {p.x, p.y, p.z};
        const std::vector<double> box = {dom.GetUMin(), dom.GetUMax(), dom.GetVMin(), dom.GetVMax()};
        for (const SurfacePatch& patch : surface_patches(surface, box, q))
        {
            if (patch.bound >= best)
                break;
            // Newton from the two nearest samples of 5 x 5 over the patch
            std::pair<double, SmPoint2d> two[2] = {{1e300, SmPoint2d()}, {1e300, SmPoint2d()}};
            for (int a = 0; a < 5; ++a)
                for (int c = 0; c < 5; ++c)
                {
                    const SmPoint2d uv(patch.u0 + (patch.u1 - patch.u0) * a / 4.0, patch.v0 + (patch.v1 - patch.v0) * c / 4.0);
                    const double d = at(*surface, uv).DistanceBetween(p);
                    if (d < two[1].first)
                    {
                        two[1] = {d, uv};
                        if (two[1].first < two[0].first)
                            std::swap(two[0], two[1]);
                    }
                }
            for (const auto& start : two)
                if (start.first < 1e300)
                {
                    double u = start.second.x, v = start.second.y;
                    best = std::min({best, start.first, nearest_on_surface(surface, box, q, u, v)});
                }
        }
        out.push_back(best);
    }
    return out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_sheet_edit(py::module_ m)
{
    m.def("match_edge", &smlibpy::match_edge, py::arg("brep"), py::arg("edge"), py::arg("curve"), py::arg("extent") = 0.25,
          py::return_value_policy::take_ownership,
          "A copy of the body whose edge runs along the curve; its faces change within `extent` of their parameter "
          "range across from it, and the faces beyond edges that move with it follow (the curve is not consumed).");
    m.def("merge_faces", &smlibpy::merge_faces, py::arg("face_a"), py::arg("face_b"), py::return_value_policy::take_ownership,
          "A sheet of one face on one surface covering two faces that share a whole side; its normal follows face_a's.");
    m.def("nurbs_surface", &smlibpy::nurbs_surface, py::arg("u_degree"), py::arg("v_degree"), py::arg("nu"), py::arg("nv"),
          py::arg("poles"), py::arg("u_knots"), py::arg("v_knots"), py::arg("weights"),
          py::return_value_policy::reference,
          "A B-spline surface from its NURBS data (poles x, y, z flat in rows along u; full knot vectors; weights or "
          "[]). The surface is the caller's (ext.delete_surface).");
    m.def("surface_distances", &smlibpy::surface_distances, py::arg("surface"), py::arg("points"),
          "How far each point (x, y, z flat) lies from the surface: to its closest point over the whole domain.");
}
#endif  // SMLIBPY_PYTHON
