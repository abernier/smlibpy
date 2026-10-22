// SPDX-License-Identifier: Apache-2.0
//
// Face and edge analysis (`smlibpy._core.ext`):
//
//   face_curvature(face, u, v)            principal curvatures with their directions at (u, v)
//   face_min_radius(face, grid)           the smallest radius of curvature of a face
//   face_iso_curves(face, constant_u, value)
//                                         iso-parametric curves of a face's surface clipped to it
//   edge_continuity(edge, samples)        gap, normal angle and curvature jump of the faces at an edge
//   edge_outer_angles(brep, edges, samples)
//                                         the kernel's outer angle at several points along each edge
//
// Curvatures follow surface_eval.cpp: from the first and second fundamental forms of the exact
// surface, signed by the outward normal of the face (a convex surface positive, a bore negative).
// The continuity of an edge is smlibpy's own: the kernel's SmEdge::GetContinuity compares a normal
// with itself in its G2 test (SmGeomUtility.cpp:5822), takes the length of a second derivative for
// the curvature, passes a position and a first derivative where it wants third derivatives
// (SmEdgeuse.cpp:726-727), ignores its tolerance, and calls the creases of a G2 blend
// discontinuous. Here each face is evaluated at the edge's points: their distance, the angle
// between their outward normals and their normal curvatures in the direction across the edge
// (tangent to each face). Where the faces meet tangentially, equal curvatures across the edge make
// the edge G2: the curvature along the edge and the twist follow from the shared curve and normals.

#include "kernel.h"
#include "face_analysis.h"

#include <SmApiGeneral.h>
#include <SmApiQueries.h>
#include <SmApiSurfaces.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <vector>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

constexpr double kInf = std::numeric_limits<double>::infinity();
constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();

struct Derivatives
{
    SmPoint3d p;
    SmVector3d du, dv, duu, duv, dvv;
};

bool evaluate(const SmSurface* surface, const SmPoint2d& uv, Derivatives& d)
{
    return surface->Evaluate2ndDerivatives(uv, TRUE, TRUE, d.p, d.du, d.dv, d.duv, d.duu, d.dvv) == SM_SUCCESS;
}

// The outward normal of a face at uv (as SmFace::outward_normal_at_uv and surface_eval.cpp).
bool outward_normal(const SmFace* face, const SmPoint2d& uv, SmVector3d& n)
{
    if (SmApiEvaluateSurfaceNormal(face->GetSurface(), uv, n) != SM_SUCCESS)
        return false;
    SmBrep* brep = face->GetBrep();
    SmFaceuse* upward = face->GetUpwardFaceuse();
    if (brep && upward && upward->GetShell() && brep->GetInfiniteRegion() != upward->GetShell()->GetRegion())
        n = n * -1.0;
    return n.Length() > 0;
}

bool on_face(const SmFace* face, const SmPoint2d& uv)
{
    int where = SM_PC_UNKNOWN;
    return SmApiFaceClassifyUV(face, uv, where) == SM_SUCCESS &&
           (where == SM_PC_FACE || where == SM_PC_EDGE || where == SM_PC_VERTEX);
}

// The unit normal from the derivatives, turned to agree with `outward`, and the fundamental forms.
struct Forms
{
    SmVector3d n;
    double E = 0, F = 0, G = 0, L = 0, M = 0, N = 0;
};

// `ratio`: tangents shorter than this times the other count as vanishing (a pole); near a pole the
// curvature from the derivatives loses digits.
bool forms(const Derivatives& d, const SmVector3d& outward, Forms& f, double ratio = 1e-6)
{
    const double a = d.du.Length(), b = d.dv.Length();
    if (!(a > 0) || !(b > 0) || std::min(a, b) < ratio * std::max(a, b))
        return false;  // singular: a tangent that vanishes (a pole)
    SmVector3d n = d.du * d.dv;  // cross product
    const double length = n.Length();
    if (!(length > 1e-6 * a * b))
        return false;  // two tangents that are parallel
    n = n * (1.0 / length);
    if (n.Dot(outward) < 0)
        n = n * -1.0;
    f.n = n;
    f.E = d.du.Dot(d.du), f.F = d.du.Dot(d.dv), f.G = d.dv.Dot(d.dv);
    f.L = -d.duu.Dot(n), f.M = -d.duv.Dot(n), f.N = -d.dvv.Dot(n);
    return f.E * f.G - f.F * f.F > 0;
}

