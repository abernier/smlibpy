// SPDX-License-Identifier: Apache-2.0
//
// Surfaces bounded by curves (`smlibpy._core.ext`):
//
//   fill_loop(curves, faces, edges, tolerance)    patches filling a closed loop of curves
//   network_surface(u, v, tolerance)              a surface through a network of crossing curves
//
// The kernel's constructors cannot be called as they are:
//
// - SmBSplineSurface::CreateCoonsPatch checks for four boundary curves only with SM_ASSERT (compiled
//   out: NDEBUG) and then reads all four; CreateNSidedPatch reads a cross-derivative curve per boundary
//   from an array the header says may be empty. Both get exactly what they read here.
// - SmBrep::CreateCornerBlend (the tangent fill of a loop of edgeuses) inserts the point curve of a
//   three-sided loop at a parameter of 0 or 1 whatever the curve's interval, puts both point curves of
//   a two-sided loop at the same end, and its N-sided branch guesses which side of the edges the patch
//   goes to when no edge lies on its surface's domain border (it only warns). The loop is ordered here,
//   the point curve put where the sides meet, and every result checked: the patches run through the
//   curves, lie across each edge from its face and are tangent to it; a patch on the wrong side is
//   built again with the loop turned round. Its N-sided fill (five sides and more) is tangent only
//   approximately: up to about 1.4 degrees halfway between a side's middle and its ends, whatever
//   angle tolerance it is given; Coons patches (three and four sides) within 0.02 degrees, now that
//   its four-sided branch puts all four sides on [0, 1] (third_party/patches: a round hole of one
//   edge, cut into four equal arcs, was filled up to 64 degrees off the sphere). Where the curves
//   of a loop run into each other without corners, their ends are no corners of the patch either:
//   one closed curve, or two or three that make one, become four sides as nearly equal as those
//   ends allow, so that a sphere's hole is filled the same however the sphere is turned.
// - SmBSplineSurface::CreateGordonSurface needs a compatible network (crossings at the same parameter
//   along every curve of a set) and fills fixed arrays of 640 curves without a count check; given an
//   incompatible one it misses its own curves (4.15e-2 on a 10 mm patch), and even given a compatible
//   one it intersects the curves again and reparameterizes them piecewise linearly to what it finds
//   (5.7e-4 off on a 10 mm network; its mapping of the crossings to [0, 1] is also right only for curves
//   whose parameters start at 0). Here each curve is sampled so that its crossings fall at parameters
//   common to its set (arc length mapped through a monotone cubic between the crossings) and
//   interpolated, N_CreateGordonSrf gets those parameters directly, and the surface is measured against
//   the curves as given (3e-8 on the same network).
#include "kernel.h"
#include "fill.h"
#include "ext_shared.h"
#include "measure.h"

#include <SmApiGeneral.h>
#include <SmApiQueries.h>
#include <nurbs.h>
#include <NL_CrvBasic.h>
#include <NL_SrfAdv.h>

#include <algorithm>
#include <cstdio>
#include <cmath>
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

struct CurveDeleter
{
    void operator()(SmCurve* c) const
    {
        if (c && c->GetOwner() == nullptr)
            delete c;
    }
};
using CurvePtr = std::unique_ptr<SmCurve, CurveDeleter>;
using SplinePtr = std::unique_ptr<SmBSplineCurve, CurveDeleter>;

struct SurfaceDeleter
{
    void operator()(SmSurface* s) const
    {
        if (s && s->GetOwner() == nullptr)
            delete s;
    }
};
using SurfacePtr = std::unique_ptr<SmSurface, SurfaceDeleter>;

std::string format(const SmPoint3d& p)
{
    char buf[96];
    std::snprintf(buf, sizeof buf, "(%.6g, %.6g, %.6g)", p.x, p.y, p.z);
    return buf;
}

std::string format(double d)
{
    char buf[32];
    std::snprintf(buf, sizeof buf, "%.3g", d);
    return buf;
}

SmPoint3d point(const SmCurve& c, double t)
{
    SmPoint3d p;
    check(c.EvaluatePoint(t, p), "SmCurve::EvaluatePoint");
    return p;
}
SmPoint3d first(const SmCurve& c) { return point(c, c.GetNaturalInterval().GetMin()); }
SmPoint3d last(const SmCurve& c) { return point(c, c.GetNaturalInterval().GetMax()); }

SmVector3d tangent(const SmCurve& c, double t)
{
    SmVector3d pv[2];
    check(c.Evaluate(t, 1, TRUE, pv), "SmCurve::Evaluate");
    return pv[1];
}

CurvePtr copy(const SmCurve* c)
{
    SmCurve* out = nullptr;
    check(c->Copy(ctx(), out), "SmCurve::Copy");
    return CurvePtr(out);
}

// The curve over [a, b] of its interval, a copy.
CurvePtr piece(const SmCurve* c, double a, double b)
{
    CurvePtr p = copy(c);
    SmExtent1d ivl(a, b);
    check(p->Trim(ivl), "SmCurve::Trim");
    return p;
}

