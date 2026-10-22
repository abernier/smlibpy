// SPDX-License-Identifier: Apache-2.0
//
// The nearest points of two bodies (`smlibpy._core.ext`):
//
//   nearest_points(a, b, near_a)   from a point near body a: the nearest points on a and b
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

// A point on a body: on a face (two parameters), on an edge (one) or at a vertex (none).
struct Spot
{
    const SmFace* face = nullptr;
    const SmEdge* edge = nullptr;
    int n = 0;
    double t[2] = {0.0, 0.0};
    SmPoint3d p;
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
        found.t[0] = parameters.x;
    }
    spot = found;
    return true;
}

// Position, first derivatives d[i] and second derivatives dd[i + j] of a spot at parameters t.
bool evaluate(const Spot& s, const double* t, SmPoint3d& p, SmVector3d d[2], SmVector3d dd[3])
{
    if (s.face)
        return s.face->GetSurface()->Evaluate2ndDerivatives(SmPoint2d(t[0], t[1]), TRUE, TRUE, p, d[0], d[1], dd[1],
                                                           dd[0], dd[2]) == SM_SUCCESS;
    if (s.edge)
    {
        SmVector3d v[3];
        if (s.edge->GetCurve()->Evaluate(t[0], 2, TRUE, v, FALSE) != SM_SUCCESS)
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
    if (s.edge)
    {
        const SmExtent1d interval = s.edge->GetInterval();
        const double slack = 1e-12 * (1.0 + std::fabs(interval.GetMin()) + std::fabs(interval.GetMax()));
        return t[0] >= interval.GetMin() - slack && t[0] <= interval.GetMax() + slack;
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

}  // namespace

namespace smlibpy {

NearestPoints nearest_points(const SmBrep* a, const SmBrep* b, const std::vector<double>& near_a)
{
    if (!a || !b)
        throw std::invalid_argument("brep is None");
    if (near_a.size() != 3)
        throw std::invalid_argument("expected a point with three coordinates");
    Spot sa, sb;
    if (!locate(a, SmPoint3d(near_a[0], near_a[1], near_a[2]), sa) || !locate(b, sa.p, sb))
        throw std::runtime_error("nearest_points: the kernel found no closest point");
    NearestPoints out;
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
        return out;
    }, py::arg("a"), py::arg("b"), py::arg("near_a"),
          "The nearest points of two bodies from a point near the first: closest points in turn, and Newton's "
          "method on the parameters of the faces and edges they lie on. {a, b, distance, converged, gain "
          "(what the last step gained when it did not converge), steps}.");
}
#endif  // SMLIBPY_PYTHON
