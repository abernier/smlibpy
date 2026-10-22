// SPDX-License-Identifier: Apache-2.0
//
// The nearest points of two bodies (`smlibpy._core.ext`):
//
//   nearest_points(a, b, near_a)   from a point near body a: the nearest points on a and b
//   nearest_curve_points(body, curve, t0, t1, near_t)
//                                  the same for a body and a curve over [t0, t1]
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
    if (s.face)
        return s.face->GetSurface()->Evaluate2ndDerivatives(SmPoint2d(t[0], t[1]), TRUE, TRUE, p, d[0], d[1], dd[1],
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
