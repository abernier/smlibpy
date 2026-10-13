// SPDX-License-Identifier: Apache-2.0
//
// Point clouds and triangles into kernel geometry (`smlibpy._core.ext`):
//
//   fit_surface(points, nu, nv, smoothing)    a bicubic B-spline surface approximating scattered points
//   poly_from_triangles(vertices, triangles)  a kernel mesh of an indexed triangle mesh
//
// The kernel fits scattered points too (SmApiCreateSurfaceFromRandomPoints), but its time grows
// steeply with their number: 50 points take 0.07 s, 100 points 4.4 s, 300 points minutes. Here a
// least-squares B-spline approximation instead, whose time grows with the number of points:
//
//  1. Parameters: the points are projected onto their best-fit plane (the plane of the two main
//     axes of their spread), into the smallest rectangle around them, u along its longer side; the
//     projections, scaled into [0, 1] x [0, 1], are the first parameters (u_i, v_i) of the points.
//  2. Control points: uniform clamped cubic knots in u and v; the control points P minimise
//        sum over the points |S(u_i, v_i) - p_i|^2  +  lambda * E(P)
//     E is the bending energy of the control net: squared second differences along u and along v,
//     and twice the squared mixed differences. lambda = smoothing * trace(A) / trace(E), A the
//     normal matrix of the distances, so that `smoothing` does not depend on the number of points
//     or the size of the cloud. The normal equations are banded (control points are coupled at
//     most three rows apart): a banded Cholesky solves them.
//  3. Parameter correction: each (u_i, v_i) moves to the foot of its point on the surface (two
//     Gauss-Newton steps), then 2. again. Three rounds.
//
// The cloud must be a height field over its best-fit plane (no overhangs, no folds over): a cloud
// that is not (a tube, a hemisphere seen from the side) gets a surface that fits it badly, which
// the returned errors show. The surface covers the rectangle the projected points span; where
// there are no points, the smoothing decides its shape.

#include "kernel.h"
#include "fit.h"

#include <SmApiGeneral.h>
#include <SmBSplineSurface.h>

#include <algorithm>
#include <cmath>
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

// Eigen decomposition of a symmetric 3x3 matrix (cyclic Jacobi): values descending, vectors[k]
// the unit eigenvector of values[k].
void eigen3(const double m[3][3], double values[3], double vectors[3][3])
{
    double a[3][3], v[3][3] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j)
            a[i][j] = m[i][j];
    for (int sweep = 0; sweep < 50; ++sweep)
    {
        const double off = a[0][1] * a[0][1] + a[0][2] * a[0][2] + a[1][2] * a[1][2];
        if (off < 1e-30 * (a[0][0] * a[0][0] + a[1][1] * a[1][1] + a[2][2] * a[2][2]) || off == 0.0)
            break;
        for (int p = 0; p < 2; ++p)
            for (int q = p + 1; q < 3; ++q)
            {
                if (a[p][q] == 0.0)
                    continue;
                const double theta = (a[q][q] - a[p][p]) / (2.0 * a[p][q]);
                const double t = (theta >= 0 ? 1.0 : -1.0) / (std::fabs(theta) + std::sqrt(theta * theta + 1.0));
                const double c = 1.0 / std::sqrt(t * t + 1.0), s = t * c;
                for (int k = 0; k < 3; ++k)
                {
                    const double akp = a[k][p], akq = a[k][q];
                    a[k][p] = c * akp - s * akq;
                    a[k][q] = s * akp + c * akq;
                }
                for (int k = 0; k < 3; ++k)
                {
                    const double apk = a[p][k], aqk = a[q][k];
                    a[p][k] = c * apk - s * aqk;
                    a[q][k] = s * apk + c * aqk;
                }
                for (int k = 0; k < 3; ++k)
                {
                    const double vkp = v[k][p], vkq = v[k][q];
                    v[k][p] = c * vkp - s * vkq;
                    v[k][q] = s * vkp + c * vkq;
                }
            }
    }
    int order[3] = {0, 1, 2};
    std::sort(order, order + 3, [&](int x, int y) { return a[x][x] > a[y][y]; });
    for (int k = 0; k < 3; ++k)
    {
        values[k] = a[order[k]][order[k]];
        for (int i = 0; i < 3; ++i)
            vectors[k][i] = v[i][order[k]];
    }
}

