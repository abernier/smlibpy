// SPDX-License-Identifier: Apache-2.0
//
// Curve tools (`smlibpy._core.ext`), shared by the Python extension and the JavaScript module:
//
//   intersect_curves(a, a0, a1, b, b0, b1, tolerance)   where two curves meet (points and overlaps)
//   self_intersections(curve, t0, t1, tolerance)        where a curve crosses itself
//   intersect_curve_faces(curve, t0, t1, faces, tol)    where a curve meets faces
//   extend_curve(curve, distance, at_start, continuity) a B-spline made longer at one end
//
// The kernel's own curve intersection (SmApiIntersectCurves, k.intersect_curves) takes the whole
// curves with a fixed tolerance of 0.001 and fails where nothing is found: skew lines 0.0005 apart
// crossed, parallel lines of a 0.01 mm part crossed, and overlapping segments gave one point. Here
// SmCurve::GlobalCurveIntersect runs over the intervals asked for with the caller's tolerance, an
// empty result is an empty list, and overlaps come back as ranges. The faces' version mirrors
// SM_API's sm_AppendCurveSurfaceHits (SmSurface::GlobalCurveIntersect, then the point classified
// in the face) with the caller's tolerance, and keeps the curve's parameter of every point.
//
// Python only: the kernel's ellipse, parabola and hyperbola curves registered as classes of their
// own (SmPyLib registers B-spline curves, lines and circles only, so pybind11 handed an ellipse
// to Python as a plain Curve, and every call that takes a B-spline curve refused it).

#include "kernel.h"
#include "curve_tools.h"
#include "measure.h"

#include <SmApiGeneral.h>
#include <nurbs.h>
#include <NL_Globals.h>

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace
{

using smlibpy::tup;
using smlibpy::Value;

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(status, what, __FILE__, __LINE__);
}

void check_interval(double t0, double t1, const char* what)
{
    if (!(std::isfinite(t0) && std::isfinite(t1) && t0 < t1))
        throw std::invalid_argument(std::string(what) + ": the interval must run upwards");
}

void check_tolerance(double tolerance)
{
    if (!(tolerance > 0.0) || !std::isfinite(tolerance))
        throw std::invalid_argument("the tolerance must be positive");
}

Value xyz(const SmPoint3d& p) { return tup(p.x, p.y, p.z); }

// The solutions of a curve x curve solve as values.
Value curve_solutions(const SmCurve* a, SmSolutionArray& sols)
{
    Value out = Value::make_list();
    for (ULONG i = 0; i < sols.GetSize(); i++)
    {
        const SmSolution& s = sols[i];
        Value d = Value::dict();
        d.set("t", tup(s.m_vStart[0], s.m_vStart[1]));
        if (s.m_eSolutionType == SM_ST_RANGE_OF_VALUES)
            d.set("end", tup(s.m_vEnd[0], s.m_vEnd[1]));
        else
            d.set("end", Value());
        d.set("distance", smlibpy::v(s.m_vStart.m_dSolutionValue));
        SmPoint3d p;
        check(a->EvaluatePoint(s.m_vStart[0], p), "SmCurve::EvaluatePoint");
        d.set("point", xyz(p));
        out.push(d);
    }
    return out;
}

// Where `curve` over [t0, t1] meets the edges of a face: the curve's parameters.
void edge_crossings(const SmCurve* curve, double t0, double t1, const SmFace* face, double tolerance,
                    std::vector<double>& out)
{
    SmTArray<SmEdge*> edges;
    face->GetEdges(edges);
    for (ULONG i = 0; i < edges.GetSize(); i++)
    {
        const SmEdge* e = edges[i];
        const SmCurve* c = e->GetCurve();
        if (!c)
            continue;
        SmSolutionArray sols;
        check(curve->GlobalCurveIntersect(SmExtent1d(t0, t1), *c, e->GetInterval(), tolerance, sols),
              "SmCurve::GlobalCurveIntersect");
        for (ULONG j = 0; j < sols.GetSize(); j++)
        {
            out.push_back(sols[j].m_vStart[0]);
            if (sols[j].m_eSolutionType == SM_ST_RANGE_OF_VALUES)
                out.push_back(sols[j].m_vEnd[0]);
        }
    }
}

