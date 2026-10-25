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
//
// A skin can also leave its first section, or reach its last, tangent to a face that ends there: the
// strip then moves each control point of the section along the direction that continues the face at
// the section (the field fitted by an affine map of the point where it is one, as across a plane, a
// cylinder or a cone about a circle: then exact), checked the same way.
//
// gordon(u_curves, v_curves) is the kernel's Gordon surface (SmBSplineSurface::CreateGordonSurface,
// NLib's N_CreateGordonSrf): the surface through a network of curves, for lofts along rails and
// two-rail sweeps.

#include "kernel.h"
#include "skins.h"

#include <SmApiGeneral.h>
#include <SmApiQueries.h>
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

// The strip of a section moved along `direction` (the cross-boundary derivative across it), or with
// `moves` (one per control point of the section) each control point moved along its own.
SmBSplineSurface* derivative_strip(SmBSplineCurve* section, const std::vector<double>& direction,
                                   const std::vector<SmVector3d>* moves = nullptr)
{
    NL_STACKS stacks;
    NLibStacks guard(&stacks);
    NL_SURFACE strip;
    N_SrfInitArrays(&strip);
    NL_VECTOR v;
    v.x = direction[0], v.y = direction[1], v.z = direction[2];
    if (N_CreateSkinSrfBoundaryDerivs(nlib_curve(section, &stacks), v, NL_BOTTOM, &strip, &stacks) == NL_YES)
        SmPyRaise(SM_ERR, "N_CreateSkinSrfBoundaryDerivs", __FILE__, __LINE__);
    if (moves)
    {
        NL_INDEX nu = 0, nv = 0;
        NL_CPOINT** Pw = nullptr;
        N_SrfGetCPts(&strip, &nu, &nv, &Pw);
        if (static_cast<size_t>(nu + 1) != moves->size() || nv != 1)
            throw std::runtime_error("skin: the derivative strip is not one row of the section's control points");
        for (size_t j = 0; j < moves->size(); ++j)
        {
            const double w = Pw[j][0].w;
            const SmVector3d& m = (*moves)[j];
            Pw[j][1].x = Pw[j][0].x + w * m.x;
            Pw[j][1].y = Pw[j][0].y + w * m.y;
            Pw[j][1].z = Pw[j][0].z + w * m.z;
            Pw[j][1].w = w;
        }
    }
    return new (ctx()) SmBSplineSurface(reinterpret_cast<gw_SURFACE*>(&strip));
}

// The unit direction that continues `face` beyond the curve through `p` with tangent `t` (the face
// ends there): in the face's tangent plane, square to `t`, away from the face. False where the
// face's surface gives no normal there.
bool continuation(const SmFace* face, const SmPoint3d& p, const SmVector3d& t, double size, SmVector3d& out)
{
    const SmSurface* surface = face->GetSurface();
    SmPoint3d q;
    SmTArray<SmPoint2d> uvs;
    double d = 0.0;
    if (SmApiSurfaceClosestPoint(surface, p, q, uvs, d) != SM_SUCCESS || !uvs.GetSize())
        return false;
    SmVector3d n;
    if (surface->EvaluateNormal(uvs[0], TRUE, TRUE, n) != SM_SUCCESS)
        return false;
    SmVector3d c = n * t;  // (cross product)
    if (!(c.Length() > 0.0))
        return false;
    c = c / c.Length();
    // away from the face: a little way along c must not lie on it (the distance to the trimmed face;
    // classifying the surface's closest point failed on a seam, where it lies on the seam edge, and
    // the surface's closest point stops at the end of its domain)
    const double step = 1e-4 * size;
    SmPoint3d on;
    double ahead = 0.0, behind = 0.0;
    SmFace* f = const_cast<SmFace*>(face);
    if (SmApiFaceClosestPoint(f, p + c * step, on, ahead) != SM_SUCCESS ||
        SmApiFaceClosestPoint(f, p - c * step, on, behind) != SM_SUCCESS)
        return false;
    if (ahead < behind)
        c = -c;
    out = c;
    return true;
}

