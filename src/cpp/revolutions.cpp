// SPDX-License-Identifier: Apache-2.0
//
// Analytic surfaces for revolved faces (`smlibpy._core.ext.analytic_revolutions`).
//
// The kernel revolves a profile through a whole turn by another routine than through part of one
// (SmPrimitiveCreation::CreateRotationalSweep, :2866-2873): it skips the topology sweep, whose
// geometry (SmRotationalSweepGeometry) copies each swept B-spline surface as a plane, cone (also a
// cylinder: a cone of no angle) or sphere where it is one (SmBSplineSurface::CopyAndAddAnalytics), and
// builds every wall that is not a plane as an SmSurfOfRevolution. A revolved tube had no cylinders
// (`faces().cylinders()` empty, `Face.radius` and drafts refused) and went to STEP as rational
// B-splines. Tori come from neither routine: CopyAndAddAnalytics has their test commented out.
// analytic_revolutions recognises the B-spline data of each SmSurfOfRevolution as CopyAndAddAnalytics
// does (cones, also cylinders, and spheres), builds a torus where the generating curve is a circular
// arc beside the axis, and puts the result on the face, its trimming curves made again
// (SmBrep::ReplaceSurface), in a copy of the body.

#include "kernel.h"
#include "revolutions.h"

#include <SmApiGeneral.h>
#include <SmCopyBrepMap.h>

#include <cmath>
#include <utility>
#include <vector>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

// A Brep that ReplaceSurface failed on half way is never freed (its destructor may read what the
// failure left behind; see keep_forever in ext.cpp).
void keep_forever(SmBrep* brep)
{
    static std::vector<SmBrep*> kept;
    kept.push_back(brep);
}

// The angle (degrees) of v from x towards y.
double angle(double y, double x) { return std::atan2(y, x) * 180.0 / SM_PI; }

// `deg` moved by whole turns to within half a turn of `near`.
double unwrap(double deg, double near)
{
    while (deg - near > 180.0)
        deg -= 360.0;
    while (deg - near < -180.0)
        deg += 360.0;
    return deg;
}

// Where a seam goes for angles that run over [lo, hi]: at lo for a whole turn, otherwise halfway
// along the rest of the turn (the face then lies inside the parameter range, not on its end).
double seam(double lo, double hi) { return hi - lo >= 360.0 - 1e-6 ? lo : hi + 0.5 * (360.0 - (hi - lo)) - 360.0; }

