// SPDX-License-Identifier: Apache-2.0
//
// The curves of edges in the parameters of their faces (pcurves) for OpenCASCADE's .brep files
// (occt_text). OpenCASCADE holds every edge of a curved face with a 2D curve in the face's surface
// parameters that runs with the edge's own parameter (SameParameter), the two of a seam on the two
// sides of the parameter rectangle, so that each wire closes in the parameters. usd-brep's writer of
// .brep files (src/cpp/occt/UsdBrepToOcctModel.cpp) takes them from the BrepArray's edgeuse trim
// curves (UV curves), and where there are none it makes them for edges that run along a parameter line
// only. SMLib's conversion writes trim curves for B-spline faces alone, in SMLib's parameters of the
// curve: the analytic faces of a fillet, a hole or a Boolean came out without curves or with curves on
// the wrong side of a seam, and B-spline faces with curves that do not run with their edges, which
// OpenCASCADE read as invalid faces of the wrong volume.
//
// Here every edgeuse of a curved face gets its trim curve anew: points of the edge's 3D curve at its
// own parameters, taken to the surface's parameters (in closed form on analytic surfaces; by Newton's
// method from SMLib's own trim curve on B-spline surfaces), unwrapped across seams, each loop made to
// run on in the parameters from one edgeuse to the next, and a B-spline curve through them (a line where
// the edge runs along a parameter line), as close to the edge as the body's tolerance allows. A loop
// may jump only where a whole parameter line is one point (a sphere's pole, a cone's apex): the writer
// puts a degenerate edge there, as OpenCASCADE does.

#include "occt.h"

#include "UsdBrepArrayData.h"
#include "UsdBrepGeometryEval.h"
#include "UsdBrepIterator.h"
#include "UsdBrepTokens.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using pxr::GfVec2d;
using pxr::GfVec3d;
using UsdBrep::UsdBrepView;
using UsdBrepData::UsdBrepArrayData;

constexpr double PI2 = 6.283185307179586476925286766559;

// A trim curve: a non-rational B-spline in the parameters of a face, over the edge's parameter.
struct Trim
{
    bool set = false;
    uint32_t order = 0;
    std::vector<double> knots;  // flat (order + number of points)
    std::vector<GfVec2d> points;
};

// -- the faces and edges of one body of the arrays -----------------------------------------------------

struct Body
{
    const UsdBrepView& brep;
    double tol;  // how close a trim curve keeps to its edge (3D)

    // the surface type of face f: 0 plane, 1 analytic curved, 2 NURBS
    int kind(uint32_t f) const
    {
        const pxr::TfToken& t = brep.FaceSurfaceTypes()[f];
        if (t == pxr::UsdBrepSurfaceTokens->brepSurfacePlaneAPI)
            return 0;
        return t == pxr::UsdBrepSurfaceTokens->brepSurfaceNurbAPI ? 2 : 1;
    }
    GfVec3d at(uint32_t f, const GfVec2d& uv) const { return UsdBrep::EvaluateSurface(brep, f, uv[0], uv[1]); }
    GfVec3d on(uint32_t e, double t) const { return UsdBrep::EvaluateCurve3d(brep, e, t); }

    // a parameter of face f at uv that the surface does not depend on (a pole's u): 1 for u, 2 for v, 0 none
    int indeterminate(uint32_t f, const GfVec2d& uv, double scale) const
    {
        const GfVec3d p = at(f, uv);
        const double h = 1e-3;
        const double eps = 1e-9 * scale;
        int out = 0;
        if ((at(f, uv + GfVec2d(h, 0.0)) - p).GetLength() < eps && (at(f, uv - GfVec2d(h, 0.0)) - p).GetLength() < eps)
            out |= 1;
        if ((at(f, uv + GfVec2d(0.0, h)) - p).GetLength() < eps && (at(f, uv - GfVec2d(0.0, h)) - p).GetLength() < eps)
            out |= 2;
        return out;
    }

    // Newton's method for the point of a B-spline face nearest to x from uv (kept in its domain)
    GfVec2d newton(uint32_t f, const GfVec3d& x, GfVec2d uv, const UsdBrep::UsdBrepSurfaceDomain& d) const
    {
        // (Gauss-Newton, each step at most a tenth of the range and halved until it brings the point
        // closer: from a pole, where one direction of the surface vanishes, a full step jumps far)
        double dist = (at(f, uv) - x).GetLengthSq();
        const double lim[2] = {0.1 * std::max(d.USpan(), 1e-12), 0.1 * std::max(d.VSpan(), 1e-12)};
        for (int it = 0; it < 40 && dist > 1e-30; ++it)
        {
            const GfVec3d S = at(f, uv), r = S - x;
            const double hu = 1e-7 * std::max(1.0, d.USpan()), hv = 1e-7 * std::max(1.0, d.VSpan());
            const double su = uv[0] + hu <= d.uvMax[0] ? hu : -hu, sv = uv[1] + hv <= d.uvMax[1] ? hv : -hv;
            const GfVec3d Su = (at(f, uv + GfVec2d(su, 0.0)) - S) / su, Sv = (at(f, uv + GfVec2d(0.0, sv)) - S) / sv;
            // (damped: where one direction vanishes, at a pole, the step goes along the other)
            const double damp = 1e-9 * (Su * Su + Sv * Sv) + 1e-300;
            const double a11 = Su * Su + damp, a12 = Su * Sv, a22 = Sv * Sv + damp, b1 = -(Su * r), b2 = -(Sv * r);
            const double det = a11 * a22 - a12 * a12;
            GfVec2d step((a22 * b1 - a12 * b2) / det, (a11 * b2 - a12 * b1) / det);
            for (int k = 0; k < 2; ++k)
                if (std::fabs(step[k]) > lim[k])
                    step *= lim[k] / std::fabs(step[k]);
            // (a step too small to change the distance any more is taken as it is: the foot of the
            // perpendicular, to the last digits, for a point a little off the surface)
            const bool tiny = std::fabs(step[0]) <= 1e-9 * lim[0] && std::fabs(step[1]) <= 1e-9 * lim[1];
            bool moved = false;
            for (int half = 0; half < 30 && !moved; ++half, step *= 0.5)
            {
                const GfVec2d next(std::clamp(uv[0] + step[0], d.uvMin[0], d.uvMax[0]), std::clamp(uv[1] + step[1], d.uvMin[1], d.uvMax[1]));
                const double nd = (at(f, next) - x).GetLengthSq();
                if (nd < dist || (tiny && nd <= dist * (1.0 + 1e-12)))
                    uv = next, dist = std::min(dist, nd), moved = true;
            }
            if (!moved || tiny)
                break;
        }
        return uv;
    }
};