// A B-spline copy of a curve without weights over [0, 1] (arcs and other rational curves
// interpolated through samples, more until they stay within `tol`), turned where `reversed`.
SplinePtr nonrational(const SmCurve* c, double tol, bool reversed)
{
    SplinePtr p;
    const SmBSplineCurve* b = SM_CAST_PTR(SmBSplineCurve, c);
    if (b && b->IsRational() == FALSE)
        p.reset(new (ctx()) SmBSplineCurve(*b));
    else
    {
        const SmExtent1d ivl = c->GetNaturalInterval();
        for (int n = 16; !p; n *= 2)
        {
            SmTArray<SmPoint3d> pts;
            for (int k = 0; k <= n; ++k)
                pts.Add(point(*c, ivl.Evaluate(double(k) / n)));
            SmTArray<SmVector3d> ends;
            SmBSplineCurve* out = nullptr;
            check(SmBSplineCurve::CreateInterpolatingCurve(ctx(), SM_CP_UNIFORM, 3, 3, pts, ends, nullptr, FALSE, out),
                  "SmBSplineCurve::CreateInterpolatingCurve");
            SplinePtr q(out);
            // between the samples: the curve's points against the interpolant
            double gap = 0.0;
            const SmExtent1d qi = q->GetNaturalInterval();
            for (int k = 0; k < n; ++k)
            {
                const double s = (k + 0.5) / n;
                gap = std::max(gap, point(*c, ivl.Evaluate(s)).DistanceBetween(point(*q, qi.Evaluate(s))));
            }
            if (gap <= tol)
                p = std::move(q);
            else if (n >= 4096)
                throw std::runtime_error("fill: a curve could not be approximated without weights within " + format(tol));
        }
    }
    if (reversed)
    {
        SmExtent1d turned;
        check(p->ReverseParameterization(p->GetNaturalInterval(), turned), "SmBSplineCurve::ReverseParameterization");
    }
    check(p->EditParameterization(SmExtent1d(0.0, 1.0)), "SmBSplineCurve::EditParameterization");
    return p;
}

// One side of the loop: a curve, and for a tangent side the face it is an edge of.
struct Side
{
    CurvePtr curve;                 // over its own interval, in its own direction
    CurvePtr uv;                    // tangent sides: the edge's UV trim curve, over the curve's interval
    const SmSurface* surface = nullptr;
    const SmFace* face = nullptr;
    const SmEdge* edge = nullptr;
    bool reversed = false;          // runs against the loop

    SmPoint3d from() const { return reversed ? last(*curve) : first(*curve); }
    SmPoint3d to() const { return reversed ? first(*curve) : last(*curve); }
};

// The sides of the chained loop cut into pieces of equal parameter length, count[i] of side i, in the
// loop's order.
std::vector<Side> cut(std::vector<Side>& sides, const std::vector<int>& count)
{
    std::vector<Side> out;
    for (size_t j = 0; j < sides.size(); ++j)
    {
        Side& s = sides[j];
        const int k = count[j];
        if (k == 1)
        {
            out.push_back(std::move(s));
            continue;
        }
        const SmExtent1d ivl = s.curve->GetNaturalInterval();
        for (int i = 0; i < k; ++i)
        {
            const int m = s.reversed ? k - 1 - i : i;  // (a side that runs against the loop: from its end)
            const double a = ivl.Evaluate(double(m) / k), b = ivl.Evaluate(double(m + 1) / k);
            Side p;
            p.curve = piece(s.curve.get(), a, b);
            if (s.uv)
                p.uv = piece(s.uv.get(), a, b);
            p.surface = s.surface, p.face = s.face, p.edge = s.edge, p.reversed = s.reversed;
            out.push_back(std::move(p));
        }
    }
    return out;
}

// Whether the loop runs on from side a into side b without a corner (in directions within half a
// degree where they meet).
bool smooth(const Side& a, const Side& b)
{
    const SmExtent1d ia = a.curve->GetNaturalInterval(), ib = b.curve->GetNaturalInterval();
    SmVector3d ta = tangent(*a.curve, a.reversed ? ia.GetMin() : ia.GetMax());
    SmVector3d tb = tangent(*b.curve, b.reversed ? ib.GetMax() : ib.GetMin());
    if (a.reversed)
        ta = ta * -1.0;
    if (b.reversed)
        tb = tb * -1.0;
    const double la = ta.Length(), lb = tb.Length();
    return la > 0.0 && lb > 0.0 && ta.Dot(tb) >= std::cos(0.5 * SM_PI / 180.0) * la * lb;
}

// How many pieces each side of the chained loop is cut into: one curve into four, two into four
// sides. Curves that run into each other without corners all round, two or three (a closed curve cut
// where its sheet's seam or another face crosses it), end where the hole's shape has no corner: the
// four sides are made as nearly equal in length as those ends allow, so that a round hole is filled
// the same wherever its rim was cut (a sphere's, however the sphere is turned).
std::vector<int> pieces(const std::vector<Side>& sides)
{
    const size_t n = sides.size();
    std::vector<int> count(n, 1);
    if (n == 1)
        count[0] = 4;
    if (n == 2)
        count = {2, 2};
    if (n != 2 && n != 3)
        return count;
    for (size_t i = 0; i < n; ++i)
        if (!smooth(sides[i], sides[(i + 1) % n]))
            return count;
    std::vector<double> length;
    for (const Side& s : sides)
    {
        const SmExtent1d ivl = s.curve->GetNaturalInterval();
        length.push_back(smlibpy::curve_length(s.curve.get(), ivl.GetMin(), ivl.GetMax(), 1e-10));
    }
    if (n == 3)
    {
        count[std::max_element(length.begin(), length.end()) - length.begin()] = 2;  // the longest in two
        return count;
    }
    // of 1 + 3, 2 + 2 and 3 + 1 pieces, the most even
    auto spread = [&](int a) {
        const double x = length[0] / a, y = length[1] / (4 - a);
        return std::max(x, y) / std::max(std::min(x, y), 1e-300);
    };
    for (int a : {1, 3})
        if (spread(a) < spread(count[0]) * (1.0 - 1e-9))
            count = {a, 4 - a};
    return count;
}