// Uniform clamped cubic knots for n control points: four zeros, (n - 4) inner knots, four ones.
std::vector<double> clamped_knots(int n)
{
    std::vector<double> k(4, 0.0);
    const int spans = n - 3;
    for (int j = 1; j < spans; ++j)
        k.push_back(static_cast<double>(j) / spans);
    k.insert(k.end(), 4, 1.0);
    return k;
}

// The knot span of x: 3 <= i <= n - 1 with k[i] <= x < k[i + 1] (x = 1: the last span).
int span(const std::vector<double>& k, int n, double x)
{
    if (x >= k[n])
        return n - 1;
    if (x <= k[3])
        return 3;
    int lo = 3, hi = n;
    while (hi - lo > 1)
    {
        const int mid = (lo + hi) / 2;
        if (x < k[mid])
            hi = mid;
        else
            lo = mid;
    }
    return lo;
}

// The four cubic basis functions that are not zero at x (of control points i - 3 .. i) and their
// first derivatives (The NURBS Book, algorithms A2.2 and A2.3).
void basis(const std::vector<double>& k, int i, double x, double N[4], double D[4])
{
    double ndu[4][4], left[4], right[4];
    ndu[0][0] = 1.0;
    for (int j = 1; j <= 3; ++j)
    {
        left[j] = x - k[i + 1 - j];
        right[j] = k[i + j] - x;
        double saved = 0.0;
        for (int r = 0; r < j; ++r)
        {
            ndu[j][r] = right[r + 1] + left[j - r];
            const double temp = ndu[r][j - 1] / ndu[j][r];
            ndu[r][j] = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        ndu[j][j] = saved;
    }
    for (int r = 0; r <= 3; ++r)
    {
        N[r] = ndu[r][3];
        double d = 0.0;
        if (r >= 1)
            d += ndu[r - 1][2] / ndu[3][r - 1];
        if (r <= 2)
            d -= ndu[r][2] / ndu[3][r];
        D[r] = 3.0 * d;
    }
}

// A symmetric positive definite band matrix (half bandwidth w), its lower triangle stored by rows:
// a(i, j) for i - w <= j <= i at band[i * (w + 1) + (i - j)].
struct Band
{
    int n, w;
    std::vector<double> band;
    Band(int n_, int w_) : n(n_), w(w_), band(static_cast<size_t>(n_) * (w_ + 1), 0.0) {}
    double& at(int i, int j) { return band[static_cast<size_t>(i) * (w + 1) + (i - j)]; }
    void add(int i, int j, double x)  // a(i, j) and a(j, i)
    {
        if (i < j)
            std::swap(i, j);
        at(i, j) += x;
    }
    double trace() const
    {
        double t = 0.0;
        for (int i = 0; i < n; ++i)
            t += band[static_cast<size_t>(i) * (w + 1)];
        return t;
    }
    // In place: the Cholesky factor L (a = L L^T).
    void factor()
    {
        for (int i = 0; i < n; ++i)
            for (int j = std::max(0, i - w); j <= i; ++j)
            {
                double s = at(i, j);
                for (int k = std::max(std::max(0, i - w), j - w); k < j; ++k)
                    s -= at(i, k) * at(j, k);
                if (i == j)
                {
                    if (!(s > 0.0))
                        throw std::runtime_error("fit_surface: the normal equations are singular; give some smoothing");
                    at(i, i) = std::sqrt(s);
                }
                else
                    at(i, j) = s / at(j, j);
            }
    }
    // Solve L L^T x = b in place.
    void solve(std::vector<double>& b)
    {
        for (int i = 0; i < n; ++i)
        {
            double s = b[i];
            for (int k = std::max(0, i - w); k < i; ++k)
                s -= at(i, k) * b[k];
            b[i] = s / at(i, i);
        }
        for (int i = n - 1; i >= 0; --i)
        {
            double s = b[i];
            for (int k = i + 1; k <= std::min(n - 1, i + w); ++k)
                s -= at(k, i) * b[k];
            b[i] = s / at(i, i);
        }
    }
};

struct Grid
{
    int nu, nv;
    std::vector<double> ku, kv;
    std::vector<double> poles;  // x, y, z of control point (i, j) at 3 * (i * nv + j)

    // S(u, v) and its first derivatives.
    void eval(double u, double v, double s[3], double su[3], double sv[3]) const
    {
        const int iu = span(ku, nu, u), iv = span(kv, nv, v);
        double Nu[4], Du[4], Nv[4], Dv[4];
        basis(ku, iu, u, Nu, Du);
        basis(kv, iv, v, Nv, Dv);
        for (int c = 0; c < 3; ++c)
            s[c] = su[c] = sv[c] = 0.0;
        for (int a = 0; a < 4; ++a)
            for (int b = 0; b < 4; ++b)
            {
                const double* p = &poles[3 * static_cast<size_t>((iu - 3 + a) * nv + (iv - 3 + b))];
                for (int c = 0; c < 3; ++c)
                {
                    s[c] += Nu[a] * Nv[b] * p[c];
                    su[c] += Du[a] * Nv[b] * p[c];
                    sv[c] += Nu[a] * Dv[b] * p[c];
                }
            }
    }
};

// Moves (u, v) towards the foot of p on the surface; returns the distance from p after the steps.
double foot(const Grid& g, const double* p, double& u, double& v, int steps)
{
    double s[3], su[3], sv[3];
    for (int it = 0; it < steps; ++it)
    {
        g.eval(u, v, s, su, sv);
        double r[3] = {s[0] - p[0], s[1] - p[1], s[2] - p[2]};
        const double a = su[0] * su[0] + su[1] * su[1] + su[2] * su[2];
        const double b = su[0] * sv[0] + su[1] * sv[1] + su[2] * sv[2];
        const double c = sv[0] * sv[0] + sv[1] * sv[1] + sv[2] * sv[2];
        const double ru = r[0] * su[0] + r[1] * su[1] + r[2] * su[2];
        const double rv = r[0] * sv[0] + r[1] * sv[1] + r[2] * sv[2];
        const double det = a * c - b * b;
        if (!(det > 1e-300))
            break;
        u = std::min(1.0, std::max(0.0, u - (c * ru - b * rv) / det));
        v = std::min(1.0, std::max(0.0, v - (a * rv - b * ru) / det));
    }
    g.eval(u, v, s, su, sv);
    return std::sqrt((s[0] - p[0]) * (s[0] - p[0]) + (s[1] - p[1]) * (s[1] - p[1]) + (s[2] - p[2]) * (s[2] - p[2]));
}

}  // namespace

