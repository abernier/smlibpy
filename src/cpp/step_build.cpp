// SPDX-License-Identifier: Apache-2.0
//
// Building kernel Breps from neutral B-rep data (used by the STEP importer).
//
// Faces get exact analytic or NURBS surfaces, edges exact curves that span exactly the
// edge from its start to its end vertex. Topology is assembled with SmBrepConstructor;
// edges shared by two faces (or used twice by one face, as seams are) are created once and
// passed to the second use, and so are the file's vertices, so the result needs no
// tolerance-based stitching.

#include "kernel.h"
#include "step_build.h"

#include <SmApiGeneral.h>
#include <SmApiQueries.h>
#include <SmBrepData.h>
#include <SmBSplineCurve.h>
#include <SmBSplineSurface.h>
#include <SmCircle.h>
#include <SmCone.h>
#include <SmCurveClass.h>
#include <SmCylinder.h>
#include <SmEllipse.h>
#include <SmFace.h>
#include <SmLine.h>
#include <SmOffsetSurface.h>
#include <SmPlane.h>
#include <SmRegion.h>
#include <SmSphere.h>
#include <SmSurfOfExtrusion.h>
#include <SmSurfOfRevolution.h>
#include <SmTorus.h>

#include <algorithm>
#include <cmath>
#include <memory>
#include <unordered_map>
#include <vector>

namespace
{

// M_PI is not standard C++; MSVC only defines it with _USE_MATH_DEFINES
constexpr double kPi = 3.14159265358979323846;

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(status, what, __FILE__, __LINE__);
}

SmVector3d vec(const smlibpy::Value& h)
{
    const std::vector<double> s = h.nums();
    if (s.size() < 3)
        throw std::invalid_argument("expected three coordinates");
    return SmVector3d(s[0], s[1], s[2]);
}

SmAxis2Placement placement(const smlibpy::Value& d, const char* origin_key = "origin")
{
    SmAxis2Placement a;
    check(a.SetSTEPCanonical(vec(d[origin_key]), vec(d["z"]), vec(d["x"])), "SmAxis2Placement::SetSTEPCanonical");
    return a;
}

void split_knots(const std::vector<double>& knots, SmTArray<double>& unique, SmTArray<ULONG>& mults)
{
    for (double k : knots)
    {
        ULONG n = unique.GetSize();
        if (n && std::abs(k - unique[n - 1]) <= 1e-14 * std::max(1.0, std::abs(k)))
            mults[n - 1] += 1;
        else
        {
            unique.Add(k);
            mults.Add(1);
        }
    }
}

SmBSplineCurve* make_bspline_curve(const smlibpy::Value& d)
{
    ULONG degree = static_cast<ULONG>(d["degree"].num());
    SmTArray<SmPoint3d> poles;
    for (const smlibpy::Value& p : d["poles"].list())
        poles.Add(vec(p));
    SmTArray<double> unique;
    SmTArray<ULONG> mults;
    split_knots(d["knots"].nums(), unique, mults);
    SmTArray<double> weights;
    const SmTArray<double>* pw = nullptr;
    if (!d["weights"].is_none())
    {
        for (const smlibpy::Value& w : d["weights"].list())
            weights.Add(w.num());
        pw = &weights;
    }
    SmBSplineCurve* c = nullptr;
    check(SmBSplineCurve::CreateCanonical(ctx(), 3, degree, poles, SM_CF_UNSPECIFIED, mults, unique,
                                          SM_KT_UNSPECIFIED, pw, nullptr, c),
          "SmBSplineCurve::CreateCanonical");
    return c;
}

double drop(const SmCurve* c, const SmPoint3d& p)
{
    SmBoolean ok = FALSE;
    double t = 0.0, dist = 0.0;
    check(const_cast<SmCurve*>(c)->DropPoint(c->GetNaturalInterval(), p, nullptr, 1e-7, nullptr, ok, t, dist),
          "SmCurve::DropPoint");
    if (!ok)
        throw std::runtime_error("a vertex does not lie on its edge curve");
    return t;
}