// The point and unit tangent of a curve at t.
void point_tangent(const SmBSplineCurve* c, double t, SmPoint3d& p, SmVector3d& tangent)
{
    SmVector3d pd[2];
    check(c->Evaluate(t, 1, TRUE, pd), "SmCurve::Evaluate");
    p = SmPoint3d(pd[0].x, pd[0].y, pd[0].z);
    tangent = pd[1] / std::max(pd[1].Length(), 1e-300);
}

// Least squares of the 3 x 4 affine map d = A q + b over samples (p, d), q = (p - center) / scale
// (`center` and `scale` set from the samples); false where the samples do not fix it or it misses a
// sample by more than `tol`.
bool affine_fit(const std::vector<SmPoint3d>& ps, const std::vector<SmVector3d>& ds, double tol, double M[3][4],
                SmPoint3d& center, double& scale_out)
{
    SmVector3d sum(0, 0, 0);
    for (const SmPoint3d& p : ps)
        sum = sum + SmVector3d(p.x, p.y, p.z);
    center = SmPoint3d(sum.x / ps.size(), sum.y / ps.size(), sum.z / ps.size());
    double reach = 0.0;
    for (const SmPoint3d& p : ps)
        reach = std::max(reach, (p - center).Length());
    scale_out = std::max(reach, 1e-300);
    auto local = [&](const SmPoint3d& p) { return (p - center) / scale_out; };
    // normal equations of [x y z 1] -> d, regularized for samples in a plane (the section's)
    double G[4][4] = {{0}}, R[4][3] = {{0}};
    for (size_t i = 0; i < ps.size(); ++i)
    {
        const SmVector3d q = local(ps[i]);
        const double r[4] = {q.x, q.y, q.z, 1.0};
        const double v[3] = {ds[i].x, ds[i].y, ds[i].z};
        for (int a = 0; a < 4; ++a)
        {
            for (int b = 0; b < 4; ++b)
                G[a][b] += r[a] * r[b];
            for (int k = 0; k < 3; ++k)
                R[a][k] += r[a] * v[k];
        }
    }
    double scale = 0.0;
    for (int a = 0; a < 4; ++a)
        scale = std::max(scale, G[a][a]);
    for (int a = 0; a < 4; ++a)
        G[a][a] += 1e-12 * scale;
    // Gauss-Jordan with partial pivoting
    double X[4][3];
    for (int a = 0; a < 4; ++a)
        for (int k = 0; k < 3; ++k)
            X[a][k] = R[a][k];
    for (int c = 0; c < 4; ++c)
    {
        int piv = c;
        for (int r = c + 1; r < 4; ++r)
            if (std::abs(G[r][c]) > std::abs(G[piv][c]))
                piv = r;
        if (!(std::abs(G[piv][c]) > 0.0))
            return false;
        for (int b = 0; b < 4; ++b)
            std::swap(G[c][b], G[piv][b]);
        for (int k = 0; k < 3; ++k)
            std::swap(X[c][k], X[piv][k]);
        for (int r = 0; r < 4; ++r)
        {
            if (r == c)
                continue;
            const double f = G[r][c] / G[c][c];
            for (int b = 0; b < 4; ++b)
                G[r][b] -= f * G[c][b];
            for (int k = 0; k < 3; ++k)
                X[r][k] -= f * X[c][k];
        }
    }
    for (int k = 0; k < 3; ++k)
        for (int a = 0; a < 4; ++a)
            M[k][a] = X[a][k] / G[a][a];
    for (size_t i = 0; i < ps.size(); ++i)
    {
        const SmVector3d q = local(ps[i]);
        const double r[4] = {q.x, q.y, q.z, 1.0};
        SmVector3d f(0, 0, 0);
        f.x = M[0][0] * r[0] + M[0][1] * r[1] + M[0][2] * r[2] + M[0][3];
        f.y = M[1][0] * r[0] + M[1][1] * r[1] + M[1][2] * r[2] + M[1][3];
        f.z = M[2][0] * r[0] + M[2][1] * r[1] + M[2][2] * r[2] + M[2][3];
        if ((f - ds[i]).Length() > tol)
            return false;
    }
    return true;
}

