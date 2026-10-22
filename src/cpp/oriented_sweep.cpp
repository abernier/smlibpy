// SPDX-License-Identifier: Apache-2.0
//
// Sweeps with the profile's attitude given along the path (`smlibpy._core.ext.oriented_sweep`), and
// the axis of a helical path (`ext.helix_axis`).
//
// The kernel's curve sweep (SmPrimitiveCreation::CreateCurveSweep -> SmBSplineSurface::
// CreateSweepSurface -> NLib's N_CreateSweepScale) frames the profile along the path by carrying the
// frame's Z vector from one sample to the next, projected onto each new normal plane
// (N_CreateBVectors): along a helix the profile turns about the path by some 30 degrees a turn
// (ai/todo/features.md, 10). N_CreateSweepScale also takes `curZ`, a curve that gives the frame's Z
// vector at every parameter of the path, but its only caller passes NULL. oriented_sweep makes the
// same sweep (the same steps as CreateCurveSweep: profile curves split at tangent breaks and joined
// into composites, one surface each, the ends capped with planar faces from the surfaces' end
// curves, stitched) with curZ: the profile's x axis, which the caller gives at parameters of the path
// (operations.sweep: `up=`, `twist=` and the default along helices).
//
// NLib places the section curve C at the path point T(v) by the frame XL = the unit tangent, ZL =
// curZ(v) normalised, YL = ZL x XL (not made perpendicular again: the vectors must be perpendicular
// to the tangent), as T(v) + C.x XL + C.y YL + C.z ZL. A profile drawn in the XY plane, its x axis
// to go along curZ and its z axis along the tangent, is that section mapped (x, y, z) -> (z, -y, x).

#include "kernel.h"
#include "oriented_sweep.h"

#include <SmApiGeneral.h>
#include <SmCompositeCurve.h>
#include <nurbs.h>
#include <NL_SrfAdv.h>

#include <algorithm>
#include <utility>
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

// The x axes as a cubic curve over the path's parameters through them: in pieces between the path's
// parameters where it turns on with a jump in its curvature (knots where it is C1 or less, such as
// where the lines and arcs of a fillet polyline joined into one curve meet: the x axis turns on with a
// kink there too, which one cubic through all of them rounds off, so that it no longer stands across
// the path near it), joined where they meet.
SmBSplineCurve* axis_curve(const SmBSplineCurve* path, const SmTArray<SmPoint3d>& points, const SmTArray<double>& params)
{
    const ULONG n = points.GetSize();
    SmTArray<double> knots;
    SmTArray<ULONG> mults;
    std::vector<double> breaks;
    if (path->GetKnots(knots, &mults) == SM_SUCCESS)
        for (ULONG k = 1; k + 1 < knots.GetSize(); ++k)
            if (mults[k] + 1 >= path->GetDegree())
                breaks.push_back(knots[k]);
    // the samples from break to break (the samples include the knots)
    std::vector<std::pair<ULONG, ULONG>> pieces;
    ULONG from = 0;
    for (ULONG i = 1; i + 1 < n; ++i)
        for (double b : breaks)
            if (std::abs(params[i] - b) <= 1e-12 * (1.0 + std::abs(b)) && i - from >= 3 && n - 1 - i >= 3)
            {
                pieces.emplace_back(from, i);
                from = i;
                break;
            }
    pieces.emplace_back(from, n - 1);
    std::vector<double> poles, all_knots;
    for (size_t p = 0; p < pieces.size(); ++p)
    {
        SmTArray<SmPoint3d> pts;
        SmTArray<double> ts;
        for (ULONG i = pieces[p].first; i <= pieces[p].second; ++i)
            pts.Add(points[i]), ts.Add(params[i]);
        SmBSplineCurve* c = nullptr;
        const SmStatus st = SmBSplineCurve::InterpolatePoints(ctx(), pts, &ts, std::min<ULONG>(3, pts.GetSize() - 1),
                                                              nullptr, nullptr, FALSE, SM_IT_CHORDLENGTH, c);
        SmObjDelete clean(c);
        check(st, "SmBSplineCurve::InterpolatePoints");
        if (pieces.size() == 1)
        {
            clean.Clear();
            return c;
        }
        if (c->GetDegree() != 3)
            throw std::runtime_error("oriented_sweep: too few samples between the path's breaks");
        SmTArray<double> kv;
        check(c->GetKnotsAll(kv), "SmBSplineCurve::GetKnotsAll");
        const ULONG m = c->GetNumberControlPoints();
        std::vector<double> xyz(3 * m);
        check(c->GetControlPointsExpert(SM_CP_NON_RATIONAL, 0, m - 1, 3, xyz.data()), "SmBSplineCurve::GetControlPointsExpert");
        // (joined where the pieces meet: the shared pole once, that knot three times)
        poles.insert(poles.end(), xyz.begin() + (p ? 3 : 0), xyz.end());
        for (ULONG k = p ? 4 : 0; k + (p + 1 < pieces.size() ? 1 : 0) < kv.GetSize(); ++k)
            all_knots.push_back(kv[k]);
    }
    SmTArray<SmPoint3d> cps;
    for (size_t i = 0; i + 2 < poles.size(); i += 3)
        cps.Add(SmPoint3d(poles[i], poles[i + 1], poles[i + 2]));
    SmTArray<double> unique;
    SmTArray<ULONG> mult;
    for (double k : all_knots)
    {
        if (unique.GetSize() && std::abs(k - unique[unique.GetSize() - 1]) <= 1e-14 * (1.0 + std::abs(k)))
            ++mult[mult.GetSize() - 1];
        else
            unique.Add(k), mult.Add(1);
    }
    SmBSplineCurve* out = nullptr;
    check(SmBSplineCurve::CreateCanonical(ctx(), 3, 3, cps, SM_CF_UNSPECIFIED, mult, unique, SM_KT_UNSPECIFIED, nullptr,
                                          nullptr, out),
          "SmBSplineCurve::CreateCanonical");
    return out;
}