// A torus where the surface of revolution is one: its generating curve a circular arc in a plane
// through the axis, beside the axis. Its seams lie where the face does not reach (or on the face's
// seam, for a whole turn), and it faces the way the surface does. (SmTorus::IsNurbSurfaceTorus, the
// test SmBSplineSurface::CopyAndAddAnalytics leaves out, gets the major radius and the angles of
// quarter arcs off a revolved fillet wrong.)
SmSurface* torus_of(const SmSurfOfRevolution* surface)
{
    const SmBSplineCurve* gen = surface->GetGenCurve();
    if (!gen)
        return nullptr;
    const SmAxis2Placement& pos = surface->GetPosition();
    const SmPoint3d origin = pos.GetOriginRef();
    SmVector3d z = pos.GetZAxis();
    z = z / z.Length();
    SmExtent3d box;
    if (gen->CalculateBoundingBox(gen->GetNaturalInterval(), &box) != SM_SUCCESS)
        return nullptr;
    const double tol = 1e-9 * (1.0 + origin.DistanceBetween(box.GetMid()) + box.GetSize().Length());
    SmAxis2Placement arc;
    double minor = 0.0, a0 = 0.0, a1 = 0.0;
    if (!gen->IsArc(9, tol, arc, minor, a0, a1))
        return nullptr;
    const SmPoint3d c = arc.GetOriginRef();
    SmVector3d n = arc.GetZAxis();
    n = n / n.Length();
    if (std::abs(n.Dot(z)) > 1e-9 || std::abs((c - origin).Dot(n)) > tol)
        return nullptr;  // (not in a plane through the axis)
    const SmPoint3d center = origin + z * (c - origin).Dot(z);
    SmVector3d x = c - center;
    const double major = x.Length();
    if (!(major > tol) || !(minor > tol))
        return nullptr;  // (on the axis: a sphere, which the kernel's test finds)
    x = x / major;

    // the angles the face covers: about the axis (u, from x) and about the tube (v, from outwards to z)
    SmSurfParamType rot = SM_SP_U;
    surface->GetRotateParamExtent(&rot);
    const SmExtent2d dom = surface->GetNaturalUVDomain();
    const int k = 16;
    double ulo = 0, uhi = 0, vlo = 0, vhi = 0, v_first = 0;
    for (int i = 0; i <= k; ++i)      // along the generating curve
    {
        double u_prev = 0, v_prev = 0;
        for (int j = 0; j <= k; ++j)  // about the axis
        {
            const double g = static_cast<double>(i) / k, r = static_cast<double>(j) / k;
            SmPoint3d p;
            if (surface->EvaluatePoint(rot == SM_SP_U ? dom.Evaluate(r, g) : dom.Evaluate(g, r), p) != SM_SUCCESS)
                return nullptr;
            const SmVector3d d = p - center;
            const SmVector3d radial = d - z * d.Dot(z);
            const double u0 = angle(radial.Dot(z * x), radial.Dot(x));
            const double v0 = angle(d.Dot(z), radial.Length() - major);
            const double u = j ? unwrap(u0, u_prev) : unwrap(u0, 0.0);
            const double v = j ? unwrap(v0, v_prev) : i ? unwrap(v0, v_first) : v0;
            if (!j)
                v_first = v;
            u_prev = u, v_prev = v;
            if (!i && !j)
                ulo = uhi = u, vlo = vhi = v;
            ulo = std::min(ulo, u), uhi = std::max(uhi, u), vlo = std::min(vlo, v), vhi = std::max(vhi, v);
        }
    }
    if (uhi - ulo > 360.0 + 1e-6 || vhi - vlo > 360.0 + 1e-6)
        return nullptr;
    const double su = seam(ulo, uhi) * SM_PI / 180.0;
    double sv = seam(vlo, vhi);  // (the tube's angles from 0 to 360 and on)
    sv -= 360.0 * std::floor(sv / 360.0);
    if (sv > 360.0 - 1e-9)
        sv = 0.0;
    const SmVector3d xs = x * std::cos(su) + (z * x) * std::sin(su);
    SmAxis2Placement frame;
    if (frame.SetCanonical(center, xs, z * xs) != SM_SUCCESS)
        return nullptr;

    // facing the way the surface does
    SmVector3d normal;
    SmPoint3d mid;
    const SmPoint2d uv = dom.Evaluate(0.5, 0.5);
    if (surface->EvaluatePoint(uv, mid) != SM_SUCCESS || surface->EvaluateNormal(uv, TRUE, TRUE, normal) != SM_SUCCESS)
        return nullptr;
    const SmVector3d d = mid - center;
    SmVector3d tube = d - z * d.Dot(z);
    tube = tube - tube * (major / tube.Length());  // from the tube's center circle out to the point
    const SmBoolean inside_out = tube.Dot(normal) < 0 ? TRUE : FALSE;
    SmTorus* torus = nullptr;
    if (SmTorus::CreateCanonical(ctx(), frame, major, minor, torus, FALSE, inside_out) != SM_SUCCESS || !torus)
        return nullptr;
    const SmExtent2d step = torus->GetSTEPUVDomain();
    if (torus->AdjustSTEPUVDomain(SmExtent2d(step.GetUMin(), sv, step.GetUMax(), sv + 360.0)) != SM_SUCCESS)
    {
        delete torus;
        return nullptr;
    }
    return torus;
}

// The analytic surface the B-spline data of a surface of revolution makes, or null.
SmSurface* analytic(const SmSurfOfRevolution* surface)
{
    // (cones and spheres as the kernel finds them in revolves through part of a turn; the data alone:
    // the copy constructor of the B-spline base)
    const SmBSplineSurface plain(*static_cast<const SmBSplineSurface*>(surface));
    SmCone* cone = nullptr;
    if (SmCone::IsNurbSurfaceCone(ctx(), &plain, cone) && cone)
        return cone;
    SmSphere* sphere = nullptr;
    if (SmSphere::IsNurbSurfaceSphere(ctx(), &plain, sphere) && sphere)
        return sphere;
    return torus_of(surface);
}