// The UV curve SMLib wrote for an edgeuse (NURBS faces), sampled: where its points lie on the surface.
struct Hint
{
    std::vector<GfVec2d> uv;
    std::vector<GfVec3d> xyz;
};

// One edgeuse's points: in the direction of the edge, at its parameters t, unwrapped across seams.
struct Use
{
    uint32_t eu = 0, edge = 0;
    bool same = true;      // runs with its edge
    bool degenerate = false;
    double t0 = 0.0, t1 = 0.0;
    std::vector<double> t;
    std::vector<GfVec2d> uv;
    Hint hint;
    GfVec2d shift{0.0, 0.0};  // what the loop adds to its points (whole periods)
    GfVec2d start() const { return (same ? uv.front() : uv.back()) + shift; }
    GfVec2d end() const { return (same ? uv.back() : uv.front()) + shift; }
};

struct Face
{
    const Body& body;
    uint32_t f;
    UsdBrep::UsdBrepSurfaceDomain d;
    double scale;  // the size of the body, for the tests of points that coincide
    // per parameter: the period of a periodic surface, or the span of a B-spline surface that closes up
    // in it (its seam's two sides are that far apart), else 0
    double period[2] = {0.0, 0.0};
    double pole[2] = {std::numeric_limits<double>::quiet_NaN(), std::numeric_limits<double>::quiet_NaN()};  // a cone's apex (v)

    void setup()
    {
        period[0] = d.uPeriodic ? d.uPeriod : 0.0;
        period[1] = d.vPeriodic ? d.vPeriod : 0.0;
        if (body.kind(f) == 2)
            for (int c = 0; c < 2; ++c)
            {
                const double a = d.uvMin[c], b = d.uvMax[c], o0 = d.uvMin[1 - c], o1 = d.uvMax[1 - c];
                if (!(b > a))
                    continue;
                bool closed = true;
                for (int i = 0; i <= 8 && closed; ++i)
                {
                    const double o = o0 + (o1 - o0) * i / 8;
                    const GfVec2d p = c == 0 ? GfVec2d(a, o) : GfVec2d(o, a), q = c == 0 ? GfVec2d(b, o) : GfVec2d(o, b);
                    closed = (body.at(f, p) - body.at(f, q)).GetLength() <= 1e-9 * scale + body.tol;
                }
                if (closed)
                    period[c] = b - a;
            }
        const pxr::TfToken& t = body.brep.FaceSurfaceTypes()[f];
        if (t == pxr::UsdBrepSurfaceTokens->brepSurfaceConeAPI)
        {
            const uint32_t i = body.brep.FaceTypeSubIndex(f);
            const double r = body.brep.ConeSurfaceRadii()[i], a = body.brep.ConeSurfaceSemiAngles()[i];
            if (std::fabs(std::tan(a)) > 1e-12)
                pole[1] = -r / std::tan(a);
        }
        else if (t == pxr::UsdBrepSurfaceTokens->brepSurfaceSphereAPI)
            pole[1] = 0.25 * PI2;  // (and -pi/2)
    }

    // a point where one parameter is free (a pole): the other one exactly at the pole
    void snap(GfVec2d& uv, int free) const
    {
        const int c = free == 1 ? 1 : 0;  // (the parameter that is not free)
        const pxr::TfToken& t = body.brep.FaceSurfaceTypes()[f];
        if (c == 1 && std::isfinite(pole[1]))
        {
            if (t == pxr::UsdBrepSurfaceTokens->brepSurfaceSphereAPI)
                uv[1] = uv[1] < 0.0 ? -0.25 * PI2 : 0.25 * PI2;
            else
                uv[1] = pole[1];
            return;
        }
        if (body.kind(f) == 2)
        {
            const double span = d.uvMax[c] - d.uvMin[c];
            if (std::fabs(uv[c] - d.uvMin[c]) <= 1e-6 * span)
                uv[c] = d.uvMin[c];
            else if (std::fabs(uv[c] - d.uvMax[c]) <= 1e-6 * span)
                uv[c] = d.uvMax[c];
        }
    }

    // x moved by whole periods toward `to`: on a periodic surface by any number, on a B-spline surface
    // that closes up only across its seam (from one end of its range to the other), which it does not
    // leave
    double wrap(int k, double x, double to) const
    {
        if (!(period[k] > 0.0))
            return x;
        if (body.kind(f) != 2)
            return x + std::round((to - x) / period[k]) * period[k];
        const double eps = 1e-9 * period[k];
        double best = x;
        for (double c : {x - period[k], x + period[k]})
            if (c >= d.uvMin[k] - eps && c <= d.uvMax[k] + eps && std::fabs(c - to) < std::fabs(best - to))
                best = c;
        return best;
    }

