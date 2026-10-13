// SPDX-License-Identifier: Apache-2.0
//
// Areas, volumes, moments and curve lengths with an error estimate (`smlibpy._core.ext`).
//
//   brep_measure(brep, tolerance)                area, volume, first and second moments of a body
//   face_measure(face, tolerance)                area and first moments of one face
//   curve_length(curve, t0, t1)                  arc length
//   curve_parameter_at_length(curve, t, length)  the parameter at an arc length from t
//
// The kernel's own integration (SmBrep/SmFace::ComputePreciseProperties) nests two Runge-Kutta
// ODE integrations: along the trim curves, and inside along iso-parameter lines. Their step
// control looks at one component only, the area, and measures it against the running sum
// along each trim curve. Every other component (volume, moments) is integrated with the steps
// the area needed, so its error is not bounded: on a swept helix the area element hardly
// changes along the path while the volume integrand does, and the volume comes out 300 times
// worse than the requested accuracy. SmCurve::Length integrates each Bezier span with the same
// ODE integrator, which gives up on a span whose curve starts with a zero tangent (a doubled
// control point); SmIntegrator::IntegrateIt then counts that span as 0.
//
// Here the faces are integrated with the same Green's theorem, over the same oriented trim
// curves in the parameter plane (SmFace::CreateOrientedTrimBoundary):
//
//   integral of g over the face  =  closed integral of -G du,   G(u, v) = integral of g(u, s) ds from v0 to v
//                                =  closed integral of  H dv,   H(u, v) = integral of g(s, v) ds from u0 to u
//
// with adaptive Gauss-Kronrod (7/15) quadrature on both levels and an error estimate for every
// component. The inner integrals run in the parameter direction with fewer knot spans (on a
// plane, a 3-point Gauss rule is exact); both levels are split at knots, where the integrands
// lose smoothness. The outer level is globally adaptive over all faces of the body: panels are
// bisected, largest error first, until the estimated error of every quantity is below
// `tolerance` times its scale:
//
//   area                    tolerance * area
//   volume                  tolerance * |volume|
//   first moments           tolerance * |volume| * size      (the centre: about tolerance * size)
//   second moments          tolerance * |volume| * size^2    (the inertia: relative to its largest moment)
//
// where size is the diagonal of the bounding box. Faces and faceuses are taken as
// SmBrep::ComputePreciseProperties takes them with the default SmMassPropertyBehavior, and the
// integrands are the kernel's (volume terms from fields such as (0, 0, z)), so the results
// are the values the kernel's integration converges to.

#include "ext.h"

#include <SmApiGeneral.h>
#include <SmBrep.h>
#include <SmFace.h>
#include <SmFaceuse.h>
#include <SmRegion.h>
#include <SmShell.h>
#include <SmSurface.h>
#include <SmPlane.h>
#include <SmBSplineCurve.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <vector>

namespace
{

const SmContext& context() { return *SmApiGetOrCreateContext(); }

void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(status, what, __FILE__, __LINE__);
}

// ---------------------------------------------------------------------------
// Gauss-Kronrod 7/15 (QUADPACK qk15)
// ---------------------------------------------------------------------------

constexpr double kXGK[8] = {0.991455371120812639206854697526329, 0.949107912342758524526189684047851,
                            0.864864423359769072789712788640926, 0.741531185599394439863864773280788,
                            0.586087235467691130294144845693013, 0.405845151377397166906606412076961,
                            0.207784955007898467600689403773245, 0.000000000000000000000000000000000};
constexpr double kWGK[8] = {0.022935322010529224963732008058970, 0.063092092629978553290700663189204,
                            0.104790010322250183839876322541518, 0.140653259715525918745189590510238,
                            0.169004726639267902826583426598550, 0.190350578064785409913256402421014,
                            0.204432940075298892414161999234649, 0.209482141084727828012999174891714};
constexpr double kWG[4] = {0.129484966168869693270611432679082, 0.279705391489276667901467771423780,
                           0.381830050505118944950369775488975, 0.417959183673469387755102040816327};
constexpr double kEps = std::numeric_limits<double>::epsilon();

// The 15 nodes of a panel on [-1, 1] in order, with their Kronrod and Gauss weights (Gauss
// weight 0 at the Kronrod-only nodes).
struct Node
{
    double x, wk, wg;
};
const std::array<Node, 15>& nodes()
{
    static const std::array<Node, 15> n = [] {
        std::array<Node, 15> a{};
        int k = 0;
        for (int i = 0; i < 7; ++i)
            a[k++] = {-kXGK[i], kWGK[i], (i % 2 == 1) ? kWG[i / 2] : 0.0};
        a[k++] = {0.0, kWGK[7], kWG[3]};
        for (int i = 6; i >= 0; --i)
            a[k++] = {kXGK[i], kWGK[i], (i % 2 == 1) ? kWG[i / 2] : 0.0};
        return a;
    }();
    return n;
}

// QUADPACK's error estimate from the Kronrod and Gauss results, the integral of |f| (resabs)
// and of |f - mean| (resasc), all scaled by the half length.
double gk_error(double resk, double resg, double resabs, double resasc)
{
    double err = std::fabs(resk - resg);
    if (resasc != 0.0 && err != 0.0)
        err = resasc * std::min(1.0, std::pow(200.0 * err / resasc, 1.5));
    if (resabs > std::numeric_limits<double>::min() / (50.0 * kEps))
        err = std::max(50.0 * kEps * resabs, err);
    return err;
}

// ---------------------------------------------------------------------------
// Integrands
// ---------------------------------------------------------------------------