// Deletes a Brep that is not handed out.
struct BrepGuard
{
    SmBrep* brep;
    ~BrepGuard() { delete brep; }
};

}  // namespace

namespace smlibpy {

SmBrep* oriented_sweep(const std::vector<SmCurve*>& profile, const SmBSplineCurve* path,
                       const std::vector<double>& params, const std::vector<double>& x_axes, bool cap_ends,
                       const std::vector<double>& scales)
{
    if (!path)
        throw std::invalid_argument("oriented_sweep: path is None");
    if (profile.empty())
        throw std::invalid_argument("oriented_sweep: no profile curves");
    const size_t n = params.size();
    if (n < 2 || x_axes.size() != 3 * n)
        throw std::invalid_argument("oriented_sweep: give two or more parameters and an x axis (3 numbers) for each");
    const SmExtent1d range = path->GetNaturalInterval();
    const double span = range.GetLength();
    if (std::abs(params.front() - range.GetMin()) > 1e-9 * (1.0 + span) ||
        std::abs(params.back() - range.GetMax()) > 1e-9 * (1.0 + span))
        throw std::invalid_argument("oriented_sweep: the parameters must run from the start of the path to its end");
    for (size_t i = 1; i < n; ++i)
        if (!(params[i] > params[i - 1]))
            throw std::invalid_argument("oriented_sweep: the parameters must increase");
    if (!scales.empty() && scales.size() != n)
        throw std::invalid_argument("oriented_sweep: give a scale for each parameter, or none");
    for (double v : scales)
        if (!(v > 0.0) || !std::isfinite(v))
            throw std::invalid_argument("oriented_sweep: the scales must be positive");

    // the x axis along the path: a curve of vectors over the path's parameters
    SmTArray<SmPoint3d> axis_points;
    SmTArray<double> axis_params;
    for (size_t i = 0; i < n; ++i)
    {
        SmVector3d x(x_axes[3 * i], x_axes[3 * i + 1], x_axes[3 * i + 2]);
        if (!(x.Length() > 1e-12))
            throw std::invalid_argument("oriented_sweep: an x axis has no length");
        axis_points.Add(x / x.Length());
        axis_params.Add(params[i]);
    }
    axis_params[0] = range.GetMin();
    axis_params[n - 1] = range.GetMax();
    SmBSplineCurve* axes = axis_curve(path, axis_points, axis_params);
    SmObjDelete clean_axes(axes);
    check(axes->EditParameterization(range), "SmBSplineCurve::EditParameterization");

    SmBSplineCurve* trajectory = new (ctx()) SmBSplineCurve(*path);
    SmObjDelete clean_trajectory(trajectory);

    // How many sections NLib places at least. It places them where a polyline follows the path to
    // within half the tolerance (at most 1000 a piece of the path, the tolerance raised tenfold till
    // then), which says nothing of how the x axis turns: a twist along a straight path got 2 sections
    // (a ruled surface through the path) and 60 turns of a helix 7 a turn. It places as many as a
    // scale curve has control points, though: one of (1, 1, 1) throughout, with a control point for
    // every 1/64 of a turn of the x axis (16 at least), makes it place more.
    // (NLib spreads them evenly over the stretches of its polyline, which are long where the path is
    // nearly straight; there the x axis may turn fastest, as 'frenet' does where the curvature nearly
    // vanishes: as many as the fastest turn takes over the whole path)
    double turned = 0.0, fastest = 0.0, length = 0.0;
    for (size_t i = 0; i + 1 < n; ++i)
    {
        const SmVector3d a = axis_points[i], b = axis_points[i + 1];
        const double angle = std::atan2((a * b).Length(), a.Dot(b));
        SmPoint3d p, q;
        check(path->EvaluatePoint(params[i], p), "SmCurve::EvaluatePoint");
        check(path->EvaluatePoint(params[i + 1], q), "SmCurve::EvaluatePoint");
        const double step = p.DistanceBetween(q);
        turned += angle;
        length += step;
        if (step > 0)
            fastest = std::max(fastest, angle / step);
    }
    const double need = std::max(turned, fastest * length) / (SM_PI / 32.0);
    const ULONG sections = static_cast<ULONG>(std::min(20000.0, std::max(16.0, std::ceil(need) + 1.0)));
    SmBSplineCurve* scale = nullptr;
    SmObjDelete clean_scale;
    if (scales.empty())
    {
        SmTArray<SmPoint3d> ones;
        SmTArray<double> knots;
        SmTArray<ULONG> mults;
        for (ULONG i = 0; i < sections; ++i)
            ones.Add(SmPoint3d(1.0, 1.0, 1.0));
        for (ULONG i = 0; i < sections; ++i)
        {
            knots.Add(range.Evaluate(static_cast<double>(i) / (sections - 1)));
            mults.Add(i == 0 || i + 1 == sections ? 2 : 1);
        }
        const SmStatus made = SmBSplineCurve::CreateCanonical(ctx(), 3, 1, ones, SM_CF_UNSPECIFIED, mults, knots,
                                                              SM_KT_UNSPECIFIED, nullptr, nullptr, scale);
        clean_scale.SetObj(scale);
        check(made, "SmBSplineCurve::CreateCanonical");
    }
    else
    {
        // A scale law (the profile's scale at the parameters; the profile is drawn at the scale of the
        // start): (s, s, s) interpolated cubically over the path's parameters, as the kernel's sweep
        // interpolates the law it takes from a scale curve. NLib places a section for each of its control
        // points, and in the first and last span between sections a changing scale leaves the surface
        // off by about 0.017 / (sections - 1) of the change (a circle of radius 2 scaled to 4 along 50:
        // 5.6e-4 with 31, 3.4e-5 with 500): where it has fewer control points than the x axis needs or
        // 512, it is sampled evenly and interpolated again with that many (the kernel's own scale law
        // has 10 a knot of the path and its curve, 650 for the 65 points operations.sweep gives it).
        SmTArray<SmPoint3d> points;
        for (size_t i = 0; i < n; ++i)
            points.Add(SmPoint3d(scales[i], scales[i], scales[i]));
        const SmStatus made = SmBSplineCurve::InterpolatePoints(ctx(), points, &axis_params, std::min<ULONG>(3, n - 1),
                                                                nullptr, nullptr, FALSE, SM_IT_CHORDLENGTH, scale);
        clean_scale.SetObj(scale);
        check(made, "SmBSplineCurve::InterpolatePoints");
        const ULONG wanted = std::max<ULONG>(sections, 512);
        if (scale->GetNumberControlPoints() < wanted)
        {
            SmTArray<SmPoint3d> even;
            SmTArray<double> at;
            for (ULONG i = 0; i < wanted; ++i)
            {
                const double t = range.Evaluate(static_cast<double>(i) / (wanted - 1));
                SmPoint3d p;
                check(scale->EvaluatePoint(t, p), "SmCurve::EvaluatePoint");
                even.Add(p);
                at.Add(t);
            }
            SmBSplineCurve* denser = nullptr;
            const SmStatus again = SmBSplineCurve::InterpolatePoints(ctx(), even, &at, 3, nullptr, nullptr, FALSE,
                                                                     SM_IT_CHORDLENGTH, denser);
            clean_scale.ReplaceObj(denser);
            scale = denser;
            check(again, "SmBSplineCurve::InterpolatePoints");
        }
        check(scale->EditParameterization(range), "SmBSplineCurve::EditParameterization");
    }
    // (a trajectory of degree 1, a line, raised to cubic as the kernel's sweep makes it compatible with
    // its scale curve: NLib sweeps along a line of degree 1 as along straight pieces, and the end curve
    // of a circle turned along one did not close into a cap: twist=90 along a line raised SM_ERR)
    if (trajectory->GetDegree() < 3)
        check(trajectory->RaiseDegree(3), "SmBSplineCurve::RaiseDegree");

    // the profile: B-spline copies (the kernel's sweep skips other curves), split where they turn
    // (SM_CT_C1), mapped onto the section frame and joined into composites
    SmTArray<SmBSplineCurve*> nurbs;
    SmObjsDelete<SmBSplineCurve*> clean_nurbs(&nurbs);
    for (SmCurve* c : profile)
    {
        SmBSplineCurve* b = SM_CAST_PTR(SmBSplineCurve, c);
        if (b)
            nurbs.Add(new (ctx()) SmBSplineCurve(*b));
    }
    if (!nurbs.GetSize())
        throw std::invalid_argument("oriented_sweep: no profile curve is a B-spline");
    for (ULONG i = 0; i < nurbs.GetSize(); ++i)
    {
        SmTArray<SmBSplineCurve*> pieces;
        check(nurbs[i]->SubdivideAtDiscontinuity(ctx(), SM_CT_C1, pieces), "SmBSplineCurve::SubdivideAtDiscontinuity");
        if (pieces.GetSize() > 1)
        {
            delete nurbs[i];
            nurbs.RemoveAt(i);
            for (ULONG j = 0; j < pieces.GetSize(); ++j)
                nurbs.InsertAt(i++, pieces[j]);
            --i;
        }
        else if (pieces.GetSize() == 1)
        {
            delete pieces[0];
        }
    }
    const ULONG curve_count = nurbs.GetSize();
    const SmVector3d origin(0, 0, 0), x_axis(1, 0, 0), y_axis(0, 1, 0);
    const SmAxis2Placement to_section(origin, x_axis, y_axis, origin, SmVector3d(0, 0, 1), SmVector3d(0, -1, 0));
    for (ULONG i = 0; i < curve_count; ++i)
        nurbs[i]->Transform(to_section);

    BrepGuard result{new (ctx()) SmBrep()};
    SmBrep* brep = result.brep;
    SmTArray<SmCompositeCurve*> composites;
    SmObjsDelete<SmCompositeCurve*> clean_composites(&composites);
    check(SmCompositeCurve::BuildCompositesFromCurves(ctx(), nurbs, TRUE, 0.0, brep->GetTolerance(), 0.0, 0.0, 0.0, 0.0,
                                                      composites),
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
            throw std::runtime_error("oriented_sweep: SmCompositeCurve::GetCanonical failed");
        }
        for (ULONG j = 0; j < taken.GetSize(); ++j)
            for (ULONG k = 0; k < nurbs.GetSize(); ++k)
                if (nurbs[k] == taken[j])
                {
                    nurbs.SetAt(k, nullptr);
                    break;
                }
    }