// A curve that runs exactly from the edge's start vertex to its end vertex.
SmCurve* make_edge_curve(const smlibpy::Value& e)
{
    std::string kind = e["kind"].str();
    if (kind == "line")
    {
        SmLine* l = nullptr;
        check(SmLine::CreateLineSegment(ctx(), 3, vec(e["p0"]), vec(e["p1"]), l, nullptr), "SmLine::CreateLineSegment");
        return l;
    }
    if (kind == "circle")
    {
        // x points at the start vertex and z is oriented so the edge runs counterclockwise
        SmAxis2Placement a = placement(e, "center");
        double sweep = e["sweep"].num();
        SmExtent1d ivl(0.0, sweep);
        SmCircle* c = nullptr;
        check(SmCircle::CreateCanonical(ctx(), a, e["radius"].num(), c, sweep < 360.0 - 1e-9 ? &ivl : nullptr),
              "SmCircle::CreateCanonical");
        return c;
    }
    if (kind == "ellipse")
    {
        SmAxis2Placement a = placement(e, "center");
        double r1 = e["r1"].num(), r2 = e["r2"].num();
        SmVector3d o = vec(e["center"]), x = vec(e["x"]);
        SmVector3d z = vec(e["z"]);
        SmVector3d y = z * x;
        auto angle = [&](const SmVector3d& p) {
            SmVector3d d = p - o;
            double deg = std::atan2(d.Dot(y) / r2, d.Dot(x) / r1) * 180.0 / kPi;
            return std::fmod(deg + 360.0, 360.0);
        };
        bool forward = e["forward"].boolean();
        bool closed = e["closed"].boolean();
        double a0 = angle(vec(e["p0"])), a1 = angle(vec(e["p1"]));
        double start = forward ? a0 : a1;
        double span = closed ? 360.0 : std::fmod((forward ? a1 - a0 : a0 - a1) + 720.0, 360.0);
        if (span < 1e-9)
            span = 360.0;
        if (start + span > 360.0)
            start -= 360.0;
        SmExtent1d ivl(start, start + span);
        SmEllipse* el = nullptr;
        check(SmEllipse::CreateCanonical(ctx(), a, r1, r2, el, &ivl), "SmEllipse::CreateCanonical");
        if (!forward)
        {
            SmExtent1d reversed;
            check(el->ReverseParameterization(el->GetNaturalInterval(), reversed), "SmCurve::ReverseParameterization");
        }
        return el;
    }
    if (kind == "bspline")
    {
        std::unique_ptr<SmBSplineCurve> c(make_bspline_curve(e));
        if (e.has("whole") && e["whole"].boolean())
            return c.release();
        bool forward = e["forward"].boolean();
        SmExtent1d nat = c->GetNaturalInterval();
        double lo = nat.GetMin(), hi = nat.GetMax();
        double t0 = lo, t1 = hi;
        if (!e["closed"].boolean())
        {
            t0 = drop(c.get(), vec(e["p0"]));
            t1 = drop(c.get(), vec(e["p1"]));
            // On a closed curve the edge may run across the curve's start: a vertex there
            // belongs to whichever end the edge needs, and a piece that wraps is joined from
            // the part before and the part after the start.
            SmVector3d a[1], b[1];
            check(c->Evaluate(lo, 0, TRUE, a, FALSE), "SmCurve::Evaluate");
            check(c->Evaluate(hi, 0, FALSE, b, FALSE), "SmCurve::Evaluate");
            double span = hi - lo, eps = 1e-9 * span;
            if ((a[0] - b[0]).Length() <= 1e-7 * std::max(1.0, a[0].Length()))
            {
                if (forward)
                {
                    if (t0 >= hi - eps) t0 = lo;
                    if (t1 <= lo + eps) t1 = hi;
                }
                else
                {
                    if (t0 <= lo + eps) t0 = hi;
                    if (t1 >= hi - eps) t1 = lo;
                }
                double from = forward ? t0 : t1, to = forward ? t1 : t0;  // along the curve
                if (from > to + eps)
                {
                    std::unique_ptr<SmBSplineCurve> tail(std::move(c)), head(make_bspline_curve(e));
                    SmExtent1d ivl_tail(from, hi), ivl_head(lo, to);
                    check(tail->Trim(ivl_tail), "SmBSplineCurve::Trim");
                    check(head->Trim(ivl_head), "SmBSplineCurve::Trim");
                    SmTArray<SmBSplineCurve*> parts;
                    parts.Add(tail.get());
                    parts.Add(head.get());
                    SmBSplineCurve* joined = nullptr;
                    check(SmBSplineCurve::CreateByJoining(ctx(), parts, nullptr, joined), "SmBSplineCurve::CreateByJoining");
                    std::unique_ptr<SmBSplineCurve> result(joined);
                    if (!forward)
                    {
                        SmExtent1d reversed;
                        check(result->ReverseParameterization(result->GetNaturalInterval(), reversed),
                              "SmCurve::ReverseParameterization");
                    }
                    return result.release();
                }
            }
        }
        else if (!forward)
            std::swap(t0, t1);
        double from = std::min(t0, t1), to = std::max(t0, t1);
        if (to - from > 1e-12 && (from > lo + 1e-12 || to < hi - 1e-12))
        {
            SmExtent1d ivl(from, to);
            check(c->Trim(ivl), "SmBSplineCurve::Trim");
        }
        if (t0 > t1)  // the edge runs against the curve
        {
            SmExtent1d reversed;
            check(c->ReverseParameterization(c->GetNaturalInterval(), reversed), "SmCurve::ReverseParameterization");
        }
        return c.release();
    }
    throw std::invalid_argument("unknown edge curve kind: " + kind);
}

SmBSplineCurve* make_generator(const smlibpy::Value& g)
{
    SmCurve* c = make_edge_curve(g);
    SmBSplineCurve* b = SM_CAST_PTR(SmBSplineCurve, c);
    if (!b)
    {
        delete c;
        throw std::runtime_error("unsupported generator curve");
    }
    return b;
}

