// SPDX-License-Identifier: Apache-2.0
//
// Curve editing (`smlibpy._core.ext`), shared by the Python extension and the JavaScript module:
//
//   refine_curve(curve, degree, knots)                             the same B-spline with more control points
//   deform_ends(curve, start, end, start_tangent, end_tangent)     the ends moved, the shape kept
//
// Edge.through moves control points of a refined B-spline (smlibpy's own minimum-norm solve, in
// Python and TypeScript). SMLib's point tool, SmBSplineCurve::ForceThroughPoint (N_CrvFitToPt), is
// not used: it missed its point by 1.9e-4 and moved the clamped start of the curve by 2e-4.
// Edge.match uses SmCurve::DeformToEndPointTargets, which SMLib itself uses to close gaps (exact at the
// ends; the curve raised to degree 3 at least).

#include "kernel.h"
#include "curve_edit.h"

#include <SmApiGeneral.h>

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

std::unique_ptr<SmBSplineCurve> plain_copy(const SmCurve* curve, const char* what)
{
    if (!curve)
        throw std::invalid_argument(std::string(what) + ": curve is None");
    if (curve->GetType() != SmBSplineCurve_TYPE)
        throw std::invalid_argument(std::string(what) + ": the curve must be a B-spline (not a line, circle or "
                                    "other curve of its own type)");
    SmCurve* copy = nullptr;
    check(curve->Copy(ctx(), copy), "SmCurve::Copy");
    return std::unique_ptr<SmBSplineCurve>(static_cast<SmBSplineCurve*>(copy));
}

bool vector3(const std::vector<double>& v, const char* what, SmVector3d& out)
{
    if (v.empty())
        return false;
    if (v.size() != 3 || !std::isfinite(v[0]) || !std::isfinite(v[1]) || !std::isfinite(v[2]))
        throw std::invalid_argument(std::string(what) + ": expected three finite numbers");
    out = SmVector3d(v[0], v[1], v[2]);
    return true;
}

SmVector3d unit(const SmVector3d& v)
{
    const double n = v.Length();
    return n > 0.0 ? v * (1.0 / n) : v;
}

}  // namespace

namespace smlibpy {

SmBSplineCurve* refine_curve(const SmCurve* curve, int degree, const std::vector<double>& knots)
{
    std::unique_ptr<SmBSplineCurve> c = plain_copy(curve, "refine_curve");
    if (degree > 32)
        throw std::invalid_argument("refine_curve: the degree is at most 32");
    if (degree > static_cast<int>(c->GetDegree()))
        check(c->DegreeElevate(static_cast<ULONG>(degree)), "SmBSplineCurve::DegreeElevate");
    if (!knots.empty())
    {
        const SmExtent1d ivl = c->GetNaturalInterval();
        std::vector<double> sorted(knots);
        std::sort(sorted.begin(), sorted.end());
        SmTArray<double> add;
        for (double k : sorted)
        {
            if (!std::isfinite(k) || !(k > ivl.GetMin() && k < ivl.GetMax()))
                throw std::invalid_argument("refine_curve: the knots must lie inside the curve's parameter range");
            add.Add(k);
        }
        check(c->InsertKnots(add), "SmBSplineCurve::InsertKnots");
    }
    return c.release();
}

EditedCurve deform_ends(const SmCurve* curve, const std::vector<double>& start, const std::vector<double>& end,
                        const std::vector<double>& start_tangent, const std::vector<double>& end_tangent)
{
    std::unique_ptr<SmBSplineCurve> c = plain_copy(curve, "deform_ends");
    SmVector3d p0, p1, t0, t1;
    const bool has_p0 = vector3(start, "deform_ends: start", p0);
    const bool has_p1 = vector3(end, "deform_ends: end", p1);
    const bool has_t0 = vector3(start_tangent, "deform_ends: start_tangent", t0);
    const bool has_t1 = vector3(end_tangent, "deform_ends: end_tangent", t1);
    if ((has_t0 && !(t0.Length() > 0.0)) || (has_t1 && !(t1.Length() > 0.0)))
        throw std::invalid_argument("deform_ends: a tangent has no direction");
    SmPoint3d q0(p0.x, p0.y, p0.z), q1(p1.x, p1.y, p1.z);
    SmCurve* replaced = nullptr;
    check(c->DeformToEndPointTargets(has_p0 ? &q0 : nullptr, has_p1 ? &q1 : nullptr, &replaced, has_t0 ? &t0 : nullptr,
                                     has_t0 ? SM_IV_SPECIFIED : SM_IV_SAME, has_t1 ? &t1 : nullptr,
                                     has_t1 ? SM_IV_SPECIFIED : SM_IV_SAME),
          "SmCurve::DeformToEndPointTargets");
    if (replaced)  // (a plain B-spline is edited in place; never expected)
    {
        delete replaced;
        throw std::runtime_error("deform_ends: the kernel replaced the curve");
    }
    EditedCurve out;
    const SmExtent1d ivl = c->GetNaturalInterval();
    SmVector3d d[2];
    check(c->Evaluate(ivl.GetMin(), 1, TRUE, d), "SmCurve::Evaluate");
    if (has_p0)
        out.deviation = std::max(out.deviation, (d[0] - p0).Length());
    if (has_t0)
        out.deviation = std::max(out.deviation, (unit(d[1]) - unit(t0)).Length());
    check(c->Evaluate(ivl.GetMax(), 1, FALSE, d), "SmCurve::Evaluate");
    if (has_p1)
        out.deviation = std::max(out.deviation, (d[0] - p1).Length());
    if (has_t1)
        out.deviation = std::max(out.deviation, (unit(d[1]) - unit(t1)).Length());
    out.curve = c.release();
    return out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_curve_edit(py::module_ m)
{
    m.def("refine_curve", [](const SmCurve* curve, int degree, const std::vector<double>& knots) {
        return smlibpy::refine_curve(curve, degree, knots);
    }, py::arg("curve"), py::arg("degree"), py::arg("knots") = std::vector<double>(), py::return_value_policy::reference,
          "A copy of the B-spline curve of at least degree with the knots inserted (exact: the same curve with more "
          "control points). The curve is the caller's (ext.delete_curve).");
    m.def("deform_ends", [](const SmCurve* curve, const std::vector<double>& start, const std::vector<double>& end,
                            const std::vector<double>& start_tangent, const std::vector<double>& end_tangent) {
        smlibpy::EditedCurve r = smlibpy::deform_ends(curve, start, end, start_tangent, end_tangent);
        return py::make_tuple(py::cast(r.curve, py::return_value_policy::reference), r.deviation);
    }, py::arg("curve"), py::arg("start") = std::vector<double>(), py::arg("end") = std::vector<double>(),
          py::arg("start_tangent") = std::vector<double>(), py::arg("end_tangent") = std::vector<double>(),
          "A copy of the B-spline curve with its ends moved to start / end and its directions there set to the "
          "tangents given (empty: kept), bent smoothly in between (SmCurve::DeformToEndPointTargets): (curve, "
          "deviation). The curve is the caller's.");
}
#endif  // SMLIBPY_PYTHON