// The components, the kernel's quantities: area, integral of (x, y, z) dA, volume, integral of
// (x, y, z) dV and of (x^2, y^2, z^2, yz, zx, xy) dV, all about the origin of integration; and
// the closure, the integral of the outward normal over the surface, which vanishes for a
// closed surface (what is left is the vector area of the gaps between the faces).
enum
{
    AREA, AX, AY, AZ, VOL, VX, VY, VZ, VXX, VYY, VZZ, VYZ, VZX, VXY, NX, NY, NZ, NC
};
using Values = std::array<double, NC>;
// Power of length by which a component exceeds the area (for scales and tolerance floors).
constexpr int kPower[NC] = {0, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 3, 0, 0, 0};

void zero(Values& v) { v.fill(0.0); }

struct Settings
{
    SmPoint3d origin{0, 0, 0};
    double tolerance = 1e-9;      // relative, for every quantity
    double inner = 1e-12;         // relative accuracy of the inner integrals
    double size = 1.0;            // the size of the body (bounding box diagonal)
    int first = AREA, last = NC;  // the components integrated: [first, last)
    long max_panels = 1000000;
    long evaluations = 0;
};

// One faceuse to integrate.
struct Job
{
    const SmSurface* surface = nullptr;
    std::vector<SmBSplineCurve*> curves;  // oriented trim curves in the parameter plane, owned
    std::vector<char> skip;               // curves along which the outer coordinate does not change
    bool inner_v = true;                  // inner integrals along v (outer factor -du/dt), else along u (dv/dt)
    bool planar = false;                  // a plane: every integrand is a low-degree polynomial along a line
    double base = 0.0;                    // where the inner integrals start
    std::vector<double> inner_knots;      // surface knots in the inner direction, sorted
    std::vector<double> outer_knots;      // surface knots in the other direction, sorted
    double column = 0.0;                  // a typical inner integral of the area element
    double sign = 1.0;                    // sign of the volume terms (faceuse orientation)
    bool area = true, volume = true;      // the terms this faceuse adds to the body

    Job() = default;
    Job(const Job&) = delete;
    Job& operator=(const Job&) = delete;
    Job(Job&& o) noexcept { *this = std::move(o); }
    Job& operator=(Job&& o) noexcept
    {
        surface = o.surface;
        curves = std::move(o.curves);
        o.curves.clear();
        skip = std::move(o.skip);
        inner_v = o.inner_v, planar = o.planar, base = o.base;
        inner_knots = std::move(o.inner_knots), outer_knots = std::move(o.outer_knots);
        column = o.column, sign = o.sign, area = o.area, volume = o.volume;
        return *this;
    }
    ~Job()
    {
        for (SmBSplineCurve* c : curves)
            delete c;
    }
};

// The integrands at one point of the surface; false where it cannot be evaluated. upper_u and
// upper_v say which span to evaluate on a knot (or within the kernel's snapping distance of
// one): the one above it or the one below. Where the derivatives jump at a knot, a point must
// be evaluated on the side its integration interval lies on, or the integrand is not smooth.
bool integrand(const Job& job, Settings& s, double u, double v, bool upper_u, bool upper_v, Values& g)
{
    SmVector3d d[4];  // [S, Sv, Su, Suv] (Suv untouched)
    if (job.surface->EvaluateSimple(SmPoint2d(u, v), 1, 1, upper_u ? TRUE : FALSE, upper_v ? TRUE : FALSE, TRUE, d)
        != SM_SUCCESS)
        return false;
    s.evaluations++;
    const SmVector3d n = d[2] * d[1];  // Su x Sv (operator* is the cross product)
    const double x = d[0].x - s.origin.x, y = d[0].y - s.origin.y, z = d[0].z - s.origin.z;
    const double a = n.Length();
    g[AREA] = a;
    g[AX] = x * a, g[AY] = y * a, g[AZ] = z * a;
    const double w = z * n.z;
    g[VOL] = w;
    g[VX] = x * w, g[VY] = y * w, g[VZ] = 0.5 * z * w;
    g[VXX] = x * x * w, g[VYY] = y * y * w, g[VZZ] = z * z * w / 3.0;
    g[VYZ] = 0.5 * y * z * w, g[VZX] = 0.5 * x * z * w, g[VXY] = x * y * w;
    g[NX] = n.x, g[NY] = n.y, g[NZ] = n.z;
    return std::isfinite(a) && std::isfinite(w);
}

// ---------------------------------------------------------------------------
// Inner integrals
// ---------------------------------------------------------------------------

struct Piece
{
    double a, b;
    Values val, err, abs;
};

bool inner_panel(const Job& job, Settings& s, double fixed, bool fixed_upper, Piece& p)
{
    const double c = 0.5 * (p.a + p.b), h = 0.5 * (p.b - p.a);
    Values fk, fg, fa, f[15];
    zero(fk), zero(fg), zero(fa);
    const auto& nd = nodes();
    for (int i = 0; i < 15; ++i)
    {
        const double t = c + h * nd[i].x;
        const bool upper = t < c;  // a node near the start of the piece belongs to the span above it
        if (!(job.inner_v ? integrand(job, s, fixed, t, fixed_upper, upper, f[i])
                          : integrand(job, s, t, fixed, upper, fixed_upper, f[i])))
            return false;
        for (int k = s.first; k < s.last; ++k)
        {
            fk[k] += nd[i].wk * f[i][k];
            fg[k] += nd[i].wg * f[i][k];
            fa[k] += nd[i].wk * std::fabs(f[i][k]);
        }
    }
    const double ah = std::fabs(h);
    for (int k = s.first; k < s.last; ++k)
    {
        const double mean = 0.5 * fk[k];
        double asc = 0.0;
        for (int i = 0; i < 15; ++i)
            asc += nd[i].wk * std::fabs(f[i][k] - mean);
        p.val[k] = fk[k] * h;
        p.abs[k] = fa[k] * ah;
        p.err[k] = gk_error(fk[k] * h, fg[k] * h, p.abs[k], asc * ah);
    }
    return true;
}

