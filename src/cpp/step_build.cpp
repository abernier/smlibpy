// SPDX-License-Identifier: Apache-2.0
//
// Building kernel Breps from neutral B-rep data (used by the STEP importer).
//
// Faces get exact analytic or NURBS surfaces, edges exact curves that span exactly the
// edge from its start to its end vertex. Topology is assembled with SmBrepConstructor;
// edges shared by two faces (or used twice by one face, as seams are) are created once and
// passed to the second use, so the result needs no tolerance-based stitching.

#include "ext.h"

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

SmVector3d vec(py::handle h)
{
    auto s = py::cast<std::vector<double>>(h);
    if (s.size() < 3)
        throw std::invalid_argument("expected three coordinates");
    return SmVector3d(s[0], s[1], s[2]);
}

SmAxis2Placement placement(const py::dict& d, const char* origin_key = "origin")
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

SmBSplineCurve* make_bspline_curve(const py::dict& d)
{
    ULONG degree = py::cast<ULONG>(d["degree"]);
    SmTArray<SmPoint3d> poles;
    for (auto p : d["poles"])
        poles.Add(vec(p));
    SmTArray<double> unique;
    SmTArray<ULONG> mults;
    split_knots(py::cast<std::vector<double>>(d["knots"]), unique, mults);
    SmTArray<double> weights;
    const SmTArray<double>* pw = nullptr;
    if (!d["weights"].is_none())
    {
        for (auto w : d["weights"])
            weights.Add(py::cast<double>(w));
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
SmCurve* make_edge_curve(const py::dict& e)
{
    std::string kind = py::cast<std::string>(e["kind"]);
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
        double sweep = py::cast<double>(e["sweep"]);
        SmExtent1d ivl(0.0, sweep);
        SmCircle* c = nullptr;
        check(SmCircle::CreateCanonical(ctx(), a, py::cast<double>(e["radius"]), c, sweep < 360.0 - 1e-9 ? &ivl : nullptr),
              "SmCircle::CreateCanonical");
        return c;
    }
    if (kind == "ellipse")
    {
        SmAxis2Placement a = placement(e, "center");
        double r1 = py::cast<double>(e["r1"]), r2 = py::cast<double>(e["r2"]);
        SmVector3d o = vec(e["center"]), x = vec(e["x"]);
        SmVector3d z = vec(e["z"]);
        SmVector3d y = z * x;
        auto angle = [&](const SmVector3d& p) {
            SmVector3d d = p - o;
            double deg = std::atan2(d.Dot(y) / r2, d.Dot(x) / r1) * 180.0 / kPi;
            return std::fmod(deg + 360.0, 360.0);
        };
        bool forward = py::cast<bool>(e["forward"]);
        bool closed = py::cast<bool>(e["closed"]);
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
        if (e.contains("whole") && py::cast<bool>(e["whole"]))
            return c.release();
        bool forward = py::cast<bool>(e["forward"]);
        SmExtent1d nat = c->GetNaturalInterval();
        double lo = nat.GetMin(), hi = nat.GetMax();
        double t0 = lo, t1 = hi;
        if (!py::cast<bool>(e["closed"]))
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

SmBSplineCurve* make_generator(const py::dict& g)
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

SmSurface* make_surface(const py::dict& s)
{
    std::string kind = py::cast<std::string>(s["kind"]);
    if (kind == "plane")
    {
        SmPlane* p = nullptr;
        check(SmPlane::CreateCanonical(ctx(), placement(s), p), "SmPlane::CreateCanonical");
        auto d = py::cast<std::vector<double>>(s["domain"]);  // u0, u1, v0, v1
        check(p->AdjustSTEPUVDomain(SmExtent2d(d[0], d[2], d[1], d[3])), "SmPlane::AdjustSTEPUVDomain");
        return p;
    }
    if (kind == "cylinder")
    {
        SmCylinder* c = nullptr;
        check(SmCylinder::CreateCanonical(ctx(), placement(s), py::cast<double>(s["radius"]), c),
              "SmCylinder::CreateCanonical");
        auto h = py::cast<std::vector<double>>(s["height"]);
        check(c->AdjustSTEPUVDomain(SmExtent2d(0.0, h[0], 360.0, h[1])), "SmCylinder::AdjustSTEPUVDomain");
        return c;
    }
    if (kind == "cone")
    {
        // A bounded cone is built from its bottom and top circle (as NVIDIA's USD import
        // does): adjusting the domain of an unbounded cone away from v = 0 loses the surface.
        SmVector3d o = vec(s["origin"]), z = vec(s["z"]), x = vec(s["x"]);
        double r = py::cast<double>(s["radius"]);
        double semi = py::cast<double>(s["semi_angle"]);  // radians, positive
        auto h = py::cast<std::vector<double>>(s["height"]);
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
        check(SmSphere::CreateCanonical(ctx(), placement(s), py::cast<double>(s["radius"]), sp),
              "SmSphere::CreateCanonical");
        return sp;
    }
    if (kind == "torus")
    {
        SmTorus* t = nullptr;
        check(SmTorus::CreateCanonical(ctx(), placement(s), py::cast<double>(s["major"]), py::cast<double>(s["minor"]), t),
              "SmTorus::CreateCanonical");
        if (s.contains("v_start"))  // the seam around the tube, where the face does not reach
        {
            double v0 = py::cast<double>(s["v_start"]);
            SmExtent2d dom = t->GetSTEPUVDomain();
            check(t->AdjustSTEPUVDomain(SmExtent2d(dom.GetUMin(), v0, dom.GetUMax(), v0 + 360.0)),
                  "SmTorus::AdjustSTEPUVDomain");
        }
        return t;
    }
    if (kind == "bspline")
    {
        ULONG ud = py::cast<ULONG>(s["u_degree"]), vd = py::cast<ULONG>(s["v_degree"]);
        SmTArray<SmPoint3d> poles;
        for (auto p : s["poles"])
            poles.Add(vec(p));
        SmTArray<double> uu, vu;
        SmTArray<ULONG> um, vm;
        split_knots(py::cast<std::vector<double>>(s["u_knots"]), uu, um);
        split_knots(py::cast<std::vector<double>>(s["v_knots"]), vu, vm);
        SmTArray<double> weights;
        const SmTArray<double>* pw = nullptr;
        if (!s["weights"].is_none())
        {
            for (auto w : s["weights"])
                weights.Add(py::cast<double>(w));
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
        SmBSplineCurve* g = make_generator(s["curve"].cast<py::dict>());
        SmSurfOfExtrusion* e = nullptr;
        check(SmSurfOfExtrusion::CreateCanonical(ctx(), g, vec(s["vector"]), e), "SmSurfOfExtrusion::CreateCanonical");
        auto v = py::cast<std::vector<double>>(s["v_range"]);
        SmExtent2d dom = e->GetSTEPUVDomain();
        check(e->AdjustSTEPUVDomain(SmExtent2d(dom.GetUMin(), v[0], dom.GetUMax(), v[1])),
              "SmSurfOfExtrusion::AdjustSTEPUVDomain");
        return e;
    }
    if (kind == "revolution")
    {
        SmBSplineCurve* g = make_generator(s["curve"].cast<py::dict>());
        SmSurfOfRevolution* r = nullptr;
        check(SmSurfOfRevolution::CreateCanonical(ctx(), g, vec(s["axis_origin"]), vec(s["axis"]), r),
              "SmSurfOfRevolution::CreateCanonical");
        return r;
    }
    if (kind == "offset")
    {
        SmSurface* base = make_surface(s["basis"].cast<py::dict>());
        return new (ctx()) SmOffsetSurface(py::cast<double>(s["distance"]), *base, TRUE);
    }
    throw std::invalid_argument("unknown surface kind: " + kind);
}

// Points along the edges of a face's loops, ends included.
std::vector<SmPoint3d> loop_points(const py::dict& f, const py::dict& edges, int per_edge)
{
    std::vector<SmPoint3d> out;
    for (auto lh : f["loops"])
    {
        py::dict loop = lh.cast<py::dict>();
        if (!loop.contains("edges"))
            continue;
        for (auto uh : loop["edges"])
        {
            long id = py::cast<long>(uh.cast<py::tuple>()[0]);
            std::unique_ptr<SmCurve> c(make_edge_curve(edges[py::int_(id)].cast<py::dict>()));
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
// gets its seam moved to where the face does not reach.
SmSurface* seam_off_face(SmSurface* srf, const py::dict& f, const py::dict& edges)
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
                points = loop_points(f, edges, 32);
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
double winding(const SmSurface* srf, SmSurfParamType dir, const std::vector<py::tuple>& uses, const py::dict& edges)
{
    const SmExtent2d dom = srf->GetNaturalUVDomain();
    const double period = (dir == SM_SP_U ? dom.GetUInterval() : dom.GetVInterval()).GetLength();
    std::vector<double> ts;
    for (const py::tuple& use : uses)
    {
        std::unique_ptr<SmCurve> c(make_edge_curve(edges[py::int_(py::cast<long>(use[0]))].cast<py::dict>()));
        const bool forward = py::cast<bool>(use[1]);
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
// rest of the loop bounds: the loop without it. True if one was dropped.
bool drop_slits(const SmSurface* srf, py::dict& f, const py::dict& edges)
{
    const SmExtent2d dom = srf->GetNaturalUVDomain();
    std::vector<SmSurfParamType> closed;
    for (SmSurfParamType dir : {SM_SP_U, SM_SP_V})
        if (srf->IsClosed(dom, dir))
            closed.push_back(dir);
    if (closed.empty())
        return false;
    bool dropped = false;
    py::list loops;
    for (auto lh : f["loops"])
    {
        py::dict loop = lh.cast<py::dict>();
        if (!loop.contains("edges"))
        {
            loops.append(loop);
            continue;
        }
        std::vector<py::tuple> uses;
        for (auto uh : loop["edges"])
            uses.push_back(uh.cast<py::tuple>());
        const size_t n = uses.size();
        std::vector<bool> slit(n, false);
        for (size_t i = 0; i < n && n > 2; ++i)
        {
            const size_t j = (i + 1) % n;
            if (py::cast<long>(uses[i][0]) == py::cast<long>(uses[j][0])
                && py::cast<bool>(uses[i][1]) != py::cast<bool>(uses[j][1]))
                slit[i] = slit[j] = true;
        }
        std::vector<py::tuple> rest;
        for (size_t i = 0; i < n; ++i)
            if (!slit[i])
                rest.push_back(uses[i]);
        bool around = rest.empty() || rest.size() == n;
        for (SmSurfParamType dir : closed)
            if (!around && std::fabs(winding(srf, dir, rest, edges)) > 0.5)
                around = true;
        if (around)
        {
            loops.append(loop);
            continue;
        }
        py::list kept;
        for (const py::tuple& use : rest)
            kept.append(use);
        py::dict copy = loop.attr("copy")().cast<py::dict>();
        copy["edges"] = kept;
        loops.append(copy);
        dropped = true;
    }
    if (dropped)
        f["loops"] = loops;
    return dropped;
}

// The faces of one shell, into the shell the constructor has open. Edges already made (by this
// shell or an earlier one) are used again.
void add_faces(SmBrepConstructor& bc, const py::list& faces, const py::dict& edges, bool reversed, bool mirrored,
               std::unordered_map<long, SmEdge*>& made)
{
    for (auto fh : faces)
    {
        py::dict f = fh.cast<py::dict>();
        bool same = py::cast<bool>(f["same_sense"]);
        SmSurface* srf = make_surface(f["surface"].cast<py::dict>());
        bool free_seam = f.contains("free_seam") && py::cast<bool>(f["free_seam"]);
        if (srf->GetType() == SmBSplineSurface_TYPE)
        {
            py::dict g = f.attr("copy")().cast<py::dict>();
            bool dropped = false;
            try
            {
                dropped = drop_slits(srf, g, edges);
            }
            catch (const std::exception&)
            {
            }
            if (dropped)
            {
                f = g;  // the face's own seam edge is gone: its surface's seam may have to move
                free_seam = true;
            }
        }
        if (free_seam)
            srf = seam_off_face(srf, f, edges);
        if (!bc.StartFace((same != reversed) ? SM_OT_SAME : SM_OT_OPPOSITE))
        {
            delete srf;
            throw std::runtime_error("SmBrepConstructor::StartFace failed");
        }
        check(bc.SetFaceSurface(srf, srf->GetNaturalUVDomain()), "SmBrepConstructor::SetFaceSurface");
        for (auto lh : f["loops"])
        {
            py::dict loop = lh.cast<py::dict>();
            if (loop.contains("vertex"))
            {
                if (!bc.StartAndEndSingleVertexLoop(vec(loop["vertex"])))
                    throw std::runtime_error("SmBrepConstructor::StartAndEndSingleVertexLoop failed");
                continue;
            }
            // loops run counterclockwise around the face normal (STEP convention)
            if (!bc.StartLoop((same != mirrored) ? SM_OT_SAME : SM_OT_OPPOSITE))
                throw std::runtime_error("SmBrepConstructor::StartLoop failed");
            for (auto uh : loop["edges"])
            {
                py::tuple use = uh.cast<py::tuple>();
                long id = py::cast<long>(use[0]);
                SmOrientType o = py::cast<bool>(use[1]) ? SM_OT_SAME : SM_OT_OPPOSITE;
                auto it = made.find(id);
                if (it != made.end())
                {
                    if (!bc.StartEdge(o, it->second, nullptr, nullptr))
                        throw std::runtime_error("SmBrepConstructor::StartEdge failed");
                    check(bc.EndEdge(), "SmBrepConstructor::EndEdge");
                    continue;
                }
                SmEdge* e = bc.StartEdge(o, nullptr, nullptr, nullptr);
                if (!e)
                    throw std::runtime_error("SmBrepConstructor::StartEdge failed");
                SmCurve* c = make_edge_curve(edges[py::int_(id)].cast<py::dict>());
                check(bc.SetEdgeCurve(c, FALSE), "SmBrepConstructor::SetEdgeCurve");
                SmExtent1d ivl = c->GetNaturalInterval();
                check(bc.SetLimits(SmVertexNode(ivl.GetMin()), SmVertexNode(ivl.GetMax())),
                      "SmBrepConstructor::SetLimits");
                check(bc.EndEdge(), "SmBrepConstructor::EndEdge");
                made[id] = e;
            }
            check(bc.EndLoop(), "SmBrepConstructor::EndLoop");
        }
        check(bc.EndFace(), "SmBrepConstructor::EndFace");
    }
}

// faces: [{"surface": spec, "same_sense": bool, "loops": [{"edges": [(edge_id, forward)]} | {"vertex": point}]}]
// edges: {edge_id: curve spec running from the edge's start to its end vertex}
// voids: [(faces, reversed)]: cavities of a solid (STEP BREP_WITH_VOIDS), each a void region inside
// the solid's region ("reversed" as for the solid's faces)
SmBrep* build_brep(const py::list& faces, const py::dict& edges, bool solid, bool reversed, bool mirrored,
                   const py::list& voids)
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
        std::unordered_map<long, SmEdge*> made;
        add_faces(bc, faces, edges, reversed, mirrored, made);
        check(bc.EndShell(FALSE), "SmBrepConstructor::EndShell");
        if (solid)
            check(bc.EndRegion(), "SmBrepConstructor::EndRegion");
        // a cavity is a region of its own with the solid's region outside it (SmBrepConstructor)
        for (auto vh : voids)
        {
            if (!solid)
                throw std::invalid_argument("build_brep: voids need a solid");
            py::tuple v = vh.cast<py::tuple>();
            SmRegion* cavity = bc.StartRegion(TRUE, region);
            if (!cavity)
                throw std::runtime_error("SmBrepConstructor::StartRegion failed");
            check(bc.StartShell(outer, inner), "SmBrepConstructor::StartShell");
            add_faces(bc, v[0].cast<py::list>(), edges, py::cast<bool>(v[1]), mirrored, made);
            check(bc.EndShell(FALSE), "SmBrepConstructor::EndShell");
            check(bc.EndRegion(), "SmBrepConstructor::EndRegion");
            cavity->SetIsVoid(TRUE);
        }
        check(bc.EndBrep(), "SmBrepConstructor::EndBrep");
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

// Faces on periodic surfaces that no edge runs along the seam of, or that edges cross the
// seam of: [{"face", "missing", "crossed"}]. STEP writers leave seams out (NX writes a
// cylinder band as its two end loops), and the kernel's tessellation and integration need
// them. With fix, the kernel adds the seam edges and splits the edges that cross it
// (SmFace::SplitAtSeam), in place. ``only`` limits both to these face indices.
// Faces whose loops run the wrong way round for their orientation: their oriented trim curves
// enclose a negative area in the parameter plane. A STEP face whose same_sense flag disagrees
// with the direction of its loops (as the loops of its neighbours have it) comes out so; the
// kernel then takes it for the rest of its surface, or integrates it with the wrong sign.
py::list inverted_faces(SmBrep* brep)
{
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    py::list out;
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
            out.append(i);
    }
    return out;
}

py::list seam_problems(SmBrep* brep, bool fix, const py::object& only)
{
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    std::vector<ULONG> which;
    if (only.is_none())
        for (ULONG i = 0; i < faces.GetSize(); ++i)
            which.push_back(i);
    else
        for (auto h : only)
        {
            ULONG i = py::cast<ULONG>(h);
            if (i < faces.GetSize())
                which.push_back(i);
        }
    py::list out;
    for (ULONG i : which)
    {
        SmCurveClassification cu, cv;
        SmSurfParamType crossed = SM_SP_UNKNOWN, missing = SM_SP_UNKNOWN, near = SM_SP_UNKNOWN;
        faces[i]->HasSeamProblem(cu, cv, crossed, missing, near, FALSE);
        const char *m = seam_name(missing), *c = seam_name(crossed);
        if (!*m && !*c)
            continue;
        py::dict d;
        d["face"] = i;
        d["missing"] = m;
        d["crossed"] = c;
        if (fix)
        {
            SmTemporaryChangeValue<SmBoolean> editing(brep->m_bEditingEnabled, TRUE);
            check(faces[i]->SplitAtSeam(cu, cv, crossed, missing, near), "SmFace::SplitAtSeam");
        }
        out.append(d);
    }
    return out;
}

}  // namespace

void bind_step_build(py::module_& m)
{
    m.def("inverted_faces", &inverted_faces, py::arg("brep"),
          "Indices of faces whose oriented trim curves enclose a negative area in the parameter plane: loops "
          "that run the wrong way round for the face's orientation.");
    m.def("seam_problems", &seam_problems, py::arg("brep"), py::arg("fix") = false, py::arg("only") = py::none(),
          "Faces of periodic surfaces whose seam no edge runs along, or edges cross: [{face, missing, crossed}] "
          "('u', 'v' or 'both'). fix=True has the kernel add the seams (in place); only= limits both to these face "
          "indices.");
    m.def("build_brep", &build_brep, py::arg("faces"), py::arg("edges"), py::arg("solid"), py::arg("reversed") = false,
          py::arg("mirrored") = false, py::arg("voids") = py::list(), py::return_value_policy::take_ownership,
          "Build a Brep from neutral face/edge data (used by the STEP importer). voids: [(faces, reversed)], the "
          "cavities of a solid, each built as a void region inside it.");
}
