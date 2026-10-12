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
#include <SmBrepData.h>
#include <SmBSplineCurve.h>
#include <SmBSplineSurface.h>
#include <SmCircle.h>
#include <SmCone.h>
#include <SmCylinder.h>
#include <SmEllipse.h>
#include <SmLine.h>
#include <SmOffsetSurface.h>
#include <SmPlane.h>
#include <SmSphere.h>
#include <SmSurfOfExtrusion.h>
#include <SmSurfOfRevolution.h>
#include <SmTorus.h>

#include <cmath>
#include <memory>
#include <unordered_map>

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

// faces: [{"surface": spec, "same_sense": bool, "loops": [{"edges": [(edge_id, forward)]} | {"vertex": point}]}]
// edges: {edge_id: curve spec running from the edge's start to its end vertex}
SmBrep* build_brep(const py::list& faces, const py::dict& edges, bool solid, bool reversed, bool mirrored)
{
    SmBrepConstructor bc;
    SmBrep* brep = bc.StartBrep(ctx());
    if (!brep)
        throw std::runtime_error("SmBrepConstructor::StartBrep failed");
    try
    {
        if (solid && !bc.StartRegion(TRUE, nullptr))
            throw std::runtime_error("SmBrepConstructor::StartRegion failed");
        SmShell *outer = nullptr, *inner = nullptr;
        check(bc.StartShell(outer, inner), "SmBrepConstructor::StartShell");
        std::unordered_map<long, SmEdge*> made;
        for (auto fh : faces)
        {
            py::dict f = fh.cast<py::dict>();
            bool same = py::cast<bool>(f["same_sense"]);
            SmSurface* srf = make_surface(f["surface"].cast<py::dict>());
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
        check(bc.EndShell(FALSE), "SmBrepConstructor::EndShell");
        if (solid)
            check(bc.EndRegion(), "SmBrepConstructor::EndRegion");
        check(bc.EndBrep(), "SmBrepConstructor::EndBrep");
    }
    catch (...)
    {
        delete brep;
        throw;
    }
    return brep;
}

}  // namespace

void bind_step_build(py::module_& m)
{
    m.def("build_brep", &build_brep, py::arg("faces"), py::arg("edges"), py::arg("solid"), py::arg("reversed") = false,
          py::arg("mirrored") = false, py::return_value_policy::take_ownership,
          "Build a Brep from neutral face/edge data (used by the STEP importer).");
}
