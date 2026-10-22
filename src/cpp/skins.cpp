// SPDX-License-Identifier: Apache-2.0
//
// Lofts with end tangents and closed lofts (`smlibpy._core.ext.skin`).
//
// The kernel's loft (SmApiCreateSkinPrimitive -> SmPrimitiveCreation::CreateSkinFromFaces) joins each
// section into one curve and skins them with SmBSplineSurface::CreateSkinnedSurface, but passes it no
// cross-boundary derivatives (so the loft leaves its first section and reaches its last in whatever
// direction the interpolation gives), and nothing it calls makes a closed skin (NLib's N_CreateSkinSrf
// has a flag for a C1 closed one; every caller passes NL_NO). skin makes the same skin with the
// derivatives: strips that move the first and last section along the asked-for direction (NLib's
// N_CreateSkinSrfBoundaryDerivs), or closed through N_CreateSkinSrf directly; the side faces from the
// surface split where it turns (as the kernel's loft), the ends capped with planar faces made from the
// surface's end curves (as its sweeps cap theirs), stitched.
//
// CreateSkinnedSurface silently skins again without the derivatives where NLib cannot meet them, so the
// directions across the ends are measured afterwards and handed back (`deviation`).

#include "kernel.h"
#include "skins.h"

#include <SmApiGeneral.h>
#include <SmCompositeCurve.h>
#include <nurbs.h>
#include <NL_SrfAdv.h>

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

void check(SmStatus st, const char* what)
{
    if (st != SM_SUCCESS)
        SmPyRaise(st, what, __FILE__, __LINE__);
}

// N_InitNurbs and N_EndNurbs around NLib's work (as the kernel's SmNLibStackHandler)
class NLibStacks
{
public:
    explicit NLibStacks(NL_STACKS* stacks) : stacks_(stacks) { N_InitNurbs(stacks_); }
    ~NLibStacks() { N_EndNurbs(stacks_); }
    NLibStacks(const NLibStacks&) = delete;
    NLibStacks& operator=(const NLibStacks&) = delete;

private:
    NL_STACKS* stacks_;
};

// Deletes a Brep that is not handed out.
struct BrepGuard
{
    SmBrep* brep;
    ~BrepGuard() { delete brep; }
};

// One B-spline curve through the curves of a section (B-spline copies joined end to end in their
// order and direction, as the kernel's loft joins them: SmCompositeCurve::MakeCompositeNurb).
SmBSplineCurve* section_curve(const std::vector<SmCurve*>& curves, size_t from, size_t count, double tolerance)
{
    SmTArray<SmBSplineCurve*> nurbs;
    SmObjsDelete<SmBSplineCurve*> clean_nurbs(&nurbs);
    for (size_t i = from; i < from + count; ++i)
    {
        SmBSplineCurve* b = SM_CAST_PTR(SmBSplineCurve, curves[i]);
        if (!b)
            throw std::invalid_argument("skin: a section curve is not a B-spline curve");
        nurbs.Add(new (ctx()) SmBSplineCurve(*b));
    }
    if (nurbs.GetSize() == 1)
    {
        SmBSplineCurve* only = nurbs[0];
        nurbs.SetAt(0, nullptr);
        return only;
    }
    SmTArray<SmCompositeCurve*> composites;
    SmObjsDelete<SmCompositeCurve*> clean_composites(&composites);
    check(SmCompositeCurve::BuildCompositesFromCurves(ctx(), nurbs, TRUE, 0.0, tolerance, 0.0, 0.0, 0.0, 0.0, composites),
          "SmCompositeCurve::BuildCompositesFromCurves");
    // (the composites own the curves they took; the guard deletes only the ones they left out)
    for (ULONG i = 0; i < composites.GetSize(); ++i)
    {
        ULONG dimension = 0;
        SmBoolean closed = FALSE;
        SmTArray<SmCurve*> taken;
        if (composites[i]->GetCanonical(dimension, taken, closed) != SM_SUCCESS)
        {
            clean_nurbs.Clear();  // (a leak rather than a curve deleted by two owners)
            throw std::runtime_error("skin: SmCompositeCurve::GetCanonical failed");
        }
        for (ULONG j = 0; j < taken.GetSize(); ++j)
            for (ULONG k = 0; k < nurbs.GetSize(); ++k)
                if (nurbs[k] == taken[j])
                {
                    nurbs.SetAt(k, nullptr);
                    break;
                }
    }
    if (composites.GetSize() != 1)
        throw std::invalid_argument("skin: the curves of a section do not join into one chain");
    SmBSplineCurve* joined = nullptr;
    check(composites[0]->MakeCompositeNurb(ctx(), joined), "SmCompositeCurve::MakeCompositeNurb");
    return joined;
}