    // the shift of a whole edgeuse by periods nearest to `want` that keeps it in the surface's range (a
    // B-spline's), NaN when none does
    double shift(const Use& u, int k, double want) const
    {
        if (body.kind(f) != 2)
            return std::round(want / period[k]) * period[k];
        const double eps = 1e-9 * period[k];
        double best = std::numeric_limits<double>::quiet_NaN();
        for (double c : {0.0, -period[k], period[k]})
        {
            bool inside = true;
            for (const GfVec2d& x : u.uv)
                inside = inside && x[k] + c >= d.uvMin[k] - eps && x[k] + c <= d.uvMax[k] + eps;
            if (inside && (!std::isfinite(best) || std::fabs(c - want) < std::fabs(best - want)))
                best = c;
        }
        return best;
    }

    // the edge's points at n + 1 parameters
    void sample(Use& u, int n) const
    {
        u.t.resize(static_cast<size_t>(n + 1));
        u.uv.resize(static_cast<size_t>(n + 1));
        std::vector<int> unknown(static_cast<size_t>(n + 1), 0);
        size_t hinted = 0;
        for (int i = 0; i <= n; ++i)
        {
            const double t = i == n ? u.t1 : u.t0 + (u.t1 - u.t0) * i / n;
            const GfVec3d x = body.on(u.edge, t);
            GfVec2d uv;
            if (body.kind(f) == 2)
            {
                // from the nearest point of SMLib's curve, else the surface's own search
                GfVec2d start;
                if (!u.hint.uv.empty())
                {
                    // the nearest of SMLib's points around the one as far along (both run with the edge, and
                    // a closed edge's two ends, which are one point, lie at its two ends)
                    const size_t m = u.hint.xyz.size() - 1;
                    const size_t guess = static_cast<size_t>(std::llround(static_cast<double>(i) / n * m));
                    const size_t lo = std::max<size_t>(hinted, guess > m / 8 ? guess - m / 8 : 0), hi = std::min(m, guess + m / 8);
                    size_t best = std::min(std::max(guess, lo), hi);
                    double bd = (u.hint.xyz[best] - x).GetLengthSq();
                    for (size_t k = lo; k <= hi; ++k)
                    {
                        const double dd = (u.hint.xyz[k] - x).GetLengthSq();
                        if (dd < bd || (dd == bd && (k > guess ? k - guess : guess - k) < (best > guess ? best - guess : guess - best)))
                            bd = dd, best = k;
                    }
                    start = u.hint.uv[best];
                    hinted = best;
                }
                else
                    start = UsdBrep::InverseProjectSurface(body.brep, f, x);
                uv = body.newton(f, x, start, d);
            }
            else
                uv = UsdBrep::InverseProjectSurface(body.brep, f, x);
            u.t[static_cast<size_t>(i)] = t;
            u.uv[static_cast<size_t>(i)] = uv;
            unknown[static_cast<size_t>(i)] = !std::isfinite(uv[0]) ? 1 : !std::isfinite(uv[1]) ? 2 : body.indeterminate(f, uv, scale);
        }
        // a parameter the surface does not depend on (at a pole) takes its neighbour's value
        for (int k = 0; k < 2; ++k)
        {
            const int bit = k + 1;
            int known = -1;
            for (int i = 0; i <= n; ++i)
                if (!(unknown[static_cast<size_t>(i)] & bit))
                {
                    known = i;
                    break;
                }
            if (known < 0)
                continue;
            for (int i = 0; i <= n; ++i)
                if (unknown[static_cast<size_t>(i)] & bit)
                {
                    int j = i;
                    while (j <= n && (unknown[static_cast<size_t>(j)] & bit))
                        ++j;
                    const int from = i > 0 ? i - 1 : j;
                    if (from >= 0 && from <= n)
                        for (int m = i; m < j; ++m)
                            u.uv[static_cast<size_t>(m)][k] = u.uv[static_cast<size_t>(from)][k];
                    i = j - 1;
                }
        }
        for (int i = 0; i <= n; ++i)
            if (unknown[static_cast<size_t>(i)] == 1 || unknown[static_cast<size_t>(i)] == 2)
                snap(u.uv[static_cast<size_t>(i)], unknown[static_cast<size_t>(i)]);
        // unwrapped: each point within half a period of the one before
        for (int k = 0; k < 2; ++k)
            if (period[k] > 0.0)
                for (int i = 1; i <= n; ++i)
                {
                    double& x = u.uv[static_cast<size_t>(i)][k];
                    x = wrap(k, x, u.uv[static_cast<size_t>(i - 1)][k]);
                }
    }