// Principal curvatures k1 >= k2 and their unit directions: the eigenvalues and eigenvectors of the
// shape operator S = I^-1 II, its discriminant taken from S's entries (from the mean and Gaussian
// curvature it would lose half the digits at an umbilic point: 1e-8 on a sphere).
bool principal(const Derivatives& d, const Forms& f, double& k1, double& k2, SmVector3d& d1, SmVector3d& d2)
{
    const double det = f.E * f.G - f.F * f.F;
    const double s11 = (f.G * f.L - f.F * f.M) / det, s12 = (f.G * f.M - f.F * f.N) / det;
    const double s21 = (f.E * f.M - f.F * f.L) / det, s22 = (f.E * f.N - f.F * f.M) / det;
    const double mean = 0.5 * (s11 + s22), half = 0.5 * (s11 - s22);
    const double root = std::sqrt(std::max(half * half + s12 * s21, 0.0));
    k1 = mean + root;
    k2 = mean - root;
    if (!std::isfinite(k1) || !std::isfinite(k2))
        return false;
    // (S - k1) w = 0 in (du, dv): w is across the larger row of S - k1
    const double r[2][2] = {{s11 - k1, s12}, {s21, s22 - k1}};
    const double n0 = std::hypot(r[0][0], r[0][1]), n1 = std::hypot(r[1][0], r[1][1]);
    const int row = n0 >= n1 ? 0 : 1;
    const double scale = std::fabs(k1) + std::fabs(k2);
    SmVector3d w;
    if (std::max(n0, n1) <= 1e-9 * scale || std::max(n0, n1) == 0.0)
        w = d.du;  // umbilic (a sphere, a plane): every direction is principal
    else
        w = d.du * -r[row][1] + d.dv * r[row][0];
    const double length = w.Length();
    if (!(length > 0))
        return false;
    d1 = w * (1.0 / length);
    d2 = f.n * d1;  // cross product: across d1 in the tangent plane
    return true;
}

// The normal curvature of a surface in the tangent direction w (signed by the forms' normal).
double normal_curvature(const Derivatives& d, const Forms& f, const SmVector3d& w)
{
    const double det = f.E * f.G - f.F * f.F;
    const double bu = d.du.Dot(w), bv = d.dv.Dot(w);
    const double a = (f.G * bu - f.F * bv) / det, b = (f.E * bv - f.F * bu) / det;  // w = a du + b dv
    const double first = f.E * a * a + 2.0 * f.F * a * b + f.G * b * b;
    if (!(first > 0))
        return kNaN;
    return (f.L * a * a + 2.0 * f.M * a * b + f.N * b * b) / first;
}

// Derivatives and forms at uv for the curvature; near a singular point (within 1e-2 of a pole by
// the ratio of the tangents, where the derivatives do not give the curvature to all its digits) a
// little towards the middle of the face's parameter box instead.
bool evaluate_at(const SmFace* face, SmPoint2d& uv, Derivatives& d, Forms& f, double ratio = 1e-2)
{
    const SmSurface* surface = face->GetSurface();
    const SmPoint2d mid = face->GetUVDomain().GetMid();
    const SmPoint2d start = uv;
    for (double t : {0.0, 1e-4, 1e-3, 3e-3, 1e-2, 3e-2, 0.1})
    {
        const SmPoint2d q(start.x + (mid.x - start.x) * t, start.y + (mid.y - start.y) * t);
        SmVector3d out;
        if (evaluate(surface, q, d) && outward_normal(face, q, out) && forms(d, out, f, ratio))
        {
            uv = q;
            return true;
        }
    }
    return false;
}

void copy3(double* out, const SmVector3d& v) { out[0] = v.x, out[1] = v.y, out[2] = v.z; }