// The sides ordered and turned into one loop, each starting where the one before ends.
void chain(std::vector<Side>& sides, double tol)
{
    std::vector<Side> out;
    out.push_back(std::move(sides[0]));
    std::vector<Side> rest;
    for (size_t i = 1; i < sides.size(); ++i)
        rest.push_back(std::move(sides[i]));
    while (!rest.empty())
    {
        const SmPoint3d end = out.back().to();
        size_t best = 0;
        bool turn = false;
        double gap = 1e300;
        for (size_t j = 0; j < rest.size(); ++j)
        {
            const double d0 = first(*rest[j].curve).DistanceBetween(end), d1 = last(*rest[j].curve).DistanceBetween(end);
            if (d0 < gap)
                gap = d0, best = j, turn = false;
            if (d1 < gap)
                gap = d1, best = j, turn = true;
        }
        if (gap > tol)
            throw std::invalid_argument("fill: the curves do not form a closed loop: no curve starts or ends at " +
                                        format(end) + " (the nearest end is " + format(gap) + " away)");
        rest[best].reversed = turn;
        out.push_back(std::move(rest[best]));
        rest.erase(rest.begin() + best);
    }
    const double gap = out.back().to().DistanceBetween(out.front().from());
    if (gap > tol)
        throw std::invalid_argument("fill: the curves do not close: the loop ends " + format(gap) + " from where it starts, at " +
                                    format(out.front().from()));
    sides = std::move(out);
}

// Patches through curves alone: a bilinear Coons patch for four sides, an N-sided fill otherwise.
std::vector<SurfacePtr> free_patches(const std::vector<Side>& sides, double tol)
{
    std::vector<SplinePtr> b;
    for (const Side& s : sides)
        b.push_back(nonrational(s.curve.get(), 0.5 * tol, s.reversed));
    std::vector<SurfacePtr> out;
    if (b.size() == 4)
    {
        // bottom 0, right 1, top 2 and left 3 turned: left and right upward, bottom and top to the right
        for (int i : {2, 3})
        {
            SmExtent1d turned;
            check(b[i]->ReverseParameterization(b[i]->GetNaturalInterval(), turned), "SmBSplineCurve::ReverseParameterization");
            check(b[i]->EditParameterization(SmExtent1d(0.0, 1.0)), "SmBSplineCurve::EditParameterization");
        }
        SmTArray<SmBSplineCurve*> bounds, derivs;
        bounds.Add(b[3].get());
        bounds.Add(b[1].get());
        bounds.Add(b[0].get());
        bounds.Add(b[2].get());
        SmBSplineSurface* s = nullptr;
        check(SmBSplineSurface::CreateCoonsPatch(ctx(), tol, TRUE, bounds, derivs, s), "SmBSplineSurface::CreateCoonsPatch");
        out.emplace_back(s);
        return out;
    }
    SmTArray<SmBSplineCurve*> bounds, derivs;
    for (auto& c : b)
        bounds.Add(c.get()), derivs.Add(static_cast<SmBSplineCurve*>(nullptr));  // one (absent) per boundary
    SmTArray<SmSurface*> patches;
    const SmStatus st = SmBSplineSurface::CreateNSidedPatch(ctx(), bounds, derivs, 1.0, patches);
    for (ULONG i = 0; i < patches.GetSize(); ++i)
        out.emplace_back(patches[i]);
    check(st, "SmBSplineSurface::CreateNSidedPatch");
    return out;
}

// Patches tangent to the faces along every side (SmBSplineSurface::CreateCornerBlend).
std::vector<SurfacePtr> tangent_patches(const std::vector<Side>& sides, double tol, double angle_rad)
{
    SmTArray<SmCurve*> curves;
    SmTArray<SmOrientType> orients;
    SmTArray<SmBSplineCurve*> uvs;
    SmTArray<SmSurface*> surfaces;
    for (const Side& s : sides)
    {
        curves.Add(s.curve.get());
        orients.Add(s.reversed ? SM_OT_OPPOSITE : SM_OT_SAME);
        uvs.Add(SM_CAST_PTR(SmBSplineCurve, s.uv.get()));
        surfaces.Add(const_cast<SmSurface*>(s.surface));
    }
    CurvePtr corner;
    if (sides.size() == 3)
    {
        // a fourth side of no length where the second and third sides meet: a Coons patch with a pole
        SmPoint3d p = sides[1].to();
        SmBSplineCurve* c = nullptr;
        check(SmBSplineCurve::CreatePointCurve(ctx(), p, c), "SmBSplineCurve::CreatePointCurve");
        corner.reset(c);
        curves.InsertAt(2, corner.get());
        orients.InsertAt(2, SM_OT_SAME);
        uvs.InsertAt(2, static_cast<SmBSplineCurve*>(nullptr));
        surfaces.InsertAt(2, static_cast<SmSurface*>(nullptr));
    }
    // the last side first, as SmBrep::CreateCornerBlend passes them
    curves.InsertAt(0, curves.GetLast()), curves.RemoveLast();
    orients.InsertAt(0, orients.GetLast()), orients.RemoveLast();
    uvs.InsertAt(0, uvs.GetLast()), uvs.RemoveLast();
    surfaces.InsertAt(0, surfaces.GetLast()), surfaces.RemoveLast();
    SmTArray<SmSurface*> patches;
    const SmStatus st = SmBSplineSurface::CreateCornerBlend(ctx(), curves, orients, uvs, surfaces, tol, angle_rad, patches, FALSE);
    std::vector<SurfacePtr> out;
    for (ULONG i = 0; i < patches.GetSize(); ++i)
        out.emplace_back(patches[i]);
    check(st, "SmBSplineSurface::CreateCornerBlend");
    if (out.empty())
        throw std::runtime_error("fill: the kernel made no patch");
    return out;
}