// The strip that makes a skin leave (or reach) `section` continuing `face`: each control point moved
// along the face's continuation direction there (see the notes at the top). `size` scales the tests.
SmBSplineSurface* face_strip(SmBSplineCurve* section, const SmFace* face, double size, bool reverse = false)
{
    const ULONG n = section->GetNumberControlPoints();
    SmTArray<double> greville;
    check(section->GetGrevilleAbscissae(greville), "SmBSplineCurve::GetGrevilleAbscissae");
    // the field at many points of the curve, for the affine fit; at the control points' abscissae for
    // the fallback
    const SmExtent1d ivl = section->GetNaturalInterval();
    std::vector<SmPoint3d> ps;
    std::vector<SmVector3d> ds;
    const int samples = std::max<int>(64, 4 * static_cast<int>(n));
    for (int i = 0; i <= samples; ++i)
    {
        SmPoint3d p;
        SmVector3d t, d;
        point_tangent(section, ivl.Evaluate(static_cast<double>(i) / samples), p, t);
        if (!continuation(face, p, t, size, d))
            throw std::invalid_argument("skin: the face has no tangent plane where the section runs along it");
        ps.push_back(p), ds.push_back(d);
    }
    double M[3][4];
    SmPoint3d center;
    double scale = 1.0;
    const bool affine = affine_fit(ps, ds, 1e-9, M, center, scale);
    std::vector<SmVector3d> moves(n);
    for (ULONG j = 0; j < n; ++j)
    {
        if (affine)
        {
            SmPoint3d P;
            double w = 1.0;
            check(section->GetControlPoint(SM_CP_EUCLIDIAN_RATIONAL, j, P, w), "SmBSplineCurve::GetControlPoint");
            const SmVector3d q = (P - center) / scale;
            moves[j] = SmVector3d(M[0][0] * q.x + M[0][1] * q.y + M[0][2] * q.z + M[0][3],
                                  M[1][0] * q.x + M[1][1] * q.y + M[1][2] * q.z + M[1][3],
                                  M[2][0] * q.x + M[2][1] * q.y + M[2][2] * q.z + M[2][3]);
        }
        else
        {
            SmPoint3d p;
            SmVector3d t;
            point_tangent(section, ivl.ClampValue(greville[j]), p, t);
            if (!continuation(face, p, t, size, moves[j]))
                throw std::invalid_argument("skin: the face has no tangent plane where the section runs along it");
        }
    }
    if (reverse)
        for (SmVector3d& m : moves)
            m = -m;
    // the strip of a constant move (its shape and knots), its far row moved as asked
    return derivative_strip(section, {1.0, 0.0, 0.0}, &moves);
}