    NL_CURVE* nl_path = trajectory->GetOrCreateGwNurbPointer();
    NL_CURVE* nl_axes = axes->GetOrCreateGwNurbPointer();
    NL_CURVE* nl_scale = scale->GetOrCreateGwNurbPointer();
    const NL_DEGREE degree = 3;  // (cubic along the path, as the kernel's sweep with a scale curve)
    SmTArray<SmFace*> sides;
    for (ULONG i = 0; i < composites.GetSize(); ++i)
    {
        SmBSplineCurve* section = nullptr;
        check(composites[i]->MakeCompositeNurb(ctx(), section), "SmCompositeCurve::MakeCompositeNurb");
        SmObjDelete clean_section(section);
        SmBSplineSurface* surface = nullptr;
        {
            NL_STACKS stacks;
            NLibStacks stacks_guard(&stacks);
            NL_SURFACE swept;
            N_SrfInitArrays(&swept);
            NL_VECTOR z0;  // (not used with curZ)
            z0.x = 0.0, z0.y = 0.0, z0.z = 1.0;
            NL_PARAMETER unused = 0.0;
            if (N_CreateSweepScale(nl_path, section->GetOrCreateGwNurbPointer(), z0, nl_axes, nl_scale, NL_NO, unused, degree,
                                   NL_UDIR, SM_ZONE_TOL_3D, &swept, &stacks) == NL_YES)
                SmPyRaise(SM_ERR, "N_CreateSweepScale", __FILE__, __LINE__);
            surface = new (ctx()) SmBSplineSurface(reinterpret_cast<gw_SURFACE*>(&swept));
        }
        // (CreateFacesFromSurface owns the surface: it gives it to the face, or splits it where it turns
        // and deletes it; where it fails half way the surface may be gone too, so it is not read again)
        SmTArray<SmFace*> faces;
        check(brep->CreateFacesFromSurface(surface, surface->GetNaturalUVDomain(), SM_CT_G1, faces),
              "SmBrep::CreateFacesFromSurface");
        sides.Append(faces);
    }