// The integral of the integrands along the inner direction from job.base to `to`, at `fixed`
// in the other direction, to the relative accuracy s.inner of the integral of |integrand|
// (with a floor of the face's typical column times size^power: near a pole or the start line
// an inner integral is tiny and only rounding is left). err receives the estimates.
bool inner_integral(const Job& job, Settings& s, double fixed, bool fixed_upper, double to, Values& val, Values& err)
{
    zero(val), zero(err);
    const double from = job.base;
    if (to == from)
        return true;
    if (job.planar)
    {
        // On a plane every integrand is a polynomial of degree 3 along a line (4 if the
        // parameterisation is bilinear): three-point Gauss-Legendre is exact.
        const double c = 0.5 * (from + to), h = 0.5 * (to - from), x = std::sqrt(0.6);
        const double xs[3] = {-x, 0.0, x}, ws[3] = {5.0 / 9.0, 8.0 / 9.0, 5.0 / 9.0};
        Values g[3];
        for (int i = 0; i < 3; ++i)
        {
            const double t = c + h * xs[i];
            if (!(job.inner_v ? integrand(job, s, fixed, t, fixed_upper, true, g[i])
                              : integrand(job, s, t, fixed, true, fixed_upper, g[i])))
                return false;
        }
        for (int k = s.first; k < s.last; ++k)
        {
            double sum = 0.0, abs = 0.0;
            for (int i = 0; i < 3; ++i)
                sum += ws[i] * g[i][k], abs += ws[i] * std::fabs(g[i][k]);
            val[k] = h * sum;
            err[k] = 50.0 * kEps * std::fabs(h) * abs;
        }
        return true;
    }

    const double lo = std::min(from, to), hi = std::max(from, to);
    const double margin = 1e-13 * (1.0 + std::fabs(hi) + std::fabs(lo));
    std::vector<Piece> pieces;
    pieces.reserve(8);
    double a = lo;
    for (auto it = std::upper_bound(job.inner_knots.begin(), job.inner_knots.end(), lo + margin);
         it != job.inner_knots.end() && *it < hi - margin; ++it)
    {
        pieces.push_back(Piece{a, *it, {}, {}, {}});
        a = *it;
    }
    pieces.push_back(Piece{a, hi, {}, {}, {}});
    for (Piece& p : pieces)
        if (!inner_panel(job, s, fixed, fixed_upper, p))
            return false;

    double last_ratio = std::numeric_limits<double>::infinity();
    int stalled = 0;
    for (int round = 0;; ++round)
    {
        Values tv, te, ta, target;
        zero(tv), zero(te), zero(ta);
        for (const Piece& p : pieces)
            for (int k = s.first; k < s.last; ++k)
                tv[k] += p.val[k], te[k] += p.err[k], ta[k] += p.abs[k];
        double ratio = 0.0;
        for (int k = s.first; k < s.last; ++k)
        {
            target[k] = s.inner * std::max(ta[k], std::max(ta[AREA], job.column) * std::pow(s.size, kPower[k]));
            ratio = std::max(ratio, te[k] / target[k]);
        }
        // Bisection divides the error of a smooth integrand by far more than 2; where it does
        // not, what is left is rounding of the surface evaluation (in a tiny knot span, say).
        // The outer panel carries the error of an inner integral that stops early.
        stalled = ratio > 0.5 * last_ratio ? stalled + 1 : 0;
        last_ratio = ratio;
        if (ratio <= 1.0 || stalled >= 2 || pieces.size() > 1000)
        {
            const double sign = to >= from ? 1.0 : -1.0;
            for (int k = s.first; k < s.last; ++k)
                val[k] = sign * tv[k], err[k] = te[k];
            return true;
        }
        // bisect every piece whose error is above its share of the target
        std::vector<Piece> next;
        next.reserve(pieces.size() * 2);
        for (const Piece& p : pieces)
        {
            bool split = false;
            for (int k = s.first; k < s.last && !split; ++k)
                split = p.err[k] > target[k] * (p.b - p.a) / (hi - lo);
            if (!split)
            {
                next.push_back(p);
                continue;
            }
            const double m = 0.5 * (p.a + p.b);
            Piece l{p.a, m, {}, {}, {}}, r{m, p.b, {}, {}, {}};
            if (!inner_panel(job, s, fixed, fixed_upper, l) || !inner_panel(job, s, fixed, fixed_upper, r))
                return false;
            next.push_back(l);
            next.push_back(r);
        }
        pieces.swap(next);
    }
}

// ---------------------------------------------------------------------------
// Outer integrals along the trim curves
// ---------------------------------------------------------------------------

struct Panel
{
    int job, curve;
    double a, b;
    Values val, err;
    double key = 0.0;  // largest error / target
};