// The largest |principal curvature| at uv, or -1 where the surface has none. Points within 1e-2 of
// a pole (by the ratio of the tangents) are left out: there the derivatives do not give the
// curvature to all its digits (a sphere of radius 10 gave 9.978 near its pole, 9.99999998 at 1e-3).
double largest_curvature(const SmFace* face, SmPoint2d uv)
{
    Derivatives d;
    Forms f;
    SmVector3d out;
    if (!evaluate(face->GetSurface(), uv, d) || !outward_normal(face, uv, out) || !forms(d, out, f, 1e-2))
        return -1.0;
    double k1, k2;
    SmVector3d d1, d2;
    if (!principal(d, f, k1, k2, d1, d2))
        return -1.0;
    return std::max(std::fabs(k1), std::fabs(k2));
}

// The parameters of the face point at p: of the point's parameters on the surface (several on a
// seam) the first on the face, the first of all if none is.
bool parameters_on(const SmFace* face, const SmPoint3d& p, SmPoint2d& uv, SmTArray<SmPoint2d>* all = nullptr)
{
    SmPoint3d closest;
    SmTArray<SmPoint2d> uvs;
    double gap = 0.0;
    if (SmApiSurfaceClosestPoint(face->GetSurface(), p, closest, uvs, gap) != SM_SUCCESS || uvs.GetSize() < 1)
        return false;
    uv = uvs[0];
    for (ULONG i = 0; i < uvs.GetSize(); ++i)
        if (on_face(face, uvs[i]))
        {
            uv = uvs[i];
            break;
        }
    if (all)
        *all = uvs;
    return true;
}

// Where an iso line (u = value, or v = value) runs on a face, from where it crosses the face's
// boundary in the parameter plane (the 2D curves of the face's loops): between consecutive
// crossings it lies on the face or off it, which the middle tells. False if the face's 2D curves
// cannot be had.
bool crossings_runs(const SmFace* face, bool constant_u, double value, double s0, double s1,
                    std::vector<std::pair<double, double>>& runs)
{
    SmTArray<ULONG> loops;
    SmTArray<SmBSplineCurve*> curves;
    SmTArray<SmOrientType> orients;
    SmTArray<SmPoint3d> points;
    const SmStatus st = face->CreateCurvesFromFace(ctx(), SM_OT_SAME, loops, nullptr, &curves, orients, points);
    bool ok = st == SM_SUCCESS;
    std::vector<double> at = {s0, s1};
    for (ULONG i = 0; i < curves.GetSize() && ok; ++i)
    {
        const SmBSplineCurve* c = curves[i];
        const SmExtent1d ivl = c->GetNaturalInterval();
        auto point = [&](double t, SmPoint3d& p) { return c->EvaluatePoint(t, p) == SM_SUCCESS; };
        auto f = [&](const SmPoint3d& p) { return (constant_u ? p.x : p.y) - value; };
        auto other = [&](const SmPoint3d& p) { return constant_u ? p.y : p.x; };
        const int n = 64;
        double ta = ivl.GetMin();
        SmPoint3d pa;
        if (!point(ta, pa))
        {
            ok = false;
            break;
        }
        double fa = f(pa);
        if (fa == 0.0)
            at.push_back(other(pa));
        for (int k = 1; k <= n; ++k)
        {
            const double tb = ivl.GetMin() + (ivl.GetMax() - ivl.GetMin()) * k / n;
            SmPoint3d pb;
            if (!point(tb, pb))
            {
                ok = false;
                break;
            }
            const double fb = f(pb);
            if (fb == 0.0)
                at.push_back(other(pb));
            else if (fa != 0.0 && (fa < 0) != (fb < 0))
            {
                double lo = ta, hi = tb, flo = fa;
                SmPoint3d pm = pa;
                for (int it = 0; it < 80; ++it)
                {
                    const double m = 0.5 * (lo + hi);
                    if (!point(m, pm))
                        break;
                    const double fm = f(pm);
                    if (fm == 0.0)
                        break;
                    if ((fm < 0) == (flo < 0))
                        lo = m, flo = fm;
                    else
                        hi = m;
                }
                at.push_back(other(pm));
            }
            ta = tb, fa = fb, pa = pb;
        }
    }
    for (ULONG i = 0; i < curves.GetSize(); ++i)
        delete curves[i];
    if (!ok)
        return false;
    std::sort(at.begin(), at.end());
    std::vector<double> cuts;
    const double tiny = 1e-12 * std::max(1.0, std::fabs(s1 - s0));
    for (double x : at)
        if (x >= s0 - tiny && x <= s1 + tiny && (cuts.empty() || x - cuts.back() > tiny))
            cuts.push_back(std::min(std::max(x, s0), s1));
    for (size_t i = 0; i + 1 < cuts.size(); ++i)
    {
        const double a = cuts[i], b = cuts[i + 1];
        if (!on_face(face, constant_u ? SmPoint2d(value, 0.5 * (a + b)) : SmPoint2d(0.5 * (a + b), value)))
            continue;
        if (!runs.empty() && std::fabs(runs.back().second - a) <= tiny)
            runs.back().second = b;  // the line runs on along the face
        else
            runs.emplace_back(a, b);
    }
    return true;
}