namespace smlibpy {

SurfaceFit fit_surface(const std::vector<double>& points, int nu, int nv, double smoothing)
{
    if (points.size() % 3 != 0)
        throw std::invalid_argument("fit_surface: the points must be x, y, z triples");
    const size_t count = points.size() / 3;
    if (count < 4)
        throw std::invalid_argument("fit_surface: at least 4 points are needed");
    if ((nu == 0) != (nv == 0) || (nu != 0 && (nu < 4 || nv < 4 || nu > 64 || nv > 64)))
        throw std::invalid_argument("fit_surface: 4 to 64 control points in each direction (or 0 and 0: chosen here)");
    if (!(smoothing >= 0.0) || !std::isfinite(smoothing))
        throw std::invalid_argument("fit_surface: the smoothing must be 0 or more");
    for (double x : points)
        if (!std::isfinite(x))
            throw std::invalid_argument("fit_surface: the points must be finite numbers");

    // 1. The best-fit plane and the first parameters.
    double c[3] = {0, 0, 0};
    for (size_t i = 0; i < count; ++i)
        for (int k = 0; k < 3; ++k)
            c[k] += points[3 * i + k];
    for (double& x : c)
        x /= static_cast<double>(count);
    double cov[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}};
    for (size_t i = 0; i < count; ++i)
    {
        const double d[3] = {points[3 * i] - c[0], points[3 * i + 1] - c[1], points[3 * i + 2] - c[2]};
        for (int a = 0; a < 3; ++a)
            for (int b = 0; b < 3; ++b)
                cov[a][b] += d[a] * d[b];
    }
    double values[3], axes[3][3];
    eigen3(cov, values, axes);
    std::vector<double> x(count), y(count);
    for (size_t i = 0; i < count; ++i)
    {
        const double d[3] = {points[3 * i] - c[0], points[3 * i + 1] - c[1], points[3 * i + 2] - c[2]};
        x[i] = d[0] * axes[0][0] + d[1] * axes[0][1] + d[2] * axes[0][2];
        y[i] = d[0] * axes[1][0] + d[1] * axes[1][1] + d[2] * axes[1][2];
    }
    // The main axes of a square or round cloud point anywhere: turn them in the plane to the
    // smallest rectangle around the points (the surface spans that rectangle), u along its longer side.
    auto bounds = [&](double angle, double& a0, double& a1, double& b0, double& b1) {
        const double ca = std::cos(angle), sa = std::sin(angle);
        a0 = b0 = 1e300, a1 = b1 = -1e300;
        for (size_t i = 0; i < count; ++i)
        {
            const double a = ca * x[i] + sa * y[i], b = -sa * x[i] + ca * y[i];
            a0 = std::min(a0, a), a1 = std::max(a1, a), b0 = std::min(b0, b), b1 = std::max(b1, b);
        }
        return (a1 - a0) * (b1 - b0);
    };
    const double pi = 3.14159265358979323846;
    double best = 0.0, smallest = 1e300, a0, a1, b0, b1;
    for (int step = 0; step < 90; ++step)  // 1 degree steps, then 0.02 degree steps around the best
        if (const double area = bounds(step * pi / 180.0, a0, a1, b0, b1); area < smallest)
            smallest = area, best = step * pi / 180.0;
    const double coarse = best;
    for (int step = -50; step <= 50; ++step)
        if (const double area = bounds(coarse + step * pi / 9000.0, a0, a1, b0, b1); area < smallest)
            smallest = area, best = coarse + step * pi / 9000.0;
    bounds(best, a0, a1, b0, b1);
    if (b1 - b0 > a1 - a0)
        best += pi / 2.0;
    std::vector<double> u(count), v(count);
    double u0 = 1e300, u1 = -1e300, v0 = 1e300, v1 = -1e300;
    {
        const double ca = std::cos(best), sa = std::sin(best);
        for (size_t i = 0; i < count; ++i)
        {
            u[i] = ca * x[i] + sa * y[i], v[i] = -sa * x[i] + ca * y[i];
            u0 = std::min(u0, u[i]), u1 = std::max(u1, u[i]);
            v0 = std::min(v0, v[i]), v1 = std::max(v1, v[i]);
        }
    }
    const double size = std::sqrt(values[0] + values[1] + values[2]);
    if (!(u1 - u0 > 1e-9 * size) || !(v1 - v0 > 1e-9 * size) || !(size > 0))
        throw std::invalid_argument("fit_surface: the points lie on a line (or a point): they span no surface");
    for (size_t i = 0; i < count; ++i)
        u[i] = (u[i] - u0) / (u1 - u0), v[i] = (v[i] - v0) / (v1 - v0);
    if (nu == 0)  // about one control point per 8 points, shaped like the rectangle
    {
        const double total = std::min(1024.0, std::max(16.0, static_cast<double>(count) / 8.0));
        const double ratio = (u1 - u0) / (v1 - v0);
        nu = static_cast<int>(std::lround(std::min(48.0, std::max(4.0, std::sqrt(total * ratio)))));
        nv = static_cast<int>(std::lround(std::min(48.0, std::max(4.0, total / nu))));
    }

