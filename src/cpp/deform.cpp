// SPDX-License-Identifier: Apache-2.0
//
// Space deformations of whole Breps (smlibpy.deform): twist, taper, bend and free-form
// deformation with a control lattice, registered as `_core.deform`.
//
// The kernel describes a space deformation as an SmVolume, a map of 3D space onto itself
// (SmTwistVolume, SmBendVolume, SmTransform; SmBSplineVolume is compiled out of this kernel
// build, so lattices are evaluated here). It sends a Brep through such a map the way
// SmSpaceBend::BendTopology does for sheet metal: vertices are mapped, edge curves become
// SmCrvInVolume and face surfaces SmSrfInVolume, the exact but procedural composition of the
// original geometry with the map (`composite_brep` below builds that). The kernel's own
// conversion of those to B-splines (SmBrep::ApproximateWithBSplines) missed its tolerance,
// rebuilt the trim curves by projection and broke a bent bar, so it is not used.
//
// Instead every face and edge is fitted here, keeping the parameterization of the original
// surface or curve, so the UV trim curves of the Brep stay valid and are kept:
//   * where the composition is polynomial it is reproduced exactly: lattices and tapers are
//     polynomial maps, affine maps keep any geometry polynomial, and a twist or bend is
//     polynomial on some faces (a plane across the twist axis is only turned). The fit
//     interpolates in homogeneous coordinates (the original's denominator to the power that
//     makes the composition polynomial) with the smallest degrees that reproduce it, on the
//     knots of the original;
//   * elsewhere (twist and bend are not polynomial) the directions in which the composition is
//     still polynomial of the original's degree stay exact, and the others get quintic splines
//     (at the original's knots as smooth as the original, C4 elsewhere) whose spans are halved
//     until they are within the tolerance. Exact faces that would get more than
//     `max_exact_points` control points are approximated the same way.
//
// Where the exact image of a face or edge is analytic, it gets that geometry instead of a fit
// (deform_analytic.cpp): a moved copy where the map is a similarity on it (faces the map leaves
// in place, the turned ends of a twist, the cross-sections of a taper), a cone like the
// cylinder a taper narrows, and new planes, cylinders, cones, lines and circles where the
// parameters change (a plate bent about an axis, a cylinder unrolled into a plane). New
// geometry takes new trim curves; if those cannot be built, the fits stay.

#include "kernel.h"
#include "deform.h"
#include "deform_analytic.h"

#include <SmApiGeneral.h>
#include <SmApiQueries.h>
#include <SmBendVolume.h>
#include <SmBSplineCurve.h>
#include <SmBSplineSurface.h>
#include <SmCrvInVolume.h>
#include <SmEdgeuse.h>
#include <SmFaceuse.h>
#include <SmSrfInVolume.h>
#include <SmTransform.h>
#include <SmTwistVolume.h>
#include <SmUnbendVolume.h>

#include <algorithm>
#include <cmath>
#include <functional>
#include <memory>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace
{

constexpr double kInf = 1e300;
constexpr double kPi = 3.14159265358979323846;

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(status, what, __FILE__, __LINE__);
}

SmVector3d vec3(const std::vector<double>& v)
{
    if (v.size() != 3)
        throw std::invalid_argument("expected three coordinates");
    return SmVector3d(v[0], v[1], v[2]);
}

SmVector3d unit3(const std::vector<double>& v)
{
    SmVector3d d = vec3(v);
    const double n = d.Length();
    if (!(n > 0.0))
        throw std::invalid_argument("expected a direction, not a zero vector");
    return d / n;
}

// ---------------------------------------------------------------------------
// Homogeneous points and spline interpolation
// ---------------------------------------------------------------------------

struct H4
{
    double x = 0.0, y = 0.0, z = 0.0, w = 1.0;
};

inline H4 hom(const SmPoint3d& p, double w) { return {p.x * w, p.y * w, p.z * w, w}; }
inline SmPoint3d euclid(const H4& h) { return SmPoint3d(h.x / h.w, h.y / h.w, h.z / h.w); }
inline void axpy(double a, const H4& x, H4& y)
{
    y.x += a * x.x; y.y += a * x.y; y.z += a * x.z; y.w += a * x.w;
}

constexpr int kMaxDegree = 31;

// Knot span of t in a clamped knot vector with n control points (The NURBS Book, A2.1).
int find_span(const std::vector<double>& U, int d, int n, double t)
{
    if (t >= U[n])
        return n - 1;
    if (t <= U[d])
        return d;
    int lo = d, hi = n;
    int mid = (lo + hi) / 2;
    while (t < U[mid] || t >= U[mid + 1])
    {
        if (t < U[mid])
            hi = mid;
        else
            lo = mid;
        mid = (lo + hi) / 2;
    }
    return mid;
}