SmSurface* make_surface(const smlibpy::Value& s)
{
    std::string kind = s["kind"].str();
    if (kind == "plane")
    {
        SmPlane* p = nullptr;
        check(SmPlane::CreateCanonical(ctx(), placement(s), p), "SmPlane::CreateCanonical");
        auto d = s["domain"].nums();  // u0, u1, v0, v1
        check(p->AdjustSTEPUVDomain(SmExtent2d(d[0], d[2], d[1], d[3])), "SmPlane::AdjustSTEPUVDomain");
        return p;
    }
    if (kind == "cylinder")
    {
        SmCylinder* c = nullptr;
        check(SmCylinder::CreateCanonical(ctx(), placement(s), s["radius"].num(), c),
              "SmCylinder::CreateCanonical");
        auto h = s["height"].nums();
        check(c->AdjustSTEPUVDomain(SmExtent2d(0.0, h[0], 360.0, h[1])), "SmCylinder::AdjustSTEPUVDomain");
        return c;
    }
    if (kind == "cone")
    {
        // A bounded cone is built from its bottom and top circle (as NVIDIA's USD import
        // does): adjusting the domain of an unbounded cone away from v = 0 loses the surface.
        SmVector3d o = vec(s["origin"]), z = vec(s["z"]), x = vec(s["x"]);
        double r = s["radius"].num();
        double semi = s["semi_angle"].num();  // radians, positive
        auto h = s["height"].nums();
        double t = std::tan(semi);
        double r0 = std::max(0.0, r + h[0] * t), r1 = std::max(0.0, r + h[1] * t);
        SmAxis2Placement a;
        check(a.SetSTEPCanonical(o + z * h[0], z, x), "SmAxis2Placement::SetSTEPCanonical");
        SmCone* c = nullptr;
        check(SmCone::CreateCanonical(ctx(), a, r0, r1, h[1] - h[0], c), "SmCone::CreateCanonical");
        return c;
    }
    if (kind == "sphere")
    {
        SmSphere* sp = nullptr;
        check(SmSphere::CreateCanonical(ctx(), placement(s), s["radius"].num(), sp),
              "SmSphere::CreateCanonical");
        return sp;
    }
    if (kind == "torus")
    {
        SmTorus* t = nullptr;
        check(SmTorus::CreateCanonical(ctx(), placement(s), s["major"].num(), s["minor"].num(), t),
              "SmTorus::CreateCanonical");
        if (s.has("v_start"))  // the seam around the tube, where the face does not reach
        {
            double v0 = s["v_start"].num();
            // (a window starting a rounding error after -360 is one starting at 0: the kernel
            // refuses the first, SmEllipse::AdjustSTEPInterval)
            if (v0 <= -360.0 + 1e-9)
                v0 = 0.0;
            SmExtent2d dom = t->GetSTEPUVDomain();
            check(t->AdjustSTEPUVDomain(SmExtent2d(dom.GetUMin(), v0, dom.GetUMax(), v0 + 360.0)),
                  "SmTorus::AdjustSTEPUVDomain");
        }
        return t;
    }
    if (kind == "bspline")
    {
        ULONG ud = static_cast<ULONG>(s["u_degree"].num()), vd = static_cast<ULONG>(s["v_degree"].num());
        SmTArray<SmPoint3d> poles;
        for (const smlibpy::Value& p : s["poles"].list())
            poles.Add(vec(p));
        SmTArray<double> uu, vu;
        SmTArray<ULONG> um, vm;
        split_knots(s["u_knots"].nums(), uu, um);
        split_knots(s["v_knots"].nums(), vu, vm);
        SmTArray<double> weights;
        const SmTArray<double>* pw = nullptr;
        if (!s["weights"].is_none())
        {
            for (const smlibpy::Value& w : s["weights"].list())
                weights.Add(w.num());
            pw = &weights;
        }
        SmBSplineSurface* b = nullptr;
        check(SmBSplineSurface::CreateCanonical(ctx(), ud, vd, poles, SM_SF_UNSPECIFIED, um, vm, uu, vu, SM_KT_UNSPECIFIED,
                                                pw, nullptr, b),
              "SmBSplineSurface::CreateCanonical");
        return b;
    }
    if (kind == "extrusion")
    {
        SmBSplineCurve* g = make_generator(s["curve"]);
        SmSurfOfExtrusion* e = nullptr;
        check(SmSurfOfExtrusion::CreateCanonical(ctx(), g, vec(s["vector"]), e), "SmSurfOfExtrusion::CreateCanonical");
        auto v = s["v_range"].nums();
        SmExtent2d dom = e->GetSTEPUVDomain();
        check(e->AdjustSTEPUVDomain(SmExtent2d(dom.GetUMin(), v[0], dom.GetUMax(), v[1])),
              "SmSurfOfExtrusion::AdjustSTEPUVDomain");
        return e;
    }
    if (kind == "revolution")
    {
        SmBSplineCurve* g = make_generator(s["curve"]);
        SmSurfOfRevolution* r = nullptr;
        check(SmSurfOfRevolution::CreateCanonical(ctx(), g, vec(s["axis_origin"]), vec(s["axis"]), r),
              "SmSurfOfRevolution::CreateCanonical");
        return r;
    }
    if (kind == "offset")
    {
        SmSurface* base = make_surface(s["basis"]);
        return new (ctx()) SmOffsetSurface(s["distance"].num(), *base, TRUE);
    }
    throw std::invalid_argument("unknown surface kind: " + kind);
}