bool outer_panel(const Job& job, Settings& s, Panel& p)
{
    const SmBSplineCurve* curve = job.curves[static_cast<size_t>(p.curve)];
    const double c = 0.5 * (p.a + p.b), h = 0.5 * (p.b - p.a);
    // A panel does not cross a knot line of the outer direction (initial_panels splits there),
    // so its middle tells on which side of a nearby knot its points lie.
    SmPoint3d mid;
    if (curve->EvaluatePoint(c, mid) != SM_SUCCESS)
        return false;
    const double mid_fixed = job.inner_v ? mid.x : mid.y;
    const std::vector<double>& knots = job.outer_knots;
    auto upper_side = [&](double fixed) {
        if (knots.empty())
            return true;
        auto it = std::lower_bound(knots.begin(), knots.end(), fixed);
        double nearest = it == knots.end() ? knots.back() : *it;
        if (it != knots.begin() && (it == knots.end() || fixed - *(it - 1) < *it - fixed))
            nearest = *(it - 1);
        return mid_fixed >= nearest;
    };

    Values fk, fg, fa, ie, f[15];
    zero(fk), zero(fg), zero(fa), zero(ie);
    const auto& nd = nodes();
    for (int i = 0; i < 15; ++i)
    {
        zero(f[i]);
        SmPoint3d e[2];
        if (curve->Evaluate(c + h * nd[i].x, 1, TRUE, e, FALSE) != SM_SUCCESS)
            return false;
        const double factor = job.inner_v ? -e[1].x : e[1].y;
        if (factor == 0.0)
            continue;
        const double fixed = job.inner_v ? e[0].x : e[0].y, to = job.inner_v ? e[0].y : e[0].x;
        Values inner, inner_err;
        if (!inner_integral(job, s, fixed, upper_side(fixed), to, inner, inner_err))
            return false;
        for (int k = s.first; k < s.last; ++k)
        {
            f[i][k] = factor * inner[k];
            fk[k] += nd[i].wk * f[i][k];
            fg[k] += nd[i].wg * f[i][k];
            fa[k] += nd[i].wk * std::fabs(f[i][k]);
            ie[k] += nd[i].wk * std::fabs(factor) * inner_err[k];
        }
    }
    const double ah = std::fabs(h);
    for (int k = s.first; k < s.last; ++k)
    {
        const double mean = 0.5 * fk[k];
        double asc = 0.0;
        for (int i = 0; i < 15; ++i)
            asc += nd[i].wk * std::fabs(f[i][k] - mean);
        p.val[k] = fk[k] * h;
        p.err[k] = gk_error(fk[k] * h, fg[k] * h, fa[k] * ah, asc * ah) + ie[k] * ah;
    }
    return true;
}

// Unique knots of a surface in one direction (empty if it has none to offer).
std::vector<double> surface_knots(const SmSurface* surface, SmSurfParamType dir)
{
    SmTArray<double> knots;
    std::vector<double> out;
    if (surface->GetKnots(dir, knots, nullptr, nullptr) == SM_SUCCESS)
        for (ULONG i = 0; i < knots.GetSize(); ++i)
            out.push_back(knots[i]);
    std::sort(out.begin(), out.end());
    return out;
}

size_t spans_within(const std::vector<double>& knots, double lo, double hi)
{
    const double margin = 1e-12 * (1.0 + std::fabs(lo) + std::fabs(hi));
    size_t n = 1;
    for (double k : knots)
        n += (k > lo + margin && k < hi - margin) ? 1 : 0;
    return n;
}