// The d + 1 non-zero B-spline basis functions at t (The NURBS Book, A2.2).
void basis_funs(int span, double t, int d, const std::vector<double>& U, double* N)
{
    double left[kMaxDegree + 2], right[kMaxDegree + 2];
    N[0] = 1.0;
    for (int j = 1; j <= d; ++j)
    {
        left[j] = t - U[span + 1 - j];
        right[j] = U[span + j] - t;
        double saved = 0.0;
        for (int r = 0; r < j; ++r)
        {
            const double temp = N[r] / (right[r + 1] + left[j - r]);
            N[r] = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        N[j] = saved;
    }
}

// Interpolation by splines of one degree on one knot vector: the sites (one per control point)
// and the banded LU factors of the collocation matrix. B-spline collocation matrices with sites
// that satisfy the Schoenberg-Whitney conditions are totally positive, so elimination without
// pivoting is stable.
struct Scheme
{
    int d = 1;
    std::vector<double> U;       // clamped knot vector
    std::vector<double> breaks;  // its distinct values
    std::vector<int> mults;      // and their multiplicities
    std::vector<double> sites;
    std::vector<std::pair<size_t, size_t>> span_sites;  // sites inside each span [first, last)
    int bw = 1;
    std::vector<double> lu;  // n rows of 2 bw + 1

    size_t n() const { return sites.size(); }
    double& a(size_t i, size_t j) { return lu[i * (2 * bw + 1) + (j + bw - i)]; }
    double a(size_t i, size_t j) const { return lu[i * (2 * bw + 1) + (j + bw - i)]; }

    void factor()
    {
        const size_t N = n();
        bw = d;
        lu.assign(N * (2 * bw + 1), 0.0);
        double b[kMaxDegree + 1];
        for (size_t i = 0; i < N; ++i)
        {
            const int span = find_span(U, d, static_cast<int>(N), sites[i]);
            basis_funs(span, sites[i], d, U, b);
            for (int k = 0; k <= d; ++k)
            {
                const long j = span - d + k;
                if (j >= 0 && std::abs(static_cast<long>(i) - j) <= bw)
                    a(i, j) += b[k];
            }
        }
        for (size_t k = 0; k < N; ++k)
        {
            const double piv = a(k, k);
            if (std::abs(piv) < 1e-300)
                throw std::runtime_error("deform: singular spline interpolation");
            const size_t last = std::min(N - 1, k + bw);
            for (size_t i = k + 1; i <= last; ++i)
            {
                const double f = a(i, k) / piv;
                a(i, k) = f;
                if (f == 0.0)
                    continue;
                for (size_t j = k + 1; j <= last; ++j)
                    a(i, j) -= f * a(k, j);
            }
        }
    }

    // Solve in place for values given with a stride (the right-hand sides are homogeneous points).
    void solve(H4* x, size_t stride) const
    {
        const size_t N = n();
        for (size_t i = 0; i < N; ++i)
        {
            const size_t first = i > static_cast<size_t>(bw) ? i - bw : 0;
            H4& xi = x[i * stride];
            for (size_t j = first; j < i; ++j)
                axpy(-a(i, j), x[j * stride], xi);
        }
        for (size_t ii = N; ii-- > 0;)
        {
            const size_t last = std::min(N - 1, ii + bw);
            H4& xi = x[ii * stride];
            for (size_t j = ii + 1; j <= last; ++j)
                axpy(-a(ii, j), x[j * stride], xi);
            const double inv = 1.0 / a(ii, ii);
            xi.x *= inv; xi.y *= inv; xi.z *= inv; xi.w *= inv;
        }
    }
};

// Chebyshev-Lobatto nodes of a degree on [0, 1], ends included.
std::vector<double> lobatto(int d)
{
    std::vector<double> t;
    for (int i = 0; i <= d; ++i)
        t.push_back(0.5 * (1.0 - std::cos(kPi * i / d)));
    return t;
}

// A scheme on the given breaks. `bezier`: every interior break has multiplicity d (piecewise
// polynomial, any continuity) and the sites are Lobatto nodes in every span (well conditioned for
// high degrees; used for exact fits). Otherwise a break gets the multiplicity that allows the
// continuity of the composition there (d - continuity, at least 1) and the sites are the
// Greville abscissae.
Scheme make_scheme(int d, const std::vector<double>& breaks, const std::vector<int>& cont, bool bezier)
{
    if (d < 1 || d > kMaxDegree)
        throw std::invalid_argument("deform: unsupported degree");
    Scheme s;
    s.d = d;
    s.breaks = breaks;
    const size_t nb = breaks.size();
    for (size_t k = 0; k < nb; ++k)
    {
        const int m = (k == 0 || k + 1 == nb) ? d + 1 : (bezier ? d : std::clamp(d - cont[k], 1, d));
        s.mults.push_back(m);
        for (int r = 0; r < m; ++r)
            s.U.push_back(breaks[k]);
    }
    const size_t N = s.U.size() - d - 1;
    if (bezier)
    {
        const std::vector<double> t = lobatto(d);
        for (size_t k = 0; k + 1 < nb; ++k)
            for (int i = (k == 0 ? 0 : 1); i <= d; ++i)
                s.sites.push_back(breaks[k] + t[i] * (breaks[k + 1] - breaks[k]));
    }
    else
    {
        for (size_t i = 0; i < N; ++i)
        {
            double g = 0.0;
            for (int r = 1; r <= d; ++r)
                g += s.U[i + r];
            s.sites.push_back(g / d);
        }
    }
    if (s.sites.size() != N)
        throw std::runtime_error("deform: inconsistent interpolation scheme");
    size_t first = 0;
    for (size_t k = 0; k + 1 < nb; ++k)
    {
        while (first < N && s.sites[first] < breaks[k])
            ++first;
        size_t last = first;
        while (last < N && s.sites[last] <= breaks[k + 1])
            ++last;
        s.span_sites.emplace_back(first, last);
    }
    s.factor();
    return s;
}

// ---------------------------------------------------------------------------
// The deformation: pieces of space maps along an axis
// ---------------------------------------------------------------------------

// A Bezier volume over the box [0, size] of a frame (a lattice): control points in the frame's
// coordinates, w fastest, then v, then u. The kernel's SmBSplineVolume would be this map, but it
// is compiled out of the kernel build (USE_VOLUMES is not defined), so it is evaluated here.
struct Lattice
{
    SmPoint3d origin;
    SmVector3d x, y, z;
    double size[3] = {1.0, 1.0, 1.0};
    int n[3] = {2, 2, 2};
    std::vector<SmPoint3d> points;

    SmPoint3d map(const SmPoint3d& p) const
    {
        const SmVector3d q = p - origin;
        const double s[3] = {q.Dot(x) / size[0], q.Dot(y) / size[1], q.Dot(z) / size[2]};
        double b[3][kMaxDegree + 1];
        for (int a = 0; a < 3; ++a)
        {
            // Bernstein polynomials of degree n - 1 (valid outside [0, 1] too: the map is a polynomial)
            const int d = n[a] - 1;
            const double t = s[a], u = 1.0 - t;
            b[a][0] = 1.0;
            for (int k = 1; k <= d; ++k)
            {
                double saved = 0.0;
                for (int j = 0; j < k; ++j)
                {
                    const double tmp = b[a][j];
                    b[a][j] = saved + u * tmp;
                    saved = t * tmp;
                }
                b[a][k] = saved;
            }
        }
        SmVector3d local(0.0, 0.0, 0.0);
        size_t idx = 0;
        for (int i = 0; i < n[0]; ++i)
            for (int j = 0; j < n[1]; ++j)
            {
                const double bij = b[0][i] * b[1][j];
                for (int k = 0; k < n[2]; ++k, ++idx)
                    local = local + (bij * b[2][k]) * points[idx];
            }
        return origin + local.x * x + local.y * y + local.z * z;
    }
};

struct Piece
{
    enum Kind
    {
        IDENTITY,
        RIGID,    // rotation and translation: analytic geometry is transformed and kept
        VOLUME,   // a kernel volume (twist, bend, unbend, affine transform)
        LATTICE,  // a Bezier volume
    } kind = IDENTITY;
    double lo = -kInf, hi = kInf;           // region along the axis
    std::unique_ptr<SmVolume> volume;       // RIGID and VOLUME
    SmAxis2Placement placement;             // RIGID: p -> origin + R p
    Lattice lattice;                        // LATTICE
    int degree = -1;                        // total degree of a polynomial map, -1 otherwise
    std::vector<smlibpy::analytic::Line3> axes;  // twist, bend, unbend: the axis (for analytic images)

    SmPoint3d map(const SmPoint3d& p) const
    {
        if (kind == IDENTITY)
            return p;
        if (kind == LATTICE)
            return lattice.map(p);
        SmPoint3d out;
        check(volume->MapPoint(p, out), "SmVolume::MapPoint");
        return out;
    }
};

struct Deformation
{
    bool has_axis = false;
    SmPoint3d origin;
    SmVector3d direction;
    bool analytic = true;   // analytic images where they are analytic
    std::vector<int> faces;  // the piece of every face, if the caller gives them
    std::vector<std::unique_ptr<Piece>> pieces;
    double tolerance = 1e-6;
    int max_degree = 12;
    int approx_degree = 5;  // degree of approximated directions (quintic: few knots)
    size_t max_exact_points = 40000;  // larger exact faces (dense originals, high degrees) are approximated
    double exact_tol = 1e-9;  // set from the model size

    int piece_at(const SmPoint3d& p) const
    {
        if (!has_axis || pieces.size() == 1)
            return 0;
        const double s = (p - origin).Dot(direction);
        for (size_t i = 0; i < pieces.size(); ++i)
            if (s <= pieces[i]->hi)
                return static_cast<int>(i);
        return static_cast<int>(pieces.size()) - 1;
    }
};

// 4x4 row-vector matrix (p' = [p 1] * T) from a 3x4 column-vector matrix.
void row_matrix(const std::vector<double>& m, double t[4][4])
{
    if (m.size() != 12)
        throw std::invalid_argument("expected a 3x4 matrix (12 values, row-major)");
    for (int r = 0; r < 3; ++r)
        for (int c = 0; c < 3; ++c)
            t[c][r] = m[r * 4 + c];
    for (int r = 0; r < 3; ++r)
        t[3][r] = m[r * 4 + 3];
    t[0][3] = t[1][3] = t[2][3] = 0.0;
    t[3][3] = 1.0;
}

std::unique_ptr<Piece> make_piece(const smlibpy::DeformPiece& d)
{
    auto piece = std::make_unique<Piece>();
    if (d.has_lo)
        piece->lo = d.lo;
    if (d.has_hi)
        piece->hi = d.hi;
    const std::string& kind = d.kind;
    if (kind == "identity")
    {
        piece->kind = Piece::IDENTITY;
    }
    else if (kind == "affine" || kind == "rigid")
    {
        double t[4][4];
        row_matrix(d.matrix, t);
        piece->volume.reset(new (ctx()) SmTransform(&ctx(), t));
        piece->kind = kind == "rigid" ? Piece::RIGID : Piece::VOLUME;
        piece->degree = 1;
        if (kind == "rigid")
        {
            SmVector3d o(t[3][0], t[3][1], t[3][2]);
            SmVector3d x(t[0][0], t[0][1], t[0][2]);
            SmVector3d y(t[1][0], t[1][1], t[1][2]);
            piece->placement = SmAxis2Placement(o, x, y);
        }
    }
    else if (kind == "twist")
    {
        piece->volume.reset(new (ctx()) SmTwistVolume(ctx(), vec3(d.origin), vec3(d.axis), vec3(d.mid), d.period));
        piece->kind = Piece::VOLUME;
        piece->axes.push_back({vec3(d.origin), unit3(d.axis)});
    }
    else if (kind == "bend")
    {
        piece->volume.reset(new (ctx()) SmBendVolume(ctx(), vec3(d.center), vec3(d.axis), vec3(d.mid), d.neutral));
        piece->kind = Piece::VOLUME;
        piece->axes.push_back({vec3(d.center), unit3(d.axis)});
    }
    else if (kind == "unbend")
    {
        // A point at distance r from the axis and at the angle a from `mid` (-pi < a < pi) goes to
        // the plane at distance r along `mid`, neutral * a along axis x mid: the inverse of a bend.
        // A rigid `matrix` moves the result (an unroll that keeps a flat in place).
        if (!(d.neutral > 0.0))
            throw std::invalid_argument("unbend: the neutral radius must be positive");
        auto* volume = new (ctx()) SmUnbendVolume(ctx(), vec3(d.center), unit3(d.axis), unit3(d.mid), d.neutral);
        piece->volume.reset(volume);
        if (!d.matrix.empty())
        {
            double t[4][4];
            row_matrix(d.matrix, t);
            const SmAxis2Placement place(SmVector3d(t[3][0], t[3][1], t[3][2]), SmVector3d(t[0][0], t[0][1], t[0][2]),
                                         SmVector3d(t[1][0], t[1][1], t[1][2]));
            check(volume->Transform(place), "SmVolume::Transform");
        }
        piece->kind = Piece::VOLUME;
        piece->axes.push_back({vec3(d.center), unit3(d.axis)});
    }
    else if (kind == "lattice")
    {
        const std::vector<int>& counts = d.counts;
        const std::vector<double>& size = d.size;
        const std::vector<double>& pts = d.points;
        if (counts.size() != 3 || size.size() != 3)
            throw std::invalid_argument("lattice: counts and size need three values");
        for (int a = 0; a < 3; ++a)
        {
            if (counts[a] < 2 || counts[a] > 12)
                throw std::invalid_argument("lattice: 2 to 12 points per direction");
            if (!(size[a] > 0.0))
                throw std::invalid_argument("lattice: the box must have a positive size");
        }
        const size_t n = static_cast<size_t>(counts[0]) * counts[1] * counts[2];
        if (pts.size() != 3 * n)
            throw std::invalid_argument("lattice: wrong number of control points");
        Lattice& lat = piece->lattice;
        lat.origin = vec3(d.origin);
        lat.x = vec3(d.x);
        lat.y = vec3(d.y);
        lat.z = vec3(d.z);
        for (int a = 0; a < 3; ++a)
        {
            lat.size[a] = size[a];
            lat.n[a] = counts[a];
        }
        for (size_t i = 0; i < n; ++i)
            lat.points.emplace_back(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]);
        piece->kind = Piece::LATTICE;
        piece->degree = counts[0] + counts[1] + counts[2] - 3;
    }
    else
    {
        throw std::invalid_argument("unknown deformation piece: " + kind);
    }
    return piece;
}

std::unique_ptr<Deformation> make_deformation(const smlibpy::DeformSpec& spec, double size)
{
    auto def = std::make_unique<Deformation>();
    if (spec.has_axis)
    {
        const std::vector<double>& a = spec.axis;
        if (a.size() != 6)
            throw std::invalid_argument("axis: expected origin and direction (6 values)");
        def->has_axis = true;
        def->origin = SmPoint3d(a[0], a[1], a[2]);
        def->direction = SmVector3d(a[3], a[4], a[5]);
        def->direction.Unitize();
    }
    if (spec.has_analytic)
        def->analytic = spec.analytic;
    for (const smlibpy::DeformPiece& item : spec.pieces)
        def->pieces.push_back(make_piece(item));
    if (def->pieces.empty())
        throw std::invalid_argument("a deformation needs at least one piece");
    for (int f : spec.faces)
        if (f < 0 || f >= static_cast<int>(def->pieces.size()))
            throw std::invalid_argument("faces: a piece index out of range");
    def->faces = spec.faces;
    if (spec.has_tolerance)
        def->tolerance = spec.tolerance;
    if (spec.has_max_degree)
        def->max_degree = std::clamp(spec.max_degree, 1, 17);
    if (spec.has_max_exact_points)
        def->max_exact_points = spec.max_exact_points;
    if (spec.has_approx_degree)
        def->approx_degree = std::clamp(spec.approx_degree, 2, 9);
    if (!(def->tolerance > 0.0))
        throw std::invalid_argument("tolerance must be positive");
    def->exact_tol = std::min(1e-11 * std::max(1.0, size), 0.01 * def->tolerance);
    return def;
}

// ---------------------------------------------------------------------------
// Fitting a composition F(u, v) = map(S(u, v)) or F(t) = map(C(t))
// ---------------------------------------------------------------------------

using SurfFn = std::function<H4(double, double)>;  // homogeneous sample of the composition
using CurveFn = std::function<H4(double)>;

// Fractions of a span where the error is measured: between the interpolation sites of every
// scheme used here, never on them.
constexpr double kTest[] = {0.1371, 0.3, 0.5, 0.7, 0.8629};
constexpr double kMixed[] = {0.2213, 0.6487, 0.9123};

// Breaks and the continuity of the composition at each: the original's knots carry the
// original's continuity there (degree - multiplicity), breaks added by refinement are smooth.
constexpr int kSmooth = 1 << 20;

struct Breaks
{
    std::vector<double> at;
    std::vector<int> cont;
};

Breaks split_marked(const Breaks& b, const std::vector<char>& mark)
{
    Breaks out;
    for (size_t i = 0; i + 1 < b.at.size(); ++i)
    {
        out.at.push_back(b.at[i]);
        out.cont.push_back(b.cont[i]);
        if (mark[i])
        {
            out.at.push_back(0.5 * (b.at[i] + b.at[i + 1]));
            out.cont.push_back(kSmooth);
        }
    }
    out.at.push_back(b.at.back());
    out.cont.push_back(b.cont.back());
    return out;
}