// Points along the edges of loops (a face's), ends included.
std::vector<SmPoint3d> loop_points(const smlibpy::Value& loops, const smlibpy::Value& edges, int per_edge)
{
    std::vector<SmPoint3d> out;
    for (const smlibpy::Value& loop : loops.list())
    {
        if (!loop.has("edges"))
            continue;
        for (const smlibpy::Value& use : loop["edges"].list())
        {
            long id = static_cast<long>(use.at(0).num());
            std::unique_ptr<SmCurve> c(make_edge_curve(edges[std::to_string(id)]));
            SmExtent1d ivl = c->GetNaturalInterval();
            for (int i = 0; i <= per_edge; ++i)
            {
                SmVector3d p[1];
                if (c->Evaluate(ivl.Evaluate(double(i) / per_edge), 0, TRUE, p, FALSE) == SM_SUCCESS)
                    out.push_back(p[0]);
            }
        }
    }
    return out;
}

// Where the seam of a B-spline surface closed in `dir` has to be for a face whose boundary
// passes through `points` to stay off it: in the widest stretch of the parameter the face does
// not reach, at a knot of the surface there if it has one (a split right beside a knot leaves a
// span too short for the tessellator). NaN if the face does not cross the seam (touching it is
// fine), or if it reaches all the way around.
double seam_outside(const SmSurface* srf, SmSurfParamType dir, const std::vector<SmPoint3d>& points)
{
    const SmExtent2d dom = srf->GetNaturalUVDomain();
    const SmExtent1d ivl = dir == SM_SP_U ? dom.GetUInterval() : dom.GetVInterval();
    const double lo = ivl.GetMin(), hi = ivl.GetMax(), period = hi - lo;
    const double none = std::nan("");
    if (!(period > 0.0))
        return none;
    // points on the seam belong to either end and say nothing about crossing it
    const double on_seam = 1e-5 * period;
    std::vector<double> ts;
    for (const SmPoint3d& p : points)
    {
        SmPoint3d closest;
        SmTArray<SmPoint2d> uvs;
        double dist = 0.0;
        if (SmApiSurfaceClosestPoint(srf, p, closest, uvs, dist) != SM_SUCCESS || uvs.IsEmpty())
            continue;
        const double t = dir == SM_SP_U ? uvs[0].x : uvs[0].y;
        if (uvs.GetSize() > 1 || t < lo + on_seam || t > hi - on_seam)
            continue;
        ts.push_back(t);
    }
    if (ts.size() < 3)
        return none;
    std::sort(ts.begin(), ts.end());
    double widest = (ts.front() - lo) + (hi - ts.back()), from = none, to = none;  // the stretch across the seam
    for (size_t i = 0; i + 1 < ts.size(); ++i)
        if (ts[i + 1] - ts[i] > widest)
        {
            widest = ts[i + 1] - ts[i];
            from = ts[i];
            to = ts[i + 1];
        }
    if (std::isnan(from) || widest <= 0.05 * period)
        return none;
    const double middle = 0.5 * (from + to);
    double at = middle;
    SmTArray<double> knots;
    if (srf->GetKnots(dir, knots, nullptr, nullptr) == SM_SUCCESS)
        for (ULONG i = 0; i < knots.GetSize(); ++i)
            if (knots[i] > from + 0.1 * widest && knots[i] < to - 0.1 * widest
                && std::fabs(knots[i] - middle) < std::fabs(at - middle) + (at == middle ? widest : 0.0))
                at = knots[i];
    return at;
}

// The same surface with its seam in direction `dir` moved to `at`: split there, and the two
// pieces joined the other way round.
SmBSplineSurface* move_seam(SmBSplineSurface* b, SmSurfParamType dir, double at)
{
    SmSurface *left = nullptr, *right = nullptr;
    check(b->SplitAt(ctx(), at, dir, left, right), "SmBSplineSurface::SplitAt");
    std::unique_ptr<SmSurface> l(left), r(right);
    SmBSplineSurface *lb = SM_CAST_PTR(SmBSplineSurface, left), *rb = SM_CAST_PTR(SmBSplineSurface, right);
    if (!lb || !rb)
        throw std::runtime_error("SmBSplineSurface::SplitAt returned no B-spline surfaces");
    // the flag is the direction the parameter crosses the joint in (its comment in the header has
    // u and v the other way round)
    SmBSplineSurface* joined = nullptr;
    check(rb->JoinSurface(ctx(), lb, dir, 1e-7, joined), "SmBSplineSurface::JoinSurface");
    return joined;
}

// A face on a B-spline surface that closes on itself, with no seam edge of its own, may lie
// across the surface's seam (where its parameter starts over): the kernel then trims the
// face the wrong way round, so it covers the rest of the surface instead. Such a surface
// gets its seam moved to where the face (bounded by `loops`) does not reach.
SmSurface* seam_off_face(SmSurface* srf, const smlibpy::Value& loops, const smlibpy::Value& edges)
{
    if (srf->GetType() != SmBSplineSurface_TYPE)
        return srf;
    const SmExtent2d dom = srf->GetNaturalUVDomain();
    std::vector<SmPoint3d> points;
    for (SmSurfParamType dir : {SM_SP_U, SM_SP_V})
    {
        // where this fails, the surface stays as it is: the face is no worse than written
        try
        {
            if (!srf->IsClosed(dom, dir))
                continue;
            if (points.empty())
                points = loop_points(loops, edges, 32);
            const double at = seam_outside(srf, dir, points);
            if (std::isnan(at))
                continue;
            SmBSplineSurface* moved = move_seam(SM_CAST_PTR(SmBSplineSurface, srf), dir, at);
            delete srf;
            srf = moved;
        }
        catch (const std::exception&)
        {
        }
    }
    return srf;
}