// The trim curves of a face, the inner direction and the typical inner integral.
Job make_job(const SmFace* face)
{
    Job job;
    job.surface = face->GetSurface();
    SmTArray<ULONG> loops;
    SmTArray<SmBSplineCurve*> curves;
    const SmStatus st = face->CreateOrientedTrimBoundary(context(), TRUE, TRUE, loops, curves);
    for (ULONG i = 0; i < curves.GetSize(); ++i)
        job.curves.push_back(curves[i]);
    check(st, "SmFace::CreateOrientedTrimBoundary");

    const SmExtent2d dom = face->GetUVDomain();
    std::vector<double> uk = surface_knots(job.surface, SM_SP_U), vk = surface_knots(job.surface, SM_SP_V);
    job.planar = job.surface->GetType() == SmPlane_TYPE;

    // How far each trim curve runs in u and in v: the extent of its control points, which
    // hold the curve. A curve along which u does not change adds nothing to the integral with
    // inner integrals along v (its factor du/dt vanishes), and the other way round.
    const size_t n = job.curves.size();
    std::vector<double> run_u(n, HUGE_VAL), run_v(n, HUGE_VAL);
    std::vector<size_t> spans(n, 1);
    for (size_t c = 0; c < n; ++c)
    {
        const SmBSplineCurve* curve = job.curves[c];
        ULONG dim = 0, degree = 0;
        SmTArray<SmPoint3d> poles;
        SmBSplineCurveForm form;
        SmTArray<ULONG> mults;
        SmTArray<double> knots, weights;
        SmKnotType knot_type;
        if (curve->GetCanonical(dim, degree, poles, form, mults, knots, knot_type, weights) != SM_SUCCESS)
            continue;  // runs both ways, as far as we know
        spans[c] = knots.GetSize() > 1 ? knots.GetSize() - 1 : 1;
        bool positive = true;  // the convex hull holds a rational curve only with positive weights
        for (ULONG i = 0; i < weights.GetSize(); ++i)
            positive = positive && weights[i] > 0;
        if (!positive || poles.GetSize() == 0)
            continue;
        double ulo = HUGE_VAL, uhi = -HUGE_VAL, vlo = HUGE_VAL, vhi = -HUGE_VAL;
        for (ULONG i = 0; i < poles.GetSize(); ++i)
        {
            ulo = std::min(ulo, poles[i].x), uhi = std::max(uhi, poles[i].x);
            vlo = std::min(vlo, poles[i].y), vhi = std::max(vhi, poles[i].y);
        }
        run_u[c] = uhi - ulo, run_v[c] = vhi - vlo;
    }
    const double eps_u = 1e-12 * (std::fabs(dom.GetMin().x) + std::fabs(dom.GetMax().x) + dom.GetMax().x - dom.GetMin().x);
    const double eps_v = 1e-12 * (std::fabs(dom.GetMin().y) + std::fabs(dom.GetMax().y) + dom.GetMax().y - dom.GetMin().y);
    // the inner direction: the one with less work, (outer spans) x (inner spans)
    double cost_v = 0.0, cost_u = 0.0;
    for (size_t c = 0; c < n; ++c)
    {
        cost_v += run_u[c] > eps_u ? static_cast<double>(spans[c]) : 0.0;
        cost_u += run_v[c] > eps_v ? static_cast<double>(spans[c]) : 0.0;
    }
    if (!job.planar)
    {
        cost_v *= static_cast<double>(spans_within(vk, dom.GetMin().y, dom.GetMax().y));
        cost_u *= static_cast<double>(spans_within(uk, dom.GetMin().x, dom.GetMax().x));
    }
    job.inner_v = cost_v <= cost_u;
    job.skip.assign(n, 0);
    for (size_t c = 0; c < n; ++c)
        job.skip[c] = job.inner_v ? run_u[c] <= eps_u : run_v[c] <= eps_v;
    job.base = job.inner_v ? dom.GetMin().y : dom.GetMin().x;
    job.inner_knots = job.inner_v ? vk : uk;
    job.outer_knots = job.inner_v ? uk : vk;

    // the inner integral of the area element across the whole domain, at three places
    const double olo = job.inner_v ? dom.GetMin().x : dom.GetMin().y, ohi = job.inner_v ? dom.GetMax().x : dom.GetMax().y;
    const double ihi = job.inner_v ? dom.GetMax().y : dom.GetMax().x;
    std::vector<double> breaks{job.base};
    for (double k : job.inner_knots)
        if (k > job.base && k < ihi)
            breaks.push_back(k);
    breaks.push_back(ihi);
    for (double f : {0.25, 0.5, 0.75})
    {
        const double fixed = olo + f * (ohi - olo);
        double sum = 0.0;
        for (size_t i = 0; i + 1 < breaks.size(); ++i)
        {
            const double c = 0.5 * (breaks[i] + breaks[i + 1]), h = 0.5 * (breaks[i + 1] - breaks[i]);
            for (const Node& n : nodes())
            {
                const double t = c + h * n.x;
                SmVector3d d[4];
                if (job.surface->EvaluateSimple(job.inner_v ? SmPoint2d(fixed, t) : SmPoint2d(t, fixed), 1, 1, TRUE,
                                                TRUE, TRUE, d) == SM_SUCCESS)
                    sum += n.wk * h * (d[2] * d[1]).Length();
            }
        }
        if (std::isfinite(sum))
            job.column = std::max(job.column, sum);
    }
    return job;
}

// The first panels of one trim curve: its knot spans, split where the curve crosses a knot
// line of the surface (in either direction: the outer integrand is not smooth there).
void initial_panels(const Job& job, int j, int c, std::vector<Panel>& out)
{
    const SmBSplineCurve* curve = job.curves[static_cast<size_t>(c)];
    const SmExtent1d ivl = curve->GetNaturalInterval();
    const double t0 = ivl.GetMin(), t1 = ivl.GetMax();
    if (!(t1 > t0))
        return;
    std::vector<double> breaks{t0, t1};
    SmTArray<double> knots;
    if (curve->GetKnots(knots, nullptr, nullptr) == SM_SUCCESS)
        for (ULONG i = 0; i < knots.GetSize(); ++i)
            if (knots[i] > t0 && knots[i] < t1)
                breaks.push_back(knots[i]);
    std::sort(breaks.begin(), breaks.end());

    // crossings of the surface's knot lines, from samples of each span
    std::vector<double> crossings;
    const int samples = 16;
    for (size_t i = 0; i + 1 < breaks.size(); ++i)
    {
        double tp = breaks[i];
        SmPoint3d pp;
        if (curve->EvaluatePoint(tp, pp) != SM_SUCCESS)
            continue;
        for (int k = 1; k <= samples; ++k)
        {
            const double t = breaks[i] + (breaks[i + 1] - breaks[i]) * k / samples;
            SmPoint3d q;
            if (curve->EvaluatePoint(t, q) != SM_SUCCESS)
                break;
            for (int dir = 0; dir < 2; ++dir)
            {
                const std::vector<double>& lines = dir == 0 ? job.inner_knots : job.outer_knots;
                const bool along_v = (dir == 0) == job.inner_v;  // the coordinate these knots are values of
                const double a = along_v ? pp.y : pp.x, b = along_v ? q.y : q.x;
                for (auto it = std::upper_bound(lines.begin(), lines.end(), std::min(a, b));
                     it != lines.end() && *it < std::max(a, b); ++it)
                {
                    const double kn = *it;
                    double lo = tp, hi = t, flo = a - kn;
                    for (int n = 0; n < 60 && hi - lo > 1e-15 * (1.0 + std::fabs(hi)); ++n)
                    {
                        const double m = 0.5 * (lo + hi);
                        SmPoint3d r;
                        if (curve->EvaluatePoint(m, r) != SM_SUCCESS)
                            break;
                        const double fm = (along_v ? r.y : r.x) - kn;
                        if ((fm < 0) == (flo < 0))
                            lo = m, flo = fm;
                        else
                            hi = m;
                    }
                    crossings.push_back(0.5 * (lo + hi));
                }
            }
            tp = t, pp = q;
        }
    }
    breaks.insert(breaks.end(), crossings.begin(), crossings.end());
    std::sort(breaks.begin(), breaks.end());
    const double margin = 1e-12 * (t1 - t0);
    double a = breaks.front();
    for (size_t i = 1; i < breaks.size(); ++i)
    {
        if (breaks[i] - a <= margin && i + 1 < breaks.size())
            continue;
        if (breaks[i] > a)
            out.push_back(Panel{j, c, a, breaks[i], {}, {}, 0.0});
        a = breaks[i];
    }
}