struct SurfFit
{
    Scheme su, sv;
    std::vector<H4> net;  // su.n() x sv.n(), u major
    double err = 0.0;
    bool exact = false;
    size_t nu() const { return su.breaks.size() - 1; }
    size_t nv() const { return sv.breaks.size() - 1; }
};

void fit_net(const SurfFn& f, SurfFit& fit)
{
    const size_t nu = fit.su.n(), nv = fit.sv.n();
    fit.net.assign(nu * nv, H4{});
    for (size_t a = 0; a < nu; ++a)
        for (size_t b = 0; b < nv; ++b)
            fit.net[a * nv + b] = f(fit.su.sites[a], fit.sv.sites[b]);
    for (size_t b = 0; b < nv; ++b)
        fit.su.solve(&fit.net[b], nv);
    for (size_t a = 0; a < nu; ++a)
        fit.sv.solve(&fit.net[a * nv], 1);
}

SmPoint3d eval_net(const SurfFit& fit, double u, double v)
{
    const Scheme& su = fit.su;
    const Scheme& sv = fit.sv;
    const int nu = static_cast<int>(su.n()), nv = static_cast<int>(sv.n());
    const int iu = find_span(su.U, su.d, nu, u), iv = find_span(sv.U, sv.d, nv, v);
    double bu[kMaxDegree + 1], bv[kMaxDegree + 1];
    basis_funs(iu, u, su.d, su.U, bu);
    basis_funs(iv, v, sv.d, sv.U, bv);
    H4 acc{0, 0, 0, 0};
    for (int a = 0; a <= su.d; ++a)
        for (int b = 0; b <= sv.d; ++b)
            axpy(bu[a] * bv[b], fit.net[(iu - su.d + a) * nv + (iv - sv.d + b)], acc);
    return euclid(acc);
}

struct CellErr
{
    double eu = 0.0, ev = 0.0, em = 0.0;  // along u (at v sites), along v (at u sites), in between
};

CellErr cell_error(const SurfFn& f, const SurfFit& fit, size_t i, size_t j)
{
    const Scheme& su = fit.su;
    const Scheme& sv = fit.sv;
    const double u0 = su.breaks[i], u1 = su.breaks[i + 1], v0 = sv.breaks[j], v1 = sv.breaks[j + 1];
    auto dist = [&](double u, double v) { return eval_net(fit, u, v).DistanceBetween(euclid(f(u, v))); };
    CellErr e;
    std::vector<double> vs, us;
    for (size_t s = sv.span_sites[j].first; s < sv.span_sites[j].second; ++s)
        vs.push_back(sv.sites[s]);
    for (size_t s = su.span_sites[i].first; s < su.span_sites[i].second; ++s)
        us.push_back(su.sites[s]);
    if (vs.empty())
        vs.push_back(0.5 * (v0 + v1));
    if (us.empty())
        us.push_back(0.5 * (u0 + u1));
    for (double fu : kTest)
        for (double v : vs)
            e.eu = std::max(e.eu, dist(u0 + fu * (u1 - u0), v));
    for (double u : us)
        for (double fv : kTest)
            e.ev = std::max(e.ev, dist(u, v0 + fv * (v1 - v0)));
    for (double fu : kMixed)
        for (double fv : kMixed)
            e.em = std::max(e.em, dist(u0 + fu * (u1 - u0), v0 + fv * (v1 - v0)));
    return e;
}

double surface_error(const SurfFn& f, const SurfFit& fit)
{
    double err = 0.0;
    for (size_t i = 0; i < fit.nu(); ++i)
        for (size_t j = 0; j < fit.nv(); ++j)
        {
            const CellErr e = cell_error(f, fit, i, j);
            err = std::max({err, e.eu, e.ev, e.em});
        }
    return err;
}

// Exact fit of a composition that is piecewise polynomial on the original's patches: the
// smallest degrees that reproduce it (bisection; exactness is monotone in the degree).
// Returns false when it is not polynomial up to the caps. Every patch is fitted on its own
// (full multiplicity at the breaks), so the degrees are searched on a few patches of a large
// surface first and then checked on all.
bool fit_exact_surface(const SurfFn& f, SurfFit& fit, const Breaks& ub, const Breaks& vb, int cu, int cv,
                       double exact_tol, size_t max_points)
{
    auto search = [&](const std::function<bool(int, int)>& exact_at) -> std::pair<int, int> {
        if (!exact_at(cu, cv))
            return {0, 0};
        int lo = 1, hi = cu;
        while (lo < hi)
        {
            const int mid = (lo + hi) / 2;
            if (exact_at(mid, cv))
                hi = mid;
            else
                lo = mid + 1;
        }
        const int du = lo;
        lo = 1;
        hi = cv;
        while (lo < hi)
        {
            const int mid = (lo + hi) / 2;
            if (exact_at(du, mid))
                hi = mid;
            else
                lo = mid + 1;
        }
        return {du, lo};
    };
    auto exact_full = [&](int du, int dv) {
        fit.su = make_scheme(du, ub.at, ub.cont, true);
        fit.sv = make_scheme(dv, vb.at, vb.cont, true);
        fit_net(f, fit);
        fit.err = surface_error(f, fit);
        return fit.err <= exact_tol;
    };
    const size_t nu = ub.at.size() - 1, nv = vb.at.size() - 1;
    if (nu * nv > 9)
    {
        // probe patches: the first, middle and last span in each direction
        auto spans = [](const Breaks& b) {
            const size_t n = b.at.size() - 1;
            std::vector<Breaks> out;
            for (size_t i : {size_t(0), n / 2, n - 1})
            {
                if (!out.empty() && out.back().at[0] == b.at[i])
                    continue;
                out.push_back(Breaks{{b.at[i], b.at[i + 1]}, {0, 0}});
            }
            return out;
        };
        const std::vector<Breaks> pu = spans(ub), pv = spans(vb);
        auto exact_probes = [&](int du, int dv) {
            for (const Breaks& bu : pu)
                for (const Breaks& bv : pv)
                {
                    SurfFit t;
                    t.su = make_scheme(du, bu.at, bu.cont, true);
                    t.sv = make_scheme(dv, bv.at, bv.cont, true);
                    fit_net(f, t);
                    if (surface_error(f, t) > exact_tol)
                        return false;
                }
            return true;
        };
        const auto [du, dv] = search(exact_probes);
        if (du == 0 || (nu * du + 1) * (nv * dv + 1) > max_points)
            return false;
        if (exact_full(du, dv))
        {
            fit.exact = true;
            return true;
        }
    }
    const auto [du, dv] = search(exact_full);
    if (du == 0)
        return false;
    exact_full(du, dv);
    fit.exact = true;
    return true;
}

// Approximation within `tol`: a direction in which the composition is still polynomial of the
// original's degree stays exact; the others get C2 cubic (or the original's higher degree)
// splines whose spans are halved where the error is too large.
void fit_approx_surface(const SurfFn& f, SurfFit& fit, Breaks ub, Breaks vb, int p, int q, double tol, double exact_tol,
                        int approx_degree)
{
    p = std::max(p, 1);
    q = std::max(q, 1);
    fit.su = make_scheme(p, ub.at, ub.cont, true);
    fit.sv = make_scheme(q, vb.at, vb.cont, true);
    fit_net(f, fit);
    double eu = 0.0, ev = 0.0;
    for (size_t i = 0; i < fit.nu(); ++i)
        for (size_t j = 0; j < fit.nv(); ++j)
        {
            const CellErr e = cell_error(f, fit, i, j);
            eu = std::max(eu, e.eu);
            ev = std::max(ev, e.ev);
        }
    const bool exact_u = eu <= exact_tol, exact_v = ev <= exact_tol;
    const int du = exact_u ? p : std::max(p, approx_degree);
    const int dv = exact_v ? q : std::max(q, approx_degree);
    const size_t max_spans = 1024, max_points = 200000;
    for (int iter = 0; iter < 60; ++iter)
    {
        fit.su = make_scheme(du, ub.at, ub.cont, exact_u);
        fit.sv = make_scheme(dv, vb.at, vb.cont, exact_v);
        fit_net(f, fit);
        std::vector<char> mu(fit.nu(), 0), mv(fit.nv(), 0);
        std::vector<CellErr> errs(fit.nu() * fit.nv());
        double err = 0.0;
        bool any = false;
        for (size_t i = 0; i < fit.nu(); ++i)
            for (size_t j = 0; j < fit.nv(); ++j)
            {
                const CellErr e = cell_error(f, fit, i, j);
                errs[i * fit.nv() + j] = e;
                err = std::max({err, e.eu, e.ev, e.em});
                if (!exact_u && e.eu > 0.5 * tol)
                    mu[i] = any = 1;
                if (!exact_v && e.ev > 0.5 * tol)
                    mv[j] = any = 1;
            }
        fit.err = err;
        if (err <= tol)
            return;
        if (!any)
            for (size_t i = 0; i < fit.nu(); ++i)
                for (size_t j = 0; j < fit.nv(); ++j)
                    if (errs[i * fit.nv() + j].em > 0.5 * tol)
                    {
                        if (!exact_u)
                            mu[i] = 1;
                        if (!exact_v)
                            mv[j] = 1;
                    }
        Breaks nub = split_marked(ub, mu), nvb = split_marked(vb, mv);
        if (nub.at.size() == ub.at.size() && nvb.at.size() == vb.at.size())
            return;  // nothing left to refine
        if (nub.at.size() - 1 > max_spans || nvb.at.size() - 1 > max_spans ||
            (nub.at.size() + du) * (nvb.at.size() + dv) > max_points)
            return;  // best effort; fit.err says how close it got
        ub = std::move(nub);
        vb = std::move(nvb);
    }
}

struct CurveFit
{
    Scheme s;
    std::vector<H4> pts;
    double err = 0.0;
    bool exact = false;
};

void fit_points(const CurveFn& f, CurveFit& fit)
{
    fit.pts.resize(fit.s.n());
    for (size_t i = 0; i < fit.s.n(); ++i)
        fit.pts[i] = f(fit.s.sites[i]);
    fit.s.solve(fit.pts.data(), 1);
}

SmPoint3d eval_points(const CurveFit& fit, double t)
{
    const Scheme& s = fit.s;
    const int span = find_span(s.U, s.d, static_cast<int>(s.n()), t);
    double b[kMaxDegree + 1];
    basis_funs(span, t, s.d, s.U, b);
    H4 acc{0, 0, 0, 0};
    for (int a = 0; a <= s.d; ++a)
        axpy(b[a], fit.pts[span - s.d + a], acc);
    return euclid(acc);
}

double span_error(const CurveFn& f, const CurveFit& fit, size_t i)
{
    const double t0 = fit.s.breaks[i], t1 = fit.s.breaks[i + 1];
    double err = 0.0;
    for (double fr : kTest)
    {
        const double t = t0 + fr * (t1 - t0);
        err = std::max(err, eval_points(fit, t).DistanceBetween(euclid(f(t))));
    }
    for (double fr : kMixed)
    {
        const double t = t0 + fr * (t1 - t0);
        err = std::max(err, eval_points(fit, t).DistanceBetween(euclid(f(t))));
    }
    return err;
}