// How many times a closed chain of edge uses winds around a surface closed in `dir`: the
// parameter of points along it, unwrapped, from the start round to the start.
double winding(const SmSurface* srf, SmSurfParamType dir, const std::vector<smlibpy::Value>& uses,
               const smlibpy::Value& edges)
{
    const SmExtent2d dom = srf->GetNaturalUVDomain();
    const double period = (dir == SM_SP_U ? dom.GetUInterval() : dom.GetVInterval()).GetLength();
    std::vector<double> ts;
    for (const smlibpy::Value& use : uses)
    {
        std::unique_ptr<SmCurve> c(make_edge_curve(edges[std::to_string(static_cast<long>(use.at(0).num()))]));
        const bool forward = use.at(1).boolean();
        const SmExtent1d ivl = c->GetNaturalInterval();
        constexpr int n = 16;
        for (int i = 0; i < n; ++i)  // the end is where the next use starts
        {
            SmVector3d p[1];
            const double s = double(i) / n;
            if (c->Evaluate(ivl.Evaluate(forward ? s : 1.0 - s), 0, TRUE, p, FALSE) != SM_SUCCESS)
                continue;
            SmPoint3d closest;
            SmTArray<SmPoint2d> uvs;
            double dist = 0.0;
            if (SmApiSurfaceClosestPoint(srf, p[0], closest, uvs, dist) == SM_SUCCESS && !uvs.IsEmpty())
                ts.push_back(dir == SM_SP_U ? uvs[0].x : uvs[0].y);
        }
    }
    double turns = 0.0;
    for (size_t i = 0; i < ts.size(); ++i)
    {
        double step = ts[(i + 1) % ts.size()] - ts[i];
        step -= period * std::round(step / period);  // the short way round
        turns += step;
    }
    return period > 0.0 ? turns / period : 0.0;
}

// A loop that runs along an edge and straight back (two uses next to each other) has a slit,
// or the seam up to a pole (a cone's tip). On a surface that closes on itself it is the seam
// only if the rest of the loop goes around the surface; otherwise the edge is a cut into the
// face that a broken file left (it may even run out of the face), and the face is what the
// rest of the loop bounds: the loop without it. The face's loops with such slits dropped, or
// none if it has none.
smlibpy::Value drop_slits(const SmSurface* srf, const smlibpy::Value& f, const smlibpy::Value& edges)
{
    const SmExtent2d dom = srf->GetNaturalUVDomain();
    std::vector<SmSurfParamType> closed;
    for (SmSurfParamType dir : {SM_SP_U, SM_SP_V})
        if (srf->IsClosed(dom, dir))
            closed.push_back(dir);
    if (closed.empty())
        return {};
    bool dropped = false;
    smlibpy::Value loops = smlibpy::Value::make_list();
    for (const smlibpy::Value& loop : f["loops"].list())
    {
        if (!loop.has("edges"))
        {
            loops.push(loop);
            continue;
        }
        const std::vector<smlibpy::Value>& uses = loop["edges"].list();
        const size_t n = uses.size();
        std::vector<bool> slit(n, false);
        for (size_t i = 0; i < n && n > 2; ++i)
        {
            const size_t j = (i + 1) % n;
            if (static_cast<long>(uses[i].at(0).num()) == static_cast<long>(uses[j].at(0).num())
                && uses[i].at(1).boolean() != uses[j].at(1).boolean())
                slit[i] = slit[j] = true;
        }
        std::vector<smlibpy::Value> rest;
        for (size_t i = 0; i < n; ++i)
            if (!slit[i])
                rest.push_back(uses[i]);
        bool around = rest.empty() || rest.size() == n;
        for (SmSurfParamType dir : closed)
            if (!around && std::fabs(winding(srf, dir, rest, edges)) > 0.5)
                around = true;
        if (around)
        {
            loops.push(loop);
            continue;
        }
        smlibpy::Value copy = loop;
        copy.set("edges", smlibpy::Value::make_list(std::move(rest)));
        loops.push(std::move(copy));
        dropped = true;
    }
    return dropped ? loops : smlibpy::Value();
}

// What the constructor has made of the file's edges and vertices, by id.
struct Made
{
    std::unordered_map<long, SmEdge*> edges;
    std::unordered_map<long, SmVertex*> vertices;

    // the vertex made for the file vertex an edge spec names at "v0" or "v1" (none: not made yet)
    SmVertex* vertex(const smlibpy::Value& spec, const char* end) const
    {
        if (!spec.has(end))
            return nullptr;
        auto it = vertices.find(static_cast<long>(spec[end].num()));
        return it == vertices.end() ? nullptr : it->second;
    }
};