struct Result
{
    Values val, err;
    double relative = 0.0;  // the largest estimated error relative to its scale
    bool converged = false;
    long panels = 0;
};

// The scales of the components; the targets are tolerance times these.
Values scales(const Values& total, const Settings& s)
{
    Values sc;
    const double area = std::max(std::fabs(total[AREA]), std::numeric_limits<double>::min());
    const double volume = std::max(std::fabs(total[VOL]), 1e-9 * area * s.size);
    for (int k = 0; k < NC; ++k)
        sc[k] = k < VOL || k >= NX ? area * std::pow(s.size, kPower[k]) : volume * std::pow(s.size, kPower[k] - 1);
    return sc;
}

// Globally adaptive integration of all jobs.
Result integrate(std::vector<Job>& jobs, Settings& s)
{
    std::vector<Panel> panels;
    for (size_t j = 0; j < jobs.size(); ++j)
        for (size_t c = 0; c < jobs[j].curves.size(); ++c)
            if (!jobs[j].skip[c])
                initial_panels(jobs[j], static_cast<int>(j), static_cast<int>(c), panels);
    auto evaluate = [&](Panel& p) {
        if (!outer_panel(jobs[static_cast<size_t>(p.job)], s, p))
            throw std::runtime_error("the integration cannot evaluate a face's surface (SM_ERR)");
    };
    for (Panel& p : panels)
        evaluate(p);
    auto weight = [&](const Panel& p, int k) {
        const Job& job = jobs[static_cast<size_t>(p.job)];
        return k < VOL ? (job.area ? 1.0 : 0.0) : (job.volume ? job.sign : 0.0);
    };

    Result r;
    double last_excess = std::numeric_limits<double>::infinity();
    int stalled = 0;
    for (int round = 0;; ++round)
    {
        Values total, err, target;
        zero(total), zero(err);
        for (const Panel& p : panels)
            for (int k = s.first; k < s.last; ++k)
            {
                const double w = weight(p, k);
                total[k] += w * p.val[k];
                err[k] += std::fabs(w) * p.err[k];
            }
        const Values sc = scales(total, s);
        bool done = true;
        for (int k = s.first; k < s.last; ++k)
        {
            target[k] = s.tolerance * sc[k];
            done = done && err[k] <= target[k];
        }
        r.val = total, r.err = err, r.panels = static_cast<long>(panels.size());
        r.relative = 0.0;
        for (int k = s.first; k < s.last; ++k)
            r.relative = std::max(r.relative, err[k] / sc[k]);
        // stop when done, and also when bisection has stopped paying (rounding noise)
        double excess = 0.0;
        for (Panel& p : panels)
        {
            p.key = 0.0;
            for (int k = s.first; k < s.last; ++k)
                p.key = std::max(p.key, std::fabs(weight(p, k)) * p.err[k] / target[k]);
            excess += p.key;
        }
        stalled = excess > 0.9 * last_excess ? stalled + 1 : 0;
        last_excess = excess;
        if (done || stalled >= 3 || static_cast<long>(panels.size()) > s.max_panels || round >= 60)
        {
            r.converged = done;
            return r;
        }
        // bisect the panels with the largest errors until the rest is within half the target
        std::vector<size_t> order(panels.size());
        for (size_t i = 0; i < order.size(); ++i)
            order[i] = i;
        std::sort(order.begin(), order.end(), [&](size_t x, size_t y) { return panels[x].key > panels[y].key; });
        std::vector<char> split(panels.size(), 0);
        double rest = excess;
        for (size_t i : order)
        {
            if (rest <= 0.5)
                break;
            split[i] = 1;
            rest -= panels[i].key;
        }
        std::vector<Panel> next;
        next.reserve(panels.size() * 2);
        for (size_t i = 0; i < panels.size(); ++i)
        {
            const Panel& p = panels[i];
            if (!split[i])
            {
                next.push_back(p);
                continue;
            }
            const double m = 0.5 * (p.a + p.b);
            Panel l{p.job, p.curve, p.a, m, {}, {}, 0.0}, h{p.job, p.curve, m, p.b, {}, {}, 0.0};
            evaluate(l);
            evaluate(h);
            next.push_back(l);
            next.push_back(h);
        }
        panels.swap(next);
    }
}

py::tuple xyz(double x, double y, double z) { return py::make_tuple(x, y, z); }

double diagonal(const SmExtent3d& box)
{
    const SmVector3d d = box.GetSize();
    return std::sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
}