    Grid g{nu, nv, clamped_knots(nu), clamped_knots(nv), {}};
    const int n = nu * nv;
    // (the inner index runs over v: the half bandwidth is 3 rows of v and 3 more)
    const int w = 3 * nv + 3;

    // The bending energy of the control net (a band matrix of the same shape).
    Band energy(n, w);
    auto stencil = [&](const std::vector<std::pair<int, double>>& s, double weight) {
        for (const auto& [i, a] : s)
            for (const auto& [j, b] : s)
                if (i >= j)
                    energy.at(i, j) += weight * a * b;
    };
    for (int i = 0; i < nu; ++i)
        for (int j = 0; j < nv; ++j)
        {
            const int at = i * nv + j;
            if (i >= 1 && i + 1 < nu)
                stencil({{at - nv, 1.0}, {at, -2.0}, {at + nv, 1.0}}, 1.0);
            if (j >= 1 && j + 1 < nv)
                stencil({{at - 1, 1.0}, {at, -2.0}, {at + 1, 1.0}}, 1.0);
            if (i + 1 < nu && j + 1 < nv)
                stencil({{at, 1.0}, {at + 1, -1.0}, {at + nv, -1.0}, {at + nv + 1, 1.0}}, 2.0);
        }

    SurfaceFit out;
    out.nu = nu, out.nv = nv;
    for (int round = 0; round < 4; ++round)
    {
        // 2. The control points for the current parameters.
        Band a(n, w);
        std::vector<double> rhs[3] = {std::vector<double>(n, 0.0), std::vector<double>(n, 0.0),
                                      std::vector<double>(n, 0.0)};
        for (size_t p = 0; p < count; ++p)
        {
            const int iu = span(g.ku, nu, u[p]), iv = span(g.kv, nv, v[p]);
            double Nu[4], Du[4], Nv[4], Dv[4];
            basis(g.ku, iu, u[p], Nu, Du);
            basis(g.kv, iv, v[p], Nv, Dv);
            int idx[16];
            double wt[16];
            for (int x = 0; x < 4; ++x)
                for (int y = 0; y < 4; ++y)
                {
                    idx[4 * x + y] = (iu - 3 + x) * nv + (iv - 3 + y);
                    wt[4 * x + y] = Nu[x] * Nv[y];
                }
            for (int s = 0; s < 16; ++s)
            {
                for (int t = 0; t <= s; ++t)
                    a.add(idx[s], idx[t], wt[s] * wt[t]);
                for (int k = 0; k < 3; ++k)
                    rhs[k][idx[s]] += wt[s] * points[3 * p + k];
            }
        }
        const double lambda = std::max(smoothing, 1e-9) * a.trace() / energy.trace();
        for (size_t e = 0; e < a.band.size(); ++e)
            a.band[e] += lambda * energy.band[e];
        a.factor();
        g.poles.assign(3 * static_cast<size_t>(n), 0.0);
        for (int k = 0; k < 3; ++k)
        {
            a.solve(rhs[k]);
            for (int i = 0; i < n; ++i)
                g.poles[3 * static_cast<size_t>(i) + k] = rhs[k][i];
        }
        // 3. The feet of the points, and how far the points are from the surface.
        double worst = 0.0, sum = 0.0;
        for (size_t p = 0; p < count; ++p)
        {
            const double d = foot(g, &points[3 * p], u[p], v[p], round < 3 ? 2 : 4);
            worst = std::max(worst, d);
            sum += d * d;
        }
        out.max_error = worst;
        out.rms_error = std::sqrt(sum / static_cast<double>(count));
        if (round == 3)
            break;
    }