// The faces of one shell, into the shell the constructor has open. Edges already made (by this
// shell or an earlier one) are used again, and so are vertices: a new edge starts and ends at the
// vertices made for its file vertices ("v0", "v1" of its spec). The constructor makes a vertex only
// where a loop ends, for each vertexuse not linked to one yet, and a vertex whose edges were first
// made in different loops came out once per loop (a part with 20 vertices in the file had 26).
void add_faces(SmBrepConstructor& bc, const smlibpy::Value& faces, const smlibpy::Value& edges, bool reversed,
               bool mirrored, Made& made)
{
    for (const smlibpy::Value& f : faces.list())
    {
        bool same = f["same_sense"].boolean();
        SmSurface* srf = make_surface(f["surface"]);
        bool free_seam = f.has("free_seam") && f["free_seam"].boolean();
        smlibpy::Value without_slits;
        if (srf->GetType() == SmBSplineSurface_TYPE)
        {
            try
            {
                without_slits = drop_slits(srf, f, edges);
            }
            catch (const std::exception&)
            {
            }
            if (!without_slits.is_none())
                free_seam = true;  // the face's own seam edge is gone: its surface's seam may have to move
        }
        const smlibpy::Value& loops = without_slits.is_none() ? f["loops"] : without_slits;
        if (free_seam)
            srf = seam_off_face(srf, loops, edges);
        if (!bc.StartFace((same != reversed) ? SM_OT_SAME : SM_OT_OPPOSITE))
        {
            delete srf;
            throw std::runtime_error("SmBrepConstructor::StartFace failed");
        }
        check(bc.SetFaceSurface(srf, srf->GetNaturalUVDomain()), "SmBrepConstructor::SetFaceSurface");
        for (const smlibpy::Value& loop : loops.list())
        {
            if (loop.has("vertex"))
            {
                if (!bc.StartAndEndSingleVertexLoop(vec(loop["vertex"])))
                    throw std::runtime_error("SmBrepConstructor::StartAndEndSingleVertexLoop failed");
                continue;
            }
            // loops run counterclockwise around the face normal (STEP convention)
            if (!bc.StartLoop((same != mirrored) ? SM_OT_SAME : SM_OT_OPPOSITE))
                throw std::runtime_error("SmBrepConstructor::StartLoop failed");
            std::vector<std::pair<SmEdge*, const smlibpy::Value*>> fresh;  // edges new in this loop
            for (const smlibpy::Value& use : loop["edges"].list())
            {
                long id = static_cast<long>(use.at(0).num());
                SmOrientType o = use.at(1).boolean() ? SM_OT_SAME : SM_OT_OPPOSITE;
                auto it = made.edges.find(id);
                if (it != made.edges.end())
                {
                    if (!bc.StartEdge(o, it->second, nullptr, nullptr))
                        throw std::runtime_error("SmBrepConstructor::StartEdge failed");
                    check(bc.EndEdge(), "SmBrepConstructor::EndEdge");
                    continue;
                }
                // (the vertices at the start and the end of the curve: StartEdge takes them in the
                // loop's direction and turns them round for an edge used against it)
                const smlibpy::Value& spec = edges[std::to_string(id)];
                SmEdge* e = bc.StartEdge(o, nullptr, made.vertex(spec, "v0"), made.vertex(spec, "v1"));
                if (!e)
                    throw std::runtime_error("SmBrepConstructor::StartEdge failed");
                SmCurve* c = make_edge_curve(spec);
                check(bc.SetEdgeCurve(c, FALSE), "SmBrepConstructor::SetEdgeCurve");
                SmExtent1d ivl = c->GetNaturalInterval();
                check(bc.SetLimits(SmVertexNode(ivl.GetMin()), SmVertexNode(ivl.GetMax())),
                      "SmBrepConstructor::SetLimits");
                check(bc.EndEdge(), "SmBrepConstructor::EndEdge");
                made.edges[id] = e;
                fresh.emplace_back(e, &spec);
            }
            check(bc.EndLoop(), "SmBrepConstructor::EndLoop");
            // the loop has its vertices now: those of the file's vertices are used again
            for (const auto& [e, spec] : fresh)
                for (const auto& [end, v] : {std::make_pair("v0", e->GetStartVertex()), std::make_pair("v1", e->GetEndVertex())})
                    if (spec->has(end) && v)
                        made.vertices.emplace(static_cast<long>((*spec)[end].num()), v);
        }
        check(bc.EndFace(), "SmBrepConstructor::EndFace");
    }
}