    if (cap_ends)
    {
        // the end caps from the side faces' end curves: the curves at the start and the end of each face
        // along the path that lie in the plane across the path's start or end. (CreateCurveSweep takes the
        // start curves of the first faces and the end curves of the last ones, as many as there are
        // profile curves; a circle is one curve, but its surface may come in four faces, which left three
        // quarters out of a cap: a circle twisted along a line raised SM_ERR.)
        SmTArray<SmCurve*> starts, ends;
        SmObjsDelete<SmCurve*> clean_starts(&starts), clean_ends(&ends);
        SmVector3d head[2], tail[2];
        check(path->Evaluate(range.GetMin(), 1, TRUE, head), "SmCurve::Evaluate");
        check(path->Evaluate(range.GetMax(), 1, FALSE, tail), "SmCurve::Evaluate");
        const SmPoint3d first(head[0].x, head[0].y, head[0].z), last(tail[0].x, tail[0].y, tail[0].z);
        const SmVector3d first_dir = head[1] / head[1].Length(), last_dir = tail[1] / tail[1].Length();
        const double tol = 10.0 * SM_ZONE_TOL_3D;
        auto across = [&](const SmBSplineCurve* c, const SmPoint3d& at, const SmVector3d& dir) {
            const SmExtent1d iv = c->GetNaturalInterval();
            for (int k = 0; k <= 4; ++k)
            {
                SmPoint3d p;
                if (c->EvaluatePoint(iv.Evaluate(k / 4.0), p) != SM_SUCCESS || std::abs((p - at).Dot(dir)) > tol)
                    return false;
            }
            return true;
        };
        for (ULONG i = 0; i < sides.GetSize(); ++i)
        {
            SmSurface* surface = sides[i]->GetSurface();
            const SmExtent2d domain = surface->GetNaturalUVDomain();
            for (double u : {domain.GetMin().x, domain.GetMax().x})
            {
                SmBSplineCurve* c = nullptr;
                check(surface->CreateIsoParametricCurve(ctx(), SM_SP_U, u, SM_ZONE_TOL_3D / 10.0, c),
                      "SmSurface::CreateIsoParametricCurve");
                if (u == domain.GetMin().x && across(c, first, first_dir))
                    starts.Add(c);
                else if (u == domain.GetMax().x && across(c, last, last_dir))
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

// -------------------------------------------------------------------------------------------------
// The axis of a helix
// -------------------------------------------------------------------------------------------------
namespace {

struct Sample
{
    SmVector3d p, t;  // point, unit tangent
};

// Two unit vectors perpendicular to a and each other.
void basis(const SmVector3d& a, SmVector3d& e1, SmVector3d& e2)
{
    SmVector3d ref = std::abs(a.x) < 0.9 ? SmVector3d(1, 0, 0) : SmVector3d(0, 1, 0);
    e1 = ref - a * ref.Dot(a);
    e1 = e1 / e1.Length();
    e2 = a * e1;  // (cross product)
}

// The residuals of the distance from the axis (o, a) and of the height along it, each fitted as a
// straight function of the angle about it (2 per point); false where the angle jumps between samples
// by more than a quarter turn (not a helix about this axis, or sampled too coarsely).
bool residuals(const std::vector<Sample>& s, const SmVector3d& a, const SmVector3d& o, std::vector<double>& r,
               double* turned = nullptr)
{
    SmVector3d e1, e2;
    basis(a, e1, e2);
    const size_t n = s.size();
    std::vector<double> th(n), rho(n), z(n);
    for (size_t i = 0; i < n; ++i)
    {
        SmVector3d d = s[i].p - o;
        double x = d.Dot(e1), y = d.Dot(e2);
        z[i] = d.Dot(a);
        rho[i] = std::hypot(x, y);
        double t = std::atan2(y, x);
        if (i)
        {
            while (t - th[i - 1] > SM_PI)
                t -= 2 * SM_PI;
            while (t - th[i - 1] < -SM_PI)
                t += 2 * SM_PI;
            if (std::abs(t - th[i - 1]) > 0.5 * SM_PI)
                return false;
        }
        th[i] = t;
    }
    double mt = 0, mr = 0, mz = 0;
    for (size_t i = 0; i < n; ++i)
        mt += th[i], mr += rho[i], mz += z[i];
    mt /= n, mr /= n, mz /= n;
    double stt = 0, str = 0, stz = 0;
    for (size_t i = 0; i < n; ++i)
    {
        stt += (th[i] - mt) * (th[i] - mt);
        str += (th[i] - mt) * (rho[i] - mr);
        stz += (th[i] - mt) * (z[i] - mz);
    }
    if (!(stt > 0))
        return false;
    const double br = str / stt, bz = stz / stt;
    r.resize(2 * n);
    for (size_t i = 0; i < n; ++i)
    {
        r[2 * i] = rho[i] - (mr + br * (th[i] - mt));
        r[2 * i + 1] = z[i] - (mz + bz * (th[i] - mt));
    }
    if (turned)
        *turned = std::abs(th.back() - th.front());
    return true;
}

// Solves the n x n system m x = b in place (Gaussian elimination with partial pivoting).
bool solve(std::vector<double>& m, std::vector<double>& b, size_t n)
{
    for (size_t c = 0; c < n; ++c)
    {
        size_t p = c;
        for (size_t r = c + 1; r < n; ++r)
            if (std::abs(m[r * n + c]) > std::abs(m[p * n + c]))
                p = r;
        if (!(std::abs(m[p * n + c]) > 1e-300))
            return false;
        if (p != c)
        {
            for (size_t k = 0; k < n; ++k)
                std::swap(m[p * n + k], m[c * n + k]);
            std::swap(b[p], b[c]);
        }
        for (size_t r = c + 1; r < n; ++r)
        {
            const double f = m[r * n + c] / m[c * n + c];
            for (size_t k = c; k < n; ++k)
                m[r * n + k] -= f * m[c * n + k];
            b[r] -= f * b[c];
        }
    }
    for (size_t c = n; c-- > 0;)
    {
        for (size_t k = c + 1; k < n; ++k)
            b[c] -= m[c * n + k] * b[k];
        b[c] /= m[c * n + c];
    }
    return true;
}

double max_abs(const std::vector<double>& r)
{
    double m = 0;
    for (double x : r)
        m = std::max(m, std::abs(x));
    return m;
}

double sum_squares(const std::vector<double>& r)
{
    double s = 0;
    for (double x : r)
        s += x * x;
    return s;
}

}  // namespace

std::vector<double> helix_axis(const std::vector<SmCurve*>& curves, double tolerance)
{
    if (curves.empty())
        return {};
    // points and unit tangents: four a knot span (a helix of the kernel has about 32 spans a turn)
    std::vector<Sample> s;
    for (SmCurve* c : curves)
    {
        if (!c)
            return {};
        const SmBSplineCurve* b = SM_CAST_PTR(SmBSplineCurve, c);
        const SmExtent1d range = c->GetNaturalInterval();
        std::vector<double> ts;
        SmTArray<double> knots;
        if (b && b->GetKnots(knots) == SM_SUCCESS && knots.GetSize() > 1)
        {
            const ULONG per = std::max<ULONG>(4, 64 / (knots.GetSize() - 1));
            for (ULONG k = 0; k + 1 < knots.GetSize(); ++k)
                for (ULONG j = 0; j < per; ++j)
                    ts.push_back(knots[k] + (knots[k + 1] - knots[k]) * j / per);
            ts.push_back(knots[knots.GetSize() - 1]);
        }
        else
        {
            for (int j = 0; j <= 64; ++j)
                ts.push_back(range.Evaluate(j / 64.0));
        }
        for (double t : ts)
        {
            SmVector3d pd[2];
            if (c->Evaluate(t, 1, TRUE, pd, FALSE) != SM_SUCCESS)
                return {};
            const double len = pd[1].Length();
            if (!(len > 0))
                continue;
            s.push_back({pd[0], pd[1] / len});
        }
    }
    if (s.size() < 16)
        return {};
    SmExtent3d box;
    for (const Sample& x : s)
        box.AddPoint3d(x.p);
    const double size = box.GetSize().Length();
    if (!(size > 0))
        return {};

    // the axis's direction: the unit tangents of a helix run round a cone about it, so the turns from
    // one to the next all point along it (along a conical helix nearly)
    SmVector3d sum(0, 0, 0);
    double total = 0;
    for (size_t i = 0; i + 2 < s.size(); ++i)
    {
        SmVector3d c = (s[i + 1].t - s[i].t) * (s[i + 2].t - s[i + 1].t);
        sum = sum + c;
        total += c.Length();
    }
    if (!(total > 0) || sum.Length() < 0.9 * total)
        return {};
    SmVector3d a = sum / sum.Length();
    SmVector3d e1, e2;
    basis(a, e1, e2);

    // a point on it: the center of the circle the points' projections lie on (nearly, for a conical helix)
    SmVector3d mean(0, 0, 0);
    for (const Sample& x : s)
        mean = mean + x.p;
    mean = mean / static_cast<double>(s.size());
    std::vector<double> m(9, 0.0), rhs(3, 0.0);
    for (const Sample& x : s)
    {
        const SmVector3d d = x.p - mean;
        const double u = d.Dot(e1), v = d.Dot(e2), w = u * u + v * v;
        const double row[3] = {u, v, 1.0};
        for (int i = 0; i < 3; ++i)
        {
            for (int j = 0; j < 3; ++j)
                m[i * 3 + j] += row[i] * row[j];
            rhs[i] += row[i] * w;
        }
    }
    if (!solve(m, rhs, 3))
        return {};
    SmVector3d o = mean + e1 * (0.5 * rhs[0]) + e2 * (0.5 * rhs[1]);

    // refined (Gauss-Newton): distance from the axis and height along it straight in the angle
    double p[4] = {0, 0, 0, 0};
    auto axis_of = [&](const double* q, SmVector3d& aa, SmVector3d& oo) {
        aa = a + e1 * q[0] + e2 * q[1];
        aa = aa / aa.Length();
        oo = o + e1 * q[2] + e2 * q[3];
    };
    std::vector<double> r, rh;
    SmVector3d aa, oo;
    axis_of(p, aa, oo);
    if (!residuals(s, aa, oo, r))
        return {};
    double cost = sum_squares(r);
    for (int it = 0; it < 30; ++it)
    {
        const size_t rows = r.size();
        std::vector<double> jac(rows * 4);
        bool ok = true;
        for (int j = 0; j < 4 && ok; ++j)
        {
            double q[4] = {p[0], p[1], p[2], p[3]};
            const double h = j < 2 ? 1e-7 : 1e-7 * size;
            q[j] += h;
            axis_of(q, aa, oo);
            ok = residuals(s, aa, oo, rh);
            for (size_t i = 0; ok && i < rows; ++i)
                jac[i * 4 + j] = (rh[i] - r[i]) / h;
        }
        if (!ok)
            break;
        std::vector<double> jtj(16, 0.0), jtr(4, 0.0);
        for (size_t i = 0; i < rows; ++i)
            for (int x = 0; x < 4; ++x)
            {
                jtr[x] -= jac[i * 4 + x] * r[i];
                for (int y = 0; y < 4; ++y)
                    jtj[x * 4 + y] += jac[i * 4 + x] * jac[i * 4 + y];
            }
        for (int x = 0; x < 4; ++x)
            jtj[x * 4 + x] *= 1.0 + 1e-9;
        if (!solve(jtj, jtr, 4))
            break;
        double q[4];
        for (int x = 0; x < 4; ++x)
            q[x] = p[x] + jtr[x];
        axis_of(q, aa, oo);
        if (!residuals(s, aa, oo, rh))
            break;
        const double c = sum_squares(rh);
        if (!(c < cost))
            break;
        std::copy(q, q + 4, p);
        r.swap(rh);
        const bool small = cost - c <= 1e-12 * cost;
        cost = c;
        if (small)
            break;
    }
    axis_of(p, aa, oo);
    double turned = 0;
    if (!residuals(s, aa, oo, r, &turned) || max_abs(r) > tolerance * size || turned < 0.5 * SM_PI)
        return {};
    // (pointing the way the path rises, and through the point of it level with the path's start)
    if ((s.back().p - s.front().p).Dot(aa) < 0)
        aa = -aa;
    oo = oo + aa * (s.front().p - oo).Dot(aa);
    return {oo.x, oo.y, oo.z, aa.x, aa.y, aa.z};
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_oriented_sweep(py::module_ m)
{
    m.def("oriented_sweep", &smlibpy::oriented_sweep, py::arg("profile"), py::arg("path"), py::arg("params"),
          py::arg("x_axes"), py::arg("cap_ends") = true, py::arg("scales") = std::vector<double>{},
          py::return_value_policy::take_ownership,
          "Sweep profile curves (in the XY plane, their anchor at the origin) along a path with the profile's x axis "
          "given along it: `x_axes` (x, y, z each, flat) at the path's parameters `params` (from its start to its "
          "end), perpendicular to the tangent there; `scales` (optional) the profile's scale there (the profile is "
          "drawn at the first). Profile and path are copied, not consumed.");
    m.def("helix_axis", [](const std::vector<SmCurve*>& curves, double tolerance) -> py::object {
        const std::vector<double> a = smlibpy::helix_axis(curves, tolerance);
        if (a.empty())
            return py::none();
        return py::make_tuple(py::make_tuple(a[0], a[1], a[2]), py::make_tuple(a[3], a[4], a[5]));
    }, py::arg("curves"), py::arg("tolerance") = 1e-5,
       "The axis (point, direction) of curves that make a helix (constant or evenly changing radius) within "
       "`tolerance` times their size, or None.");
}
#endif  // SMLIBPY_PYTHON
