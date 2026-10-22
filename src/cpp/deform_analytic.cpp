// SPDX-License-Identifier: Apache-2.0
//
// Analytic images for deform.cpp (see deform_analytic.h).
//
// deform.cpp fits every deformed face and edge with a NURBS that keeps the parameters of the
// original, which keeps the trim curves valid. Where the exact image is analytic, that loses the
// type: a plate bent about an axis has cylinders there, a tapered cylinder is a cone, the turned
// end of a twisted bar is a plane, and a face the map leaves in place is what it was. Here the
// exact map is sampled on the original geometry, and an image counts as analytic when every
// sample lies on the candidate within the exact tolerance:
//   * a similarity on the face or edge (a rigid motion and a uniform scale, the identity too):
//     the original geometry, moved; the parameters are kept;
//   * a cone or cylinder about the image of the original's axis, as a taper makes of a
//     cylinder: built like the original (angles, flags) and checked at the same parameters;
//   * otherwise a plane, or a cylinder or cone about a candidate axis (the bend's, the twist's,
//     the image of the original's), or a line or circle for an edge: new geometry with new
//     parameters. The trim curves of the faces it touches are dropped onto it again, as the
//     kernel does after a Boolean (swap_in). Faces with a seam keep their fitted surface: a new
//     seam would not lie where the old one was.

#include "deform_analytic.h"

#include <SmApiGeneral.h>
#include <SmApiQueries.h>

#include <algorithm>
#include <cmath>
#include <type_traits>
#include <unordered_set>