// One kernel vertex for each file vertex. Within a loop the constructor links the vertexuses of
// neighbouring edges only; a seam on a B-spline face, which meets the same vertex again further
// round the loop, still came out with a second vertex there (3 in the valve body's 102). Those are
// glued to the first (SmBrep::GlueVertices keeps it and widens its tolerance by the distance).
void glue_file_vertices(SmBrep* brep, const smlibpy::Value& edges, const Made& made)
{
    std::vector<long> ids;  // (in order: the vertex that stays must not depend on hashing)
    for (const auto& entry : made.edges)
        ids.push_back(entry.first);
    std::sort(ids.begin(), ids.end());
    std::unordered_map<long, SmVertex*> first;
    for (long id : ids)
    {
        const SmEdge* e = made.edges.at(id);
        const smlibpy::Value& spec = edges[std::to_string(id)];
        for (const char* end : {"v0", "v1"})
        {
            SmVertex* have = end[1] == '0' ? e->GetStartVertex() : e->GetEndVertex();
            if (!spec.has(end) || !have)
                continue;
            auto [it, fresh] = first.emplace(static_cast<long>(spec[end].num()), have);
            SmVertex* want = it->second;
            if (fresh || want == have)
                continue;
            check(brep->GlueVertices(want, have), "SmBrep::GlueVertices");
            for (auto& entry : first)  // (a vertex the constructor made for two file vertices is gone too)
                if (entry.second == have)
                    entry.second = want;
        }
    }
}

// Each face's parameter domain around its trim curves, as faces made by the kernel's own operations
// have it (the constructor gives a face its surface's whole domain), in the directions the face takes
// less than half of. The kernel's search for a point
// inside a face (SmFace::CalculateAnInternalPoint: 20 lines across the domain) misses a narrow strip
// of a torus in the whole domain, and Face.interior_point() and STEP export failed on it. A face
// whose trim curves cannot be made keeps the whole domain.
void tighten_uv_domains(SmBrep* brep)
{
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        SmExtent2d dom;
        if (faces[i]->CalculateUVDomainFromUVTrimCurves(dom, TRUE) != SM_SUCCESS)
            continue;
        const SmExtent2d whole = faces[i]->GetUVDomain();
        const double du = dom.GetUInterval().GetLength(), dv = dom.GetVInterval().GetLength();
        if (!(std::isfinite(du) && std::isfinite(dv) && du > 0 && dv > 0))
            continue;
        // Only a direction the face takes less than half of is narrowed (a strip of a torus): where
        // the trim curves span most of a closed surface's period (a band between two helices
        // around a cylinder), the face can reach past their box, and the narrowed domain cut
        // off part of the face.
        const bool nu = du < 0.5 * whole.GetUInterval().GetLength(), nv = dv < 0.5 * whole.GetVInterval().GetLength();
        if (nu || nv)
            faces[i]->SetUVDomain(SmExtent2d(nu ? dom.GetUMin() : whole.GetUMin(), nv ? dom.GetVMin() : whole.GetVMin(),
                                             nu ? dom.GetUMax() : whole.GetUMax(), nv ? dom.GetVMax() : whole.GetVMax()));
    }
}

SmBrep* build(const smlibpy::Value& faces, const smlibpy::Value& edges, bool solid, bool reversed, bool mirrored,
              const smlibpy::Value& voids)
{
    SmBrepConstructor bc;
    SmBrep* brep = bc.StartBrep(ctx());
    if (!brep)
        throw std::runtime_error("SmBrepConstructor::StartBrep failed");
    try
    {
        SmRegion* region = nullptr;
        if (solid && !(region = bc.StartRegion(TRUE, nullptr)))
            throw std::runtime_error("SmBrepConstructor::StartRegion failed");
        SmShell *outer = nullptr, *inner = nullptr;
        check(bc.StartShell(outer, inner), "SmBrepConstructor::StartShell");
        Made made;
        add_faces(bc, faces, edges, reversed, mirrored, made);
        check(bc.EndShell(FALSE), "SmBrepConstructor::EndShell");
        if (solid)
            check(bc.EndRegion(), "SmBrepConstructor::EndRegion");
        // a cavity is a region of its own with the solid's region outside it (SmBrepConstructor)
        if (!voids.is_none())
            for (const smlibpy::Value& v : voids.list())
            {
                if (!solid)
                    throw std::invalid_argument("build_brep: voids need a solid");
                SmRegion* cavity = bc.StartRegion(TRUE, region);
                if (!cavity)
                    throw std::runtime_error("SmBrepConstructor::StartRegion failed");
                check(bc.StartShell(outer, inner), "SmBrepConstructor::StartShell");
                add_faces(bc, v.at(0), edges, v.at(1).boolean(), mirrored, made);
                check(bc.EndShell(FALSE), "SmBrepConstructor::EndShell");
                check(bc.EndRegion(), "SmBrepConstructor::EndRegion");
                cavity->SetIsVoid(TRUE);
            }
        check(bc.EndBrep(), "SmBrepConstructor::EndBrep");
        glue_file_vertices(brep, edges, made);
        tighten_uv_domains(brep);
    }
    catch (...)
    {
        delete brep;
        throw;
    }
    return brep;
}

const char* seam_name(SmSurfParamType t)
{
    return t == SM_SP_U ? "u" : t == SM_SP_V ? "v" : t == SM_SP_BOTH ? "both" : "";
}

}  // namespace

