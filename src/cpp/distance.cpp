// SPDX-License-Identifier: Apache-2.0
//
// The nearest points of two bodies (`smlibpy._core.ext`):
//
//   nearest_points(a, b, near_a)   from a point near body a: the nearest points on a and b
//   nearest_curve_points(body, curve, t0, t1, near_t)
//                                  the same for a body and a curve over [t0, t1]
//   nearest_point(body, point)     the point of a body nearest to a point
//
// Closest points taken in turn on either body (alternating projections) settle at a pair of
// nearest points, but slowly where the two surfaces are nearly parallel: each round gains a
// fraction of what is left that goes to zero with the angle between them. Two skew cylinders 2
// apart at 5 degrees were still 2.4845 apart after 500 rounds, and Part.distance_to returned that.
// Here, once the closest points lie on two faces (or on a face and an edge, or on two edges),
// Newton's method minimizes the squared distance over the parameters of both, damped as in
// Levenberg-Marquardt so that every step it takes gains, for as long as the parameters stay on
// their faces and edges. Where they would leave them (a nearest point on a boundary), or Newton
// stalls, a round of closest points finds the next pair of faces, and Newton goes on from there.

#include "kernel.h"
#include "distance.h"

#include <SmApiGeneral.h>
#include <SmApiQueries.h>
#include <SmTopologySolver.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace
{

// A point on a body: on a face (two parameters), on an edge (one) or at a vertex (none); or a
// point on a curve over an interval (one parameter).
struct Spot
{
    const SmFace* face = nullptr;
    const SmSurface* surface = nullptr;  // a surface over a box of its parameters (no face)
    double box[4] = {0.0, 0.0, 0.0, 0.0};  // u0, u1, v0, v1
    const SmEdge* edge = nullptr;
    const SmVertex* vertex = nullptr;
    const SmCurve* curve = nullptr;  // the edge's curve, or the curve itself
    double lo = 0.0, hi = 0.0;       // the curve's interval
    int n = 0;
    double t[2] = {0.0, 0.0};
    SmPoint3d p;
};

// What the nearest points are taken on: a body, or a curve over [lo, hi].
struct Target
{
    const SmBrep* brep = nullptr;
    const SmCurve* curve = nullptr;
    double lo = 0.0, hi = 0.0;
};

// The point of a body nearest to q, and what it lies on.
bool locate(const SmBrep* brep, const SmPoint3d& q, Spot& spot)
{
    SmSolutionArray solutions;
    if (SmTopologySolver::BrepPointSolve(brep, q, SM_SO_MINIMIZE, SM_SR_SINGLE, SM_ZONE_TOL_3D, 1.0e40, nullptr,
                                         solutions) != SM_SUCCESS ||
        solutions.GetSize() < 1)
        return false;
    const SmSolution& solution = solutions[0];
    Spot found;
    SmPoint3d parameters(0, 0, 0);
    if (solution.GetPoint(0, found.p, &parameters) != SM_SUCCESS)
        return false;
    SmObject* object = solution.m_apObjects[0];
    if (const SmFace* face = SM_CAST_PTR(SmFace, object))
    {
        found.face = face, found.n = 2;
        found.t[0] = parameters.x, found.t[1] = parameters.y;
    }
    else if (const SmEdge* edge = SM_CAST_PTR(SmEdge, object))
    {
        found.edge = edge, found.n = 1;
        found.curve = edge->GetCurve();
        const SmExtent1d interval = edge->GetInterval();
        found.lo = interval.GetMin(), found.hi = interval.GetMax();
        found.t[0] = parameters.x;
    }
    else if (const SmVertex* vertex = SM_CAST_PTR(SmVertex, object))
        found.vertex = vertex;
    spot = found;
    return true;
}

// The point of a curve over [lo, hi] nearest to q.
bool locate(const Target& target, const SmPoint3d& q, Spot& spot)
{
    if (target.brep)
        return locate(target.brep, q, spot);
    SmSolutionArray solutions;
    if (target.curve->GlobalPointSolve(SmExtent1d(target.lo, target.hi), SM_SO_MINIMIZE, q, SM_ZONE_TOL_3D, nullptr,
                                       nullptr, SM_SR_SINGLE, solutions) != SM_SUCCESS ||
        solutions.GetSize() < 1)
        return false;
    Spot found;
    found.curve = target.curve, found.n = 1;
    found.lo = target.lo, found.hi = target.hi;
    found.t[0] = std::min(std::max(solutions[0].m_vStart[0], target.lo), target.hi);
    if (target.curve->EvaluatePoint(found.t[0], found.p) != SM_SUCCESS)
        return false;
    spot = found;
    return true;
}

// The face a spot lies on: its own, or one of the faces at its edge or vertex.
const SmFace* face_of(const Spot& s)
{
    if (s.face)
        return s.face;
    SmTArray<SmFace*> faces;
    if (s.edge)
        s.edge->GetFaces(faces);
    else if (s.vertex)
        s.vertex->GetFaces(faces);
    return faces.GetSize() > 0 ? faces[0] : nullptr;
}

// Position, first derivatives d[i] and second derivatives dd[i + j] of a spot at parameters t.
bool evaluate(const Spot& s, const double* t, SmPoint3d& p, SmVector3d d[2], SmVector3d dd[3])
{
    if (s.face || s.surface)
        return (s.face ? s.face->GetSurface() : s.surface)->Evaluate2ndDerivatives(SmPoint2d(t[0], t[1]), TRUE, TRUE, p, d[0], d[1], dd[1],
                                                           dd[0], dd[2]) == SM_SUCCESS;
    if (s.curve)
    {
        SmVector3d v[3];
        if (s.curve->Evaluate(t[0], 2, TRUE, v, FALSE) != SM_SUCCESS)
            return false;
        p = v[0], d[0] = v[1], dd[0] = v[2];
        return true;
    }
    p = s.p;
    return true;
}

// Whether parameters t lie on the spot's face (inside or on its boundary) or edge.
bool inside(const Spot& s, const double* t)
{
    if (s.surface)
        return t[0] >= s.box[0] && t[0] <= s.box[1] && t[1] >= s.box[2] && t[1] <= s.box[3];
    if (s.face)
    {
        int where = SM_PC_UNKNOWN;
        return SmApiFaceClassifyUV(s.face, SmPoint2d(t[0], t[1]), where) == SM_SUCCESS && where != SM_PC_UNKNOWN;
    }
    if (s.curve)
    {
        const double slack = 1e-12 * (1.0 + std::fabs(s.lo) + std::fabs(s.hi));
        return t[0] >= s.lo - slack && t[0] <= s.hi + slack;
    }
    return true;
}

// Half the squared distance between two spots at the joint parameters x (a's, then b's), with its
// gradient g and Hessian h.
struct Local
{
    SmPoint3d pa, pb;
    double f = 0.0, g[4] = {}, h[4][4] = {};
};

bool local(const Spot& a, const Spot& b, const double* x, Local& l)
{
    SmVector3d da[2], dda[3], db[2], ddb[3];
    if (!evaluate(a, x, l.pa, da, dda) || !evaluate(b, x + a.n, l.pb, db, ddb))
        return false;
    const SmVector3d r = l.pa - l.pb;
    l.f = 0.5 * r.Dot(r);
    SmVector3d j[4];  // the derivatives of r by each parameter
    int n = 0;
    for (int i = 0; i < a.n; ++i)
        j[n++] = da[i];
    for (int i = 0; i < b.n; ++i)
        j[n++] = -db[i];
    for (int i = 0; i < n; ++i)
    {
        l.g[i] = r.Dot(j[i]);
        for (int k = 0; k < n; ++k)
            l.h[i][k] = j[i].Dot(j[k]);
    }
    for (int i = 0; i < a.n; ++i)
        for (int k = 0; k < a.n; ++k)
            l.h[i][k] += r.Dot(dda[i + k]);
    for (int i = 0; i < b.n; ++i)
        for (int k = 0; k < b.n; ++k)
            l.h[a.n + i][a.n + k] -= r.Dot(ddb[i + k]);
    return true;
}

// Solves the n x n system m x = rhs (Gaussian elimination with partial pivoting).
bool solve(int n, double m[4][4], double rhs[4], double x[4])
{
    for (int c = 0; c < n; ++c)
    {
        int pivot = c;
        for (int r = c + 1; r < n; ++r)
            if (std::fabs(m[r][c]) > std::fabs(m[pivot][c]))
                pivot = r;
        if (!(std::fabs(m[pivot][c]) > 0.0))
            return false;
        std::swap(m[c], m[pivot]);
        std::swap(rhs[c], rhs[pivot]);
        for (int r = c + 1; r < n; ++r)
        {
            const double k = m[r][c] / m[c][c];
            for (int i = c; i < n; ++i)
                m[r][i] -= k * m[c][i];
            rhs[r] -= k * rhs[c];
        }
    }
    for (int r = n - 1; r >= 0; --r)
    {
        double s = rhs[r];
        for (int i = r + 1; i < n; ++i)
            s -= m[r][i] * x[i];
        x[r] = s / m[r][r];
    }
    return std::isfinite(x[0]) && (n < 2 || std::isfinite(x[n - 1]));
}

// Damped Newton on the parameters of two spots. True if it got closer; a and b are then there.
bool newton(Spot& a, Spot& b, double& distance)
{
    const int n = a.n + b.n;
    if (n == 0)
        return false;
    double x[4] = {};
    std::copy(a.t, a.t + a.n, x);
    std::copy(b.t, b.t + b.n, x + a.n);
    Local now;
    if (!local(a, b, x, now))
        return false;
    const double start = now.f;
    double lambda = 1e-9;
    for (int step = 0; step < 50; ++step)
    {
        bool moved = false;
        double dx[4] = {};
        for (int attempt = 0; attempt < 16 && !moved; ++attempt, lambda *= 10.0)
        {
            double m[4][4], rhs[4];
            for (int i = 0; i < n; ++i)
            {
                for (int k = 0; k < n; ++k)
                    m[i][k] = now.h[i][k];
                m[i][i] += lambda * std::max(now.h[i][i], 1e-300);
                rhs[i] = -now.g[i];
            }
            if (!solve(n, m, rhs, dx))
                continue;
            double y[4];
            for (int i = 0; i < n; ++i)
                y[i] = x[i] + dx[i];
            Local next;
            if (!inside(a, y) || !inside(b, y + a.n) || !local(a, b, y, next) || !(next.f < now.f))
                continue;
            std::copy(y, y + n, x);
            now = next;
            moved = true;
        }
        if (!moved)
            break;
        lambda = std::max(lambda / 1000.0, 1e-15);  // (the loop raised it once more)
        bool small = true;
        for (int i = 0; i < n; ++i)
            small = small && std::fabs(dx[i]) <= 1e-14 * (1.0 + std::fabs(x[i]));
        if (small)
            break;
    }
    if (!(now.f < start))
        return false;
    std::copy(x, x + a.n, a.t);
    std::copy(x + a.n, x + n, b.t);
    a.p = now.pa, b.p = now.pb;
    distance = std::sqrt(2.0 * now.f);
    return true;
}

// The nearest points of a and b from a point near a.
smlibpy::NearestPoints nearest(const Target& a, const Target& b, const SmPoint3d& near_a, Spot& sa, Spot& sb)
{
    if (!locate(a, near_a, sa) || !locate(b, sa.p, sb))
        throw std::runtime_error("nearest_points: the kernel found no closest point");
    smlibpy::NearestPoints out;
    double distance = sa.p.DistanceBetween(sb.p);
    const double scale = std::max({1.0, sa.p.GetMaxDimension(), sb.p.GetMaxDimension()});
    double gained = std::numeric_limits<double>::infinity();
    for (; out.steps < 200; ++out.steps)
    {
        const double before = distance;
        newton(sa, sb, distance);
        // a round of closest points: on to other faces where a boundary held Newton back, and the
        // kernel's own points where they are as near (on analytic surfaces they are exact to the
        // last digit, Newton's to a few)
        Spot na, nb;
        if (locate(a, sb.p, na) && locate(b, na.p, nb))
        {
            const double d = na.p.DistanceBetween(nb.p);
            if (d <= distance + 4e-16 * scale)
                sa = na, sb = nb, distance = d;
        }
        gained = before - distance;
        if (!(gained > 1e-15 * scale))
        {
            out.converged = true;
            break;
        }
    }
    out.a[0] = sa.p.x, out.a[1] = sa.p.y, out.a[2] = sa.p.z;
    out.b[0] = sb.p.x, out.b[1] = sb.p.y, out.b[2] = sb.p.z;
    out.distance = distance;
    out.gain = out.converged ? 0.0 : gained;
    return out;
}

// The distance from q to a box (0 inside it).
double box_distance(const SmExtent3d& box, const SmPoint3d& q)
{
    const SmPoint3d lo = box.GetMin(), hi = box.GetMax();
    const double dx = std::max({lo.x - q.x, 0.0, q.x - hi.x});
    const double dy = std::max({lo.y - q.y, 0.0, q.y - hi.y});
    const double dz = std::max({lo.z - q.z, 0.0, q.z - hi.z});
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

// The full knot vector of a B-spline surface in one direction.
bool full_knots(const SmBSplineSurface* s, SmSurfParamType dir, std::vector<double>& out)
{
    SmTArray<double> knots;
    SmTArray<ULONG> mults;
    if (s->GetKnots(dir, knots, &mults) != SM_SUCCESS)
        return false;
    out.clear();
    for (ULONG i = 0; i < knots.GetSize(); ++i)
        for (ULONG m = 0; m < (i < mults.GetSize() ? mults[i] : 1); ++m)
            out.push_back(knots[i]);
    const size_t p = s->GetDegree(dir), n = s->GetNumberControlPoints(dir);
    return p >= 1 && out.size() == n + p + 1;
}

}  // namespace

namespace smlibpy {

NearestPoints nearest_points(const SmBrep* a, const SmBrep* b, const std::vector<double>& near_a)
{
    if (!a || !b)
        throw std::invalid_argument("brep is None");
    if (near_a.size() != 3)
        throw std::invalid_argument("expected a point with three coordinates");
    Target ta, tb;
    ta.brep = a, tb.brep = b;
    Spot sa, sb;
    NearestPoints out = nearest(ta, tb, SmPoint3d(near_a[0], near_a[1], near_a[2]), sa, sb);
    out.face_a = face_of(sa), out.face_b = face_of(sb);
    return out;
}

NearestPoints nearest_curve_points(const SmBrep* body, const SmCurve* curve, double t0, double t1, double near_t)
{
    if (!body || !curve)
        throw std::invalid_argument("brep or curve is None");
    if (!(t0 <= t1) || !(near_t >= t0 && near_t <= t1))
        throw std::invalid_argument("nearest_curve_points: expected t0 <= near_t <= t1");
    Target tc, tb;
    tc.curve = curve, tc.lo = t0, tc.hi = t1;
    tb.brep = body;
    SmPoint3d start;
    if (curve->EvaluatePoint(near_t, start) != SM_SUCCESS)
        throw std::runtime_error("nearest_curve_points: the curve cannot be evaluated");
    Spot sc, sb;
    const NearestPoints r = nearest(tc, tb, start, sc, sb);
    NearestPoints out = r;  // on the body first, then on the curve
    std::copy(r.b, r.b + 3, out.a);
    std::copy(r.a, r.a + 3, out.b);
    out.face_a = face_of(sb), out.face_b = nullptr;
    out.t = sc.t[0];
    return out;
}

std::vector<SurfacePatch> surface_patches(const SmSurface* surface, const std::vector<double>& domain, const std::vector<double>& point)
{
    const SmPoint3d q(point[0], point[1], point[2]);
    const SmExtent2d dom(SmPoint2d(domain[0], domain[2]), SmPoint2d(domain[1], domain[3]));
    auto whole = [&] { return SurfacePatch{0.0, dom.GetUMin(), dom.GetUMax(), dom.GetVMin(), dom.GetVMax()}; };
    std::vector<SurfacePatch> out;
    const SmBSplineSurface* b = SM_CAST_PTR(SmBSplineSurface, surface);
    std::vector<double> ku, kv;
    if (!b || !full_knots(b, SM_SP_U, ku) || !full_knots(b, SM_SP_V, kv))
    {
        out.push_back(whole());
        return out;
    }
    const int p = static_cast<int>(b->GetDegree(SM_SP_U)), r = static_cast<int>(b->GetDegree(SM_SP_V));
    const int nu = static_cast<int>(b->GetNumberControlPoints(SM_SP_U));
    const int nv = static_cast<int>(b->GetNumberControlPoints(SM_SP_V));
    std::vector<SmPoint3d> poles(static_cast<size_t>(nu) * nv);
    for (int i = 0; i < nu; ++i)
        for (int j = 0; j < nv; ++j)
        {
            double w = 1.0;
            if (b->GetControlPoint(SM_CP_EUCLIDIAN_RATIONAL, i, j, poles[static_cast<size_t>(i) * nv + j], w) != SM_SUCCESS)
            {
                out.assign(1, whole());
                return out;
            }
        }
    for (int i = p; i < nu; ++i)
    {
        const double u0 = std::max(ku[i], dom.GetUMin()), u1 = std::min(ku[i + 1], dom.GetUMax());
        if (!(u1 > u0))
            continue;
        for (int j = r; j < nv; ++j)
        {
            const double v0 = std::max(kv[j], dom.GetVMin()), v1 = std::min(kv[j + 1], dom.GetVMax());
            if (!(v1 > v0))
                continue;
            SmExtent3d box;
            for (int a = i - p; a <= i; ++a)
                for (int c = j - r; c <= j; ++c)
                    box.AddPoint3d(poles[static_cast<size_t>(a) * nv + c]);
            out.push_back(SurfacePatch{box_distance(box, q), u0, u1, v0, v1});
        }
    }
    if (out.empty())
        out.push_back(whole());
    std::sort(out.begin(), out.end(), [](const SurfacePatch& a, const SurfacePatch& c) { return a.bound < c.bound; });
    return out;
}

double nearest_on_surface(const SmSurface* surface, const std::vector<double>& dom, const std::vector<double>& point,
                          double& u, double& v)
{
    const SmPoint3d q(point[0], point[1], point[2]);
    const double lo[2] = {dom[0], dom[2]}, hi[2] = {dom[1], dom[3]};
    double x[2] = {std::min(std::max(u, lo[0]), hi[0]), std::min(std::max(v, lo[1]), hi[1])};
    // half the squared distance, its gradient and Hessian at x
    auto local = [&](const double* t, double& f, double g[2], double h[2][2]) {
        SmPoint3d p;
        SmVector3d d[2], dd[3];
        if (surface->Evaluate2ndDerivatives(SmPoint2d(t[0], t[1]), TRUE, TRUE, p, d[0], d[1], dd[1], dd[0], dd[2]) !=
            SM_SUCCESS)
            return false;
        const SmVector3d r = p - q;
        f = 0.5 * r.Dot(r);
        g[0] = r.Dot(d[0]), g[1] = r.Dot(d[1]);
        h[0][0] = d[0].Dot(d[0]) + r.Dot(dd[0]);
        h[0][1] = h[1][0] = d[0].Dot(d[1]) + r.Dot(dd[1]);
        h[1][1] = d[1].Dot(d[1]) + r.Dot(dd[2]);
        return true;
    };
    double f, g[2], h[2][2];
    if (!local(x, f, g, h))
        return 1e300;
    // projected Newton: steps clipped to the box; along a side where the box holds it, the other
    // parameter alone; halved while they do not gain
    for (int it = 0; it < 60; ++it)
    {
        bool fixed[2];
        for (int k = 0; k < 2; ++k)
            fixed[k] = (x[k] <= lo[k] && g[k] > 0.0) || (x[k] >= hi[k] && g[k] < 0.0);
        double step[2] = {0.0, 0.0};
        auto newton1 = [&](int k) {
            const double c = h[k][k] > 0.0 ? h[k][k] : std::abs(h[k][k]) + 1e-300;
            step[k] = -g[k] / c;
        };
        if (fixed[0] && fixed[1])
            break;
        if (fixed[0])
            newton1(1);
        else if (fixed[1])
            newton1(0);
        else
        {
            const double det = h[0][0] * h[1][1] - h[0][1] * h[0][1];
            if (h[0][0] > 0.0 && det > 0.0)
            {
                step[0] = -(h[1][1] * g[0] - h[0][1] * g[1]) / det;
                step[1] = -(h[0][0] * g[1] - h[0][1] * g[0]) / det;
            }
            else
            {
                // not convex here: down the gradient, scaled by the first derivatives
                const double a = std::max(h[0][0], 1e-300), b = std::max(h[1][1], 1e-300);
                step[0] = -g[0] / std::abs(a), step[1] = -g[1] / std::abs(b);
            }
        }
        bool moved = false;
        for (int half = 0; half < 30 && !moved; ++half, step[0] *= 0.5, step[1] *= 0.5)
        {
            double y[2];
            for (int k = 0; k < 2; ++k)
                y[k] = std::min(std::max(x[k] + step[k], lo[k]), hi[k]);
            double fy, gy[2], hy[2][2];
            if (!local(y, fy, gy, hy) || !(fy < f))
                continue;
            const double moved_by = std::abs(y[0] - x[0]) + std::abs(y[1] - x[1]);
            x[0] = y[0], x[1] = y[1], f = fy;
            g[0] = gy[0], g[1] = gy[1];
            h[0][0] = hy[0][0], h[0][1] = hy[0][1], h[1][0] = hy[1][0], h[1][1] = hy[1][1];
            moved = moved_by > 1e-15 * (1.0 + std::abs(x[0]) + std::abs(x[1]));
            if (!moved)
                break;
        }
        if (!moved)
            break;
    }
    u = x[0], v = x[1];
    return std::sqrt(2.0 * f);
}

NearestPoint nearest_point(const SmBrep* brep, const std::vector<double>& point, const SmFace* only)
{
    if (!brep && !only)
        throw std::invalid_argument("brep is None");
    if (point.size() != 3)
        throw std::invalid_argument("expected a point with three coordinates");
    const SmPoint3d q(point[0], point[1], point[2]);
    Spot best;
    if (only)
    {
        // the kernel's nearest point of the face (trim-aware), as a vertex-like start
        SmPoint3d p;
        double d = 0.0;
        if (SmApiFaceClosestPoint(const_cast<SmFace*>(only), q, p, d) != SM_SUCCESS)
            throw std::runtime_error("nearest_point: the kernel found no closest point on the face");
        best.p = p;
    }
    else if (!locate(brep, q, best))
        throw std::runtime_error("nearest_point: the kernel found no closest point");
    double distance = best.p.DistanceBetween(q);
    const SmFace* face = only ? only : face_of(best);
    // The kernel's point solve stops at a local minimum of the distance where a B-spline face folds
    // back towards the point (a sheet fitted around a tube: 5.83 where the nearest point is 5.71).
    // On every face, and every knot span of its surface, that could hold a nearer point (by the box
    // of its control points), Newton's method from the nearest points of a grid over it; then on the
    // edges of those faces (a nearest point on a face's boundary).
    Spot target;
    target.p = q;  // (a fixed point: no parameters)
    SmTArray<SmFace*> faces;
    if (only)
        faces.Add(const_cast<SmFace*>(only));
    else
        const_cast<SmBrep*>(brep)->GetFaces(faces);
    std::vector<const SmFace*> near;
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        const SmFace* f = faces[i];
        const SmSurface* surface = f->GetSurface();
        if (!surface)
            continue;
        SmExtent3d box;
        if (f->CalculateBoundingBox(box, FALSE) == SM_SUCCESS && box_distance(box, q) >= distance)
            continue;
        near.push_back(f);
        // analytic surfaces: the kernel's solve is in closed form
        const int type = surface->GetType();
        if (type == SmPlane_TYPE || type == SmCone_TYPE || type == SmSphere_TYPE || type == SmTorus_TYPE)
            continue;
        // each patch that could hold a nearer point: Newton's method from the nearest points of a
        // grid over it (the bound only grows down the list)
        const SmExtent2d fd = f->GetUVDomain();
        const std::vector<SurfacePatch> list =
            surface_patches(surface, {fd.GetUMin(), fd.GetUMax(), fd.GetVMin(), fd.GetVMax()}, point);
        const int n = list.size() == 1 ? 17 : 5;
        for (const SurfacePatch& patch : list)
        {
            if (patch.bound >= distance)
                break;
            std::vector<std::pair<double, SmPoint2d>> samples;
            std::vector<SmPoint3d> grid(static_cast<size_t>(n) * n);
            std::vector<bool> ok(grid.size(), false);
            for (int a = 0; a < n; ++a)
                for (int c = 0; c < n; ++c)
                {
                    const SmPoint2d uv(patch.u0 + (patch.u1 - patch.u0) * a / (n - 1),
                                       patch.v0 + (patch.v1 - patch.v0) * c / (n - 1));
                    SmPoint3d& p = grid[static_cast<size_t>(a) * n + c];
                    if (surface->EvaluatePoint(uv, p) == SM_SUCCESS)
                        samples.emplace_back(p.DistanceBetween(q), uv), ok[static_cast<size_t>(a) * n + c] = true;
                }
            // the widest step of the grid: a nearer point of the patch lies within that of a sample, so
            // only a sample nearer than the best distance plus that can lead to one
            double step = 0.0;
            for (int a = 0; a < n; ++a)
                for (int c = 0; c < n; ++c)
                {
                    const size_t i = static_cast<size_t>(a) * n + c;
                    if (a + 1 < n && ok[i] && ok[i + n])
                        step = std::max(step, grid[i].DistanceBetween(grid[i + n]));
                    if (c + 1 < n && ok[i] && ok[i + 1])
                        step = std::max(step, grid[i].DistanceBetween(grid[i + 1]));
                }
            std::sort(samples.begin(), samples.end(), [](const auto& a, const auto& c) { return a.first < c.first; });
            int started = 0, tried = 0;
            for (const auto& start : samples)
            {
                if (started == 2 || ++tried > 8 || start.first >= distance + step)
                    break;
                // first down to a nearest point of the surface from there, over the patch and its
                // neighbours (cheap: no trims): where that is not nearer than the best, Newton's method
                // on the face goes no nearer either
                double u = start.second.x, v = start.second.y;
                const double du = patch.u1 - patch.u0, dv = patch.v1 - patch.v0;
                const double reach = nearest_on_surface(
                    surface,
                    {std::max(fd.GetUMin(), patch.u0 - du), std::min(fd.GetUMax(), patch.u1 + du),
                     std::max(fd.GetVMin(), patch.v0 - dv), std::min(fd.GetVMax(), patch.v1 + dv)},
                    point, u, v);
                ++started;
                if (!(reach < distance - 1e-9 * (1.0 + distance)))
                    continue;  // (the same point, or one nearer only by rounding)
                Spot s;
                s.face = f, s.n = 2;
                s.t[0] = start.second.x, s.t[1] = start.second.y;
                if (!inside(s, s.t))
                    continue;  // (outside a trimmed face)
                if (surface->EvaluatePoint(start.second, s.p) != SM_SUCCESS)
                    continue;
                double d = start.first;
                newton(s, target, d);
                if (d < distance)
                    distance = d, best = s, face = f;
            }
        }
    }
    for (const SmFace* f : near)
    {
        const int type = f->GetSurface()->GetType();
        if (type == SmPlane_TYPE || type == SmCone_TYPE || type == SmSphere_TYPE || type == SmTorus_TYPE)
            continue;  // (on analytic faces, also their edges' nearest points are the kernel's to find)
        SmTArray<SmEdge*> edges;
        const_cast<SmFace*>(f)->GetEdges(edges);
        for (ULONG i = 0; i < edges.GetSize(); ++i)
        {
            const SmEdge* e = edges[i];
            const SmCurve* curve = e->GetCurve();
            if (!curve)
                continue;
            SmExtent3d ebox;
            if (e->CalculateBoundingBox(&ebox) == SM_SUCCESS && box_distance(ebox, q) >= distance)
                continue;
            const SmExtent1d ivl = e->GetInterval();
            Spot s;
            s.edge = e, s.curve = curve, s.n = 1;
            s.lo = ivl.GetMin(), s.hi = ivl.GetMax();
            double t0 = s.lo, d0 = 1e300, step = 0.0;
            SmPoint3d last;
            for (int k = 0; k <= 32; ++k)
            {
                const double t = ivl.Evaluate(k / 32.0);
                SmPoint3d p;
                if (curve->EvaluatePoint(t, p) != SM_SUCCESS)
                    continue;
                if (k > 0)
                    step = std::max(step, p.DistanceBetween(last));
                last = p;
                if (p.DistanceBetween(q) < d0)
                    d0 = p.DistanceBetween(q), t0 = t, s.p = p;
            }
            if (!(d0 < distance + step))
                continue;  // (no sample near enough to lead to a nearer point)
            s.t[0] = t0;
            double d = d0;
            newton(s, target, d);
            if (d < distance)
                distance = d, best = s, face = f;
        }
    }
    NearestPoint out;
    out.p[0] = best.p.x, out.p[1] = best.p.y, out.p[2] = best.p.z;
    out.distance = distance;
    out.face = only ? only : (face ? face : face_of(best));
    return out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_distance(py::module_ m)
{
    m.def("nearest_points", [](const SmBrep* a, const SmBrep* b, const std::vector<double>& near_a) {
        const smlibpy::NearestPoints r = smlibpy::without_gil([&] { return smlibpy::nearest_points(a, b, near_a); });
        py::dict out;
        out["a"] = py::make_tuple(r.a[0], r.a[1], r.a[2]);
        out["b"] = py::make_tuple(r.b[0], r.b[1], r.b[2]);
        out["distance"] = r.distance, out["converged"] = r.converged, out["gain"] = r.gain;
        out["steps"] = r.steps;
        out["face_a"] = py::cast(const_cast<SmFace*>(r.face_a), py::return_value_policy::reference);
        out["face_b"] = py::cast(const_cast<SmFace*>(r.face_b), py::return_value_policy::reference);
        return out;
    }, py::arg("a"), py::arg("b"), py::arg("near_a"),
          "The nearest points of two bodies from a point near the first: closest points in turn, and Newton's "
          "method on the parameters of the faces and edges they lie on. {a, b, distance, converged, gain "
          "(what the last step gained when it did not converge), steps, face_a, face_b (the faces the points "
          "lie on; at an edge or a corner, one of the faces there)}.");
    m.def("nearest_point", [](const SmBrep* brep, const std::vector<double>& point, const SmFace* face) {
        const smlibpy::NearestPoint r = smlibpy::nearest_point(brep, point, face);
        py::dict out;
        out["point"] = py::make_tuple(r.p[0], r.p[1], r.p[2]);
        out["distance"] = r.distance;
        out["face"] = py::cast(const_cast<SmFace*>(r.face), py::return_value_policy::reference);
        return out;
    }, py::arg("brep"), py::arg("point"), py::arg("face") = nullptr,
          "The point of a body (or of one of its faces, `face`) nearest to a point: the kernel's closest point, and "
          "Newton's method from the nearest samples of every knot span of every face that could hold a nearer one "
          "(the kernel's solve stops where a B-spline face folds back towards the point), and on their edges. "
          "{point, distance, face (the face it lies on; at an edge or a corner, one of the faces there)}.");
    m.def("nearest_curve_points", [](const SmBrep* body, const SmCurve* curve, double t0, double t1, double near_t) {
        const smlibpy::NearestPoints r = smlibpy::nearest_curve_points(body, curve, t0, t1, near_t);
        py::dict out;
        out["a"] = py::make_tuple(r.a[0], r.a[1], r.a[2]);
        out["b"] = py::make_tuple(r.b[0], r.b[1], r.b[2]);
        out["distance"] = r.distance, out["converged"] = r.converged, out["gain"] = r.gain;
        out["steps"] = r.steps, out["t"] = r.t;
        out["face_a"] = py::cast(const_cast<SmFace*>(r.face_a), py::return_value_policy::reference);
        return out;
    }, py::arg("body"), py::arg("curve"), py::arg("t0"), py::arg("t1"), py::arg("near_t"),
          "The nearest points of a body and a curve over [t0, t1], from the curve's point at near_t: as "
          "nearest_points, with the curve as the second body. {a (on the body), b (on the curve), t (the curve "
          "parameter of b), distance, converged, gain, steps, face_a}.");
}
#endif  // SMLIBPY_PYTHON