// The same from samples along the line, each change refined by bisection (to the classification's
// own precision, about 1e-5 of the face's parameter box).
template <typename In>
void sampled_runs(const In& in, double s0, double s1, std::vector<std::pair<double, double>>& runs)
{
    const int n = 256;
    double start = 0.0;
    bool inside = false;
    double before = s0;
    bool was = false;
    for (int i = 0; i <= n; ++i)
    {
        const double s = s0 + (s1 - s0) * i / n;
        const bool now = in(s);
        if (i > 0 && now != was)
        {
            double a = before, b = s;  // was at a, now at b
            for (int k = 0; k < 60; ++k)
            {
                const double m = 0.5 * (a + b);
                (in(m) == was ? a : b) = m;
            }
            const double edge = was ? a : b;  // the last point on the face, or the first
            if (now)
                start = edge, inside = true;
            else
            {
                runs.emplace_back(start, edge);
                inside = false;
            }
        }
        else if (i == 0 && now)
            start = s, inside = true;
        before = s, was = now;
    }
    if (inside)
        runs.emplace_back(start, s1);
}

}  // namespace

namespace smlibpy {

FaceCurvature face_curvature(const SmFace* face, double u, double v)
{
    if (!face)
        throw std::invalid_argument("face is None");
    SmPoint2d uv(u, v);
    Derivatives d;
    Forms f;
    double k1 = 0, k2 = 0;
    SmVector3d d1, d2;
    if (!evaluate_at(face, uv, d, f) || !principal(d, f, k1, k2, d1, d2))
        throw std::runtime_error("face_curvature: the surface has no curvature at this point");
    FaceCurvature out;
    // the point and normal where asked (the curvature may come from a little beside a pole)
    SmPoint3d p = d.p;
    SmVector3d n = f.n;
    const SmPoint2d asked(u, v);
    if ((uv.x != asked.x || uv.y != asked.y) && face->GetSurface()->EvaluatePoint(asked, p) == SM_SUCCESS)
    {
        SmVector3d there;
        if (outward_normal(face, asked, there))
        {
            n = there * (1.0 / there.Length());
            const SmVector3d flat = d1 - n * d1.Dot(n);  // the directions in the plane of the normal
            if (flat.Length() > 0)
                d1 = flat * (1.0 / flat.Length()), d2 = n * d1;
        }
    }
    copy3(out.point, SmVector3d(p.x, p.y, p.z));
    copy3(out.normal, n);
    out.k1 = k1, out.k2 = k2;
    copy3(out.d1, d1);
    copy3(out.d2, d2);
    return out;
}

MinRadius face_min_radius(const SmFace* face, int grid)
{
    if (!face)
        throw std::invalid_argument("face is None");
    grid = std::max(2, std::min(grid, 200));
    const SmExtent2d domain = face->GetUVDomain();
    const double u0 = domain.GetMin().x, u1 = domain.GetMax().x, v0 = domain.GetMin().y, v1 = domain.GetMax().y;
    MinRadius out;
    struct Sample
    {
        double k;
        SmPoint2d uv;
    };
    std::vector<Sample> samples;
    SmExtent3d box;
    for (int i = 0; i <= grid; ++i)
        for (int j = 0; j <= grid; ++j)
        {
            const SmPoint2d uv(u0 + (u1 - u0) * i / grid, v0 + (v1 - v0) * j / grid);
            if (!on_face(face, uv))
                continue;
            SmPoint3d p;
            if (face->GetSurface()->EvaluatePoint(uv, p) == SM_SUCCESS)
                box.AddPoint3d(p);
            const double k = largest_curvature(face, uv);
            ++out.evaluations;
            if (k >= 0)
                samples.push_back({k, uv});
        }
    if (samples.empty())
    {
        const SmPoint2d mid = domain.GetMid();
        const double k = largest_curvature(face, mid);
        if (k < 0)
            throw std::runtime_error("face_min_radius: the face has no curvature anywhere it was sampled");
        samples.push_back({k, mid});
    }
    std::sort(samples.begin(), samples.end(), [](const Sample& a, const Sample& b) { return a.k > b.k; });
    // refine the best few by a pattern search on the face
    Sample best = samples[0];
    const size_t starts = std::min<size_t>(samples.size(), 4);
    for (size_t s = 0; s < starts; ++s)
    {
        Sample at = samples[s];
        double su = (u1 - u0) / grid, sv = (v1 - v0) / grid;
        for (int step = 0; step < 400 && (su > 1e-10 * (u1 - u0) || sv > 1e-10 * (v1 - v0)); ++step)
        {
            bool moved = false;
            for (int di = -1; di <= 1 && !moved; ++di)
                for (int dj = -1; dj <= 1 && !moved; ++dj)
                {
                    if (!di && !dj)
                        continue;
                    const SmPoint2d q(at.uv.x + di * su, at.uv.y + dj * sv);
                    if (q.x < u0 || q.x > u1 || q.y < v0 || q.y > v1 || !on_face(face, q))
                        continue;
                    const double k = largest_curvature(face, q);
                    ++out.evaluations;
                    if (k > at.k * (1 + 1e-15))
                        at = {k, q}, moved = true;
                }
            if (!moved)
                su *= 0.5, sv *= 0.5;
        }
        if (at.k > best.k)
            best = at;
    }
    SmPoint3d p;
    face->GetSurface()->EvaluatePoint(best.uv, p);
    const double size = box.IsInit() ? 0.0 : box.GetSize().Length();
    out.radius = best.k * std::max(size, 1e-300) <= 1e-12 ? kInf : 1.0 / best.k;
    out.point[0] = p.x, out.point[1] = p.y, out.point[2] = p.z;
    out.uv[0] = best.uv.x, out.uv[1] = best.uv.y;
    return out;
}

std::vector<SmCurve*> face_iso_curves(const SmFace* face, bool constant_u, double value)
{
    if (!face)
        throw std::invalid_argument("face is None");
    const SmExtent2d domain = face->GetUVDomain();
    const double s0 = constant_u ? domain.GetMin().y : domain.GetMin().x;
    const double s1 = constant_u ? domain.GetMax().y : domain.GetMax().x;
    const double c0 = constant_u ? domain.GetMin().x : domain.GetMin().y;
    const double c1 = constant_u ? domain.GetMax().x : domain.GetMax().y;
    if (!(value >= c0 - 1e-12 * (1 + std::fabs(c0)) && value <= c1 + 1e-12 * (1 + std::fabs(c1))))
        throw std::invalid_argument("face_iso_curves: the parameter lies outside the face");
    value = std::min(std::max(value, c0), c1);
    auto uv = [&](double s) { return constant_u ? SmPoint2d(value, s) : SmPoint2d(s, value); };
    auto in = [&](double s) { return on_face(face, uv(s)); };
    std::vector<std::pair<double, double>> runs;
    if (!crossings_runs(face, constant_u, value, s0, s1, runs))
        sampled_runs(in, s0, s1, runs);
    std::vector<SmCurve*> out;
    try
    {
        for (const auto& r : runs)
        {
            if (!(r.second - r.first > 1e-9 * (s1 - s0)))
                continue;
            const SmExtent2d piece = constant_u ? SmExtent2d(value, r.first, value, r.second)
                                                : SmExtent2d(r.first, value, r.second, value);
            SmBSplineCurve* curve = nullptr;
            const SmStatus st = face->GetSurface()->CreateIsoParametricCurve(
                ctx(), constant_u ? SM_SP_U : SM_SP_V, value, SmApproxTol3d(1e-7), curve, &piece);
            if (st != SM_SUCCESS || !curve)
            {
                delete curve;
                throw std::runtime_error("face_iso_curves: the kernel did not make the iso-parametric curve");
            }
            out.push_back(curve);
        }
    }
    catch (...)
    {
        for (SmCurve* c : out)
            delete c;
        throw;
    }
    return out;
}

EdgeContinuity edge_continuity(const SmEdge* edge, int samples)
{
    if (!edge)
        throw std::invalid_argument("edge is None");
    samples = std::max(1, std::min(samples, 10000));
    SmTArray<SmFace*> faces;
    edge->GetFaces(faces);
    const SmFace* a = nullptr;
    const SmFace* b = nullptr;
    bool seam = false;
    if (faces.GetSize() == 2 && faces[0] != faces[1])
        a = faces[0], b = faces[1];
    else if (faces.GetSize() == 1 || (faces.GetSize() == 2 && faces[0] == faces[1]))
        a = b = faces[0], seam = true;
    else
        throw std::invalid_argument("continuity: the edge does not lie between two faces");
    const SmCurve* curve = edge->GetCurve();
    const SmExtent1d interval = edge->GetInterval();
    const double lo = interval.GetMin(), hi = interval.GetMax();
    EdgeContinuity out;
    out.samples = samples;
    out.tolerance = SmTol::GetZoneTol3d(static_cast<const SmObject*>(edge));
    if (curve->Length(interval, 1e-9, out.length) != SM_SUCCESS)
        out.length = 0.0;
    double gap = -1.0, angle = -1.0, jump = -1.0;
    for (int i = 0; i < samples; ++i)
    {
        const double t = lo + (hi - lo) * (i + 0.5) / samples;
        SmVector3d v[2];
        if (curve->Evaluate(t, 1, TRUE, v, FALSE) != SM_SUCCESS)
            throw std::runtime_error("continuity: the edge's curve cannot be evaluated");
        const SmPoint3d p(v[0].x, v[0].y, v[0].z);
        SmPoint2d uv[2];
        if (seam)
        {
            SmTArray<SmPoint2d> all;
            if (!parameters_on(a, p, uv[0], &all) || all.GetSize() < 2)
                throw std::invalid_argument("continuity: the edge does not lie between two faces");
            uv[0] = all[0], uv[1] = all[all.GetSize() - 1];
        }
        else if (!parameters_on(a, p, uv[0]) || !parameters_on(b, p, uv[1]))
            throw std::runtime_error("continuity: a face's point at the edge was not found");
        Derivatives d[2];
        Forms f[2];
        SmVector3d n[2];
        bool curved[2];
        for (int s = 0; s < 2; ++s)
        {
            const SmFace* face = s ? b : a;
            if (!evaluate(face->GetSurface(), uv[s], d[s]) || !outward_normal(face, uv[s], n[s]))
                throw std::runtime_error("continuity: a face cannot be evaluated at the edge");
            n[s] = n[s] * (1.0 / n[s].Length());
            curved[s] = forms(d[s], n[s], f[s]);
        }
        const double g = (d[0].p - d[1].p).Length();
        if (g > gap)
            gap = g, copy3(out.gap_at, v[0]);
        const double c = std::min(1.0, std::max(-1.0, n[0].Dot(n[1])));
        const double ang = std::acos(c) * 180.0 / SM_PI;
        if (ang > angle)
            angle = ang, copy3(out.angle_at, v[0]);
        // the normal curvatures across the edge, tangent to each face
        SmVector3d across = v[1] * n[0];
        double k[2] = {kNaN, kNaN};
        for (int s = 0; s < 2; ++s)
        {
            SmVector3d w = across - n[s] * across.Dot(n[s]);
            if (curved[s] && w.Length() > 0)
                k[s] = normal_curvature(d[s], f[s], w * (1.0 / w.Length()));
        }
        if (std::isfinite(k[0]) && std::isfinite(k[1]))
        {
            const double j = std::fabs(k[0] - k[1]);
            if (j > jump)
                jump = j, copy3(out.jump_at, v[0]);
            out.curvature = std::max({out.curvature, std::fabs(k[0]), std::fabs(k[1])});
        }
    }
    out.gap = std::max(gap, 0.0), out.angle = std::max(angle, 0.0);
    out.jump = jump < 0 ? kNaN : jump;
    if (jump < 0)
        std::copy(out.angle_at, out.angle_at + 3, out.jump_at);
    return out;
}

std::vector<std::vector<double>> edge_outer_angles(const SmBrep* brep, const std::vector<SmEdge*>& edges, int samples)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    samples = std::max(1, std::min(samples, 10000));
    std::vector<std::vector<double>> out;
    for (SmEdge* e : edges)
    {
        if (!e || e->GetBrep() != brep)
            throw std::invalid_argument("edge_outer_angles: an edge is not one of the body's");
        std::vector<double> angles;
        SmTArray<SmFace*> faces;
        e->GetFaces(faces);
        if (faces.GetSize() == 2 && faces[0] != faces[1] && e->IsManifold())
        {
            const SmExtent1d ivl = e->GetInterval();
            for (int i = 0; i < samples; ++i)
            {
                double angle = 0.0;
                const double t = ivl.GetMin() + (ivl.GetMax() - ivl.GetMin()) * (i + 0.5) / samples;
                if (e->CalcOuterAngle(t, angle) == SM_SUCCESS && std::isfinite(angle))
                    angles.push_back(angle * 180.0 / SM_PI);
            }
        }
        out.push_back(angles);
    }
    return out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_face_analysis(py::module_ m)
{
    m.def("face_curvature", [](const SmFace* face, double u, double v) {
        const smlibpy::FaceCurvature r = smlibpy::face_curvature(face, u, v);
        py::dict out;
        auto t = [](const double* x) { return py::make_tuple(x[0], x[1], x[2]); };
        out["point"] = t(r.point), out["normal"] = t(r.normal), out["k1"] = r.k1, out["k2"] = r.k2;
        out["d1"] = t(r.d1), out["d2"] = t(r.d2);
        return out;
    }, py::arg("face"), py::arg("u"), py::arg("v"),
          "Principal curvatures k1 >= k2 (1/length, convex positive) of a face at (u, v), their unit "
          "directions d1 and d2, the point and the outward normal: {point, normal, k1, k2, d1, d2}.");
    m.def("face_min_radius", [](const SmFace* face, int grid) {
        const smlibpy::MinRadius r = smlibpy::face_min_radius(face, grid);
        py::dict out;
        out["radius"] = r.radius, out["point"] = py::make_tuple(r.point[0], r.point[1], r.point[2]);
        out["uv"] = py::make_tuple(r.uv[0], r.uv[1]), out["evaluations"] = r.evaluations;
        return out;
    }, py::arg("face"), py::arg("grid") = 24,
          "The smallest radius of curvature of a face (inf where it does not curve), where it is and how "
          "many points were evaluated: {radius, point, uv, evaluations}.");
    m.def("face_iso_curves", [](const SmFace* face, bool constant_u, double value) {
        py::list out;
        for (SmCurve* c : smlibpy::face_iso_curves(face, constant_u, value))
            out.append(py::cast(c, py::return_value_policy::take_ownership));
        return out;
    }, py::arg("face"), py::arg("constant_u"), py::arg("value"),
          "The curves of constant u (or v) of a face's surface, clipped to the face: standalone curves.");
    m.def("edge_continuity", [](const SmEdge* edge, int samples) {
        const smlibpy::EdgeContinuity r = smlibpy::edge_continuity(edge, samples);
        py::dict out;
        auto t = [](const double* x) { return py::make_tuple(x[0], x[1], x[2]); };
        out["samples"] = r.samples, out["gap"] = r.gap, out["angle"] = r.angle, out["jump"] = r.jump;
        out["curvature"] = r.curvature, out["tolerance"] = r.tolerance, out["length"] = r.length;
        out["gap_at"] = t(r.gap_at), out["angle_at"] = t(r.angle_at), out["jump_at"] = t(r.jump_at);
        return out;
    }, py::arg("edge"), py::arg("samples") = 16,
          "How the two faces of an edge meet at `samples` points along it: the largest gap, normal angle "
          "(degrees) and jump of the normal curvatures across the edge (NaN where no face curves), the "
          "largest normal curvature across it, and where each is largest.");
    m.def("edge_outer_angles", &smlibpy::edge_outer_angles, py::arg("brep"), py::arg("edges"), py::arg("samples") = 5,
          "The kernel's outer angle (degrees) of each edge at `samples` points along it ([] where the edge "
          "does not lie between two faces of a solid).");
}
#endif  // SMLIBPY_PYTHON