// An NLib copy of a curve on `stacks` (as the kernel's sm_CreateNlibCurve).
NL_CURVE* nlib_curve(SmBSplineCurve* curve, NL_STACKS* stacks)
{
    NL_CURVE* out = N_AllocCrvAndArrays(static_cast<NL_INDEX>(curve->GetNumberControlPoints()),
                                        static_cast<NL_DEGREE>(curve->GetDegree()),
                                        static_cast<NL_INDEX>(curve->GetNumberNaturalKnots()), stacks);
    if (!out || N_CrvCopy(curve->GetOrCreateGwNurbPointer(), out, stacks) == NL_YES)
        throw std::runtime_error("skin: N_CrvCopy failed");
    return out;
}

// The strip of a section moved along `direction` (the cross-boundary derivative across it).
SmBSplineSurface* derivative_strip(SmBSplineCurve* section, const std::vector<double>& direction)
{
    NL_STACKS stacks;
    NLibStacks guard(&stacks);
    NL_SURFACE strip;
    N_SrfInitArrays(&strip);
    NL_VECTOR v;
    v.x = direction[0], v.y = direction[1], v.z = direction[2];
    if (N_CreateSkinSrfBoundaryDerivs(nlib_curve(section, &stacks), v, NL_BOTTOM, &strip, &stacks) == NL_YES)
        SmPyRaise(SM_ERR, "N_CreateSkinSrfBoundaryDerivs", __FILE__, __LINE__);
    return new (ctx()) SmBSplineSurface(reinterpret_cast<gw_SURFACE*>(&strip));
}

// The largest angle (radians) between the surface's direction across its u = u_end iso curve and
// `direction` (where the derivative points away from it, the angle exceeds 90 degrees).
double direction_error(const SmSurface* surface, bool at_end, const std::vector<double>& direction)
{
    const SmVector3d d(direction[0], direction[1], direction[2]);
    const SmExtent2d dom = surface->GetNaturalUVDomain();
    double worst = 0.0;
    for (int j = 0; j <= 8; ++j)
    {
        const SmPoint2d uv(at_end ? dom.GetMax().x : dom.GetMin().x, dom.GetMin().y + (dom.GetMax().y - dom.GetMin().y) * j / 8);
        SmPoint3d p;
        SmVector3d du, dv;
        if (surface->Evaluate1stDerivatives(uv, at_end ? FALSE : TRUE, TRUE, p, du, dv) != SM_SUCCESS)
            return SM_PI;
        const double c = du.Dot(d) / std::max(du.Length() * d.Length(), 1e-300);
        worst = std::max(worst, std::acos(std::max(-1.0, std::min(1.0, c))));
    }
    return worst;
}

}  // namespace