// The distance from p to the nearest patch, with that patch and the point's uv on it.
double nearest(const std::vector<SurfacePtr>& patches, const SmPoint3d& p, size_t* which = nullptr, SmPoint2d* uv = nullptr)
{
    double best = 1e300;
    for (size_t i = 0; i < patches.size(); ++i)
    {
        SmPoint3d c;
        SmTArray<SmPoint2d> uvs;
        double d = 0.0;
        if (SmApiSurfaceClosestPoint(patches[i].get(), p, c, uvs, d) != SM_SUCCESS || uvs.GetSize() == 0)
            continue;
        if (d < best)
        {
            best = d;
            if (which)
                *which = i;
            if (uv)
                *uv = uvs[0];
        }
    }
    return best;
}

SmVector3d normal_of(const SmSurface& s, const SmPoint2d& uv)
{
    SmVector3d n;
    check(s.EvaluateNormal(uv, TRUE, TRUE, n), "SmSurface::EvaluateNormal");
    return n;
}

// The face's outward normal at uv (as SmFace's outward_normal_at_uv).
SmVector3d outward(const SmFace* face, const SmPoint2d& uv)
{
    SmVector3d n = normal_of(*face->GetSurface(), uv);
    const SmBrep* brep = face->GetBrep();
    const SmFaceuse* upward = face->GetUpwardFaceuse();
    if (brep && upward && upward->GetShell() && brep->GetInfiniteRegion() != upward->GetShell()->GetRegion())
        n = n * -1.0;
    return n;
}

// The edge's parameter at the fraction f along a side (of its own piece of the edge).
double along(const Side& s, double f) { return s.curve->GetNaturalInterval().Evaluate(f); }

// How the patches lie along a tangent side at the edge's parameter t: +1 across the edge from the
// face, -1 over the face; the face's outward normal and the patch's normal there.
int side_vote(const std::vector<SurfacePtr>& patches, const Side& s, double t, double h, SmVector3d& face_normal,
              SmVector3d& patch_normal)
{
    const SmEdgeuse* eu = s.edge->GetEdgeuseOfFace(s.face);
    SmPoint3d p;
    SmVector3d inward;
    SmPoint2d uv;
    check(eu->EvaluateBinormal(t, TRUE, p, inward, nullptr, nullptr, &uv), "SmEdgeuse::EvaluateBinormal");
    face_normal = outward(s.face, uv);
    inward.Unitize();
    const double away = nearest(patches, p - inward * h), over = nearest(patches, p + inward * h);
    size_t k = 0;
    SmPoint2d puv;
    nearest(patches, p, &k, &puv);
    patch_normal = normal_of(*patches[k], puv);
    return away < over ? 1 : -1;
}

SmBrep* sheet_of(std::vector<SurfacePtr>& patches, const std::vector<bool>& flip)
{
    SmBrep* out = new (ctx()) SmBrep();
    try
    {
        for (size_t i = 0; i < patches.size(); ++i)
        {
            SmSurface* s = patches[i].release();
            SmFace* face = nullptr;
            const SmStatus st = out->CreateFaceFromSurface(s, s->GetNaturalUVDomain(), face);
            if (st != SM_SUCCESS || !face)
            {
                if (s->GetOwner() == nullptr)
                    delete s;
                check(st != SM_SUCCESS ? st : SM_ERR, "SmBrep::CreateFaceFromSurface");
            }
            if (flip[i])
                check(face->SwapUV(), "SmFace::SwapUV");
        }
    }
    catch (...)
    {
        delete out;
        throw;
    }
    return out;
}

// ---------------------------------------------------------------- networks

struct Crossing
{
    double t = 0.0, s = 0.0, gap = 0.0;
    SmPoint3d p;
};

// Where curve a comes nearest to curve b: the nearest pair of samples, refined by Gauss-Newton on
// |a(t) - b(s)|^2 within the curves' intervals.
Crossing crossing(const SmCurve& a, const SmCurve& b)
{
    const SmExtent1d ia = a.GetNaturalInterval(), ib = b.GetNaturalInterval();
    const int n = 96;
    std::vector<SmPoint3d> pa(n + 1), pb(n + 1);
    for (int i = 0; i <= n; ++i)
        pa[i] = point(a, ia.Evaluate(double(i) / n)), pb[i] = point(b, ib.Evaluate(double(i) / n));
    int bi = 0, bj = 0;
    double best = 1e300;
    for (int i = 0; i <= n; ++i)
        for (int j = 0; j <= n; ++j)
        {
            const double d = pa[i].DistanceBetween(pb[j]);
            if (d < best)
                best = d, bi = i, bj = j;
        }
    double t = ia.Evaluate(double(bi) / n), s = ib.Evaluate(double(bj) / n);
    for (int it = 0; it < 60; ++it)
    {
        SmVector3d da[2], db[2];
        check(a.Evaluate(t, 1, TRUE, da), "SmCurve::Evaluate");
        check(b.Evaluate(s, 1, TRUE, db), "SmCurve::Evaluate");
        const SmVector3d r = da[0] - db[0];
        const SmVector3d ja = da[1], jb = db[1] * -1.0;
        const double a11 = ja.Dot(ja), a12 = ja.Dot(jb), a22 = jb.Dot(jb);
        const double g1 = -ja.Dot(r), g2 = -jb.Dot(r);
        const double det = a11 * a22 - a12 * a12;
        if (!(std::abs(det) > 1e-300))
            break;
        const double dt = (g1 * a22 - g2 * a12) / det, ds = (a11 * g2 - a12 * g1) / det;
        const double nt = std::clamp(t + dt, ia.GetMin(), ia.GetMax()), ns = std::clamp(s + ds, ib.GetMin(), ib.GetMax());
        const bool done = std::abs(nt - t) <= 1e-15 * std::max(1.0, ia.GetLength()) && std::abs(ns - s) <= 1e-15 * std::max(1.0, ib.GetLength());
        t = nt, s = ns;
        if (done)
            break;
    }
    Crossing c;
    c.t = t, c.s = s;
    const SmPoint3d x = point(a, t), y = point(b, s);
    c.gap = x.DistanceBetween(y);
    c.p = SmPoint3d((x.x + y.x) / 2, (x.y + y.y) / 2, (x.z + y.z) / 2);
    return c;
}