// The largest angle (radians) between the surface's direction across its u = u_end iso curve and
// what `face` continues in there (see continuation).
double face_error(const SmSurface* surface, bool at_end, const SmFace* face, double size)
{
    const SmExtent2d dom = surface->GetNaturalUVDomain();
    double worst = 0.0;
    for (int j = 0; j <= 16; ++j)
    {
        const SmPoint2d uv(at_end ? dom.GetMax().x : dom.GetMin().x, dom.GetMin().y + (dom.GetMax().y - dom.GetMin().y) * j / 16);
        SmPoint3d p;
        SmVector3d du, dv, want;
        if (surface->Evaluate1stDerivatives(uv, at_end ? FALSE : TRUE, TRUE, p, du, dv) != SM_SUCCESS ||
            !continuation(face, p, dv / std::max(dv.Length(), 1e-300), size, want))
            return SM_PI;
        // (the skin runs away from the first section and towards the last: the face's continuation is
        // its direction at the first, the opposite at the last)
        const SmVector3d d = at_end ? -want : want;
        const double c = du.Dot(d) / std::max(du.Length(), 1e-300);
        worst = std::max(worst, std::acos(std::max(-1.0, std::min(1.0, c))));
    }
    return worst;
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
             bool cap_ends, double deviation[2], const SmFace* start_face, const SmFace* end_face)
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
    if (closed && (!start_tangent.empty() || !end_tangent.empty() || start_face || end_face))
        throw std::invalid_argument("skin: a closed skin has no end tangents");
    if ((start_face && !start_tangent.empty()) || (end_face && !end_tangent.empty()))
        throw std::invalid_argument("skin: an end is tangent to a direction or to a face, not both");
    if (degree < 1 || degree > 3)
        throw std::invalid_argument("skin: the degree is 1, 2 or 3");

    BrepGuard result{new (ctx()) SmBrep()};
    SmBrep* brep = result.brep;
    SmTArray<SmBSplineCurve*> sections;
    SmObjsDelete<SmBSplineCurve*> clean_sections(&sections);
    for (size_t i = 0, from = 0; i < n; from += counts[i], ++i)
        sections.Add(section_curve(curves, from, counts[i], brep->GetTolerance()));
    double size = 0.0;  // (of the sections: what the face tests step by)
    {
        SmExtent3d box;
        for (ULONG i = 0; i < sections.GetSize(); ++i)
        {
            SmExtent3d b;
            sections[i]->CalculateBoundingBox(sections[i]->GetNaturalInterval(), &b);
            box.AddPoint3d(b.GetMin()), box.AddPoint3d(b.GetMax());
        }
        size = std::max(1.0, (box.GetMax() - box.GetMin()).Length());
    }

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
        else if (start_face)
            clean_start.SetObj(strips[0] = face_strip(sections[0], start_face, size));
        if (!end_tangent.empty())
            clean_end.SetObj(strips[1] = derivative_strip(sections[n - 1], end_tangent));
        else if (end_face)
        {
            // (the skin reaches the last section running into the face: the continuation reversed)
            clean_end.SetObj(strips[1] = face_strip(sections[n - 1], end_face, size, true));
        }
        check(SmBSplineSurface::CreateSkinnedSurface(ctx(), sections, FALSE, SM_SP_U, 0.0, nullptr, nullptr, FALSE, nullptr,
                                                     strips, surface, degree),
              "SmBSplineSurface::CreateSkinnedSurface");
    }
    SmObjDelete clean_surface(surface);
    if (!start_tangent.empty())
        deviation[0] = direction_error(surface, false, start_tangent);
    else if (start_face)
        deviation[0] = face_error(surface, false, start_face, size);
    if (!end_tangent.empty())
        deviation[1] = direction_error(surface, true, end_tangent);
    else if (end_face)
        deviation[1] = face_error(surface, true, end_face, size);

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