    // the point of the face nearest to the edge's point at t, near uv `near` (on its side of a seam; a
    // parameter that is free there, at a pole, taken from it); its distance from the edge in `off`
    GfVec2d project(const Use& u, double t, const GfVec2d& near, double* off = nullptr) const
    {
        const GfVec3d x = body.on(u.edge, t);
        GfVec2d uv = body.kind(f) == 2 ? body.newton(f, x, near, d) : UsdBrep::InverseProjectSurface(body.brep, f, x);
        if (body.kind(f) == 2 && (body.at(f, uv) - x).GetLength() > 1e-4 * scale)
        {
            // (stuck far from the edge, as at a pole: from the nearest of SMLib's points, and from the
            // surface's own search, where that is closer)
            std::vector<GfVec2d> starts;
            if (!u.hint.uv.empty())
            {
                size_t best = 0;
                for (size_t k = 1; k < u.hint.xyz.size(); ++k)
                    if ((u.hint.xyz[k] - x).GetLengthSq() < (u.hint.xyz[best] - x).GetLengthSq())
                        best = k;
                starts.push_back(u.hint.uv[best]);
            }
            starts.push_back(UsdBrep::InverseProjectSurface(body.brep, f, x));
            for (const GfVec2d& s0 : starts)
            {
                const GfVec2d other = body.newton(f, x, s0, d);
                if ((body.at(f, other) - x).GetLength() < (body.at(f, uv) - x).GetLength() - 1e-12 * scale)
                    uv = other;
            }
        }
        int free = !std::isfinite(uv[0]) ? 1 : !std::isfinite(uv[1]) ? 2 : body.indeterminate(f, uv, scale);
        if (free & 1)
            uv[0] = near[0];
        if (free & 2)
            uv[1] = near[1];
        if (free == 1 || free == 2)
            snap(uv, free);
        for (int k = 0; k < 2; ++k)
            if (period[k] > 0.0)
                uv[k] = wrap(k, uv[k], near[k]);
        if (off)
            *off = (body.at(f, uv) - x).GetLength();
        return uv;
    }

    // u's trim curve (in the direction of its edge, on the side of the seam its points are): a line
    // where one is close enough, else cubic pieces between points where the curve's direction is taken
    // on each side (Hermite), halved until each keeps within the tolerance of the face's points nearest
    // to the edge. False where the edge lies farther from the face than `limit`.
    bool fit(const Use& u, double limit, Trim& out, double& worst_off) const
    {
        worst_off = 0.0;
        auto at = [&](double t) {
            // (near: the coarse point at or before t)
            size_t i = 0;
            while (i + 1 < u.t.size() && u.t[i + 1] <= t)
                ++i;
            return u.uv[i];
        };
        // a line?
        {
            bool line = true;
            const GfVec2d a = u.uv.front(), b = u.uv.back();
            for (size_t i = 0; i + 1 < u.t.size() && line; ++i)
                for (int k = 0; k < 2 && line; ++k)
                {
                    const double t = k == 0 ? u.t[i] : 0.5 * (u.t[i] + u.t[i + 1]);
                    const GfVec2d l = a + (b - a) * ((t - u.t0) / (u.t1 - u.t0));
                    double off = 0.0;
                    const GfVec2d q = project(u, t, at(t), &off);
                    worst_off = std::max(worst_off, off);
                    line = (body.at(f, l) - body.on(u.edge, t)).GetLength() <= off + body.tol;
                }
            if (line)
            {
                out.set = true, out.order = 2;
                out.knots = {u.t0, u.t0, u.t1, u.t1};
                out.points = {a, b};
                return worst_off <= limit;
            }
        }
        // the pieces: from the coarse points and the knots of a B-spline edge, halved where they stray (no
        // shorter than `least`: the writer takes knots closer than 1e-9 for one)
        const double least = std::max(1e-7 * (u.t1 - u.t0), 1e-8);
        std::vector<double> breaks(u.t.begin(), u.t.end());
        {
            const auto types = body.brep.EdgeCurveTypes();
            if (u.edge < types.size() && types[u.edge] == pxr::UsdBrepCurveTokens->brepCurve3dNurbAPI)
            {
                const uint32_t sub = body.brep.EdgeTypeSubIndex(u.edge);
                const auto vcs = body.brep.EdgeNurbsVertexCounts();
                const auto ords = body.brep.EdgeNurbsOrders();
                const auto kn = body.brep.EdgeNurbsKnots();
                size_t start = 0;
                for (uint32_t i = 0; i < sub && i < vcs.size(); ++i)
                    start += vcs[i] + ords[i];
                if (sub < vcs.size())
                    for (size_t i = start; i < start + vcs[sub] + ords[sub] && i < kn.size(); ++i)
                        if (kn[i] > u.t0 + least && kn[i] < u.t1 - least)
                        {
                            // (a knot takes the place of a point that close to it)
                            auto near = std::find_if(breaks.begin() + 1, breaks.end() - 1,
                                                     [&](double b) { return std::fabs(b - kn[i]) <= least; });
                            if (near != breaks.end() - 1)
                                *near = kn[i];
                            else
                                breaks.push_back(kn[i]);
                        }
                std::sort(breaks.begin(), breaks.end());
                breaks.erase(std::unique(breaks.begin(), breaks.end(), [&](double x, double y) { return std::fabs(x - y) <= least; }),
                             breaks.end());
            }
        }
        struct Piece
        {
            double a, b;
            GfVec2d pa, pb, da, db;
        };
        // the curve's direction at t, from one side (+1 after t, -1 before), by one-sided differences
        // (the edge's direction, one-sided, taken into the surface's parameters through its derivatives
        // at p: least squares, damped where a direction of the surface vanishes, at a pole)
        auto direction = [&](double t, const GfVec2d& p, int side) {
            const double h = 1e-5 * (u.t1 - u.t0);
            const GfVec3d c0 = body.on(u.edge, t), c1 = body.on(u.edge, t + side * h), c2 = body.on(u.edge, t + side * 2 * h);
            const GfVec3d dc = (c0 * -3.0 + c1 * 4.0 - c2) / (2.0 * h * side);
            const double hu = 1e-6 * std::max(1e-12, d.USpan()), hv = 1e-6 * std::max(1e-12, d.VSpan());
            auto partial = [&](const GfVec2d& e, double hh, int k) {
                const double lo = p[k] - hh >= d.uvMin[k] - 1e-12 ? p[k] - hh : p[k], hi = p[k] + hh <= d.uvMax[k] + 1e-12 ? p[k] + hh : p[k];
                GfVec2d a = p, b = p;
                a[k] = lo, b[k] = hi;
                return (body.at(f, b) - body.at(f, a)) / std::max(hi - lo, 1e-300);
            };
            const GfVec3d Su = partial(GfVec2d(1, 0), hu, 0), Sv = partial(GfVec2d(0, 1), hv, 1);
            const double damp = 1e-12 * (Su * Su + Sv * Sv) + 1e-300;
            const double a11 = Su * Su + damp, a12 = Su * Sv, a22 = Sv * Sv + damp, b1 = Su * dc, b2 = Sv * dc;
            const double det = a11 * a22 - a12 * a12;
            return GfVec2d((a22 * b1 - a12 * b2) / det, (a11 * b2 - a12 * b1) / det);
        };
        std::vector<Piece> todo, done;
        std::vector<GfVec2d> points;
        for (size_t i = 0; i < breaks.size(); ++i)
            points.push_back(i == 0 ? u.uv.front() : project(u, breaks[i], i + 1 == breaks.size() ? u.uv.back() : at(breaks[i])));
        points.back() = project(u, u.t1, u.uv.back());
        for (size_t i = 0; i + 1 < breaks.size(); ++i)
            todo.push_back({breaks[i], breaks[i + 1], points[i], points[i + 1], direction(breaks[i], points[i], +1),
                            direction(breaks[i + 1], points[i + 1], -1)});
        std::reverse(todo.begin(), todo.end());
        while (!todo.empty())
        {
            Piece p = todo.back();
            todo.pop_back();
            const double h = p.b - p.a;
            const GfVec2d c1 = p.pa + p.da * (h / 3.0), c2 = p.pb - p.db * (h / 3.0);
            bool ok = true;
            double strays = 0.0;  // (how far the piece's points lie from the edge in space)
            for (double s : {0.2, 0.5, 0.8})
            {
                const double w = 1.0 - s;
                const GfVec2d hermite = p.pa * (w * w * w) + c1 * (3 * w * w * s) + c2 * (3 * w * s * s) + p.pb * (s * s * s);
                double off = 0.0;
                const GfVec2d q = project(u, p.a + s * h, hermite, &off);
                worst_off = std::max(worst_off, off);
                // (as close to the edge as the face's nearest point is, give or take the tolerance: an
                // edge that lies a little off its face is followed as well as it can be)
                const double from_edge = (body.at(f, hermite) - body.on(u.edge, p.a + s * h)).GetLength();
                strays = std::max(strays, from_edge);
                if (from_edge > off + body.tol)
                    ok = false;
            }
            if (ok || h <= 2.0 * least || done.size() + todo.size() > 8192)
            {
                // (a piece that cannot be split further, where the edge leaves its face (past a pole): as
                // close as it is, the tolerance written covering it)
                if (!ok)
                    worst_off = std::max(worst_off, strays);
                done.push_back(p);
                continue;
            }
            const double m = 0.5 * (p.a + p.b);
            const GfVec2d pm = project(u, m, p.pa + (p.pb - p.pa) * 0.5);
            todo.push_back({m, p.b, pm, p.pb, direction(m, pm, +1), p.db});
            todo.push_back({p.a, m, p.pa, pm, p.da, direction(m, pm, -1)});
        }
        out.set = true, out.order = 4;
        out.knots.assign(4, u.t0);
        out.points.clear();
        for (const Piece& p : done)
        {
            const double h = p.b - p.a;
            if (out.points.empty())
                out.points.push_back(p.pa);
            out.points.push_back(p.pa + p.da * (h / 3.0));
            out.points.push_back(p.pb - p.db * (h / 3.0));
            out.points.push_back(p.pb);
            if (&p != &done.back())
                out.knots.insert(out.knots.end(), 3, p.b);
        }
        out.knots.insert(out.knots.end(), 4, u.t1);
        return worst_off <= limit;
    }
};