// A monotone cubic through (x[i], y[i]) (Fritsch and Carlson): no overshoot between the points.
struct Pchip
{
    std::vector<double> x, y, m;
    Pchip(std::vector<double> xs, std::vector<double> ys) : x(std::move(xs)), y(std::move(ys)), m(x.size(), 0.0)
    {
        const size_t n = x.size();
        std::vector<double> d(n - 1);
        for (size_t k = 0; k + 1 < n; ++k)
            d[k] = (y[k + 1] - y[k]) / (x[k + 1] - x[k]);
        m[0] = d[0], m[n - 1] = d[n - 2];
        for (size_t k = 1; k + 1 < n; ++k)
        {
            if (d[k - 1] * d[k] <= 0.0)
                m[k] = 0.0;
            else
            {
                const double h0 = x[k] - x[k - 1], h1 = x[k + 1] - x[k];
                const double w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
                m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
            }
        }
    }
    double operator()(double t) const
    {
        size_t k = 0;
        while (k + 2 < x.size() && t > x[k + 1])
            ++k;
        const double h = x[k + 1] - x[k], s = (t - x[k]) / h;
        const double h00 = (1 + 2 * s) * (1 - s) * (1 - s), h10 = s * (1 - s) * (1 - s), h01 = s * s * (3 - 2 * s), h11 = s * s * (s - 1);
        return h00 * y[k] + h10 * h * m[k] + h01 * y[k + 1] + h11 * h * m[k + 1];
    }
};

// The curves of one set made compatible: each sampled so that crossing i falls at the same parameter
// on every curve (arc length mapped through a monotone cubic between the crossings, samples per span
// in proportion to the span's mean length) and interpolated (degree 3, uniform parameters, so every
// curve of the set gets the same knots), over [0, 1].
std::vector<SplinePtr> compatible(const std::vector<const SmCurve*>& curves, const std::vector<std::vector<double>>& at,
                                  std::vector<double>& nodes)
{
    const size_t m = curves.size(), n = at[0].size();
    std::vector<std::vector<double>> len(m, std::vector<double>(n, 0.0));
    std::vector<double> span(n - 1, 0.0);
    for (size_t j = 0; j < m; ++j)
        for (size_t i = 1; i < n; ++i)
        {
            len[j][i] = len[j][i - 1] + smlibpy::curve_length(curves[j], at[j][i - 1], at[j][i], 1e-10);
            span[i - 1] += (len[j][i] - len[j][i - 1]) / m;
        }
    double total = 0.0;
    for (double s : span)
        total += s;
    std::vector<int> node(n, 0);
    for (size_t i = 1; i < n; ++i)
        node[i] = node[i - 1] + std::max(16, int(std::lround(48.0 * (n - 1) * span[i - 1] / std::max(total, 1e-300))));
    const int samples = node[n - 1];
    std::vector<double> xs(n);
    for (size_t i = 0; i < n; ++i)
        xs[i] = double(node[i]) / samples;
    nodes = xs;
    std::vector<SplinePtr> out;
    for (size_t j = 0; j < m; ++j)
    {
        const Pchip map(xs, len[j]);
        SmTArray<SmPoint3d> pts;
        size_t next = 0;
        for (int k = 0; k <= samples; ++k)
        {
            double t;
            if (next < n && node[next] == k)
                t = at[j][next++];
            else
            {
                const std::pair<double, bool> r = smlibpy::curve_parameter_at_length(curves[j], at[j][0], map(double(k) / samples), 1e-10);
                t = r.first;
            }
            pts.Add(point(*curves[j], t));
        }
        SmTArray<SmVector3d> none;
        SmBSplineCurve* c = nullptr;
        check(SmBSplineCurve::CreateInterpolatingCurve(ctx(), SM_CP_UNIFORM, 3, 3, pts, none, nullptr, FALSE, c),
              "SmBSplineCurve::CreateInterpolatingCurve");
        SplinePtr p(c);
        check(p->EditParameterization(SmExtent1d(0.0, 1.0)), "SmBSplineCurve::EditParameterization");
        out.push_back(std::move(p));
    }
    return out;
}

// NLib's memory stacks for one call.
struct Stacks
{
    NL_STACKS s;
    Stacks() { N_InitNurbs(&s); }
    ~Stacks() { N_EndNurbs(&s); }
    Stacks(const Stacks&) = delete;
    Stacks& operator=(const Stacks&) = delete;
};