namespace smlibpy {

SmBrep* skin(const std::vector<SmCurve*>& curves, const std::vector<unsigned long>& counts, unsigned degree,
             const std::vector<double>& start_tangent, const std::vector<double>& end_tangent, bool closed,
             bool cap_ends, double deviation[2])
{
    deviation[0] = deviation[1] = 0.0;
    const size_t n = counts.size();
    if (n < 2)
        throw std::invalid_argument("skin: give two or more sections");
    size_t total = 0;
    for (unsigned long c : counts)
    {
        if (c == 0)
            throw std::invalid_argument("skin: a section has no curves");
        total += c;
    }
    if (total != curves.size())
        throw std::invalid_argument("skin: the counts do not add up to the number of curves");
    if (!start_tangent.empty() && start_tangent.size() != 3)
        throw std::invalid_argument("skin: start_tangent has three components or none");
    if (!end_tangent.empty() && end_tangent.size() != 3)
        throw std::invalid_argument("skin: end_tangent has three components or none");
    if (closed && (!start_tangent.empty() || !end_tangent.empty()))
        throw std::invalid_argument("skin: a closed skin has no end tangents");
    if (degree < 1 || degree > 3)
        throw std::invalid_argument("skin: the degree is 1, 2 or 3");

    BrepGuard result{new (ctx()) SmBrep()};
    SmBrep* brep = result.brep;
    SmTArray<SmBSplineCurve*> sections;
    SmObjsDelete<SmBSplineCurve*> clean_sections(&sections);
    for (size_t i = 0, from = 0; i < n; from += counts[i], ++i)
        sections.Add(section_curve(curves, from, counts[i], brep->GetTolerance()));

    SmBSplineSurface* surface = nullptr;
    if (closed)
    {
        // NLib's skin through the sections and the first again, C1 where it closes (degree 1: just
        // closed)
        NL_STACKS stacks;
        NLibStacks guard(&stacks);
        std::vector<NL_CURVE*> nl(n + 1);
        for (size_t i = 0; i < n; ++i)
            nl[i] = nlib_curve(sections[i], &stacks);
        nl[n] = nlib_curve(sections[0], &stacks);
        NL_SURFACE skinned;
        N_SrfInitArrays(&skinned);
        if (N_CreateSkinSrf(nl.data(), static_cast<NL_INDEX>(n), NL_YES, degree > 1 ? NL_YES : NL_NO,
                            static_cast<NL_DEGREE>(degree), NL_UDIR, 0.0, &skinned, &stacks, &stacks) == NL_YES)
            SmPyRaise(SM_ERR, "N_CreateSkinSrf", __FILE__, __LINE__);
        surface = new (ctx()) SmBSplineSurface(reinterpret_cast<gw_SURFACE*>(&skinned));
    }
    else
    {
        SmBSplineSurface* strips[2] = {nullptr, nullptr};
        SmObjDelete clean_start, clean_end;
        if (!start_tangent.empty())
            clean_start.SetObj(strips[0] = derivative_strip(sections[0], start_tangent));
        if (!end_tangent.empty())
            clean_end.SetObj(strips[1] = derivative_strip(sections[n - 1], end_tangent));
        check(SmBSplineSurface::CreateSkinnedSurface(ctx(), sections, FALSE, SM_SP_U, 0.0, nullptr, nullptr, FALSE, nullptr,
                                                     strips, surface, degree),
              "SmBSplineSurface::CreateSkinnedSurface");
    }
    SmObjDelete clean_surface(surface);
    if (!start_tangent.empty())
        deviation[0] = direction_error(surface, false, start_tangent);
    if (!end_tangent.empty())
        deviation[1] = direction_error(surface, true, end_tangent);

    // (CreateFacesFromSurface owns the surface: it gives it to the face, or splits it where it turns
    // and deletes it; where it fails half way the surface may be gone too, so it is never read again)
    SmTArray<SmFace*> sides;
    clean_surface.Clear();
    check(brep->CreateFacesFromSurface(surface, surface->GetNaturalUVDomain(), SM_CT_G1, sides),
          "SmBrep::CreateFacesFromSurface");

    if (cap_ends && !closed)
    {
        // the end caps from the side faces' end curves: the curves at u = min and max of each one's
        // surface that lie on the first or last section (a skin with a kink at a section in between,
        // a ruled one, comes in faces split there)
        SmTArray<SmCurve*> starts, ends;
        SmObjsDelete<SmCurve*> clean_starts(&starts), clean_ends(&ends);
        const double tol = 10.0 * SM_ZONE_TOL_3D;
        auto on = [&](const SmBSplineCurve* c, const SmBSplineCurve* section) {
            const SmExtent1d iv = c->GetNaturalInterval();
            for (int k = 0; k <= 4; ++k)
            {
                SmPoint3d p;
                SmBoolean found = FALSE;
                double t = 0.0, dist = SM_BIG_DOUBLE;
                if (c->EvaluatePoint(iv.Evaluate(k / 4.0), p) != SM_SUCCESS ||
                    section->DropPoint(section->GetNaturalInterval(), p, nullptr, tol, nullptr, found, t, dist) != SM_SUCCESS ||
                    !found || dist > tol)
                    return false;
            }
            return true;
        };
        for (ULONG i = 0; i < sides.GetSize(); ++i)
        {
            SmSurface* side = sides[i]->GetSurface();
            const SmExtent2d domain = side->GetNaturalUVDomain();
            for (double u : {domain.GetMin().x, domain.GetMax().x})
            {
                SmBSplineCurve* c = nullptr;
                check(side->CreateIsoParametricCurve(ctx(), SM_SP_U, u, SM_ZONE_TOL_3D / 10.0, c),
                      "SmSurface::CreateIsoParametricCurve");
                if (u == domain.GetMin().x && on(c, sections[0]))
                    starts.Add(c);
                else if (u == domain.GetMax().x && on(c, sections[n - 1]))
                    ends.Add(c);
                else
                    delete c;
            }
        }
        SmTArray<SmFace*> cap;
        SmStatus st = brep->CreatePlanarFacesWith3DCurves(brep->GetInfiniteRegion(), starts, SM_ZONE_TOL_3D, cap);
        for (ULONG i = 0; i < starts.GetSize(); ++i)  // (a failed cap may own some of them already)
            if (starts[i]->GetOwner() != nullptr)
                starts[i] = nullptr;
        check(st, "SmBrep::CreatePlanarFacesWith3DCurves");
        clean_starts.Clear();
        cap.ReSet();
        st = brep->CreatePlanarFacesWith3DCurves(brep->GetInfiniteRegion(), ends, SM_ZONE_TOL_3D, cap);
        for (ULONG i = 0; i < ends.GetSize(); ++i)
            if (ends[i]->GetOwner() != nullptr)
                ends[i] = nullptr;
        check(st, "SmBrep::CreatePlanarFacesWith3DCurves");
        clean_ends.Clear();
    }
    check(brep->StitchAndOrient(), "SmBrep::StitchAndOrient");
    result.brep = nullptr;
    return brep;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_skins(py::module_ m)
{
    m.def("skin", [](const std::vector<SmCurve*>& curves, const std::vector<unsigned long>& counts, unsigned degree,
                     const std::vector<double>& start_tangent, const std::vector<double>& end_tangent, bool closed,
                     bool cap_ends) {
        double deviation[2] = {0.0, 0.0};
        SmBrep* b = smlibpy::skin(curves, counts, degree, start_tangent, end_tangent, closed, cap_ends, deviation);
        return py::make_tuple(py::cast(b, py::return_value_policy::take_ownership), deviation[0], deviation[1]);
    }, py::arg("curves"), py::arg("counts"), py::arg("degree") = 3, py::arg("start_tangent") = std::vector<double>{},
       py::arg("end_tangent") = std::vector<double>{}, py::arg("closed") = false, py::arg("cap_ends") = true,
       "A loft through sections (`counts[i]` curves each, joined) with the directions it leaves the first and "
       "reaches the last in (x, y, z or empty), or closed (C1 through the first again); capped into a solid "
       "with `cap_ends`. Returns (brep, start deviation, end deviation): the largest angles (radians) between the "
       "skin's direction across its ends and the asked-for ones. Curves are copied, not consumed.");
}
#endif  // SMLIBPY_PYTHON