double curve_error(const CurveFn& f, const CurveFit& fit)
{
    double err = 0.0;
    for (size_t i = 0; i + 1 < fit.s.breaks.size(); ++i)
        err = std::max(err, span_error(f, fit, i));
    return err;
}

bool fit_exact_curve(const CurveFn& f, CurveFit& fit, const Breaks& b, int cap, double exact_tol)
{
    auto exact_at = [&](int d) {
        fit.s = make_scheme(d, b.at, b.cont, true);
        fit_points(f, fit);
        fit.err = curve_error(f, fit);
        return fit.err <= exact_tol;
    };
    if (!exact_at(cap))
        return false;
    int lo = 1, hi = cap;
    while (lo < hi)
    {
        const int mid = (lo + hi) / 2;
        if (exact_at(mid))
            hi = mid;
        else
            lo = mid + 1;
    }
    exact_at(lo);
    fit.exact = true;
    return true;
}

void fit_approx_curve(const CurveFn& f, CurveFit& fit, Breaks b, int p, double tol, double exact_tol, int approx_degree)
{
    p = std::max(p, 1);
    fit.s = make_scheme(p, b.at, b.cont, true);
    fit_points(f, fit);
    const bool exact = curve_error(f, fit) <= exact_tol;
    const int d = exact ? p : std::max(p, approx_degree);
    for (int iter = 0; iter < 60; ++iter)
    {
        fit.s = make_scheme(d, b.at, b.cont, exact);
        fit_points(f, fit);
        std::vector<char> mark(b.at.size() - 1, 0);
        double err = 0.0;
        bool any = false;
        for (size_t i = 0; i + 1 < b.at.size(); ++i)
        {
            const double e = span_error(f, fit, i);
            err = std::max(err, e);
            if (e > 0.5 * tol)
                mark[i] = any = 1;
        }
        fit.err = err;
        if (err <= tol || !any || exact || b.at.size() > 8192)
            return;
        b = split_marked(b, mark);
    }
}

// ---------------------------------------------------------------------------
// NURBS assembly
// ---------------------------------------------------------------------------

bool is_rational(const std::vector<H4>& net)
{
    for (const H4& h : net)
        if (std::abs(h.w - net[0].w) > 1e-13 * std::abs(net[0].w))
            return true;
    return false;
}

void knots_of(const Scheme& s, SmTArray<double>& knots, SmTArray<ULONG>& mults)
{
    for (size_t k = 0; k < s.breaks.size(); ++k)
    {
        knots.Add(s.breaks[k]);
        mults.Add(static_cast<ULONG>(s.mults[k]));
    }
}

SmBSplineSurface* build_surface(const SurfFit& fit, double remove_tol)
{
    const bool rational = is_rational(fit.net);
    SmTArray<SmPoint3d> points;
    SmTArray<double> weights;
    for (const H4& h : fit.net)
    {
        if (!(h.w > 0.0))
            throw std::runtime_error("deform: non-positive weight in a fitted surface");
        points.Add(euclid(h));
        if (rational)
            weights.Add(h.w / fit.net[0].w);
    }
    SmTArray<ULONG> mu, mv;
    SmTArray<double> ku, kv;
    knots_of(fit.su, ku, mu);
    knots_of(fit.sv, kv, mv);
    SmBSplineSurface* out = nullptr;
    check(SmBSplineSurface::CreateCanonical(ctx(), fit.su.d, fit.sv.d, points, SM_SF_UNSPECIFIED, mu, mv, ku, kv,
                                            SM_KT_UNSPECIFIED, rational ? &weights : nullptr, nullptr, out),
          "SmBSplineSurface::CreateCanonical");
    const bool inner_u = fit.su.breaks.size() > 2, inner_v = fit.sv.breaks.size() > 2;
    if (remove_tol > 0.0 && (inner_u || inner_v))
        out->RemoveKnots(remove_tol, inner_u ? TRUE : FALSE, inner_v ? TRUE : FALSE);
    return out;
}

SmBSplineCurve* build_curve(const CurveFit& fit, double remove_tol)
{
    const bool rational = is_rational(fit.pts);
    SmTArray<SmPoint3d> points;
    SmTArray<double> weights;
    for (const H4& h : fit.pts)
    {
        if (!(h.w > 0.0))
            throw std::runtime_error("deform: non-positive weight in a fitted curve");
        points.Add(euclid(h));
        if (rational)
            weights.Add(h.w / fit.pts[0].w);
    }
    SmTArray<ULONG> mults;
    SmTArray<double> knots;
    knots_of(fit.s, knots, mults);
    SmBSplineCurve* out = nullptr;
    check(SmBSplineCurve::CreateCanonical(ctx(), 3, fit.s.d, points, SM_CF_UNSPECIFIED, mults, knots, SM_KT_UNSPECIFIED,
                                          rational ? &weights : nullptr, nullptr, out),
          "SmBSplineCurve::CreateCanonical");
    if (remove_tol > 0.0 && fit.s.breaks.size() > 2)
        out->RemoveKnots(remove_tol);
    return out;
}

// ---------------------------------------------------------------------------
// Mapping one surface / curve
// ---------------------------------------------------------------------------

struct Stats
{
    int faces_kept = 0, faces_exact = 0, faces_approx = 0;
    int edges_kept = 0, edges_exact = 0, edges_approx = 0;
    int faces_analytic = 0, edges_analytic = 0;
    double max_error = 0.0;  // largest deviation from the exact deformation found at the test points
    int max_degree = 0;
};

// NURBS form of a B-spline surface: degrees, knots and the denominator as a surface of its own.
struct SurfaceInfo
{
    bool nurbs = false;
    bool rational = false;
    int p = 3, q = 3;
    std::vector<double> uk, vk;  // unique knots
    std::vector<int> um, vm;     // their multiplicities
    std::unique_ptr<SmBSplineSurface> weight;  // x = denominator
};

SurfaceInfo surface_info(const SmSurface* s)
{
    SurfaceInfo info;
    if (!s->IsKindOf(SmBSplineSurface_TYPE))
        return info;
    auto bs = static_cast<const SmBSplineSurface*>(s);
    ULONG ud = 0, vd = 0;
    SmTArray<SmPoint3d> poles;
    SmBSplineSurfaceForm form;
    SmTArray<ULONG> um, vm;
    SmTArray<double> uk, vk, w;
    SmKnotType kt;
    if (bs->GetCanonical(ud, vd, poles, form, um, vm, uk, vk, kt, w) != SM_SUCCESS)
        return info;
    info.nurbs = true;
    info.p = static_cast<int>(ud);
    info.q = static_cast<int>(vd);
    for (ULONG i = 0; i < uk.GetSize(); ++i)
    {
        info.uk.push_back(uk[i]);
        info.um.push_back(static_cast<int>(um[i]));
    }
    for (ULONG i = 0; i < vk.GetSize(); ++i)
    {
        info.vk.push_back(vk[i]);
        info.vm.push_back(static_cast<int>(vm[i]));
    }
    if (w.GetSize())
    {
        bool varies = false;
        for (ULONG i = 0; i < w.GetSize(); ++i)
            varies = varies || std::abs(w[i] - w[0]) > 1e-14 * std::abs(w[0]);
        if (varies)
        {
            info.rational = true;
            SmTArray<SmPoint3d> wp;
            for (ULONG i = 0; i < w.GetSize(); ++i)
                wp.Add(SmPoint3d(w[i], 0.0, 0.0));
            SmBSplineSurface* ws = nullptr;
            check(SmBSplineSurface::CreateCanonical(ctx(), ud, vd, wp, SM_SF_UNSPECIFIED, um, vm, uk, vk, SM_KT_UNSPECIFIED,
                                                    nullptr, nullptr, ws),
                  "SmBSplineSurface::CreateCanonical");
            info.weight.reset(ws);
        }
    }
    return info;
}

struct CurveInfo
{
    bool nurbs = false;
    bool rational = false;
    int p = 3;
    std::vector<double> k;
    std::vector<int> m;
    std::unique_ptr<SmBSplineCurve> weight;
};

CurveInfo curve_info(const SmCurve* c)
{
    CurveInfo info;
    if (!c->IsKindOf(SmBSplineCurve_TYPE))
        return info;
    auto bc = static_cast<const SmBSplineCurve*>(c);
    ULONG dim = 0, deg = 0;
    SmTArray<SmPoint3d> poles;
    SmBSplineCurveForm form;
    SmTArray<ULONG> mults;
    SmTArray<double> knots, w;
    SmKnotType kt;
    if (bc->GetCanonical(dim, deg, poles, form, mults, knots, kt, w) != SM_SUCCESS)
        return info;
    info.nurbs = true;
    info.p = static_cast<int>(deg);
    for (ULONG i = 0; i < knots.GetSize(); ++i)
    {
        info.k.push_back(knots[i]);
        info.m.push_back(static_cast<int>(mults[i]));
    }
    if (w.GetSize())
    {
        bool varies = false;
        for (ULONG i = 0; i < w.GetSize(); ++i)
            varies = varies || std::abs(w[i] - w[0]) > 1e-14 * std::abs(w[0]);
        if (varies)
        {
            info.rational = true;
            SmTArray<SmPoint3d> wp;
            for (ULONG i = 0; i < w.GetSize(); ++i)
                wp.Add(SmPoint3d(w[i], 0.0, 0.0));
            SmBSplineCurve* wc = nullptr;
            check(SmBSplineCurve::CreateCanonical(ctx(), 3, deg, wp, SM_CF_UNSPECIFIED, mults, knots, SM_KT_UNSPECIFIED,
                                                  nullptr, nullptr, wc),
                  "SmBSplineCurve::CreateCanonical");
            info.weight.reset(wc);
        }
    }
    return info;
}

// The knots of the original inside [a, b] as breaks, with the original's continuity at each.
Breaks breaks_in(const std::vector<double>& knots, const std::vector<int>& mults, int degree, double a, double b)
{
    Breaks out;
    out.at.push_back(a);
    out.cont.push_back(0);
    const double eps = 1e-12 * std::max(1.0, std::abs(b - a));
    for (size_t i = 0; i < knots.size(); ++i)
        if (knots[i] > a + eps && knots[i] < b - eps)
        {
            out.at.push_back(knots[i]);
            out.cont.push_back(i < mults.size() ? std::max(0, degree - mults[i]) : 0);
        }
    out.at.push_back(b);
    out.cont.push_back(0);
    return out;
}