    SmTArray<SmPoint3d> poles;
    for (int i = 0; i < n; ++i)
        poles.Add(SmPoint3d(g.poles[3 * i], g.poles[3 * i + 1], g.poles[3 * i + 2]));
    auto unique = [](int count_) {
        SmTArray<double> knots;
        SmTArray<ULONG> mults;
        const int spans = count_ - 3;
        for (int j = 0; j <= spans; ++j)
        {
            knots.Add(static_cast<double>(j) / spans);
            mults.Add(j == 0 || j == spans ? 4 : 1);
        }
        return std::make_pair(knots, mults);
    };
    auto [uk, um] = unique(nu);
    auto [vk, vm] = unique(nv);
    SmBSplineSurface* srf = nullptr;
    check(SmBSplineSurface::CreateCanonical(ctx(), 3, 3, poles, SM_SF_UNSPECIFIED, um, vm, uk, vk,
                                            SM_KT_UNSPECIFIED, nullptr, nullptr, srf),
          "SmBSplineSurface::CreateCanonical");
    out.surface = srf;
    return out;
}

SmPolyBrep* poly_from_triangles(const std::vector<double>& vertices, const std::vector<long>& triangles)
{
    if (vertices.size() % 3 != 0)
        throw std::invalid_argument("poly_from_triangles: the vertices must be x, y, z triples");
    if (triangles.size() % 3 != 0)
        throw std::invalid_argument("poly_from_triangles: the triangles must be triples of vertex indices");
    const size_t nvert = vertices.size() / 3;
    for (long t : triangles)
        if (t < 0 || static_cast<size_t>(t) >= nvert)
            throw std::invalid_argument("poly_from_triangles: a triangle refers to a vertex that is not there (" +
                                        std::to_string(t) + ")");
    for (double x : vertices)
        if (!std::isfinite(x))
            throw std::invalid_argument("poly_from_triangles: the vertices must be finite numbers");
    if (triangles.empty())
        throw std::invalid_argument("poly_from_triangles: no triangles");

    // The tolerance of the kernel's STL reader: 1e-7 of the size of the model (the larger of the
    // diagonal of its box and its largest coordinate).
    SmExtent3d box;
    double largest = 0.0;
    for (size_t i = 0; i < nvert; ++i)
    {
        box.AddPoint3d(SmPoint3d(vertices[3 * i], vertices[3 * i + 1], vertices[3 * i + 2]));
        for (int k = 0; k < 3; ++k)
            largest = std::max(largest, std::fabs(vertices[3 * i + k]));
    }
    const double scale = std::max(box.GetSize().Length(), largest);
    const SmZoneTol3d tol = SM_EFF_ZERO_SQRT / 10.0 * std::max(scale, 1e-12);

    SmPolyBrep* pb = new (ctx()) SmPolyBrep(tol, static_cast<ULONG>(std::min<size_t>(6 * triangles.size(), 4000000)));
    try
    {
        std::vector<SmPolyVertex*> verts(nvert, nullptr);
        auto vertex = [&](long i) {
            if (!verts[i])
                verts[i] = new (pb) SmPolyVertex(SmPoint3d(vertices[3 * i], vertices[3 * i + 1], vertices[3 * i + 2]), tol);
            return verts[i];
        };
        SmPolyShell* shell = nullptr;
        size_t made = 0;
        for (size_t t = 0; t + 2 < triangles.size(); t += 3)
        {
            const long a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
            if (a == b || b == c || a == c)
                continue;
            const SmPoint3d pa(vertices[3 * a], vertices[3 * a + 1], vertices[3 * a + 2]);
            SmVector3d normal;
            pa.NormalToPlane(SmPoint3d(vertices[3 * b], vertices[3 * b + 1], vertices[3 * b + 2]),
                             SmPoint3d(vertices[3 * c], vertices[3 * c + 1], vertices[3 * c + 2]), normal);
            if (!normal.IsInitialized())  // no area: the kernel's STL reader leaves such facets out too
                continue;
            SmPolyFace* face = nullptr;
            check(pb->CreatePolyTriangle(nullptr, shell, vertex(a), vertex(b), vertex(c), face),
                  "SmPolyBrep::CreatePolyTriangle");
            if (!shell)
                shell = face->GetPolyShell();
            ++made;
        }
        if (made == 0)
            throw std::invalid_argument("poly_from_triangles: every triangle has no area");
        ULONG stitched = 0, lamina = 0;
        // (the shared vertices stitched the triangles already; this splits edges at vertices that lie on
        // them, keeping triangles, and sorts the faces into shells and regions)
        check(pb->Stitch(tol, FALSE, TRUE, TRUE, stitched, lamina, TRUE), "SmPolyBrep::Stitch");
    }
    catch (...)
    {
        delete pb;
        throw;
    }
    return pb;
}