// N_CreateGordonSrf with the network's own crossing parameters: the u curves lie at v = at_v[j], the v
// curves at u = at_u[i]; both sets compatible. (SmBSplineSurface::CreateGordonSurface intersects the
// curves again and reparameterizes them piecewise linearly to what it finds, which moved them by up to
// 5.7e-4 on a 10 mm network that was compatible already.)
SmBSplineSurface* gordon(std::vector<SplinePtr>& u, std::vector<SplinePtr>& v, const std::vector<double>& at_u,
                         const std::vector<double>& at_v)
{
    Stacks sc, ss;
    auto nl = [&](SmBSplineCurve& c) {
        NL_CURVE* src = reinterpret_cast<NL_CURVE*>(c.GetOrCreateGwNurbPointer());
        NL_CURVE* dst = N_AllocCrvAndArrays(NL_INDEX(c.GetNumberControlPoints()), NL_DEGREE(c.GetDegree()),
                                            NL_INDEX(c.GetNumberNaturalKnots()), &sc.s);
        if (!src || !dst || N_CrvCopy(src, dst, &sc.s))
            throw std::runtime_error("network: a curve could not be copied for the kernel");
        return dst;
    };
    std::vector<NL_CURVE*> cu, cv;
    for (auto& c : u)
        cu.push_back(nl(*c));
    for (auto& c : v)
        cv.push_back(nl(*c));
    std::vector<NL_PARAMETER> pu(at_u.begin(), at_u.end()), pv(at_v.begin(), at_v.end());
    const NL_INDEX nu = NL_INDEX(u.size()), nv = NL_INDEX(v.size());
    NL_DEGREE p = 3, q = 3;  // as SmBSplineSurface::CreateGordonSurface: fewer curves, lower degree
    if (nu <= q)
        q = NL_DEGREE(nu - 1);
    if (nv <= p)
        p = NL_DEGREE(nv - 1);
    NL_SURFACE sur;
    N_SrfInitArrays(&sur);
    if (N_CreateGordonSrf(cu.data(), pv.data(), nu - 1, cv.data(), pu.data(), nv - 1, p, q, p, q, NL_YES, &sur, &sc.s, &ss.s))
        throw std::runtime_error("network: the kernel could not make the surface (N_CreateGordonSrf)");
    return new (ctx()) SmBSplineSurface(reinterpret_cast<gw_SURFACE*>(&sur));
}

}  // namespace