// The part of a face's surface that its trim curves use (with the convex hull of their control
// points, so every trim curve lies inside).
SmExtent2d face_box(SmFace* face)
{
    SmExtent2d nat = face->GetSurface()->GetNaturalUVDomain();
    double u0 = kInf, u1 = -kInf, v0 = kInf, v1 = -kInf;
    SmFaceuse* fu = face->GetUpwardFaceuse();
    if (fu)
    {
        SmTArray<SmEdgeuse*> eus;
        fu->GetEdgeuses(eus);
        for (ULONG i = 0; i < eus.GetSize(); ++i)
        {
            SmBSplineCurve* pc = eus[i]->GetUVTrimCurve();
            if (!pc)
                continue;
            ULONG dim = 0, deg = 0;
            SmTArray<SmPoint3d> poles;
            SmBSplineCurveForm form;
            SmTArray<ULONG> mults;
            SmTArray<double> knots, w;
            SmKnotType kt;
            if (pc->GetCanonical(dim, deg, poles, form, mults, knots, kt, w) != SM_SUCCESS)
                continue;
            for (ULONG k = 0; k < poles.GetSize(); ++k)
            {
                u0 = std::min(u0, poles[k].x);
                u1 = std::max(u1, poles[k].x);
                v0 = std::min(v0, poles[k].y);
                v1 = std::max(v1, poles[k].y);
            }
        }
    }
    if (!(u0 < u1) || !(v0 < v1))
        return face->GetUVDomain();
    u0 = std::max(u0, nat.GetUMin());
    u1 = std::min(u1, nat.GetUMax());
    v0 = std::max(v0, nat.GetVMin());
    v1 = std::min(v1, nat.GetVMax());
    if (!(u0 < u1) || !(v0 < v1))
        return face->GetUVDomain();
    return SmExtent2d(SmPoint2d(u0, v0), SmPoint2d(u1, v1));
}

SmSurface* map_surface(SmFace* face, const Piece& piece, const Deformation& def, Stats& st)
{
    const SmSurface* s = face->GetSurface();
    if (piece.kind == Piece::IDENTITY)
    {
        ++st.faces_kept;
        return nullptr;
    }
    if (piece.kind == Piece::RIGID)
    {
        SmSurface* copy = nullptr;
        check(s->Copy(ctx(), copy), "SmSurface::Copy");
        check(copy->Transform(piece.placement), "SmSurface::Transform");
        ++st.faces_exact;
        return copy;
    }
    SurfaceInfo info = surface_info(s);
    SmExtent2d box = face_box(face);
    SurfFit fit;
    const Breaks ub = breaks_in(info.uk, info.um, info.p, box.GetUMin(), box.GetUMax());
    const Breaks vb = breaks_in(info.vk, info.vm, info.q, box.GetVMin(), box.GetVMax());
    const SmSurface* wsurf = info.weight.get();
    auto fn = [&](int e) -> SurfFn {
        return [s, wsurf, e, &piece](double u, double v) {
            SmPoint3d p;
            check(s->EvaluatePoint(SmPoint2d(u, v), p), "SmSurface::EvaluatePoint");
            SmPoint3d q = piece.map(p);
            double w = 1.0;
            if (wsurf && e > 0)
            {
                SmPoint3d wp;
                check(wsurf->EvaluatePoint(SmPoint2d(u, v), wp), "SmSurface::EvaluatePoint");
                w = std::pow(wp.x, e);
            }
            return hom(q, w);
        };
    };
    bool done = false;
    if (info.nurbs && piece.degree >= 1)
    {
        const int cu = std::min(piece.degree * info.p, def.max_degree);
        const int cv = std::min(piece.degree * info.q, def.max_degree);
        for (int e = info.rational ? 1 : 0; e <= (info.rational ? piece.degree : 0) && !done; ++e)
            done = fit_exact_surface(fn(e), fit, ub, vb, cu, cv, def.exact_tol, def.max_exact_points);
    }
    if (!done)
    {
        // A twist or bend: the original's degree may still be exact in one direction.
        const int e = info.rational ? 1 : 0;
        fit_approx_surface(fn(e), fit, ub, vb, info.nurbs ? info.p : 3, info.nurbs ? info.q : 3, 0.5 * def.tolerance,
                           def.exact_tol, def.approx_degree);
        fit.exact = fit.err <= def.exact_tol;
    }
    SmBSplineSurface* out = build_surface(fit, fit.exact ? def.exact_tol : 0.25 * def.tolerance);
    if (fit.exact)
        ++st.faces_exact;
    else
    {
        ++st.faces_approx;
        st.max_error = std::max(st.max_error, fit.err + 0.25 * def.tolerance);
    }
    st.max_degree = std::max({st.max_degree, fit.su.d, fit.sv.d});
    return out;
}

// The image of a curve over the interval `ivl` of its parameters (an edge's curve, or a
// standalone curve), fitted keeping its parameters; null where the piece leaves it as it is.
SmCurve* map_curve(const SmCurve* c, const SmExtent1d& ivl, const Piece& piece, const Deformation& def, Stats& st)
{
    if (!c || piece.kind == Piece::IDENTITY)
    {
        ++st.edges_kept;
        return nullptr;
    }
    if (piece.kind == Piece::RIGID)
    {
        SmCurve* copy = nullptr;
        check(c->Copy(ctx(), copy), "SmCurve::Copy");
        check(copy->Transform(piece.placement), "SmCurve::Transform");
        ++st.edges_exact;
        return copy;
    }
    CurveInfo info = curve_info(c);
    CurveFit fit;
    const Breaks tb = breaks_in(info.k, info.m, info.p, ivl.GetMin(), ivl.GetMax());
    const SmCurve* wcurve = info.weight.get();
    auto fn = [&](int e) -> CurveFn {
        return [c, wcurve, e, &piece](double t) {
            SmPoint3d p;
            check(c->EvaluatePoint(t, p), "SmCurve::EvaluatePoint");
            SmPoint3d q = piece.map(p);
            double w = 1.0;
            if (wcurve && e > 0)
            {
                SmPoint3d wp;
                check(wcurve->EvaluatePoint(t, wp), "SmCurve::EvaluatePoint");
                w = std::pow(wp.x, e);
            }
            return hom(q, w);
        };
    };
    bool done = false;
    if (info.nurbs && piece.degree >= 1)
    {
        const int cap = std::min(piece.degree * info.p, def.max_degree);
        for (int e = info.rational ? 1 : 0; e <= (info.rational ? piece.degree : 0) && !done; ++e)
            done = fit_exact_curve(fn(e), fit, tb, cap, def.exact_tol);
    }
    if (!done)
    {
        fit_approx_curve(fn(info.rational ? 1 : 0), fit, tb, info.nurbs ? info.p : 3, 0.5 * def.tolerance,
                         def.exact_tol, def.approx_degree);
        fit.exact = fit.err <= def.exact_tol;
    }
    SmBSplineCurve* out = build_curve(fit, fit.exact ? def.exact_tol : 0.25 * def.tolerance);
    if (fit.exact)
        ++st.edges_exact;
    else
    {
        ++st.edges_approx;
        st.max_error = std::max(st.max_error, fit.err + 0.25 * def.tolerance);
    }
    st.max_degree = std::max(st.max_degree, fit.s.d);
    return out;
}

SmCurve* map_curve(SmEdge* edge, const Piece& piece, const Deformation& def, Stats& st)
{
    return map_curve(edge->GetCurve(), edge->GetInterval(), piece, def, st);
}

// ---------------------------------------------------------------------------
// Whole Breps
// ---------------------------------------------------------------------------

struct Topology
{
    SmTArray<SmFace*> faces;
    SmTArray<SmEdge*> edges;
    SmTArray<SmVertex*> vertices;
    std::vector<int> face_piece, edge_piece, vertex_piece;
};

// Which piece of the deformation each face, edge and vertex goes through. A face is classified by
// a point inside it (faces must not cross a region boundary: the caller imprints the boundaries);
// edges and vertices follow their faces, preferring the deforming piece on a region boundary,
// where the maps agree.
void classify(SmBrep& brep, const Deformation& def, Topology& topo)
{
    brep.GetFaces(topo.faces);
    brep.GetEdges(topo.edges);
    brep.GetVertices(topo.vertices);
    topo.face_piece.assign(topo.faces.GetSize(), 0);
    topo.edge_piece.assign(topo.edges.GetSize(), -1);
    topo.vertex_piece.assign(topo.vertices.GetSize(), -1);
    if (def.pieces.size() == 1)
    {
        std::fill(topo.edge_piece.begin(), topo.edge_piece.end(), 0);
        std::fill(topo.vertex_piece.begin(), topo.vertex_piece.end(), 0);
        return;
    }
    if (!def.faces.empty() && def.faces.size() != topo.faces.GetSize())
        throw std::invalid_argument("faces: one piece per face of the Brep");
    std::unordered_map<const SmFace*, int> fp;
    for (ULONG i = 0; i < topo.faces.GetSize(); ++i)
    {
        if (!def.faces.empty())
            topo.face_piece[i] = def.faces[i];
        else
        {
            SmPoint3d p;
            if (SmApiFaceInternalPoint(topo.faces[i], p) != SM_SUCCESS)
            {
                SmExtent3d box;
                topo.faces[i]->CalculateBoundingBox(box);
                p = box.GetMid();
            }
            topo.face_piece[i] = def.piece_at(p);
        }
        fp[topo.faces[i]] = topo.face_piece[i];
    }
    auto rank = [&](int i) {
        const Piece::Kind k = def.pieces[i]->kind;
        return (k == Piece::VOLUME || k == Piece::LATTICE) ? 2 : (k == Piece::RIGID ? 1 : 0);
    };
    std::unordered_map<const SmEdge*, int> ep;
    for (ULONG i = 0; i < topo.edges.GetSize(); ++i)
    {
        SmTArray<SmFace*> faces;
        topo.edges[i]->GetFaces(faces);
        int best = -1;
        for (ULONG k = 0; k < faces.GetSize(); ++k)
        {
            auto it = fp.find(faces[k]);
            if (it != fp.end() && (best < 0 || rank(it->second) > rank(best)))
                best = it->second;
        }
        if (best < 0)
        {
            SmPoint3d mid;
            SmExtent1d ivl = topo.edges[i]->GetInterval();
            topo.edges[i]->GetCurve()->EvaluatePoint(ivl.Evaluate(0.5), mid);
            best = def.piece_at(mid);
        }
        topo.edge_piece[i] = best;
        ep[topo.edges[i]] = best;
    }
    for (ULONG i = 0; i < topo.vertices.GetSize(); ++i)
    {
        SmTArray<SmEdge*> edges;
        topo.vertices[i]->GetEdges(edges);
        int best = -1;
        for (ULONG k = 0; k < edges.GetSize(); ++k)
        {
            auto it = ep.find(edges[k]);
            if (it != ep.end() && (best < 0 || rank(it->second) > rank(best)))
                best = it->second;
        }
        if (best < 0)
        {
            SmTArray<SmFace*> faces;
            topo.vertices[i]->GetFaces(faces);
            for (ULONG k = 0; k < faces.GetSize(); ++k)
            {
                auto it = fp.find(faces[k]);
                if (it != fp.end() && (best < 0 || rank(it->second) > rank(best)))
                    best = it->second;
            }
        }
        topo.vertex_piece[i] = best >= 0 ? best : def.piece_at(topo.vertices[i]->GetPoint());
    }
}