bool on_face(const SmFace* face, double u, double v)
{
    SmPointClassification pc;
    check(face->PointClassify(SmPoint2d(u, v), SmTol::GetZoneTol3d(face), FALSE, TRUE, pc), "SmFace::PointClassify");
    return pc.GetPointClass() != SM_PC_UNKNOWN;
}

}  // namespace

namespace smlibpy {

void init_kernel_limits()
{
    // The spiral fit (NL_Spiral.cpp) refines up to NL_CCPLIM - 6 spans. With the default of 1000
    // a helix of radius 20 failed SmApiCreateHelix's tolerance check beyond 32 turns; with 2^20
    // every helix up to the API's 124.25 turns fits within it (124 turns at radius 50: 7939
    // control points, 2.7 ms). The fitter allocates by the spans it uses, so the cap costs nothing.
    // NL_CCPLIM has no other reader in the kernel.
    NL_CCPLIM = 1L << 20;
}

Value intersect_curves(const SmCurve* a, double a0, double a1, const SmCurve* b, double b0, double b1,
                       double tolerance)
{
    if (!a || !b)
        throw std::invalid_argument("curve is None");
    check_interval(a0, a1, "intersect_curves");
    check_interval(b0, b1, "intersect_curves");
    check_tolerance(tolerance);
    SmSolutionArray sols;
    check(a->GlobalCurveIntersect(SmExtent1d(a0, a1), *b, SmExtent1d(b0, b1), tolerance, sols),
          "SmCurve::GlobalCurveIntersect");
    return curve_solutions(a, sols);
}

Value self_intersections(const SmCurve* curve, double t0, double t1, double tolerance)
{
    if (!curve)
        throw std::invalid_argument("curve is None");
    check_interval(t0, t1, "self_intersections");
    check_tolerance(tolerance);
    SmSolutionArray sols;
    check(curve->GlobalCurveSelfIntersect(SmExtent1d(t0, t1), tolerance, sols), "SmCurve::GlobalCurveSelfIntersect");
    return curve_solutions(curve, sols);
}

Value intersect_curve_faces(const SmCurve* curve, double t0, double t1, const std::vector<SmFace*>& faces,
                            double tolerance)
{
    if (!curve)
        throw std::invalid_argument("curve is None");
    check_interval(t0, t1, "intersect_curve_faces");
    check_tolerance(tolerance);
    Value out = Value::make_list();
    auto add = [&](double t, size_t face) {
        SmPoint3d p;
        check(curve->EvaluatePoint(t, p), "SmCurve::EvaluatePoint");
        Value d = Value::dict();
        d.set("t", smlibpy::v(t));
        d.set("face", smlibpy::v(static_cast<long long>(face)));
        d.set("point", xyz(p));
        out.push(d);
    };
    for (size_t f = 0; f < faces.size(); f++)
    {
        const SmFace* face = faces[f];
        if (!face)
            throw std::invalid_argument("face is None");
        const SmSurface* surface = face->GetSurface();
        if (!surface)
            continue;
        SmSolutionArray sols;
        check(surface->GlobalCurveIntersect(face->GetUVDomain(), *curve, SmExtent1d(t0, t1), tolerance, sols),
              "SmSurface::GlobalCurveIntersect");
        for (ULONG i = 0; i < sols.GetSize(); i++)
        {
            const SmSolution& s = sols[i];
            if (s.m_eSolutionType != SM_ST_RANGE_OF_VALUES)
            {
                if (on_face(face, s.m_vStart[1], s.m_vStart[2]))
                    add(s.m_vStart[0], f);
                continue;
            }
            // The curve lies on the surface from s.m_vStart[0] to s.m_vEnd[0]: where that stretch is
            // on the face, its ends are where it starts and stops lying on the face; the face's edges
            // cut it where it leaves the face and comes back.
            double s0 = std::min(s.m_vStart[0], s.m_vEnd[0]), s1 = std::max(s.m_vStart[0], s.m_vEnd[0]);
            if (on_face(face, s.m_vStart[1], s.m_vStart[2]))
                add(s.m_vStart[0], f);
            if (on_face(face, s.m_vEnd[1], s.m_vEnd[2]))
                add(s.m_vEnd[0], f);
            if (s1 > s0)
            {
                std::vector<double> cuts;
                edge_crossings(curve, s0, s1, face, tolerance, cuts);
                for (double t : cuts)
                    add(t, f);
            }
        }
    }
    return out;
}

SmBSplineCurve* extend_curve(const SmCurve* curve, double distance, bool at_start, int continuity)
{
    if (!curve)
        throw std::invalid_argument("curve is None");
    if (!(distance > 0.0) || !std::isfinite(distance))
        throw std::invalid_argument("extend_curve: the distance must be positive");
    SmContinuityType ct;
    switch (continuity)
    {
        case 1: ct = SM_CT_G1; break;
        case 2: ct = SM_CT_G1_G2; break;
        case 0: ct = SM_CT_CINFINITY; break;
        default: throw std::invalid_argument("extend_curve: continuity must be 0 (natural), 1 (G1) or 2 (G2)");
    }
    // CreateExtendedCurve works on the B-spline's NLib form, which it builds on the curve: a copy.
    SmCurve* copy = nullptr;
    check(curve->Copy(ctx(), copy), "SmCurve::Copy");
    std::unique_ptr<SmCurve> own(copy);
    SmBSplineCurve* b = SM_CAST_PTR(SmBSplineCurve, copy);
    std::unique_ptr<SmBSplineCurve> approximated;
    if (!b)
    {
        SmTArray<double> breaks;
        SmExtent1d ivl = copy->GetNaturalInterval();
        breaks.Add(ivl.GetMin());
        breaks.Add(ivl.GetMax());
        double gap = 0.0;
        SmBSplineCurve* a = nullptr;
        check(copy->ApproximateCurve(ctx(), breaks, 1e-7, gap, a, FALSE, TRUE), "SmCurve::ApproximateCurve");
        approximated.reset(a);
        b = a;
    }
    // G1 adds a straight piece of exactly `distance`; G2 and the continued polynomial add a curved
    // one whose length the kernel only estimates (5.18 and 5.005 for 5 on a three-point spline):
    // the distance asked of it is corrected until the added length is the one wanted.
    auto extended = [&](double d) {
        SmBSplineCurve* out = nullptr;
        check(b->CreateExtendedCurve(ctx(), d, at_start ? 1 : 2, ct, out), "SmBSplineCurve::CreateExtendedCurve");
        if (!out)
            check(SM_ERR, "SmBSplineCurve::CreateExtendedCurve");
        return std::unique_ptr<SmBSplineCurve>(out);
    };
    const SmExtent1d own_ivl = b->GetNaturalInterval();
    const double length = curve_length(b, own_ivl.GetMin(), own_ivl.GetMax(), 1e-12);
    auto added = [&](const SmBSplineCurve* c) {
        const SmExtent1d ivl = c->GetNaturalInterval();
        return curve_length(c, ivl.GetMin(), ivl.GetMax(), 1e-12) - length;
    };
    std::unique_ptr<SmBSplineCurve> best = extended(distance);
    if (ct == SM_CT_G1)
        return best.release();
    const double tol = 1e-10 * std::max(1.0, distance);
    double d0 = distance, g0 = added(best.get()) - distance;
    double d1 = distance - g0, g1 = 0.0;
    for (int i = 0; i < 12 && std::abs(g0) > tol; i++)
    {
        if (!(d1 > 0.0))
            d1 = 0.5 * d0;
        std::unique_ptr<SmBSplineCurve> c = extended(d1);
        g1 = added(c.get()) - distance;
        if (std::abs(g1) < std::abs(g0))
            best = std::move(c);
        const double slope = (g1 - g0) / (d1 - d0);
        d0 = d1, g0 = g1;
        if (!(std::abs(slope) > 1e-12))
            break;
        d1 = d1 - g1 / slope;
    }
    if (std::abs(added(best.get()) - distance) > 1e-7 * std::max(1.0, distance))
        throw std::runtime_error("extend_curve: the extension does not reach the distance asked for (the curve "
                                 "turns back on itself); extend less, or with continuity G1");
    return best.release();
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"
#include "py_value.h"

#include <SmEllipse.h>
#include <SmHyperbola.h>
#include <SmParabola.h>

void bind_curve_types(py::module_& m)
{
    // SmPyTypes.cpp registers BSplineCurve, Line and Circle; pybind11 hands a curve to Python as
    // the most derived registered class of its dynamic type, so an SmEllipse came back as Curve.
    py::class_<SmEllipse, SmBSplineCurve, std::unique_ptr<SmEllipse, py::nodelete>>(m, "Ellipse");
    py::class_<SmParabola, SmBSplineCurve, std::unique_ptr<SmParabola, py::nodelete>>(m, "Parabola");
    py::class_<SmHyperbola, SmBSplineCurve, std::unique_ptr<SmHyperbola, py::nodelete>>(m, "Hyperbola");
}

void bind_curve_tools(py::module_ m)
{
    m.def("intersect_curves", [](const SmCurve* a, double a0, double a1, const SmCurve* b, double b0, double b1,
                                 double tolerance) {
        return smlibpy::to_python(smlibpy::intersect_curves(a, a0, a1, b, b0, b1, tolerance));
    }, py::arg("a"), py::arg("a0"), py::arg("a1"), py::arg("b"), py::arg("b0"), py::arg("b1"), py::arg("tolerance"),
          "Where two curves meet over [a0, a1] and [b0, b1] within a 3D tolerance: [{t: (ta, tb), end: (ta1, tb1) "
          "where they overlap else None, distance, point}]; [] where they do not meet.");
    m.def("self_intersections", [](const SmCurve* c, double t0, double t1, double tolerance) {
        return smlibpy::to_python(smlibpy::self_intersections(c, t0, t1, tolerance));
    }, py::arg("curve"), py::arg("t0"), py::arg("t1"), py::arg("tolerance"),
          "Where a curve crosses itself over [t0, t1]: [{t: (ta, tb), end, distance, point}].");
    m.def("intersect_curve_faces", [](const SmCurve* c, double t0, double t1, const std::vector<SmFace*>& faces,
                                      double tolerance) {
        return smlibpy::to_python(smlibpy::intersect_curve_faces(c, t0, t1, faces, tolerance));
    }, py::arg("curve"), py::arg("t0"), py::arg("t1"), py::arg("faces"), py::arg("tolerance"),
          "Where a curve over [t0, t1] meets faces: [{t, face (index into faces), point}]; where it lies on a "
          "face's surface, the points where it starts and stops lying on the face.");
    m.def("extend_curve", &smlibpy::extend_curve, py::arg("curve"), py::arg("distance"), py::arg("at_start"),
          py::arg("continuity") = 1, py::return_value_policy::take_ownership,
          "A standalone B-spline copy of the curve made longer by distance at its start or end "
          "(SmBSplineCurve::CreateExtendedCurve; continuity 1 = G1, along the end tangent; 2 = G2; 0 = the "
          "curve's own polynomial continued).");
}
#endif  // SMLIBPY_PYTHON