SmBrep* gordon(const std::vector<SmCurve*>& u_curves, const std::vector<double>& v_params,
               const std::vector<SmCurve*>& v_curves, const std::vector<double>& u_params)
{
    const size_t nu = u_curves.size(), nv = v_curves.size();
    if (nu < 2 || nv < 2)
        throw std::invalid_argument("gordon: give two or more curves each way");
    if (v_params.size() != nu || u_params.size() != nv)
        throw std::invalid_argument("gordon: give a parameter for each curve: where it crosses the others");
    NL_STACKS stacks;
    NLibStacks guard(&stacks);
    std::vector<NL_CURVE*> cu(nu), cv(nv);
    for (size_t i = 0; i < nu + nv; ++i)
    {
        SmBSplineCurve* b = SM_CAST_PTR(SmBSplineCurve, i < nu ? u_curves[i] : v_curves[i - nu]);
        if (!b || b->IsRational())
            throw std::invalid_argument("gordon: the curves must be non-rational B-splines");
        (i < nu ? cu[i] : cv[i - nu]) = nlib_curve(b, &stacks);
    }
    std::vector<NL_PARAMETER> v(v_params.begin(), v_params.end()), u(u_params.begin(), u_params.end());
    // (the degrees across: cubic, or as many curves as there are allow)
    const NL_DEGREE across_u = static_cast<NL_DEGREE>(std::min<size_t>(3, nu - 1));
    const NL_DEGREE across_v = static_cast<NL_DEGREE>(std::min<size_t>(3, nv - 1));
    NL_SURFACE sur;
    N_SrfInitArrays(&sur);
    if (N_CreateGordonSrf(cu.data(), v.data(), static_cast<NL_INDEX>(nu - 1), cv.data(), u.data(),
                          static_cast<NL_INDEX>(nv - 1), across_v, across_u, across_v, across_u, NL_YES, &sur, &stacks,
                          &stacks) == NL_YES)
        SmPyRaise(SM_ERR, "N_CreateGordonSrf", __FILE__, __LINE__);
    SmBSplineSurface* surface = new (ctx()) SmBSplineSurface(reinterpret_cast<gw_SURFACE*>(&sur));
    BrepGuard result{new (ctx()) SmBrep()};
    SmTArray<SmFace*> faces;
    // (CreateFacesFromSurface owns the surface, also where it fails)
    check(result.brep->CreateFacesFromSurface(surface, surface->GetNaturalUVDomain(), SM_CT_G1, faces),
          "SmBrep::CreateFacesFromSurface");
    check(result.brep->StitchAndOrient(), "SmBrep::StitchAndOrient");
    SmBrep* out = result.brep;
    result.brep = nullptr;
    return out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_skins(py::module_ m)
{
    m.def("skin", [](const std::vector<SmCurve*>& curves, const std::vector<unsigned long>& counts, unsigned degree,
                     const std::vector<double>& start_tangent, const std::vector<double>& end_tangent, bool closed,
                     bool cap_ends, const SmFace* start_face, const SmFace* end_face) {
        double deviation[2] = {0.0, 0.0};
        SmBrep* b = smlibpy::skin(curves, counts, degree, start_tangent, end_tangent, closed, cap_ends, deviation,
                                  start_face, end_face);
        return py::make_tuple(py::cast(b, py::return_value_policy::take_ownership), deviation[0], deviation[1]);
    }, py::arg("curves"), py::arg("counts"), py::arg("degree") = 3, py::arg("start_tangent") = std::vector<double>{},
       py::arg("end_tangent") = std::vector<double>{}, py::arg("closed") = false, py::arg("cap_ends") = true,
       py::arg("start_face") = nullptr, py::arg("end_face") = nullptr,
       "A loft through sections (`counts[i]` curves each, joined) with the directions it leaves the first and "
       "reaches the last in (x, y, z or empty), or tangent to a face that ends at the first or last section "
       "(start_face, end_face: it continues the face), or closed (C1 through the first again); capped into a "
       "solid with `cap_ends`. Returns (brep, start deviation, end deviation): the largest angles (radians) "
       "between the skin's direction across its ends and the asked-for ones. Curves are copied, not consumed.");
    m.def("gordon", &smlibpy::gordon, py::arg("u_curves"), py::arg("v_params"), py::arg("v_curves"),
          py::arg("u_params"), py::return_value_policy::take_ownership,
          "The sheet through a network of non-rational curves (NLib's N_CreateGordonSrf): u curve i (all compatible) "
          "crosses v curve j (all compatible) at its parameter u_params[j], which crosses u curve i at its parameter "
          "v_params[i]; the first and last of each set are its borders. Curves are copied, not consumed.");
}
#endif  // SMLIBPY_PYTHON