namespace smlibpy {

SmBrep* build_brep(const Value& faces, const Value& edges, bool solid, bool reversed, bool mirrored,
                   const Value& voids)
{
    return build(faces, edges, solid, reversed, mirrored, voids);
}

Value inverted_faces(SmBrep* brep)
{
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    Value out = Value::make_list();
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        SmTArray<ULONG> loops;  // the number of curves of each loop
        SmTArray<SmBSplineCurve*> curves;
        const SmStatus st = faces[i]->CreateOrientedTrimBoundary(ctx(), TRUE, TRUE, loops, curves);
        std::vector<std::unique_ptr<SmBSplineCurve>> owned;
        for (ULONG c = 0; c < curves.GetSize(); ++c)
            owned.emplace_back(curves[c]);
        if (st != SM_SUCCESS || owned.empty())
            continue;
        const SmExtent2d dom = faces[i]->GetUVDomain();
        const double size = std::max(dom.GetUInterval().GetLength(), dom.GetVInterval().GetLength());
        // Green: twice the enclosed area is the closed integral of u dv - v du, here summed over
        // the chords of the sampled curves. Only for loops that close in the parameter plane: a
        // band around a periodic surface has loops that do not, and no sign to read.
        double twice = 0.0;
        bool closed = true;
        size_t first = 0;
        for (ULONG l = 0; l < loops.GetSize() && closed; ++l)
        {
            SmVector3d start[1], prev[1];
            bool have = false;
            for (size_t c = first; c < first + loops[l] && c < owned.size(); ++c)
            {
                const SmExtent1d ivl = owned[c]->GetNaturalInterval();
                constexpr int n = 32;
                for (int k = 0; k <= n; ++k)
                {
                    SmVector3d p[1];
                    if (owned[c]->Evaluate(ivl.Evaluate(double(k) / n), 0, k < n, p, FALSE) != SM_SUCCESS)
                        continue;
                    if (!have)
                        start[0] = p[0], have = true;
                    else
                        twice += prev[0].x * p[0].y - p[0].x * prev[0].y;
                    prev[0] = p[0];
                }
            }
            first += loops[l];
            if (!have || (prev[0] - start[0]).Length() > 1e-6 * std::max(1.0, size))
                closed = false;
            else
                twice += prev[0].x * start[0].y - start[0].x * prev[0].y;
        }
        if (closed && twice < -1e-9 * std::max(1.0, size * size))
            out.push(Value::integer(static_cast<long long>(i)));
    }
    return out;
}

Value seam_problems(SmBrep* brep, bool fix, const std::vector<long>* only)
{
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    std::vector<ULONG> which;
    if (only == nullptr)
        for (ULONG i = 0; i < faces.GetSize(); ++i)
            which.push_back(i);
    else
        for (long i : *only)
            if (i >= 0 && static_cast<ULONG>(i) < faces.GetSize())
                which.push_back(static_cast<ULONG>(i));
    Value out = Value::make_list();
    for (ULONG i : which)
    {
        SmCurveClassification cu, cv;
        SmSurfParamType crossed = SM_SP_UNKNOWN, missing = SM_SP_UNKNOWN, near = SM_SP_UNKNOWN;
        faces[i]->HasSeamProblem(cu, cv, crossed, missing, near, FALSE);
        const char *m = seam_name(missing), *c = seam_name(crossed);
        if (!*m && !*c)
            continue;
        Value d = Value::dict();
        d.set("face", Value::integer(static_cast<long long>(i)));
        d.set("missing", Value::of(std::string(m)));
        d.set("crossed", Value::of(std::string(c)));
        if (fix)
        {
            SmTemporaryChangeValue<SmBoolean> editing(brep->m_bEditingEnabled, TRUE);
            check(faces[i]->SplitAtSeam(cu, cv, crossed, missing, near), "SmFace::SplitAtSeam");
        }
        out.push(d);
    }
    return out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "py_value.h"

void bind_step_build(py::module_& m)
{
    m.def("inverted_faces", [](SmBrep* brep) { return smlibpy::to_python(smlibpy::inverted_faces(brep)); },
          py::arg("brep"),
          "Indices of faces whose oriented trim curves enclose a negative area in the parameter plane: loops "
          "that run the wrong way round for the face's orientation.");
    m.def("seam_problems", [](SmBrep* brep, bool fix, py::object only) {
        std::vector<long> indices;
        if (!only.is_none())
            for (py::handle h : only)
                indices.push_back(py::cast<long>(h));
        return smlibpy::to_python(smlibpy::seam_problems(brep, fix, only.is_none() ? nullptr : &indices));
    }, py::arg("brep"), py::arg("fix") = false, py::arg("only") = py::none(),
          "Faces of periodic surfaces whose seam no edge runs along, or edges cross: [{face, missing, crossed}] "
          "('u', 'v' or 'both'). fix=True has the kernel add the seams (in place); only= limits both to these face "
          "indices.");
    m.def("build_brep", [](py::handle faces, py::handle edges, bool solid, bool reversed, bool mirrored,
                           py::object voids) {
        return smlibpy::build_brep(smlibpy::to_value(faces), smlibpy::to_value(edges), solid, reversed, mirrored,
                                   smlibpy::to_value(voids));
    }, py::arg("faces"), py::arg("edges"), py::arg("solid"), py::arg("reversed") = false,
          py::arg("mirrored") = false, py::arg("voids") = py::list(), py::return_value_policy::take_ownership,
          "Build a Brep from neutral face/edge data (used by the STEP importer). voids: [(faces, reversed)], the "
          "cavities of a solid, each built as a void region inside it.");
}
#endif  // SMLIBPY_PYTHON