void triangulate_poly(SmPolyBrep* poly)
{
    SmTArray<SmPolyFace*> faces;
    poly->GetPolyFaces(faces);
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        SmPolyFace* face = faces[i];
        SmTArray<SmPolyLoop*> loops;
        face->GetPolyLoops(loops);
        if (loops.GetSize() == 0)
            continue;
        SmTArray<SmPolyEdge*> edges;
        loops[0]->GetPolyEdges(edges);
        if (loops.GetSize() == 1 && edges.GetSize() <= 3)
            continue;
        SmTArray<SmPolyFace*> made;
        if (face->IsPlanar())
            check(face->TriangulatePlanar(made), "SmPolyFace::TriangulatePlanar");
        else
            check(face->TriangulateNonPlanar(made), "SmPolyFace::TriangulateNonPlanar");
    }
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_fit(py::module_ m)
{
    m.def("fit_surface", [](const std::vector<double>& points, int nu, int nv, double smoothing) {
        const smlibpy::SurfaceFit r = smlibpy::fit_surface(points, nu, nv, smoothing);
        return py::make_tuple(py::cast(r.surface, py::return_value_policy::reference), r.max_error, r.rms_error, r.nu,
                              r.nv);
    }, py::arg("points"), py::arg("nu") = 0, py::arg("nv") = 0, py::arg("smoothing") = 1e-3,
       "A bicubic B-spline surface approximating scattered points (x, y, z flat), with nu x nv control points (0 and "
       "0: about one per 8 points): (surface, max_error, rms_error, nu, nv). The surface is the caller's "
       "(ext.delete_surface).");
    m.def("poly_from_triangles", [](const std::vector<double>& vertices, const std::vector<long>& triangles) {
        return smlibpy::poly_from_triangles(vertices, triangles);
    }, py::arg("vertices"), py::arg("triangles"), py::return_value_policy::reference,
       "A kernel mesh (PolyBrep) of an indexed triangle mesh, stitched along shared edges. The caller's "
       "(ext.delete_polybrep).");
    m.def("triangulate_poly", &smlibpy::triangulate_poly, py::arg("poly"),
          "Split every polygon of a kernel mesh that is not a triangle (polygons with holes too) into triangles, "
          "in place.");
}
#endif  // SMLIBPY_PYTHON