// The UV trim curves of a Brep, copied, so they can be put back after the face surfaces and edge
// curves were replaced (replacing geometry deletes them; the parameterization is kept, so they
// stay valid).
struct SavedTrims
{
    std::vector<std::pair<SmEdgeuse*, SmBSplineCurve*>> items;
    ~SavedTrims()
    {
        for (auto& it : items)
            delete it.second;
    }
    void save(const SmTArray<SmEdge*>& edges)
    {
        std::unordered_set<SmEdgeuse*> seen;
        for (ULONG i = 0; i < edges.GetSize(); ++i)
        {
            SmTArray<SmEdgeuse*> eus;
            edges[i]->GetEdgeuses(eus);
            for (ULONG k = 0; k < eus.GetSize(); ++k)
            {
                SmEdgeuse* owner = nullptr;
                SmBSplineCurve* pc = eus[k]->GetUVTrimCurve(&owner);
                if (!pc)
                {
                    SmBSplineCurve* created = nullptr;
                    if (eus[k]->GetOrCreateUVTrimCurve(created) == SM_SUCCESS)
                        pc = eus[k]->GetUVTrimCurve(&owner);
                }
                if (!pc || !owner || !seen.insert(owner).second)
                    continue;
                SmCurve* copy = nullptr;
                check(pc->Copy(ctx(), copy), "SmBSplineCurve::Copy");
                items.emplace_back(owner, static_cast<SmBSplineCurve*>(copy));
            }
        }
    }
    void restore()
    {
        for (auto& it : items)
        {
            it.first->SetUVTrimCurve(it.second, 0.0, TRUE);
            it.second = nullptr;
        }
    }
};

smlibpy::DeformStats stats_of(const Stats& st)
{
    smlibpy::DeformStats d;
    d.faces_kept = st.faces_kept;
    d.faces_exact = st.faces_exact;
    d.faces_approximated = st.faces_approx;
    d.edges_kept = st.edges_kept;
    d.edges_exact = st.edges_exact;
    d.edges_approximated = st.edges_approx;
    d.faces_analytic = st.faces_analytic;
    d.edges_analytic = st.edges_analytic;
    d.max_error = st.max_error;
    d.max_degree = st.max_degree;
    return d;
}

double model_size(const SmBrep* brep)
{
    SmExtent3d box;
    if (brep->CalculateBoundingBox(box, FALSE) != SM_SUCCESS)
        return 1.0;
    return box.GetSize().Length();
}

// Whether a surface is analytic (a plane, cylinder, cone, sphere, torus, ...) rather than a NURBS.
bool is_analytic(const SmSurface* s) { return s && s->GetType() != SmBSplineSurface_TYPE; }

// One attempt at the deformed Brep. With `fresh`, faces and edges whose image is new analytic
// geometry get it (their trim curves are built again); null if that fails, and the caller tries
// again without.
SmBrep* build(const SmBrep* brep, const Deformation& def, bool fresh, Stats& st)
{
    SmBrep* out = new (ctx()) SmBrep(*brep, nullptr, nullptr, TRUE, FALSE);
    try
    {
        Topology topo;
        classify(*out, def, topo);
        SavedTrims trims;
        trims.save(topo.edges);

        // all new geometry from the unchanged copy first: analytic images where they are
        const ULONG nf = topo.faces.GetSize(), ne = topo.edges.GetSize();
        std::vector<SmSurface*> surfaces(nf, nullptr), new_surfaces(nf, nullptr);
        std::vector<SmCurve*> curves(ne, nullptr), new_curves(ne, nullptr);
        std::vector<SmPoint3d> points(topo.vertices.GetSize());
        std::unordered_set<const SmFace*> analytic_faces;  // analytic when done
        auto deforming = [&](const Piece& piece) {
            return def.analytic && (piece.kind == Piece::VOLUME || piece.kind == Piece::LATTICE);
        };
        try
        {
            for (ULONG i = 0; i < nf; ++i)
            {
                const Piece& piece = *def.pieces[topo.face_piece[i]];
                if (deforming(piece))
                {
                    const smlibpy::analytic::SurfaceImage image = smlibpy::analytic::surface_image(
                        topo.faces[i], face_box(topo.faces[i]), [&piece](const SmPoint3d& q) { return piece.map(q); },
                        piece.axes, def.exact_tol);
                    if (image.surface && (image.same || fresh))
                    {
                        // new geometry goes in with its trim curves at the end; the face keeps its
                        // surface and trims until then
                        (image.same ? surfaces : new_surfaces)[i] = image.surface;
                        if (is_analytic(image.surface))
                            analytic_faces.insert(topo.faces[i]);
                        ++st.faces_exact, ++st.faces_analytic;
                        continue;
                    }
                    delete image.surface;
                }
                surfaces[i] = map_surface(topo.faces[i], piece, def, st);
                if (is_analytic(surfaces[i] ? surfaces[i] : topo.faces[i]->GetSurface()))
                    analytic_faces.insert(topo.faces[i]);
            }
            for (ULONG i = 0; i < ne; ++i)
            {
                const Piece& piece = *def.pieces[topo.edge_piece[i]];
                if (deforming(piece) && topo.edges[i]->GetCurve())
                {
                    const smlibpy::analytic::CurveImage image = smlibpy::analytic::curve_image(
                        topo.edges[i], [&piece](const SmPoint3d& q) { return piece.map(q); }, def.exact_tol);
                    // a new curve only where all faces of the edge are analytic: on a fitted face the
                    // old trim curve is exact, a curve dropped onto it would not be
                    bool ok = image.curve && (image.same || fresh);
                    if (ok && !image.same)
                    {
                        SmTArray<SmFace*> faces;
                        topo.edges[i]->GetFaces(faces);
                        ok = faces.GetSize() > 0;
                        for (ULONG k = 0; k < faces.GetSize() && ok; ++k)
                            ok = analytic_faces.count(faces[k]) > 0;
                    }
                    if (ok)
                    {
                        (image.same ? curves : new_curves)[i] = image.curve;
                        ++st.edges_exact, ++st.edges_analytic;
                        continue;
                    }
                    delete image.curve;
                }
                curves[i] = map_curve(topo.edges[i], piece, def, st);
            }
            for (ULONG i = 0; i < topo.vertices.GetSize(); ++i)
                points[i] = def.pieces[topo.vertex_piece[i]]->map(topo.vertices[i]->GetPoint());
        }
        catch (...)
        {
            for (auto* list : {&surfaces, &new_surfaces})
                for (SmSurface* s : *list)
                    delete s;
            for (auto* list : {&curves, &new_curves})
                for (SmCurve* c : *list)
                    delete c;
            throw;
        }
        // the new geometry is owned here until swap_in takes it
        struct Pending
        {
            std::vector<SmSurface*>& surfaces;
            std::vector<SmCurve*>& curves;
            ~Pending()
            {
                for (SmSurface* s : surfaces)
                    delete s;
                for (SmCurve* c : curves)
                    delete c;
            }
        } pending{new_surfaces, new_curves};

        out->Notify(SM_NO_PRE_EDIT, out, nullptr, nullptr);
        std::vector<SmBoolean> rect(nf);
        for (ULONG i = 0; i < nf; ++i)
            rect[i] = topo.faces[i]->GetRectangularTrim();
        for (ULONG i = 0; i < nf; ++i)
            if (surfaces[i])
                topo.faces[i]->SetSurface(surfaces[i], TRUE);
        for (ULONG i = 0; i < ne; ++i)
            if (curves[i])
            {
                SmExtent1d ivl = topo.edges[i]->GetInterval();
                check(topo.edges[i]->Replace3DCurve(curves[i]), "SmEdge::Replace3DCurve");
                topo.edges[i]->SetInterval(ivl);
            }
        for (ULONG i = 0; i < topo.vertices.GetSize(); ++i)
        {
            topo.vertices[i]->Notify(SM_NO_PRE_EDIT, topo.vertices[i], out, nullptr);
            topo.vertices[i]->SetPoint(points[i]);
        }
        trims.restore();
        for (ULONG i = 0; i < nf; ++i)
            topo.faces[i]->SetIsRectangularTrim(rect[i]);
        out->Notify(SM_NO_POST_EDIT, out, nullptr, nullptr);

        // the new analytic geometry, with trim curves built again
        std::vector<std::pair<SmFace*, SmSurface*>> faces;
        std::vector<std::pair<SmEdge*, SmCurve*>> edges;
        for (ULONG i = 0; i < nf; ++i)
            if (new_surfaces[i])
                faces.emplace_back(topo.faces[i], std::exchange(new_surfaces[i], nullptr));
        for (ULONG i = 0; i < ne; ++i)
            if (new_curves[i])
                edges.emplace_back(topo.edges[i], std::exchange(new_curves[i], nullptr));
        if ((!faces.empty() || !edges.empty()) &&
            !smlibpy::analytic::swap_in(*out, faces, edges, def.tolerance, 10.0 * def.exact_tol))
        {
            delete out;
            return nullptr;
        }
    }
    catch (...)
    {
        delete out;
        throw;
    }
    return out;
}

smlibpy::Deformed deform(const SmBrep* brep, const smlibpy::DeformSpec& spec)
{
    std::unique_ptr<Deformation> def = make_deformation(spec, model_size(brep));
    Stats st;
    SmBrep* out = build(brep, *def, def->analytic, st);
    if (!out)
    {
        // a trim curve on new analytic geometry failed: fit those faces and edges instead
        st = Stats();
        out = build(brep, *def, false, st);
    }
    return {out, stats_of(st)};
}

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

// The parameters in (t0, t1) where a curve crosses the ends of the pieces along the deformation's
// axis: sign changes of the distance to each end's plane on a dense sampling (64 points per knot
// span of a B-spline, 512 at least), refined by bisection.
std::vector<double> crossings(const SmCurve* c, double t0, double t1, const Deformation& def, double size)
{
    std::vector<double> cuts;
    if (!def.has_axis || def.pieces.size() < 2 || !(t1 > t0))
        return cuts;
    std::vector<double> ends;
    for (size_t i = 0; i + 1 < def.pieces.size(); ++i)
        if (std::abs(def.pieces[i]->hi) < kInf)
            ends.push_back(def.pieces[i]->hi);
    if (ends.empty())
        return cuts;
    std::vector<double> ts;
    {
        const CurveInfo info = curve_info(c);
        const int n = std::clamp(64 * static_cast<int>(info.k.size()), 512, 1 << 16);
        for (int k = 0; k <= n; ++k)
            ts.push_back(t0 + (t1 - t0) * k / n);
    }
    auto along = [&](double t) {
        SmPoint3d p;
        check(c->EvaluatePoint(t, p), "SmCurve::EvaluatePoint");
        return (p - def.origin).Dot(def.direction);
    };
    std::vector<double> h(ts.size());
    for (size_t k = 0; k < ts.size(); ++k)
        h[k] = along(ts[k]);
    const double eps = 1e-12 * std::max(1.0, size);
    for (const double e : ends)
    {
        auto sign = [&](double x) { return x - e > eps ? 1 : (x - e < -eps ? -1 : 0); };
        int last = 0;
        size_t at = 0;
        for (size_t k = 0; k < ts.size(); ++k)
        {
            const int sk = sign(h[k]);
            if (sk == 0)
                continue;
            if (last != 0 && sk != last)
            {
                // a crossing between ts[at] (side `last`) and ts[k]
                double a = ts[at], b = ts[k];
                for (int it = 0; it < 200 && b - a > 1e-15 * std::max(1.0, std::abs(t1 - t0)); ++it)
                {
                    const double m = 0.5 * (a + b);
                    if ((along(m) > e) == (last > 0))  // (the exact crossing, not the edge of the band)
                        a = m;
                    else
                        b = m;
                }
                cuts.push_back(0.5 * (a + b));
            }
            last = sk, at = k;
        }
    }
    std::sort(cuts.begin(), cuts.end());
    std::vector<double> out;
    const double gap = 1e-12 * std::max(1.0, std::abs(t1 - t0));
    for (double t : cuts)
        if (t - t0 > gap && t1 - t > gap && (out.empty() || t - out.back() > gap))
            out.push_back(t);
    return out;
}