// Whether `exact` is where `surface` is, and faces the same way, at points across its domain.
bool same_surface(const SmSurface* surface, const SmSurface* exact, double tolerance)
{
    const SmExtent2d dom = surface->GetNaturalUVDomain();
    for (int i = 0; i <= 4; ++i)
        for (int j = 0; j <= 4; ++j)
        {
            const SmPoint2d uv = dom.Evaluate(0.1 + 0.2 * i, 0.1 + 0.2 * j);
            SmPoint3d p;
            SmVector3d n;
            if (surface->EvaluatePoint(uv, p) != SM_SUCCESS || surface->EvaluateNormal(uv, TRUE, TRUE, n) != SM_SUCCESS)
                return false;
            SmSolutionArray solutions;
            if (exact->GlobalPointSolve(exact->GetNaturalUVDomain(), SM_SO_MINIMIZE, p, SmTol::GetZoneTol3d(&ctx()),
                                        nullptr, SM_SR_SINGLE, solutions) != SM_SUCCESS || solutions.GetSize() < 1)
                return false;
            const SmPoint2d st(solutions[0].m_vStart[0], solutions[0].m_vStart[1]);
            SmPoint3d q;
            SmVector3d m;
            if (exact->EvaluatePoint(st, q) != SM_SUCCESS || exact->EvaluateNormal(st, TRUE, TRUE, m) != SM_SUCCESS)
                return false;
            if (p.DistanceBetween(q) > tolerance || n.Dot(m) < 0.999)
                return false;
        }
    return true;
}

}  // namespace

namespace smlibpy {

SmBrep* analytic_revolutions(const SmBrep* brep)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    std::vector<std::pair<SmFace*, SmSurface*>> found;  // a face of brep, its analytic surface
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        const SmSurface* surface = faces[i]->GetSurface();
        if (!surface || surface->GetType() != SmSurfOfRevolution_TYPE)
            continue;
        SmSurface* exact = analytic(static_cast<const SmSurfOfRevolution*>(surface));
        if (!exact)
            continue;
        // (its B-spline data is made when asked for: the point solver below reads it directly)
        if (!static_cast<SmBSplineSurface*>(exact)->GetOrCreateGwNurbPointer())
        {
            delete exact;
            continue;
        }
        SmExtent3d box;
        faces[i]->CalculateBoundingBox(box);
        if (!same_surface(surface, exact, 1e-9 * (1.0 + box.GetSize().Length())))
        {
            delete exact;
            continue;
        }
        found.emplace_back(faces[i], exact);
    }
    if (found.empty())
        return nullptr;
    SmCopyBrepMap map;  // original -> copy
    SmBrep* copy = new (ctx()) SmBrep(*brep, nullptr, &map, TRUE, FALSE);
    SmStatus st = SM_SUCCESS;
    size_t done = 0;
    for (; done < found.size() && st == SM_SUCCESS; ++done)
    {
        SmFace* face = static_cast<SmFace*>(map.GetAt(found[done].first));
        st = copy->ReplaceSurface(face, found[done].second, FALSE, nullptr, TRUE);
        if (st != SM_SUCCESS && found[done].second->GetOwner() == nullptr)
            delete found[done].second;
    }
    for (; done < found.size(); ++done)
        delete found[done].second;
    if (st != SM_SUCCESS)
    {
        keep_forever(copy);
        SmPyRaise(st, "SmBrep::ReplaceSurface", __FILE__, __LINE__);
    }
    return copy;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "analytic.h"
#include "ext.h"

void bind_revolutions(py::module_ m)
{
    m.def("exact_circles", &smlibpy::exact_circles, py::arg("brep"), py::return_value_policy::take_ownership,
          "A copy of the Brep whose B-spline edges are circles where its two faces meet in one exactly (a plane and "
          "a cylinder, cone or sphere about an axis along its normal, two cylinders or cones about one axis: the "
          "kernel fits the circle where a cone meets a cylinder), or None where it has no such edge.");
    m.def("analytic_revolutions", &smlibpy::analytic_revolutions, py::arg("brep"), py::return_value_policy::take_ownership,
          "A copy of the Brep whose surfaces of revolution are cylinders, cones, spheres and tori wherever they are "
          "one (their faces' trimming curves made again), or None where it has no such face.");
}
#endif  // SMLIBPY_PYTHON