namespace smlibpy::analytic {
namespace {

constexpr double kPi = 3.14159265358979323846;

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

SmVector3d unit(const SmVector3d& v)
{
    const double n = v.Length();
    return n > 0.0 ? v / n : v;
}

// A 3 x 3 matrix by its rows.
struct Mat3
{
    SmVector3d row[3];
    SmVector3d operator()(const SmVector3d& v) const { return SmVector3d(row[0].Dot(v), row[1].Dot(v), row[2].Dot(v)); }
    SmVector3d column(ULONG j) const { return SmVector3d(row[0][j], row[1][j], row[2][j]); }
};

// p -> s R p + t
struct Similarity
{
    Mat3 r;
    double s = 1.0;
    SmVector3d t;
    SmPoint3d operator()(const SmPoint3d& p) const { return s * r(p) + t; }
};

double extent(const std::vector<SmPoint3d>& p)
{
    double e = 0.0;
    for (const SmPoint3d& x : p)
        e = std::max(e, x.DistanceBetween(p[0]));
    return e;
}

// Indices of three samples that span a plane: the first, the one farthest from it and the one
// farthest from their line. False when the samples lie (nearly) on a line.
bool spread(const std::vector<SmPoint3d>& p, size_t idx[3])
{
    if (p.size() < 3)
        return false;
    idx[0] = 0;
    double best = -1.0;
    for (size_t i = 1; i < p.size(); ++i)
    {
        const double d = p[i].DistanceBetween(p[0]);
        if (d > best)
            best = d, idx[1] = i;
    }
    const double size = best;
    if (!(size > 0.0))
        return false;
    const SmVector3d e = unit(p[idx[1]] - p[0]);
    best = -1.0;
    for (size_t i = 1; i < p.size(); ++i)
    {
        const SmVector3d v = p[i] - p[0];
        const double d = (v - e.Dot(v) * e).Length();
        if (d > best)
            best = d, idx[2] = i;
    }
    return best > 1e-3 * size;
}

// An orthonormal frame (rows) from three points: along the first edge, then toward the third.
Mat3 frame(const SmPoint3d& a, const SmPoint3d& b, const SmPoint3d& c)
{
    Mat3 m;
    m.row[0] = unit(b - a);
    const SmVector3d w = c - a;
    m.row[1] = unit(w - m.row[0].Dot(w) * m.row[0]);
    m.row[2] = m.row[0] * m.row[1];
    return m;
}

// The similarity (proper rotation, positive scale) that maps the samples p to q within tol.
bool similarity(const std::vector<SmPoint3d>& p, const std::vector<SmPoint3d>& q, double tol, Similarity& out)
{
    size_t idx[3];
    if (!spread(p, idx))
        return false;
    const Mat3 e = frame(p[idx[0]], p[idx[1]], p[idx[2]]);
    const Mat3 f = frame(q[idx[0]], q[idx[1]], q[idx[2]]);
    // R e_i = f_i for the frame vectors: R = sum_i f_i e_i^T
    for (ULONG j = 0; j < 3; ++j)
    {
        SmVector3d row(0.0, 0.0, 0.0);
        for (ULONG i = 0; i < 3; ++i)
            row = row + f.row[i][j] * e.row[i];
        out.r.row[j] = row;
    }
    const double dp = p[idx[1]].DistanceBetween(p[idx[0]]);
    out.s = q[idx[1]].DistanceBetween(q[idx[0]]) / dp;
    if (!(out.s > 0.0))
        return false;
    out.t = q[idx[0]] - out.s * out.r(p[idx[0]]);
    for (size_t k = 0; k < p.size(); ++k)
        if (out(p[k]).DistanceBetween(q[k]) > tol)
            return false;
    return true;
}

// Move a copy of a surface or curve by a similarity. Null if the kernel cannot.
template <class Geometry>
Geometry* moved_copy(const Geometry* g, const Similarity& sim)
{
    Geometry* copy = nullptr;
    if (g->Copy(ctx(), copy) != SM_SUCCESS || copy == nullptr)
        return nullptr;
    const SmAxis2Placement place(SmPoint3d(sim.t), sim.r.column(0), sim.r.column(1));
    SmStatus status = SM_SUCCESS;
    if (std::abs(sim.s - 1.0) <= 1e-14)
        status = copy->Transform(place);
    else
    {
        const SmVector3d scale(sim.s, sim.s, sim.s);
        status = copy->Transform(place, &scale);
    }
    if (status != SM_SUCCESS)
    {
        delete copy;
        return nullptr;
    }
    return copy;
}

// The NURBS data of new analytic geometry, built at once: the kernel's lines, arcs and planes
// build it only when asked, and SmPlane::DropCurve copies a curve and reads it (see
// sheetmetal.cpp). False (and the geometry deleted) if it cannot be built.
template <class Geometry>
bool with_nurbs(Geometry*& g)
{
    if (!g)
        return false;
    bool ok = true;
    if constexpr (std::is_same_v<Geometry, SmCurve>)
        ok = !g->IsKindOf(SmBSplineCurve_TYPE) || static_cast<SmBSplineCurve*>(g)->GetOrCreateGwNurbPointer();
    else
        ok = !g->IsKindOf(SmBSplineSurface_TYPE) || static_cast<SmBSplineSurface*>(g)->GetOrCreateGwNurbPointer();
    if (!ok)
    {
        delete g;
        g = nullptr;
    }
    return ok;
}

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

struct Grid
{
    std::vector<SmPoint2d> uv;
    std::vector<SmPoint3d> p, q;  // on the original, and mapped
};

Grid grid(const SmSurface* s, const SmExtent2d& box, const Map& map, int n)
{
    Grid g;
    for (int a = 0; a < n; ++a)
        for (int b = 0; b < n; ++b)
        {
            const SmPoint2d uv(box.GetUMin() + a * (box.GetUMax() - box.GetUMin()) / (n - 1),
                               box.GetVMin() + b * (box.GetVMax() - box.GetVMin()) / (n - 1));
            SmPoint3d p;
            if (s->EvaluatePoint(uv, p) != SM_SUCCESS)
                continue;
            g.uv.push_back(uv);
            g.p.push_back(p);
            g.q.push_back(map(p));
        }
    return g;
}

bool inside(const SmFace* face, const SmPoint2d& uv)
{
    int cls = SM_PC_UNKNOWN;
    return SmApiFaceClassifyUV(face, uv, cls) == SM_SUCCESS && cls != SM_PC_UNKNOWN;
}

// The images of points along a face's edges; false if the face has a seam (an edge it uses
// twice) or an edge without a curve.
bool boundary(SmFace* face, const Map& map, std::vector<SmPoint3d>& out)
{
    SmFaceuse* fu = face->GetUpwardFaceuse();
    if (!fu)
        return false;
    SmTArray<SmEdgeuse*> eus;
    fu->GetEdgeuses(eus);
    std::unordered_set<const SmEdge*> seen;
    for (ULONG i = 0; i < eus.GetSize(); ++i)
    {
        SmEdge* edge = eus[i]->GetEdge();
        if (!edge || !seen.insert(edge).second)
            return false;
        const SmCurve* c = edge->GetCurve();
        if (!c)
            return false;
        const SmExtent1d ivl = edge->GetInterval();
        for (int k = 0; k <= 8; ++k)
        {
            SmPoint3d p;
            if (c->EvaluatePoint(ivl.Evaluate(k / 8.0), p) != SM_SUCCESS)
                return false;
            out.push_back(map(p));
        }
    }
    return !out.empty();
}

// The normal of the image surface at a sample inside the face (central differences of the
// mapped surface), and the image point there. False if there is no such sample.
bool image_normal(SmFace* face, const SmSurface* s, const SmExtent2d& box, const Map& map, SmPoint3d& at,
                  SmVector3d& normal)
{
    const double du = box.GetUMax() - box.GetUMin(), dv = box.GetVMax() - box.GetVMin();
    const int n = 9;
    bool found = false;
    double best = SM_BIG_DOUBLE;
    SmPoint2d pick(0.0, 0.0);
    for (int a = 1; a < n - 1; ++a)
        for (int b = 1; b < n - 1; ++b)
        {
            const SmPoint2d uv(box.GetUMin() + a * du / (n - 1), box.GetVMin() + b * dv / (n - 1));
            const double off = std::abs(a - (n - 1) / 2.0) + std::abs(b - (n - 1) / 2.0);
            if (off < best && inside(face, uv))
                best = off, pick = uv, found = true;
        }
    if (!found)
    {
        // a thin face between the grid points: the kernel's point inside it
        SmPoint3d p;
        SmBoolean ok = FALSE, multi = FALSE;
        double gap = 0.0;
        if (SmApiFaceInternalPoint(face, p) != SM_SUCCESS ||
            s->DropPoint(p, box, nullptr, ok, pick, gap, multi) != SM_SUCCESS || !ok)
            return false;
    }
    const double hu = 1e-6 * du, hv = 1e-6 * dv;
    SmPoint3d a, b, c, d, m;
    if (s->EvaluatePoint(SmPoint2d(pick.x + hu, pick.y), a) != SM_SUCCESS ||
        s->EvaluatePoint(SmPoint2d(pick.x - hu, pick.y), b) != SM_SUCCESS ||
        s->EvaluatePoint(SmPoint2d(pick.x, pick.y + hv), c) != SM_SUCCESS ||
        s->EvaluatePoint(SmPoint2d(pick.x, pick.y - hv), d) != SM_SUCCESS || s->EvaluatePoint(pick, m) != SM_SUCCESS)
        return false;
    normal = unit((map(a) - map(b)) * (map(c) - map(d)));
    at = map(m);
    return normal.Length() > 0.5;
}

// Whether a surface's normal at the point nearest `at` points along `normal`.
bool agrees(const SmSurface* s, const SmPoint3d& at, const SmVector3d& normal)
{
    SmBoolean ok = FALSE, multi = FALSE;
    SmPoint2d uv;
    double gap = 0.0;
    if (s->DropPoint(at, s->GetNaturalUVDomain(), nullptr, ok, uv, gap, multi) != SM_SUCCESS || !ok)
        return false;
    SmVector3d n;
    if (s->EvaluateNormal(uv, TRUE, TRUE, n) != SM_SUCCESS)
        return false;
    return n.Dot(normal) > 0.5;
}

// The largest distance between a surface and the samples at the same parameters.
double same_param_error(const SmSurface* s, const Grid& g)
{
    double err = 0.0;
    for (size_t k = 0; k < g.uv.size(); ++k)
    {
        SmPoint3d p;
        if (s->EvaluatePoint(g.uv[k], p) != SM_SUCCESS)
            return SM_BIG_DOUBLE;
        err = std::max(err, p.DistanceBetween(g.q[k]));
    }
    return err;
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

// A cylinder (rb == rt) or cone from its bottom circle's center and frame, the radii there and
// at `height` along the axis, and the angles (degrees) it spans. Null if the kernel refuses.
SmBSplineSurface* make_cone(const SmPoint3d& bottom, const SmVector3d& x, const SmVector3d& y, double rb, double rt,
                            double a0, double a1, double height, SmBoolean swap, SmBoolean inside_out, bool cylinder)
{
    if (cylinder)
        return new (ctx()) SmCylinder(bottom, x, y, 0.5 * (rb + rt), a0, a1, height, swap, inside_out, FALSE, &ctx());
    SmCone* cone = nullptr;
    if (SmCone::CreateCanonical(ctx(), SmAxis2Placement(bottom, x, y), rb, rt, height, cone, swap, inside_out) !=
            SM_SUCCESS ||
        cone == nullptr)
        return nullptr;
    if ((a0 != 0.0 || a1 != 360.0) &&
        cone->AdjustSTEPUVDomain(SmExtent2d(SmPoint2d(a0, 0.0), SmPoint2d(a1, height))) != SM_SUCCESS)
    {
        delete cone;
        return nullptr;
    }
    return cone;
}

// A cone or cylinder like an original one (angles, flags, parameters) about the image of its
// axis, when the map takes it to one (a taper, a scale across the axis). It spans the part of the
// original's axis the face uses (`box`), so that a taper ending inside a cylinder does not reach
// the cone's apex.
SmSurface* cone_like(const SmSurface* s, const SmExtent2d& box, const Grid& g, const Map& map, double tol)
{
    if (!s->IsKindOf(SmCone_TYPE))
        return nullptr;
    const SmCone* cone = static_cast<const SmCone*>(s);
    SmAxis2Placement a;
    double r0 = 0.0, semi = 0.0;
    SmBoolean swap = FALSE, inside_out = FALSE;
    if (cone->GetCanonical(a, r0, semi, &swap, &inside_out) != SM_SUCCESS)
        return nullptr;
    const SmPoint3d o = a.GetOriginRef();
    const SmVector3d x = unit(a.GetXAxisRef()), y = unit(a.GetYAxisRef());
    const SmVector3d z = unit(x * y);
    const SmExtent2d step = cone->GetSTEPUVDomain();  // degrees, distance along the axis
    const SmExtent2d nat = s->GetNaturalUVDomain();
    // the face's ends along the axis: the box's ends in the surface's straight direction
    const double um = 0.5 * (box.GetUMin() + box.GetUMax()), vm = 0.5 * (box.GetVMin() + box.GetVMax());
    SmPoint3d pa, pb;
    const SmPoint2d ua = swap ? SmPoint2d(box.GetUMin(), vm) : SmPoint2d(um, box.GetVMin());
    const SmPoint2d ub = swap ? SmPoint2d(box.GetUMax(), vm) : SmPoint2d(um, box.GetVMax());
    if (s->EvaluatePoint(ua, pa) != SM_SUCCESS || s->EvaluatePoint(ub, pb) != SM_SUCCESS)
        return nullptr;
    const double ha = (pa - o).Dot(z), hb = (pb - o).Dot(z);
    const double v0 = std::min(ha, hb), v1 = std::max(ha, hb);
    const double slope = std::tan(semi * kPi / 180.0);
    const SmPoint3d c0 = map(o + v0 * z), c1 = map(o + v1 * z);
    const SmPoint3d e0 = map(o + v0 * z + (r0 + v0 * slope) * x), e1 = map(o + v1 * z + (r0 + v1 * slope) * x);
    const double height = c1.DistanceBetween(c0);
    if (!(height > tol))
        return nullptr;
    const SmVector3d zz = (c1 - c0) / height;
    const SmVector3d xb = e0 - c0, xt = e1 - c1;
    const double rb = xb.Length(), rt = xt.Length();
    if (!(rb > tol) || !(rt > tol) || std::abs(xb.Dot(zz)) > tol || std::abs(xt.Dot(zz)) > tol)
        return nullptr;
    const SmVector3d xx = xb / rb;
    if ((xt / rt - xx).Length() * rt > tol)
        return nullptr;  // the map turns the cross-sections: not the same angles
    const SmVector3d yy = zz * xx;
    SmBSplineSurface* out = make_cone(c0, xx, yy, rb, rt, step.GetUMin(), step.GetUMax(), height, swap, inside_out,
                                      std::abs(rb - rt) <= tol);
    if (!out)
        return nullptr;
    // the original's parameters: all of its turn, the box along the axis
    const SmExtent2d want = swap ? SmExtent2d(SmPoint2d(box.GetUMin(), nat.GetVMin()), SmPoint2d(box.GetUMax(), nat.GetVMax()))
                                 : SmExtent2d(SmPoint2d(nat.GetUMin(), box.GetVMin()), SmPoint2d(nat.GetUMax(), box.GetVMax()));
    const SmExtent2d mine = out->GetNaturalUVDomain();
    if ((mine.GetMin() - want.GetMin()).Length() > 1e-12 * (1.0 + want.GetMaxDimension()) ||
        (mine.GetMax() - want.GetMax()).Length() > 1e-12 * (1.0 + want.GetMaxDimension()))
        out->Reparameterize(want);
    if (same_param_error(out, g) > tol)
    {
        delete out;
        return nullptr;
    }
    return out;
}

// A plane through points, if they lie on one within tol: a point on it and its unit normal.
bool fit_plane(const std::vector<SmPoint3d>& pts, double tol, SmPoint3d& origin, SmVector3d& normal)
{
    size_t idx[3];
    if (!spread(pts, idx))
        return false;
    normal = unit((pts[idx[1]] - pts[idx[0]]) * (pts[idx[2]] - pts[idx[0]]));
    origin = pts[idx[0]];
    for (const SmPoint3d& p : pts)
        if (std::abs((p - origin).Dot(normal)) > tol)
            return false;
    return true;
}

// Points at a distance from an axis that changes linearly along it (a cylinder or a cone about
// it): the distance at axial positions h is a + b h.
bool fit_revolved(const std::vector<SmPoint3d>& pts, const Line3& axis, double tol, double& a, double& b)
{
    const size_t n = pts.size();
    if (n < 3)
        return false;
    std::vector<double> h(n), r(n);
    double sh = 0, sr = 0, shh = 0, shr = 0;
    for (size_t k = 0; k < n; ++k)
    {
        const SmVector3d v = pts[k] - axis.origin;
        h[k] = v.Dot(axis.direction);
        r[k] = (v - h[k] * axis.direction).Length();
        sh += h[k], sr += r[k], shh += h[k] * h[k], shr += h[k] * r[k];
    }
    const double det = n * shh - sh * sh;
    if (det > 1e-12 * (1.0 + shh) * n)
    {
        b = (n * shr - sh * sr) / det;
        a = (sr - b * sh) / n;
    }
    else
        b = 0.0, a = sr / n;
    for (size_t k = 0; k < n; ++k)
        if (std::abs(r[k] - (a + b * h[k])) > tol)
            return false;
    return true;
}

// (start, span) in radians of the shortest arc that covers the angles.
std::pair<double, double> arc_span(std::vector<double> angles)
{
    for (double& x : angles)
        x = std::fmod(std::fmod(x, 2 * kPi) + 2 * kPi, 2 * kPi);
    std::sort(angles.begin(), angles.end());
    const size_t n = angles.size();
    double gap = -1.0;
    size_t at = 0;
    for (size_t i = 0; i < n; ++i)
    {
        const double next = i + 1 < n ? angles[i + 1] : angles[0] + 2 * kPi;
        if (next - angles[i] > gap)
            gap = next - angles[i], at = i;
    }
    const double start = at + 1 < n ? angles[at + 1] : angles[0];
    return {start, 2 * kPi - gap};
}

// A new plane, cylinder or cone through the image samples, oriented like the image.
SmSurface* new_surface(const std::vector<SmPoint3d>& shape, const std::vector<SmPoint3d>& ext,
                       const std::vector<Line3>& axes, const SmPoint3d& at, const SmVector3d& normal, double tol)
{
    const double size = std::max(extent(ext), 1.0);
    const double margin = 1e-7 * size;
    SmPoint3d origin;
    SmVector3d n;
    if (fit_plane(shape, tol, origin, n))
    {
        if (n.Dot(normal) < 0.0)
            n = -n;
        const SmVector3d x = unit(std::abs(n.x) < 0.9 ? SmVector3d(1, 0, 0) * n : SmVector3d(0, 1, 0) * n);
        const SmVector3d y = n * x;
        SmExtent2d dom;
        for (const SmPoint3d& p : ext)
            dom.AddPoint2d(SmPoint2d((p - origin).Dot(x), (p - origin).Dot(y)));
        dom.ExpandAbsolute(margin);
        return new (ctx()) SmPlane(origin, x, y, SmVector2d(1.0, 1.0), dom, &ctx());
    }
    for (const Line3& axis : axes)
    {
        double a = 0.0, b = 0.0;
        if (!fit_revolved(shape, axis, tol, a, b))
            continue;
        const SmVector3d z = axis.direction;
        double h0 = SM_BIG_DOUBLE, h1 = -SM_BIG_DOUBLE;
        std::vector<double> angles;
        const SmVector3d any = ext[0] - axis.origin;
        const SmVector3d x0 = unit(any - any.Dot(z) * z);
        const SmVector3d y0 = z * x0;
        for (const SmPoint3d& p : ext)
        {
            const SmVector3d v = p - axis.origin;
            const double h = v.Dot(z);
            h0 = std::min(h0, h), h1 = std::max(h1, h);
            angles.push_back(std::atan2(v.Dot(y0), v.Dot(x0)));
        }
        const auto [start, span] = arc_span(angles);
        if (!(span > 1e-9) || span > 2 * kPi - 1e-6 || !(h1 - h0 > tol))
            continue;
        h0 -= margin, h1 += margin;
        const double rb = a + b * h0, rt = a + b * h1;
        if (!(rb > tol) || !(rt > tol))
            continue;  // the apex: not a face of a cone here
        const double pad = std::min(margin / std::min(rb, rt), 1e-6);
        const double first = std::max(start - pad, start - 0.5 * (2 * kPi - span));
        const SmVector3d x = std::cos(first) * x0 + std::sin(first) * y0;
        const SmVector3d y = z * x;
        const double sweep = std::min((span + 2 * pad) * 180.0 / kPi, 360.0);
        const SmPoint3d bottom = axis.origin + h0 * z;
        // outward (away from the axis) unless the image points inward
        const SmVector3d radial = unit((at - axis.origin) - (at - axis.origin).Dot(z) * z);
        const SmBoolean inside_out = radial.Dot(normal) < 0.0 ? TRUE : FALSE;
        return make_cone(bottom, x, y, rb, rt, 0.0, sweep, h1 - h0, FALSE, inside_out, std::abs(rb - rt) <= tol);
    }
    return nullptr;
}

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

double curve_error(const SmCurve* c, const std::vector<double>& t, const std::vector<SmPoint3d>& q)
{
    double err = 0.0;
    for (size_t k = 0; k < t.size(); ++k)
    {
        SmPoint3d p;
        if (c->EvaluatePoint(t[k], p) != SM_SUCCESS)
            return SM_BIG_DOUBLE;
        err = std::max(err, p.DistanceBetween(q[k]));
    }
    return err;
}

// A circle through the points (in their order), if they lie on one within tol.
SmCurve* new_circle(const std::vector<SmPoint3d>& q, double tol)
{
    size_t idx[3];
    if (!spread(q, idx))
        return nullptr;
    // the circumcenter of three of them
    const SmPoint3d a = q[idx[0]], b = q[idx[1]], c = q[idx[2]];
    const SmVector3d ab = b - a, ac = c - a;
    const SmVector3d n = ab * ac;
    const double nn = n.Dot(n);
    if (!(nn > 0.0))
        return nullptr;
    const SmPoint3d center = a + ((ab.Dot(ab)) * (ac * n) + (ac.Dot(ac)) * (n * ab)) / (2.0 * nn);
    const double r = center.DistanceBetween(a);
    const SmVector3d z0 = unit(n);
    for (const SmPoint3d& p : q)
        if (std::abs(p.DistanceBetween(center) - r) > tol || std::abs((p - center).Dot(z0)) > tol)
            return nullptr;
    // the direction of travel
    const SmVector3d x = unit(q.front() - center);
    SmVector3d z = z0;
    if (((q[1] - center) * (q.front() - center)).Dot(z) > 0.0)
        z = -z;
    const SmVector3d y = z * x;
    double last = 0.0, sweep = 0.0;
    for (size_t k = 1; k < q.size(); ++k)
    {
        const SmVector3d v = q[k] - center;
        double ang = std::atan2(v.Dot(y), v.Dot(x));
        if (ang < 0.0)
            ang += 2 * kPi;
        if (k + 1 == q.size() && ang < 1e-9)
            ang = 2 * kPi;  // closed
        if (ang + 1e-9 < last)
            return nullptr;  // not monotonic
        last = ang;
        sweep = ang;
    }
    if (!(sweep > 1e-9))
        return nullptr;
    return new (ctx()) SmCircle(center, x, y, SmExtent1d(0.0, sweep * 180.0 / kPi), r, 3, &ctx());
}

}  // namespace

SurfaceImage surface_image(SmFace* face, const SmExtent2d& box, const Map& map, const std::vector<Line3>& axes,
                           double tol)
{
    const SmSurface* s = face->GetSurface();
    if (!s || !(box.GetUMax() > box.GetUMin()) || !(box.GetVMax() > box.GetVMin()))
        return {};
    const Grid g = grid(s, box, map, 7);
    if (g.uv.size() < 9)
        return {};

    // the same parameters: a similarity, or a cone or cylinder like the original
    Similarity sim;
    if (similarity(g.p, g.q, tol, sim))
    {
        SmSurface* copy = moved_copy(s, sim);
        if (copy && same_param_error(copy, g) <= tol && with_nurbs(copy))
            return {copy, true};
        delete copy;
    }
    if (SmSurface* like = cone_like(s, box, g, map, tol); with_nurbs(like))
        return {like, true};

    // new parameters: a plane, a cylinder or a cone (faces without a seam)
    std::vector<SmPoint3d> edge_points;
    if (!boundary(face, map, edge_points))
        return {};
    SmPoint3d at;
    SmVector3d normal;
    if (!image_normal(face, s, box, map, at, normal))
        return {};
    std::vector<SmPoint3d> shape = g.q;
    shape.insert(shape.end(), edge_points.begin(), edge_points.end());
    std::vector<SmPoint3d> ext = edge_points;
    for (size_t k = 0; k < g.uv.size(); ++k)
        if (inside(face, g.uv[k]))
            ext.push_back(g.q[k]);
    std::vector<Line3> candidates = axes;
    if (s->IsKindOf(SmCone_TYPE) || s->IsKindOf(SmSphere_TYPE) || s->IsKindOf(SmTorus_TYPE))
    {
        // the image of the original's axis, where it is a line
        SmAxis2Placement a;
        bool ok = false;
        if (s->IsKindOf(SmCone_TYPE))
        {
            double r = 0.0, semi = 0.0;
            SmBoolean swap = FALSE, inside_out = FALSE;
            ok = static_cast<const SmCone*>(s)->GetCanonical(a, r, semi, &swap, &inside_out) == SM_SUCCESS;
        }
        else if (s->IsKindOf(SmSphere_TYPE))
        {
            double r = 0.0;
            SmBoolean swap = FALSE, inside_out = FALSE;
            ok = static_cast<const SmSphere*>(s)->GetCanonical(a, r, &swap, &inside_out) == SM_SUCCESS;
        }
        else
        {
            double big = 0.0, small = 0.0;
            SmBoolean swap = FALSE, inside_out = FALSE;
            ok = static_cast<const SmTorus*>(s)->GetCanonical(a, big, small, &swap, &inside_out) == SM_SUCCESS;
        }
        if (ok)
        {
            const SmVector3d z = unit(a.GetXAxisRef() * a.GetYAxisRef());
            const double len = std::max(extent(g.p), 1.0);
            const SmPoint3d o = a.GetOriginRef();
            const SmPoint3d m0 = map(o), m1 = map(o + len * z), mh = map(o + 0.5 * len * z);
            const SmVector3d d = unit(m1 - m0);
            const SmVector3d off = mh - m0;
            if ((off - off.Dot(d) * d).Length() <= tol)
                candidates.push_back({m0, d});
        }
    }
    SmSurface* fresh = new_surface(shape, ext, candidates, at, normal, tol);
    if (!with_nurbs(fresh))
        return {};
    if (!agrees(fresh, at, normal))
    {
        delete fresh;
        return {};
    }
    return {fresh, false};
}

CurveImage curve_image(SmEdge* edge, const Map& map, double tol)
{
    const SmCurve* c = edge->GetCurve();
    if (!c)
        return {};
    return curve_image(c, edge->GetInterval(), map, tol);
}

CurveImage curve_image(const SmCurve* c, const SmExtent1d& ivl, const Map& map, double tol)
{
    const double ta = ivl.GetMin(), tb = ivl.GetMax();
    if (!(tb > ta))
        return {};
    const int n = 16;
    std::vector<double> t;
    std::vector<SmPoint3d> p, q;
    for (int k = 0; k <= n; ++k)
    {
        const double tk = ivl.Evaluate(static_cast<double>(k) / n);
        SmPoint3d pk;
        if (c->EvaluatePoint(tk, pk) != SM_SUCCESS)
            return {};
        t.push_back(tk), p.push_back(pk), q.push_back(map(pk));
    }
    const SmVector3d d = q.back() - q.front();
    const double len = d.Length();

    // a line with the same parameters
    if (len > tol)
    {
        bool affine = true;
        for (int k = 0; k <= n && affine; ++k)
            affine = (q.front() + ((t[k] - ta) / (tb - ta)) * d).DistanceBetween(q[k]) <= tol;
        if (affine)
        {
            const double scale = len / (tb - ta);
            const SmVector3d u = d / len;
            SmCurve* line = new (ctx()) SmLine(q.front() - (ta * scale) * u, u, SmExtent1d(ta, tb), scale, 3, &ctx());
            if (with_nurbs(line))
            {
                if (curve_error(line, t, q) > tol)
                    line->EditParameterization(SmExtent1d(ta, tb));
                if (curve_error(line, t, q) <= tol)
                    return {line, true};
                delete line;
            }
        }
    }
    // a moved copy
    Similarity sim;
    if (similarity(p, q, tol, sim))
    {
        SmCurve* copy = moved_copy(c, sim);
        if (copy && curve_error(copy, t, q) <= tol && with_nurbs(copy))
            return {copy, true};
        delete copy;
    }
    // a new line or circle
    if (len > tol)
    {
        const SmVector3d u = d / len;
        bool straight = true;
        double last = -1.0;
        for (const SmPoint3d& x : q)
        {
            const SmVector3d v = x - q.front();
            const double along = v.Dot(u);
            straight = straight && (v - along * u).Length() <= tol && along >= last - tol;
            last = along;
        }
        SmCurve* line = straight ? new (ctx()) SmLine(q.front(), q.back(), 3, &ctx()) : nullptr;
        if (with_nurbs(line))
            return {line, false};
    }
    if (SmCurve* circle = new_circle(q, tol); with_nurbs(circle))
        return {circle, false};
    return {};
}

bool swap_in(SmBrep& brep, const std::vector<std::pair<SmFace*, SmSurface*>>& faces,
             const std::vector<std::pair<SmEdge*, SmCurve*>>& edges, double gap, double drop_tol)
{
    std::vector<SmFace*> touched;
    std::unordered_set<SmFace*> seen;
    bool ok = true;
    for (const auto& [face, surface] : faces)
    {
        if (!ok || brep.ReplaceSurface(face, surface, FALSE, nullptr, FALSE) != SM_SUCCESS)
        {
            if (surface->GetOwner() == nullptr)
                delete surface;
            ok = false;
            continue;
        }
        face->SetIsRectangularTrim(FALSE);
        if (seen.insert(face).second)
            touched.push_back(face);
    }
    for (const auto& [edge, curve] : edges)
    {
        if (!ok || brep.ReplaceCurve(edge, curve) != SM_SUCCESS)
        {
            if (curve->GetOwner() == nullptr)
                delete curve;
            ok = false;
            continue;
        }
        SmTArray<SmFace*> fs;
        edge->GetFaces(fs);
        for (ULONG k = 0; k < fs.GetSize(); ++k)
            if (seen.insert(fs[k]).second)
                touched.push_back(fs[k]);
    }
    if (!ok)
        return false;
    // The kernel drops an edge onto a surface within the edge's tolerance: the trim curves are
    // built with a tight one (the samples' tolerance), then the edges get theirs back.
    std::vector<std::pair<SmEdge*, double>> tolerances;
    std::unordered_set<const SmEdge*> listed;
    for (SmFace* face : touched)
    {
        SmTArray<SmEdge*> es;
        face->GetEdges(es);
        for (ULONG k = 0; k < es.GetSize(); ++k)
            if (listed.insert(es[k]).second)
                tolerances.emplace_back(es[k], static_cast<double>(es[k]->GetTolerance()));
    }
    for (const auto& [edge, old] : tolerances)
        edge->SetTolerance(std::min(old, drop_tol), FALSE, FALSE);
    bool built = true;
    for (SmFace* face : touched)
    {
        double mean = 0.0, worst = 0.0, mean_v = 0.0, worst_v = 0.0, mean_uv = 0.0, worst_uv = 0.0;
        const SmStatus st =
            face->CreateUVTrimCurves(FALSE, nullptr, nullptr, mean, worst, mean_v, worst_v, mean_uv, worst_uv);
        if (st != SM_SUCCESS || !(worst <= gap) || !(worst_v <= gap))
        {
            built = false;
            break;
        }
    }
    for (const auto& [edge, old] : tolerances)
        edge->SetTolerance(old, FALSE, FALSE);
    return built;
}

}  // namespace smlibpy::analytic