namespace smlibpy {

SmBrep* fill_loop(const std::vector<SmCurve*>& curves, const std::vector<SmFace*>& faces, const std::vector<SmEdge*>& edges,
                  double tolerance)
{
    const size_t n = curves.size();
    if (n == 0)
        throw std::invalid_argument("fill: no curves");
    if (faces.size() != n || edges.size() != n)
        throw std::invalid_argument("fill: one face and one edge (or None) per curve");
    if (!(tolerance > 0.0) || !std::isfinite(tolerance))
        throw std::invalid_argument("fill: the tolerance must be positive");
    size_t tangent = 0;
    for (size_t i = 0; i < n; ++i)
    {
        if (!curves[i])
            throw std::invalid_argument("fill: a curve is None");
        if ((faces[i] == nullptr) != (edges[i] == nullptr))
            throw std::invalid_argument("fill: a face needs its edge");
        tangent += faces[i] ? 1 : 0;
    }
    if (tangent != 0 && tangent != n)
        throw std::invalid_argument("fill: either every curve is an edge of a sheet (a patch tangent to the sheets) or "
                                    "none is; mixed loops are not supported");

    std::vector<Side> sides;
    SmExtent3d box;
    for (size_t i = 0; i < n; ++i)
    {
        Side s;
        if (edges[i])
        {
            s.curve.reset(edge_curve(edges[i]));
            const SmEdgeuse* eu = edges[i]->GetEdgeuseOfFace(faces[i]);
            if (!eu)
                throw std::invalid_argument("fill: an edge does not bound its face");
            SmBSplineCurve* uv = nullptr;
            check(const_cast<SmEdgeuse*>(eu)->GetOrCreateUVTrimCurve(uv), "SmEdgeuse::GetOrCreateUVTrimCurve");
            if (!uv)
                throw std::runtime_error("fill: an edge has no curve on its face");
            s.uv = copy(uv);
            check(s.uv->EditParameterization(s.curve->GetNaturalInterval()), "SmCurve::EditParameterization");
            s.surface = faces[i]->GetSurface(), s.face = faces[i], s.edge = edges[i];
        }
        else
            s.curve = copy(curves[i]);
        SmExtent3d cb;
        check(s.curve->CalculateBoundingBox(s.curve->GetNaturalInterval(), &cb), "SmCurve::CalculateBoundingBox");
        box.Union(cb, box);
        sides.push_back(std::move(s));
    }
    const double size = std::max(box.GetMin().DistanceBetween(box.GetMax()), 1e-9);
    if (n < 3)
        for (Side& s : sides)
            if (s.curve->GetNaturalInterval().GetLength() <= 0.0)
                throw std::invalid_argument("fill: a curve has no length");
    chain(sides, tolerance);
    sides = cut(sides, pieces(sides));  // one closed curve, or two (or three without corners), into four sides
    const double tol = std::max(1e-7 * size, 1e-9);

    // a loop's normal by the right-hand rule (Newell), from samples along it
    SmVector3d loop(0, 0, 0);
    {
        std::vector<SmPoint3d> pts;
        for (const Side& s : sides)
        {
            const SmExtent1d ivl = s.curve->GetNaturalInterval();
            for (int k = 0; k < 16; ++k)
                pts.push_back(point(*s.curve, ivl.Evaluate(s.reversed ? 1.0 - k / 16.0 : k / 16.0)));
        }
        for (size_t i = 0; i < pts.size(); ++i)
        {
            const SmPoint3d& a = pts[i];
            const SmPoint3d& b = pts[(i + 1) % pts.size()];
            loop += SmVector3d((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y));
        }
    }

    std::vector<SurfacePtr> patches;
    std::vector<bool> flip;
    if (!tangent)
    {
        patches = free_patches(sides, tol);
        for (auto& p : patches)
        {
            const SmExtent2d d = p->GetNaturalUVDomain();
            flip.push_back(normal_of(*p, SmPoint2d(0.5 * (d.GetMin().x + d.GetMax().x), 0.5 * (d.GetMin().y + d.GetMax().y))).Dot(loop) < 0.0);
        }
    }
    else
    {
        const double h = 1e-3 * size;
        for (int attempt = 0; attempt < 2; ++attempt)
        {
            if (attempt == 1)
            {
                // the patches folded over the faces: the loop the other way round
                std::reverse(sides.begin(), sides.end());
                for (Side& s : sides)
                    s.reversed = !s.reversed;
            }
            patches = tangent_patches(sides, tol, 0.25 * SM_PI / 180.0);
            int votes = 0;
            for (const Side& s : sides)
            {
                SmVector3d fn, pn;
                votes += side_vote(patches, s, along(s, 0.5), h, fn, pn);
            }
            if (votes > 0)
                break;
            if (attempt == 1)
                throw std::runtime_error("fill: the patch folds back over the sheets; fill the hole in pieces");
        }
        // each patch's normal follows the faces it meets
        std::vector<double> agree(patches.size(), 0.0);
        for (const Side& s : sides)
        {
            const SmEdgeuse* eu = s.edge->GetEdgeuseOfFace(s.face);
            for (int k = 1; k < 8; ++k)
            {
                SmPoint3d p;
                SmVector3d inward;
                SmPoint2d uv, puv;
                check(eu->EvaluateBinormal(along(s, k / 8.0), TRUE, p, inward, nullptr, nullptr, &uv), "SmEdgeuse::EvaluateBinormal");
                size_t which = 0;
                if (nearest(patches, p, &which, &puv) > 1e-3 * size)
                    continue;
                agree[which] += outward(s.face, uv).Dot(normal_of(*patches[which], puv)) >= 0.0 ? 1.0 : -1.0;
            }
        }
        for (double a : agree)
            flip.push_back(a < 0.0);
    }

    // the patches run through the curves; tangent ones meet the faces tangentially
    double worst = 0.0, worst_angle = 0.0;
    SmPoint3d where;
    for (const Side& s : sides)
    {
        const SmExtent1d ivl = s.curve->GetNaturalInterval();
        for (int k = 0; k <= 8; ++k)
        {
            const SmPoint3d p = point(*s.curve, ivl.Evaluate(k / 8.0));
            const double d = nearest(patches, p);
            if (d > worst)
                worst = d, where = p;
        }
        if (s.face)
            for (int k = 1; k < 8; ++k)
            {
                SmVector3d fn, pn;
                side_vote(patches, s, along(s, k / 8.0), 1e-3 * size, fn, pn);
                fn.Unitize(), pn.Unitize();
                worst_angle = std::max(worst_angle, std::acos(std::min(1.0, std::abs(fn.Dot(pn)))) * 180.0 / SM_PI);
            }
    }
    if (worst > std::max(1e-5 * size, 100 * tol))
        throw std::runtime_error("fill: the patch misses its boundary by " + format(worst) + " at " + format(where));
    // (the kernel's N-sided fill meets its sheets only approximately: up to about 1.4 degrees halfway
    // between a side's middle and its ends, whatever tolerance it is given; Coons patches within 0.02)
    const double allowed = sides.size() >= 5 ? 2.0 : 0.5;
    if (worst_angle > allowed)
        throw std::runtime_error("fill: the patch meets a sheet at " + format(worst_angle) + " degrees, not tangentially "
                                 "(at most " + format(allowed) + "); the sheets may not meet each other tangentially "
                                 "at the loop's corners");
    return sheet_of(patches, flip);
}

std::pair<SmBrep*, double> network_surface(const std::vector<SmCurve*>& u_in, const std::vector<SmCurve*>& v_in, double tolerance)
{
    if (u_in.size() < 2 || v_in.size() < 2)
        throw std::invalid_argument("network: at least two curves in each direction");
    if (u_in.size() > 640 || v_in.size() > 640)
        throw std::invalid_argument("network: at most 640 curves in each direction (the kernel's limit)");
    if (!(tolerance > 0.0) || !std::isfinite(tolerance))
        throw std::invalid_argument("network: the tolerance must be positive");
    for (SmCurve* c : u_in)
        if (!c)
            throw std::invalid_argument("network: a curve is None");
    for (SmCurve* c : v_in)
        if (!c)
            throw std::invalid_argument("network: a curve is None");
    const size_t nu = u_in.size(), nv = v_in.size();
    // working copies, so that curves can be turned
    std::vector<CurvePtr> u, v;
    for (SmCurve* c : u_in)
        u.push_back(copy(c));
    for (SmCurve* c : v_in)
        v.push_back(copy(c));
    std::vector<std::vector<Crossing>> x(nu, std::vector<Crossing>(nv));
    for (size_t j = 0; j < nu; ++j)
        for (size_t i = 0; i < nv; ++i)
        {
            x[j][i] = crossing(*u[j], *v[i]);
            if (x[j][i].gap > tolerance)
                throw std::invalid_argument("network: u curve " + std::to_string(j) + " and v curve " + std::to_string(i) +
                                            " do not cross (they come " + format(x[j][i].gap) + " close at " +
                                            format(x[j][i].p) + ")");
        }
    // the v curves in their order along the first u curve, the u curves along the first v curve
    std::vector<size_t> ou(nu), ov(nv);
    for (size_t i = 0; i < nv; ++i)
        ov[i] = i;
    for (size_t j = 0; j < nu; ++j)
        ou[j] = j;
    std::sort(ov.begin(), ov.end(), [&](size_t a, size_t b) { return x[0][a].t < x[0][b].t; });
    std::sort(ou.begin(), ou.end(), [&](size_t a, size_t b) { return x[a][0].s < x[b][0].s; });
    // each curve turned so that its crossings come in that order
    auto turn = [](CurvePtr& c) {
        SmExtent1d turned;
        check(c->ReverseParameterization(c->GetNaturalInterval(), turned), "SmCurve::ReverseParameterization");
    };
    for (size_t j = 0; j < nu; ++j)
        if (x[j][ov.front()].t > x[j][ov.back()].t)
        {
            const SmExtent1d ivl = u[j]->GetNaturalInterval();
            turn(u[j]);
            for (size_t i = 0; i < nv; ++i)
                x[j][i].t = ivl.GetMin() + ivl.GetMax() - x[j][i].t;
        }
    for (size_t i = 0; i < nv; ++i)
        if (x[ou.front()][i].s > x[ou.back()][i].s)
        {
            const SmExtent1d ivl = v[i]->GetNaturalInterval();
            turn(v[i]);
            for (size_t j = 0; j < nu; ++j)
                x[j][i].s = ivl.GetMin() + ivl.GetMax() - x[j][i].s;
        }
    std::vector<const SmCurve*> uc, vc;
    std::vector<std::vector<double>> ut, vt;
    for (size_t a = 0; a < nu; ++a)
    {
        const size_t j = ou[a];
        uc.push_back(u[j].get());
        std::vector<double> ts;
        for (size_t b = 0; b < nv; ++b)
        {
            ts.push_back(x[j][ov[b]].t);
            if (b > 0 && !(ts[b] > ts[b - 1]))
                throw std::invalid_argument("network: u curve " + std::to_string(j) + " crosses the v curves in another "
                                            "order than the first u curve does");
        }
        const SmExtent1d ivl = u[j]->GetNaturalInterval();
        const double over = std::max(point(*u[j], ivl.GetMin()).DistanceBetween(x[j][ov.front()].p),
                                     point(*u[j], ivl.GetMax()).DistanceBetween(x[j][ov.back()].p));
        if (over > tolerance)
            throw std::invalid_argument("network: u curve " + std::to_string(j) + " runs " + format(over) +
                                        " past the outer v curves; each curve must end on the outer curves of the other set");
        ut.push_back(ts);
    }
    for (size_t b = 0; b < nv; ++b)
    {
        const size_t i = ov[b];
        vc.push_back(v[i].get());
        std::vector<double> ss;
        for (size_t a = 0; a < nu; ++a)
        {
            ss.push_back(x[ou[a]][i].s);
            if (a > 0 && !(ss[a] > ss[a - 1]))
                throw std::invalid_argument("network: v curve " + std::to_string(i) + " crosses the u curves in another "
                                            "order than the first v curve does");
        }
        const SmExtent1d ivl = v[i]->GetNaturalInterval();
        const double over = std::max(point(*v[i], ivl.GetMin()).DistanceBetween(x[ou.front()][i].p),
                                     point(*v[i], ivl.GetMax()).DistanceBetween(x[ou.back()][i].p));
        if (over > tolerance)
            throw std::invalid_argument("network: v curve " + std::to_string(i) + " runs " + format(over) +
                                        " past the outer u curves; each curve must end on the outer curves of the other set");
        vt.push_back(ss);
    }
    std::vector<double> at_u, at_v;  // where the v curves cross the u curves, and the u curves the v curves
    std::vector<SplinePtr> ucomp = compatible(uc, ut, at_u), vcomp = compatible(vc, vt, at_v);
    std::vector<SurfacePtr> surface;
    surface.emplace_back(gordon(ucomp, vcomp, at_u, at_v));

    // measured against the curves as given
    double deviation = 0.0;
    for (const auto* set : {&u_in, &v_in})
        for (const SmCurve* c : *set)
        {
            const SmExtent1d ivl = c->GetNaturalInterval();
            for (int k = 0; k <= 32; ++k)
                deviation = std::max(deviation, nearest(surface, point(*c, ivl.Evaluate(k / 32.0))));
        }
    // the normal: the first u curve's direction crossed with the first v curve's, as given
    const Crossing c0 = crossing(*u_in[0], *v_in[0]);
    const SmVector3d given = tangent(*u_in[0], c0.t) * tangent(*v_in[0], c0.s);
    SmPoint2d uv;
    nearest(surface, c0.p, nullptr, &uv);
    std::vector<bool> flip{normal_of(*surface[0], uv).Dot(given) < 0.0};
    return {sheet_of(surface, flip), deviation};
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_fill(py::module_ m)
{
    m.def("fill_loop", &smlibpy::fill_loop, py::arg("curves"), py::arg("faces"), py::arg("edges"), py::arg("tolerance"),
          py::return_value_policy::take_ownership,
          "Patches (one face each, not sewn) filling the closed loop of the curves; tangent to faces[i] along edges[i] "
          "where every curve has a face, through the curves alone where none has.");
    m.def("network_surface", [](const std::vector<SmCurve*>& u, const std::vector<SmCurve*>& v, double tolerance) {
        const std::pair<SmBrep*, double> r = smlibpy::network_surface(u, v, tolerance);
        return py::make_tuple(py::cast(r.first, py::return_value_policy::take_ownership), r.second);
    }, py::arg("u"), py::arg("v"), py::arg("tolerance"),
          "(sheet, deviation): a surface through a network of crossing curves, made compatible first; deviation is "
          "the largest distance of a given curve from it.");
}
#endif  // SMLIBPY_PYTHON