Settings settings(const SmExtent3d& box, double tolerance)
{
    if (!(tolerance > 0.0))
        throw std::invalid_argument("the tolerance must be positive");
    Settings s;
    s.origin = box.GetMid();
    s.size = std::max(diagonal(box), std::numeric_limits<double>::min());
    s.tolerance = tolerance;
    // The outer error from the inner integrals is at most s.inner times the integral of
    // |integrand| over the strips under the trim curves: a small multiple of the result.
    s.inner = std::max(1e-3 * tolerance, 1e-12);
    return s;
}

py::dict brep_measure(const SmBrep* brep, double tolerance)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    SmExtent3d box;
    check(brep->CalculateBoundingBox(box), "SmBrep::CalculateBoundingBox");
    Settings s = settings(box, tolerance);

    // the faceuses SmBrep::ComputePreciseProperties integrates with the default behaviour:
    // faces between two regions, from the side of each region that is not a void
    std::vector<Job> jobs;
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        SmFace* face = faces[i];
        SmFaceuse* uses[2];
        uses[0] = face->GetUpwardFaceuse();
        uses[1] = uses[0] ? uses[0]->GetMate() : nullptr;
        if (!uses[0] || !uses[1] || uses[0]->GetShell()->GetRegion() == uses[1]->GetShell()->GetRegion())
            continue;  // not volume separating: such a face counts only with a face thickness
        for (SmFaceuse* fu : uses)
        {
            // the kernel integrates a faceuse for its area (solid region beside a void) or its
            // volume (solid region), and then adds both: the faceuse of every solid region
            if (fu->GetShell()->GetRegion()->IsVoid())
                continue;
            Job job = make_job(face);
            job.sign = fu->GetOrientation() == SM_OT_SAME ? -1.0 : 1.0;
            jobs.push_back(std::move(job));
        }
    }
    const Result r = integrate(jobs, s);

    py::dict d;
    d["area"] = r.val[AREA];
    d["volume"] = r.val[VOL];
    d["origin"] = xyz(s.origin.x, s.origin.y, s.origin.z);
    d["first_moments"] = xyz(r.val[VX], r.val[VY], r.val[VZ]);
    d["second_moments"] = py::make_tuple(r.val[VXX], r.val[VYY], r.val[VZZ], r.val[VYZ], r.val[VZX], r.val[VXY]);
    d["closure"] = xyz(r.val[NX], r.val[NY], r.val[NZ]);
    py::dict e;
    e["area"] = r.err[AREA];
    e["volume"] = r.err[VOL];
    e["first_moments"] = xyz(r.err[VX], r.err[VY], r.err[VZ]);
    e["second_moments"] = py::make_tuple(r.err[VXX], r.err[VYY], r.err[VZZ], r.err[VYZ], r.err[VZX], r.err[VXY]);
    d["error"] = e;
    d["relative_error"] = r.relative;
    d["size"] = s.size;
    d["converged"] = r.converged;
    d["panels"] = r.panels;
    d["evaluations"] = s.evaluations;
    return d;
}

py::dict face_measure(const SmFace* face, double tolerance)
{
    if (!face)
        throw std::invalid_argument("face is None");
    SmExtent3d box;
    check(face->CalculateBoundingBox(box), "SmFace::CalculateBoundingBox");
    Settings s = settings(box, tolerance);
    s.first = AREA, s.last = VOL;
    std::vector<Job> jobs;
    jobs.push_back(make_job(face));
    jobs.back().volume = false;
    const Result r = integrate(jobs, s);
    py::dict d;
    d["area"] = std::fabs(r.val[AREA]);
    d["signed_area"] = r.val[AREA];
    d["origin"] = xyz(s.origin.x, s.origin.y, s.origin.z);
    d["first_moments"] = xyz(r.val[AX], r.val[AY], r.val[AZ]);
    d["error"] = r.err[AREA];
    d["relative_error"] = r.relative;
    d["converged"] = r.converged;
    d["panels"] = r.panels;
    d["evaluations"] = s.evaluations;
    return d;
}

// ---------------------------------------------------------------------------
// Curve length
// ---------------------------------------------------------------------------

struct Span
{
    double a, b, val, err;
};

// |C'(t)| integrated over a span with one 15-point panel.
void speed_panel(const SmCurve* curve, Span& sp)
{
    const double c = 0.5 * (sp.a + sp.b), h = 0.5 * (sp.b - sp.a);
    double fk = 0, fg = 0, f[15];
    const auto& nd = nodes();
    for (int i = 0; i < 15; ++i)
    {
        SmVector3d e[2];
        if (curve->Evaluate(c + h * nd[i].x, 1, TRUE, e, FALSE) != SM_SUCCESS)
            throw std::runtime_error("curve_length: the curve cannot be evaluated (SM_ERR)");
        f[i] = e[1].Length();
        fk += nd[i].wk * f[i], fg += nd[i].wg * f[i];
    }
    double asc = 0;
    for (int i = 0; i < 15; ++i)
        asc += nd[i].wk * std::fabs(f[i] - 0.5 * fk);
    const double ah = std::fabs(h);
    sp.val = fk * h;
    sp.err = gk_error(fk * h, fg * h, fk * ah, asc * ah);
}

// The knot spans of a curve within [t0, t1] (t0 < t1).
std::vector<double> span_breaks(const SmCurve* curve, double t0, double t1)
{
    std::vector<double> breaks{t0};
    SmTArray<double> knots;
    const double margin = 1e-14 * (1.0 + std::fabs(t0) + std::fabs(t1));
    if (curve->GetKnots(knots, nullptr, nullptr) == SM_SUCCESS)
        for (ULONG i = 0; i < knots.GetSize(); ++i)
            if (knots[i] > t0 + margin && knots[i] < t1 - margin)
                breaks.push_back(knots[i]);
    breaks.push_back(t1);
    std::sort(breaks.begin(), breaks.end());
    return breaks;
}