std::string where(uint32_t brep, uint32_t f) { return "body " + std::to_string(brep) + ", face " + std::to_string(f); }

// The trim curves of every edgeuse of the curved faces of one body (in local edgeuse order; unset: keep);
// `need`: the tolerance the body's edges need, as far as they lie from their faces.
std::vector<Trim> trims(const UsdBrepView& brep, double& need)
{
    const uint32_t faces = brep.FaceCount(), edgeuses = brep.EdgeuseCount();
    std::vector<Trim> out(edgeuses);
    const double tol = brep.HasBrepXSectTol3d() ? brep.BrepXSectTol3d() : 1e-7;
    Body body{brep, std::max(1e-9, 0.01 * tol)};
    const GfVec3d lo = brep.HasBrepExtent() ? brep.BrepExtentMin() : GfVec3d(0.0), hi = brep.HasBrepExtent() ? brep.BrepExtentMax() : GfVec3d(1.0);
    const double scale = std::max(1e-6, (hi - lo).GetLength());
    const auto orients = brep.EdgeuseOrientationTypes();
    const auto ranges = brep.EdgeRanges();
    const auto stored_counts = brep.EdgeuseUVNurbsVertexCounts();
    const auto stored_orders = brep.EdgeuseUVNurbsOrders();
    const auto stored_points = brep.EdgeuseUVNurbsControlVertices();
    const auto stored_knots = brep.EdgeuseUVNurbsKnots();
    const auto stored_weights = brep.EdgeuseUVNurbsWeights();
    std::vector<uint32_t> point_start(edgeuses + 1, 0), knot_start(edgeuses + 1, 0);
    for (uint32_t eu = 0; eu < edgeuses; ++eu)
    {
        const uint32_t vc = eu < stored_counts.size() ? stored_counts[eu] : 0, o = eu < stored_orders.size() ? stored_orders[eu] : 0;
        point_start[eu + 1] = point_start[eu] + vc;
        knot_start[eu + 1] = knot_start[eu] + (vc ? vc + o : 0);
    }

    for (uint32_t f = 0; f < faces; ++f)
    {
        if (body.kind(f) == 0)
            continue;
        Face face{body, f, UsdBrep::GetSurfaceDomain(brep, f), scale};
        face.setup();
        const double* period = face.period;
        // what counts as one point in the parameters: 1e-9 of the face's range (or of a period)
        const double uvtol = 1e-9 * std::max({1.0, face.d.USpan(), face.d.VSpan(), period[0], period[1]});
        for (uint32_t l = 0; l < brep.FaceLoopCount(f); ++l)
        {
            uint32_t start = 0, count = 0;
            if (!UsdBrep::GetFaceLoopEdgeuseStart(brep, f, l, start, count) || count == 0)
                continue;
            std::vector<Use> loop;
            for (uint32_t k = 0; k < count; ++k)
            {
                Use u;
                u.eu = start + k;
                u.edge = brep.EdgeuseLocalEdgeIndex(u.eu);
                if (u.edge >= brep.EdgeCount() || 2 * u.edge + 1 >= ranges.size())
                    throw std::runtime_error("brep: " + where(brep.BrepIndex(), f) + " uses an edge that is not there");
                u.same = u.eu >= orients.size() || orients[u.eu] == pxr::UsdBrepSolidTokens->same;
                u.t0 = ranges[2 * u.edge], u.t1 = ranges[2 * u.edge + 1];
                u.degenerate = !(std::fabs(u.t1 - u.t0) > 1e-12);
                if (u.degenerate)
                    continue;  // (a pole's own edge: the writer gives it its curve)
                // SMLib's own curve of a B-spline face, sampled (it lies on the right side of a seam)
                const uint32_t vc = u.eu < stored_counts.size() ? stored_counts[u.eu] : 0;
                if (body.kind(f) == 2 && vc > 0 && point_start[u.eu + 1] <= stored_points.size() &&
                    knot_start[u.eu + 1] <= stored_knots.size())
                {
                    const uint32_t o = stored_orders[u.eu];
                    auto pts = stored_points.subspan(point_start[u.eu], vc);
                    auto kn = stored_knots.subspan(knot_start[u.eu], vc + o);
                    auto w = stored_weights.size() >= point_start[u.eu + 1] ? stored_weights.subspan(point_start[u.eu], vc)
                                                                           : pxr::TfSpan<const double>();
                    const double s0 = kn[o - 1], s1 = kn[vc];
                    // (in the direction of the edge, as the points are taken)
                    for (int i = 0; i <= 256; ++i)
                    {
                        const double s = u.same ? s0 + (s1 - s0) * i / 256 : s1 - (s1 - s0) * i / 256;
                        const GfVec2d uv = UsdBrep::EvalNurbsCurve2d(pts, kn, w, o, s);
                        u.hint.uv.push_back(uv);
                        u.hint.xyz.push_back(body.at(f, uv));
                    }
                }
                face.sample(u, 16);
                loop.push_back(std::move(u));
            }
            if (loop.empty())
                continue;
            // each edgeuse continues where the one before it ends (whole periods apart at most), from
            // the one farthest inside the face's range
            size_t first = 0;
            double inside = -1.0;
            for (size_t k = 0; k < loop.size(); ++k)
            {
                const GfVec2d mid = loop[k].uv[loop[k].uv.size() / 2];
                double depth = std::numeric_limits<double>::max();
                for (int c = 0; c < 2; ++c)
                    if (period[c] > 0.0)
                    {
                        const double x = std::fmod(std::fmod(mid[c] - face.d.uvMin[c], period[c]) + period[c], period[c]);
                        depth = std::min(depth, std::min(x, period[c] - x));
                    }
                if (depth > inside)
                    inside = depth, first = k;
            }
            // Where an edgeuse meets the next at a pole, its parameter along the pole is free: the second
            // use of a seam then lands on the first. It belongs a period away, on the side that leaves the
            // face to the left of the loop (a positive area in the parameters, as the loop of a whole
            // sphere has): both sides are tried.
            const size_t n = loop.size();
            // the loop closes where an edgeuse ends where the next starts: the same point in the parameters,
            // ends a little apart (each at its own edge's end, all of the jump between them within the
            // tolerance, and not across a period: on a small face with a large tolerance a whole period is
            // within it), or a pole (all of the jump one point of the surface to the last digits)
            const double snap_gap = 1e-3 * std::max({face.d.USpan(), face.d.VSpan(), period[0], period[1]});
            auto closes = [&](size_t k) {
                const GfVec2d p = loop[k].end(), q = loop[(k + 1) % n].start();
                if ((q - p).GetLength() <= uvtol)
                    return true;
                const GfVec3d x = body.at(f, p);
                auto within = [&](double limit) {
                    for (int i = 1; i <= 8; ++i)
                        if ((body.at(f, p + (q - p) * (i / 8.0)) - x).GetLength() > limit)
                            return false;
                    return true;
                };
                bool wraps = false;
                for (int c = 0; c < 2; ++c)
                    wraps = wraps || (period[c] > 0.0 && std::fabs(q[c] - p[c]) > 0.25 * period[c]);
                // (ends apart by more than the tolerance raise it, as edges off their faces do, up to 1e-3 of
                // the body's size)
                return (!wraps && within(1e-3 * scale)) || within(1e-9 * scale);
            };
            auto area = [&]() {
                double a = 0.0;
                std::vector<GfVec2d> poly;
                for (const Use& u : loop)
                {
                    const size_t m = u.uv.size();
                    for (size_t i = 0; i < m; ++i)
                        poly.push_back((u.same ? u.uv[i] : u.uv[m - 1 - i]) + u.shift);
                }
                for (size_t i = 0; i < poly.size(); ++i)
                {
                    const GfVec2d& p = poly[i];
                    const GfVec2d& q = poly[(i + 1) % poly.size()];
                    a += p[0] * q[1] - q[0] * p[1];
                }
                return 0.5 * a;
            };
            auto coincide = [&](const Use& a, const Use& b) {
                return a.edge == b.edge && (a.start() - b.end()).GetLength() <= uvtol && (a.end() - b.start()).GetLength() <= uvtol;
            };
            double best_area = 0.0;
            std::vector<GfVec2d> best;
            // per branch point (an edgeuse after a pole, one that lands on the other use of its seam): the
            // offset tried, and how many it has
            std::vector<int> choice, options;
            for (int tries = 0; tries < 243; ++tries)
            {
                for (int c = 0; c < 2; ++c)
                {
                    loop[first].shift[c] = 0.0;
                    if (period[c] > 0.0)
                    {
                        const GfVec2d mid = loop[first].uv[loop[first].uv.size() / 2];
                        if (body.kind(f) != 2)
                            loop[first].shift[c] = -std::floor((mid[c] - face.d.uvMin[c]) / period[c]) * period[c];
                    }
                }
                size_t branch = 0;
                auto pick = [&](int count) {
                    if (branch >= choice.size())
                        choice.push_back(0), options.push_back(count);
                    return choice[branch++];
                };
                bool outside = false;
                for (size_t j = 1; j < n; ++j)
                {
                    Use& u = loop[(first + j) % n];
                    const Use& prev = loop[(first + j - 1) % n];
                    for (int c = 0; c < 2; ++c)
                        if (period[c] > 0.0)
                        {
                            const double gap = prev.end()[c] - (u.same ? u.uv.front() : u.uv.back())[c];
                            u.shift[c] = face.shift(u, c, gap);
                            if (!std::isfinite(u.shift[c]))
                                u.shift[c] = 0.0;
                        }
                    // after a pole the parameter along it is free: the next edgeuse may lie a period
                    // either way of where it continues
                    if (body.kind(f) != 2)
                    {
                        const int free = body.indeterminate(f, prev.end(), scale);
                        for (int c = 0; c < 2; ++c)
                            if (period[c] > 0.0 && (free & (c + 1)))
                            {
                                static const int offset[3] = {0, -1, 1};
                                u.shift[c] += offset[pick(3)] * period[c];
                            }
                    }
                    for (size_t i = 0; i < j; ++i)
                    {
                        const Use& other = loop[(first + i) % n];
                        if (!coincide(other, u))
                            continue;
                        // the periodic direction along which the seam runs
                        int c = -1;
                        for (int d = 0; d < 2; ++d)
                            if (period[d] > 0.0 && std::fabs(u.uv.front()[d] - u.uv.back()[d]) <= uvtol)
                                c = d;
                        if (c < 0)
                            break;
                        u.shift[c] += (pick(2) == 0 ? 1 : -1) * period[c];
                        if (body.kind(f) == 2)
                            for (const GfVec2d& x : u.uv)  // (a B-spline's seam has its other side within the range only)
                                outside = outside || x[c] + u.shift[c] < face.d.uvMin[c] - 1e-9 * period[c] ||
                                          x[c] + u.shift[c] > face.d.uvMax[c] + 1e-9 * period[c];
                        break;
                    }
                }
                bool ok = !outside;
                for (size_t k = 0; k < n && ok; ++k)
                    ok = closes(k);
                // (a face lies within one period of its surface: a loop that spans more winds around it)
                for (int c = 0; c < 2 && ok; ++c)
                    if (period[c] > 0.0)
                    {
                        double lo = std::numeric_limits<double>::max(), hi = -lo;
                        for (const Use& u : loop)
                            for (const GfVec2d& x : u.uv)
                                lo = std::min(lo, x[c] + u.shift[c]), hi = std::max(hi, x[c] + u.shift[c]);
                        ok = hi - lo <= period[c] * (1.0 + 1e-6);  // (ends apart within the tolerance may overshoot)
                    }
                const double a = ok ? area() : 0.0;
                if (ok && (best.empty() || (a > 0.0 && best_area <= 0.0)))
                {
                    best.clear();
                    for (const Use& u : loop)
                        best.push_back(u.shift);
                    best_area = a;
                }
                // the next combination of sides, until every one was tried or a positive one closed
                if (best_area > 0.0)
                    break;
                size_t k = 0;
                while (k < choice.size() && choice[k] + 1 >= options[k])
                    choice[k++] = 0;
                if (k == choice.size())
                    break;
                ++choice[k];
            }
            if (best.empty())
            {
                throw std::runtime_error("brep: " + where(brep.BrepIndex(), f) + ": its boundary does not close in the "
                                         "parameters of its surface (a loop that winds around it without a seam?)");
            }
            for (size_t k = 0; k < n; ++k)
                loop[k].shift = best[k];
            // the loop's box centred in the face's range (whole periods)
            for (int c = 0; c < 2; ++c)
                if (period[c] > 0.0 && body.kind(f) != 2)
                {
                    double lo = std::numeric_limits<double>::max(), hi = -lo;
                    for (const Use& u : loop)
                        for (const GfVec2d& x : u.uv)
                            lo = std::min(lo, x[c] + u.shift[c]), hi = std::max(hi, x[c] + u.shift[c]);
                    const double mid = 0.5 * (lo + hi);
                    const double s = -std::floor((mid - face.d.uvMin[c]) / period[c]) * period[c];
                    for (Use& u : loop)
                        u.shift[c] += s;
                }
            // the curves: a line along a parameter line, else cubic pieces (an edge that lies farther from
            // its face than the body's tolerance says raises the tolerance written, up to 1e-3 of its size)
            for (Use& u : loop)
            {
                Trim c;
                double off = 0.0;
                const bool ok = face.fit(u, 1e-3 * scale, c, off);
                if (!ok)
                    throw std::runtime_error("brep: " + where(brep.BrepIndex(), f) + ": an edge lies " + std::to_string(off) +
                                             " from it, or its curve in the face's parameters cannot be made close to it");
                need = std::max(need, off / 0.9);
                for (GfVec2d& x : c.points)
                    x += u.shift;
                if (!u.same)
                {
                    // (the edgeuse's own direction, as the arrays hold its curve)
                    std::reverse(c.points.begin(), c.points.end());
                    const double sum = c.knots.front() + c.knots.back();
                    std::reverse(c.knots.begin(), c.knots.end());
                    for (double& k : c.knots)
                        k = sum - k;
                }
                out[u.eu] = std::move(c);
            }
            // consecutive curves meet exactly where their edges meet within the tolerance (each ends at its
            // own edge's end): only a pole's jump (ends that are one point in space, apart in the
            // parameters) is left for the writer to bridge
            const double snap = 1e-3 * std::max({face.d.USpan(), face.d.VSpan(), period[0], period[1]});
            for (size_t k = 0; k < n; ++k)
            {
                GfVec2d& a = out[loop[k].eu].points.back();
                GfVec2d& b = out[loop[(k + 1) % n].eu].points.front();
                const double apart = (body.at(f, a) - body.at(f, b)).GetLength();
                if (&a != &b && ((a - b).GetLength() <= snap || apart > 1e-9 * scale))
                {
                    a = b = (a + b) * 0.5;
                    need = std::max(need, apart / 0.9);  // (each end moved by half of it)
                }
            }
        }
    }
    return out;
}

}  // namespace