// A curve sent through the deformation: split where it crosses the ends of the pieces, every
// segment mapped by its piece (an analytic image where it is one, else fitted like the edges of a
// Brep). The curves are the caller's.
smlibpy::DeformedCurve deform_curve_impl(const SmCurve* curve, const smlibpy::DeformSpec& spec)
{
    if (!curve)
        throw std::invalid_argument("deform_curve: no curve");
    const SmExtent1d ivl = curve->GetNaturalInterval();
    const double t0 = ivl.GetMin(), t1 = ivl.GetMax();
    if (!(t1 > t0))
        throw std::invalid_argument("deform_curve: the curve has no length");
    // its size, for the tolerances
    double size = 0.0;
    {
        SmPoint3d first, p;
        check(curve->EvaluatePoint(t0, first), "SmCurve::EvaluatePoint");
        for (int k = 1; k <= 32; ++k)
        {
            check(curve->EvaluatePoint(t0 + (t1 - t0) * k / 32, p), "SmCurve::EvaluatePoint");
            size = std::max(size, first.DistanceBetween(p));
        }
    }
    std::unique_ptr<Deformation> def = make_deformation(spec, std::max(size, 1.0));
    std::vector<double> breaks{t0};
    for (double t : crossings(curve, t0, t1, *def, size))
        breaks.push_back(t);
    breaks.push_back(t1);

    Stats st;
    std::vector<std::unique_ptr<SmCurve>> out;
    for (size_t i = 0; i + 1 < breaks.size(); ++i)
    {
        const double a = breaks[i], b = breaks[i + 1];
        SmPoint3d mid;
        check(curve->EvaluatePoint(0.5 * (a + b), mid), "SmCurve::EvaluatePoint");
        const Piece& piece = *def->pieces[def->piece_at(mid)];
        SmCurve* raw = nullptr;
        check(curve->Copy(ctx(), raw), "SmCurve::Copy");
        std::unique_ptr<SmCurve> segment(raw);
        if (breaks.size() > 2)
        {
            SmExtent1d part(a, b);
            check(segment->Trim(part), "SmCurve::Trim");
        }
        const SmExtent1d sivl = segment->GetNaturalInterval();
        SmCurve* mapped = nullptr;
        if (def->analytic && (piece.kind == Piece::VOLUME || piece.kind == Piece::LATTICE))
        {
            const smlibpy::analytic::CurveImage image = smlibpy::analytic::curve_image(
                segment.get(), sivl, [&piece](const SmPoint3d& q) { return piece.map(q); }, def->exact_tol);
            if (image.curve)
            {
                mapped = image.curve;
                ++st.edges_exact, ++st.edges_analytic;
            }
        }
        if (!mapped)
            mapped = map_curve(segment.get(), sivl, piece, *def, st);
        std::unique_ptr<SmCurve> result(mapped ? mapped : segment.release());
        // the NURBS data of analytic curves, built at once (the kernel builds it only when asked)
        if (result->IsKindOf(SmBSplineCurve_TYPE) &&
            !static_cast<SmBSplineCurve*>(result.get())->GetOrCreateGwNurbPointer())
            throw std::runtime_error("deform_curve: a deformed segment has no NURBS form");
        out.push_back(std::move(result));
    }
    smlibpy::DeformedCurve r;
    r.stats = stats_of(st);
    for (auto& c : out)
        r.curves.push_back(c.release());
    return r;
}

// A curve (a procedural one, such as the kernel's SmCrvInVolume) fitted over [t0, t1] keeping its
// parameters, on the knots of `base` (the original it maps): exact where it is polynomial of the
// original's degree, quintic splines whose spans are halved elsewhere (as the edges of a deformed
// Brep). Null when it cannot be fitted within the tolerance.
SmBSplineCurve* fit_keeping_impl(const SmCurve* curve, const SmCurve* base, double t0, double t1, double tolerance)
{
    if (!curve || !(t1 > t0) || !(tolerance > 0.0))
        return nullptr;
    try
    {
        const CurveInfo info = curve_info(base ? base : curve);
        const SmCurve* wcurve = info.weight.get();
        const CurveFn fn = [curve, wcurve](double t) {
            SmPoint3d p;
            check(curve->EvaluatePoint(t, p), "SmCurve::EvaluatePoint");
            double w = 1.0;
            if (wcurve)
            {
                SmPoint3d wp;
                check(wcurve->EvaluatePoint(t, wp), "SmCurve::EvaluatePoint");
                w = wp.x;
            }
            return hom(p, w);
        };
        double size = 0.0;
        const SmPoint3d first = euclid(fn(t0));
        for (int k = 1; k <= 16; ++k)
            size = std::max(size, first.DistanceBetween(euclid(fn(t0 + (t1 - t0) * k / 16))));
        const double exact_tol = std::min(1e-11 * std::max(1.0, size), 0.01 * tolerance);
        CurveFit fit;
        fit_approx_curve(fn, fit, breaks_in(info.k, info.m, info.p, t0, t1), info.nurbs ? info.p : 3, 0.5 * tolerance,
                         exact_tol, 5);
        if (!(fit.err <= 0.5 * tolerance))
            return nullptr;
        return build_curve(fit, fit.err <= exact_tol ? exact_tol : 0.25 * tolerance);
    }
    catch (const std::exception&)
    {
        return nullptr;
    }
}

// The kernel's own composition (SmSrfInVolume / SmCrvInVolume, procedural and exact), for checks.
SmBrep* composite(const SmBrep* brep, const smlibpy::DeformSpec& spec)
{
    std::unique_ptr<Deformation> def = make_deformation(spec, model_size(brep));
    SmBrep* out = new (ctx()) SmBrep(*brep, nullptr, nullptr, TRUE, FALSE);
    try
    {
        Topology topo;
        classify(*out, *def, topo);
        SavedTrims trims;
        trims.save(topo.edges);
        out->Notify(SM_NO_PRE_EDIT, out, nullptr, nullptr);
        for (ULONG i = 0; i < topo.faces.GetSize(); ++i)
        {
            const Piece& piece = *def->pieces[topo.face_piece[i]];
            if (piece.kind == Piece::IDENTITY)
                continue;
            if (!piece.volume)
                throw std::invalid_argument("composite_brep: lattices have no kernel volume in this kernel build");
            SmSurface* old = topo.faces[i]->GetSurface();
            auto* mapped = new (ctx()) SmSrfInVolume(*old, FALSE, *piece.volume, 3, 3);
            topo.faces[i]->SetSurface(mapped, TRUE);
        }
        for (ULONG i = 0; i < topo.edges.GetSize(); ++i)
        {
            const Piece& piece = *def->pieces[topo.edge_piece[i]];
            if (piece.kind == Piece::IDENTITY || !topo.edges[i]->GetCurve())
                continue;
            if (!piece.volume)
                throw std::invalid_argument("composite_brep: lattices have no kernel volume in this kernel build");
            SmExtent1d ivl = topo.edges[i]->GetInterval();
            auto* mapped = new (ctx()) SmCrvInVolume(*topo.edges[i]->GetCurve(), FALSE, *piece.volume, 3, 3);
            check(topo.edges[i]->Replace3DCurve(mapped), "SmEdge::Replace3DCurve");
            topo.edges[i]->SetInterval(ivl);
        }
        for (ULONG i = 0; i < topo.vertices.GetSize(); ++i)
        {
            SmPoint3d p = def->pieces[topo.vertex_piece[i]]->map(topo.vertices[i]->GetPoint());
            topo.vertices[i]->Notify(SM_NO_PRE_EDIT, topo.vertices[i], out, nullptr);
            topo.vertices[i]->SetPoint(p);
        }
        trims.restore();
        out->Notify(SM_NO_POST_EDIT, out, nullptr, nullptr);
    }
    catch (...)
    {
        delete out;
        throw;
    }
    return out;
}