// The arc length over [t0, t1] (t0 <= t1) to a relative tolerance, integrated per knot span
// (the speed |C'| is smooth within a span, and may vanish at its ends).
double arc_length(const SmCurve* curve, double t0, double t1, double tolerance)
{
    if (!(t1 > t0))
        return 0.0;
    const std::vector<double> breaks = span_breaks(curve, t0, t1);
    std::vector<Span> spans;
    for (size_t i = 0; i + 1 < breaks.size(); ++i)
    {
        spans.push_back(Span{breaks[i], breaks[i + 1], 0, 0});
        speed_panel(curve, spans.back());
    }
    double total = 0;
    for (int round = 0; round < 60; ++round)
    {
        double err = 0;
        total = 0;
        for (const Span& sp : spans)
            total += sp.val, err += sp.err;
        const double target = tolerance * std::fabs(total);
        if (err <= target || spans.size() > 100000)
            break;
        std::vector<Span> next;
        next.reserve(spans.size() * 2);
        for (const Span& sp : spans)
        {
            if (!(sp.err > target * (sp.b - sp.a) / (t1 - t0)))
            {
                next.push_back(sp);
                continue;
            }
            const double m = 0.5 * (sp.a + sp.b);
            next.push_back(Span{sp.a, m, 0, 0});
            speed_panel(curve, next.back());
            next.push_back(Span{m, sp.b, 0, 0});
            speed_panel(curve, next.back());
        }
        spans.swap(next);
    }
    return total;
}

// The parameter at signed arc length `length` from t_start, within the natural interval;
// (t, past_end) with past_end when the curve ends first.
py::tuple parameter_at_length(const SmCurve* curve, double t_start, double length, double tolerance)
{
    const SmExtent1d ivl = curve->GetNaturalInterval();
    const double lo = ivl.GetMin(), hi = ivl.GetMax();
    t_start = std::min(std::max(t_start, lo), hi);
    if (length == 0.0)
        return py::make_tuple(t_start, false);
    const bool forward = length > 0;
    double want = std::fabs(length);
    auto dist = [&](double a, double b) { return arc_length(curve, std::min(a, b), std::max(a, b), tolerance); };

    // walk span by span to the one where the length is reached
    std::vector<double> breaks = forward ? span_breaks(curve, t_start, hi) : span_breaks(curve, lo, t_start);
    if (!forward)
        std::reverse(breaks.begin(), breaks.end());
    double a = breaks.front();
    for (size_t i = 1; i < breaks.size(); ++i)
    {
        const double b = breaks[i], len = dist(a, b);
        if (len < want)
        {
            want -= len;
            a = b;
            continue;
        }
        // within [a, b]: bracketed Newton on s(t) = dist(a, t) - want, monotone in t
        double lo_t = a, hi_t = b, t = a + (b - a) * (want / len);
        for (int it = 0; it < 100; ++it)
        {
            const double f = dist(a, t) - want;
            if (std::fabs(f) <= 4.0 * tolerance * std::fabs(length))
                break;
            if (f < 0)
                lo_t = t;
            else
                hi_t = t;
            double next = 0.5 * (lo_t + hi_t);
            SmVector3d e[2];
            if (curve->Evaluate(t, 1, TRUE, e, FALSE) == SM_SUCCESS && e[1].Length() > 0)
            {
                const double newton = t - (forward ? 1.0 : -1.0) * f / e[1].Length();
                if ((newton - lo_t) * (newton - hi_t) < 0)
                    next = newton;
            }
            if (next == t || std::fabs(hi_t - lo_t) <= 1e-15 * (1.0 + std::fabs(t)))
                break;
            t = next;
        }
        return py::make_tuple(t, false);
    }
    return py::make_tuple(forward ? hi : lo, want > 1e-12 * (1.0 + std::fabs(length)));
}

}  // namespace

void bind_measure(py::module_ m)
{
    m.def("brep_measure", &brep_measure, py::arg("brep"), py::arg("tolerance") = 1e-9,
          "Area, volume, and first and second volume moments of a Brep (about the bounding box centre, "
          "'origin'), integrated until the estimated error of each is below `tolerance` times its scale: "
          "the area, |volume|, |volume| * size, |volume| * size^2 (size: the bounding box diagonal). "
          "'error' holds the estimates, 'converged' whether they met the tolerance, 'closure' the integral "
          "of the outward normal (zero for a closed surface; else the vector area of the gaps).");
    m.def("face_measure", &face_measure, py::arg("face"), py::arg("tolerance") = 1e-9,
          "Area and first area moments of a face (about its bounding box centre, 'origin'), to a relative "
          "`tolerance` (first moments: tolerance * area * size).");
    m.def("curve_length", [](const SmCurve* curve, double t0, double t1, double tolerance) {
        return arc_length(curve, std::min(t0, t1), std::max(t0, t1), tolerance);
    }, py::arg("curve"), py::arg("t0"), py::arg("t1"), py::arg("tolerance") = 1e-12,
       "Arc length between two parameters, integrated per knot span to a relative tolerance.");
    m.def("curve_parameter_at_length", [](const SmCurve* curve, double t_start, double length, double tolerance) {
        return parameter_at_length(curve, t_start, length, tolerance);
    }, py::arg("curve"), py::arg("t_start"), py::arg("length"), py::arg("tolerance") = 1e-12,
       "Parameter at signed arc length `length` from `t_start`; returns (t, past_end).");
}