namespace smlibpy {

void occt_trim_curves(UsdBrepArrayData& a)
{
    std::vector<uint32_t> counts, orders;
    std::vector<double> knots, weights;
    std::vector<GfVec2d> points;
    size_t total = 0;
    std::vector<double> tolerances(a.m_sBrepXSectTol3dArray.begin(), a.m_sBrepXSectTol3dArray.end());
    for (const UsdBrepView& brep : UsdBrep::UsdBrepRange(a))
    {
        double need = 0.0;
        const std::vector<Trim> mine = trims(brep, need);
        if (brep.BrepIndex() < tolerances.size() && need > tolerances[brep.BrepIndex()])
            tolerances[brep.BrepIndex()] = need;
        const auto vc = brep.EdgeuseUVNurbsVertexCounts();
        const auto ord = brep.EdgeuseUVNurbsOrders();
        const auto pts = brep.EdgeuseUVNurbsControlVertices();
        const auto kn = brep.EdgeuseUVNurbsKnots();
        const auto w = brep.EdgeuseUVNurbsWeights();
        size_t p = 0, k = 0;
        for (uint32_t eu = 0; eu < brep.EdgeuseCount(); ++eu)
        {
            const uint32_t n = eu < vc.size() ? vc[eu] : 0, o = eu < ord.size() ? ord[eu] : 0;
            if (mine[eu].set)
            {
                counts.push_back(static_cast<uint32_t>(mine[eu].points.size()));
                orders.push_back(mine[eu].order);
                knots.insert(knots.end(), mine[eu].knots.begin(), mine[eu].knots.end());
                points.insert(points.end(), mine[eu].points.begin(), mine[eu].points.end());
                weights.insert(weights.end(), mine[eu].points.size(), 1.0);
            }
            else
            {
                counts.push_back(n);
                orders.push_back(n ? o : 0);
                for (uint32_t i = 0; i < n; ++i)
                {
                    points.push_back(p + i < pts.size() ? pts[p + i] : GfVec2d(0.0, 0.0));
                    weights.push_back(p + i < w.size() ? w[p + i] : 1.0);
                }
                for (uint32_t i = 0; n && i < n + o; ++i)
                    knots.push_back(k + i < kn.size() ? kn[k + i] : 0.0);
            }
            p += n;
            k += n ? n + o : 0;
        }
        total += brep.EdgeuseCount();
    }
    if (total != a.m_sEdgeuseEdgeIndexArray.size())
        throw std::runtime_error("brep: the bodies' edgeuses are not where their arrays say");
    a.m_sEdgeuse_CurveNurb_VertexCountArray.assign(counts.begin(), counts.end());
    a.m_sEdgeuse_CurveNurb_OrderArray.assign(orders.begin(), orders.end());
    a.m_sEdgeuse_CurveNurb_KnotsArray.assign(knots.begin(), knots.end());
    a.m_sEdgeuse_CurveNurb_ControlVerticesArray.assign(points.begin(), points.end());
    a.m_sEdgeuse_CurveNurb_WeightsArray.assign(weights.begin(), weights.end());
    a.m_sBrepXSectTol3dArray.assign(tolerances.begin(), tolerances.end());
}

}  // namespace smlibpy