// Largest distance between the deformed Brep and the exact deformation of the original, compared
// at the same surface and curve parameters (the parameterization is kept), on an n x n grid per
// face, n points per edge and at the vertices.
smlibpy::Deviation distance(const SmBrep* src, const SmBrep* dst, const smlibpy::DeformSpec& spec, int n)
{
    std::unique_ptr<Deformation> def = make_deformation(spec, model_size(src));
    SmBrep* copy = new (ctx()) SmBrep(*src, nullptr, nullptr, TRUE, FALSE);
    std::unique_ptr<SmBrep> clean(copy);
    Topology topo;
    classify(*copy, *def, topo);
    SmTArray<SmFace*> faces;
    SmTArray<SmEdge*> edges;
    SmTArray<SmVertex*> vertices;
    dst->GetFaces(faces);
    dst->GetEdges(edges);
    dst->GetVertices(vertices);
    if (faces.GetSize() != topo.faces.GetSize() || edges.GetSize() != topo.edges.GetSize() ||
        vertices.GetSize() != topo.vertices.GetSize())
        throw std::invalid_argument("deviation: the Breps do not have the same topology");
    n = std::max(n, 2);
    double df = 0.0, de = 0.0, dv = 0.0;
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        const Piece& piece = *def->pieces[topo.face_piece[i]];
        const SmSurface* s0 = topo.faces[i]->GetSurface();
        const SmSurface* s1 = faces[i]->GetSurface();
        if (s1->GetType() != SmBSplineSurface_TYPE)
        {
            // analytic, with parameters of its own: the distance of the exact image of points of
            // the source face from the face
            const SmExtent2d box = face_box(topo.faces[i]);
            for (int a = 0; a < n; ++a)
                for (int b = 0; b < n; ++b)
                {
                    SmPoint2d uv(box.GetUMin() + (a + 0.37) / n * (box.GetUMax() - box.GetUMin()),
                                 box.GetVMin() + (b + 0.61) / n * (box.GetVMax() - box.GetVMin()));
                    int cls = SM_PC_UNKNOWN;
                    if (SmApiFaceClassifyUV(topo.faces[i], uv, cls) != SM_SUCCESS || cls == SM_PC_UNKNOWN)
                        continue;
                    SmPoint3d p0, near;
                    double gap = 0.0;
                    check(s0->EvaluatePoint(uv, p0), "SmSurface::EvaluatePoint");
                    check(SmApiFaceClosestPoint(faces[i], piece.map(p0), near, gap), "SmApiFaceClosestPoint");
                    df = std::max(df, gap);
                }
            continue;
        }
        SmExtent2d box = s1->GetNaturalUVDomain();
        for (int a = 0; a < n; ++a)
            for (int b = 0; b < n; ++b)
            {
                SmPoint2d uv(box.GetUMin() + (a + 0.37) / n * (box.GetUMax() - box.GetUMin()),
                             box.GetVMin() + (b + 0.61) / n * (box.GetVMax() - box.GetVMin()));
                SmPoint3d p0, p1;
                check(s0->EvaluatePoint(uv, p0), "SmSurface::EvaluatePoint");
                check(s1->EvaluatePoint(uv, p1), "SmSurface::EvaluatePoint");
                df = std::max(df, piece.map(p0).DistanceBetween(p1));
            }
    }
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        const Piece& piece = *def->pieces[topo.edge_piece[i]];
        const SmCurve* c0 = topo.edges[i]->GetCurve();
        const SmCurve* c1 = edges[i]->GetCurve();
        if (!c0 || !c1)
            continue;
        if (c1->GetType() != SmBSplineCurve_TYPE)
        {
            // analytic, with parameters of its own: the distance of the exact image from the curve
            const SmExtent1d ivl0 = topo.edges[i]->GetInterval();
            for (int a = 0; a <= n; ++a)
            {
                SmPoint3d p0, near;
                double param = 0.0, gap = 0.0;
                check(c0->EvaluatePoint(ivl0.Evaluate((a + 0.29) / (n + 1.0)), p0), "SmCurve::EvaluatePoint");
                check(SmApiCurveClosestPoint(c1, piece.map(p0), near, param, gap), "SmApiCurveClosestPoint");
                de = std::max(de, gap);
            }
            continue;
        }
        SmExtent1d ivl = edges[i]->GetInterval();
        for (int a = 0; a <= n; ++a)
        {
            const double t = ivl.Evaluate((a + 0.29) / (n + 1.0));
            SmPoint3d p0, p1;
            check(c0->EvaluatePoint(t, p0), "SmCurve::EvaluatePoint");
            check(c1->EvaluatePoint(t, p1), "SmCurve::EvaluatePoint");
            de = std::max(de, piece.map(p0).DistanceBetween(p1));
        }
    }
    for (ULONG i = 0; i < vertices.GetSize(); ++i)
        dv = std::max(dv, def->pieces[topo.vertex_piece[i]]->map(topo.vertices[i]->GetPoint())
                              .DistanceBetween(vertices[i]->GetPoint()));
    return {df, de, dv};
}

}  // namespace

namespace smlibpy {

Deformed deform_brep(const SmBrep* brep, const DeformSpec& spec) { return deform(brep, spec); }

SmBrep* composite_brep(const SmBrep* brep, const DeformSpec& spec) { return composite(brep, spec); }

DeformedCurve deform_curve(const SmCurve* curve, const DeformSpec& spec) { return deform_curve_impl(curve, spec); }

SmBSplineCurve* fit_curve_keeping_parameters(const SmCurve* curve, const SmCurve* base, double t0, double t1,
                                             double tolerance)
{
    return fit_keeping_impl(curve, base, t0, t1, tolerance);
}

Deviation deviation(const SmBrep* source, const SmBrep* result, const DeformSpec& spec, int samples)
{
    return distance(source, result, spec, samples);
}

std::vector<double> map_points(const DeformSpec& spec, const std::vector<double>& points)
{
    if (points.size() % 3 != 0)
        throw std::invalid_argument("expected points with three coordinates");
    std::unique_ptr<Deformation> def = make_deformation(spec, 1.0);
    std::vector<double> out;
    out.reserve(points.size());
    for (size_t i = 0; i < points.size(); i += 3)
    {
        SmPoint3d q(points[i], points[i + 1], points[i + 2]);
        SmPoint3d r = def->pieces[def->piece_at(q)]->map(q);
        out.insert(out.end(), {r.x, r.y, r.z});
    }
    return out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

namespace {

// The spec as smlibpy's Python sends it: a dict, its pieces dicts, with optional keys.
smlibpy::DeformSpec spec_from(const py::dict& d)
{
    smlibpy::DeformSpec spec;
    if (d.contains("axis") && !d["axis"].is_none())
    {
        spec.has_axis = true;
        spec.axis = py::cast<std::vector<double>>(d["axis"]);
    }
    for (auto item : py::cast<py::list>(d["pieces"]))
    {
        const py::dict p = py::cast<py::dict>(item);
        smlibpy::DeformPiece piece;
        piece.kind = py::cast<std::string>(p["kind"]);
        if (p.contains("lo"))
            piece.has_lo = true, piece.lo = py::cast<double>(p["lo"]);
        if (p.contains("hi"))
            piece.has_hi = true, piece.hi = py::cast<double>(p["hi"]);
        auto numbers = [&](const char* key, std::vector<double>& out) {
            if (p.contains(key))
                out = py::cast<std::vector<double>>(p[key]);
        };
        numbers("matrix", piece.matrix);
        numbers("origin", piece.origin);
        numbers("axis", piece.axis);
        numbers("mid", piece.mid);
        numbers("center", piece.center);
        numbers("size", piece.size);
        numbers("x", piece.x);
        numbers("y", piece.y);
        numbers("z", piece.z);
        numbers("points", piece.points);
        if (p.contains("counts"))
            piece.counts = py::cast<std::vector<int>>(p["counts"]);
        if (p.contains("period"))
            piece.period = py::cast<double>(p["period"]);
        if (p.contains("neutral"))
            piece.neutral = py::cast<double>(p["neutral"]);
        spec.pieces.push_back(std::move(piece));
    }
    if (d.contains("tolerance"))
        spec.has_tolerance = true, spec.tolerance = py::cast<double>(d["tolerance"]);
    if (d.contains("max_degree"))
        spec.has_max_degree = true, spec.max_degree = py::cast<int>(d["max_degree"]);
    if (d.contains("max_exact_points"))
        spec.has_max_exact_points = true, spec.max_exact_points = py::cast<size_t>(d["max_exact_points"]);
    if (d.contains("approx_degree"))
        spec.has_approx_degree = true, spec.approx_degree = py::cast<int>(d["approx_degree"]);
    if (d.contains("faces") && !d["faces"].is_none())
        spec.faces = py::cast<std::vector<int>>(d["faces"]);
    if (d.contains("analytic"))
        spec.has_analytic = true, spec.analytic = py::cast<bool>(d["analytic"]);
    return spec;
}

}  // namespace

void bind_deform(py::module_& parent)
{
    py::module_ m = parent.def_submodule("deform", "Space deformations of whole Breps: twist, taper, bend, lattice.");

    m.def("deform_brep", [](const SmBrep* brep, const py::dict& spec) {
        const smlibpy::DeformSpec s = spec_from(spec);
        const smlibpy::Deformed r = smlibpy::without_gil([&] { return smlibpy::deform_brep(brep, s); });
        py::dict d;
        d["faces_kept"] = r.stats.faces_kept;
        d["faces_exact"] = r.stats.faces_exact;
        d["faces_approximated"] = r.stats.faces_approximated;
        d["edges_kept"] = r.stats.edges_kept;
        d["edges_exact"] = r.stats.edges_exact;
        d["edges_approximated"] = r.stats.edges_approximated;
        d["faces_analytic"] = r.stats.faces_analytic;
        d["edges_analytic"] = r.stats.edges_analytic;
        d["max_error"] = r.stats.max_error;
        d["max_degree"] = r.stats.max_degree;
        return py::make_tuple(py::cast(r.brep, py::return_value_policy::take_ownership), d);
    }, py::arg("brep"), py::arg("spec"),
          "Send a copy of a Brep through a space deformation and convert every face and edge to NURBS "
          "(exact where the composition is polynomial, within spec['tolerance'] elsewhere), or to "
          "analytic geometry where the exact image is analytic (unless spec['analytic'] is False). The "
          "spec lists pieces of kernel volume maps (identity, rigid, affine, twist, bend, unbend, lattice) "
          "along an optional axis, or with spec['faces'] the piece of every face. Returns (brep, report).");

    m.def("deform_curve", [](const SmCurve* curve, const py::dict& spec) {
        const smlibpy::DeformedCurve r = smlibpy::deform_curve(curve, spec_from(spec));
        py::list curves;
        for (SmCurve* c : r.curves)
            curves.append(py::cast(c, py::return_value_policy::take_ownership));
        py::dict d;
        d["edges_kept"] = r.stats.edges_kept;
        d["edges_exact"] = r.stats.edges_exact;
        d["edges_approximated"] = r.stats.edges_approximated;
        d["edges_analytic"] = r.stats.edges_analytic;
        d["max_error"] = r.stats.max_error;
        d["max_degree"] = r.stats.max_degree;
        return py::make_tuple(curves, d);
    }, py::arg("curve"), py::arg("spec"),
          "Send a copy of a curve (over its natural interval) through a space deformation: split where it "
          "crosses the ends of the pieces along the spec's axis, every segment an analytic image (line, "
          "circle, moved copy) where it is one, else NURBS (exact where the composition is polynomial, within "
          "spec['tolerance'] elsewhere). Returns (curves, report): the segments in order, the caller's.");

    m.def("composite_brep", [](const SmBrep* brep, const py::dict& spec) {
        const smlibpy::DeformSpec s = spec_from(spec);
        return smlibpy::without_gil([&] { return smlibpy::composite_brep(brep, s); });
    }, py::arg("brep"), py::arg("spec"), py::return_value_policy::take_ownership,
          "The kernel's exact procedural composition (SmSrfInVolume faces, SmCrvInVolume edges) of a "
          "copy of a Brep with the deformation, for checks.");

    m.def("deviation", [](const SmBrep* source, const SmBrep* result, const py::dict& spec, int samples) {
        const smlibpy::DeformSpec s = spec_from(spec);
        const smlibpy::Deviation r = smlibpy::without_gil([&] { return smlibpy::deviation(source, result, s, samples); });
        py::dict d;
        d["faces"] = r.faces;
        d["edges"] = r.edges;
        d["vertices"] = r.vertices;
        return d;
    }, py::arg("source"), py::arg("result"), py::arg("spec"), py::arg("samples") = 9,
          "Largest distance between a deformed Brep and the exact deformation of its source at the same "
          "parameters: {'faces', 'edges', 'vertices'}.");

    m.def("map_points", [](const py::dict& spec, const std::vector<std::vector<double>>& points) {
        std::vector<double> flat;
        flat.reserve(points.size() * 3);
        for (const auto& p : points)
        {
            if (p.size() != 3)
                throw std::invalid_argument("expected points with three coordinates");
            flat.insert(flat.end(), p.begin(), p.end());
        }
        const std::vector<double> mapped = smlibpy::map_points(spec_from(spec), flat);
        py::list out;
        for (size_t i = 0; i < mapped.size(); i += 3)
            out.append(py::make_tuple(mapped[i], mapped[i + 1], mapped[i + 2]));
        return out;
    }, py::arg("spec"), py::arg("points"), "Map points through a deformation.");
}
#endif  // SMLIBPY_PYTHON
