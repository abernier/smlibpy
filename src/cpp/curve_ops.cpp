// SPDX-License-Identifier: Apache-2.0
//
// Curve operations (`smlibpy._core.ext`), shared by the Python extension and the JavaScript module:
//
//   offset_curve(curve, normal, distance, tolerance)        the curve moved sideways in a plane
//   approximate_points(points, degree, tolerance, ...)      a B-spline within a tolerance of points
//   interpolate_tangents(points, tangents, degree)          a B-spline through points and tangents
//   curve_geometry(curve, t)                                curvature and torsion vectors
//   curve_properties(curve, t0, t1, kind, value, tol)       inflections, radius extrema
//   curve_box(curve, t0, t1)                                the exact axis-aligned box
//   lines_and_arcs(curve, tolerance)                        lines and circular arcs within a tolerance
//
// The kernel's own entries for some of these are SM_API calls with fixed tolerances: SmApiOffsetCurve
// approximates within 0.001 (an offset of 2 was 1.99945 to 2.00085 from a spline), the SM_API point
// approximation has no tolerance at all (a fixed fraction of the points as control points), and
// SmApiConvertToLinesAndArcs asks for 0.001 and returns one rational B-spline whose arcs, fitted
// within ten times what NLib is given (N_CrvSplitIntoLinesAndArcs), were 0.0037 off. Here every
// tolerance is the caller's, every result is measured, and the arcs come back as separate pieces.

#include "kernel.h"
#include "curve_ops.h"

#include <SmApiGeneral.h>
#include <SmApiQueries.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <memory>
#include <stdexcept>

namespace
{

using smlibpy::tup;
using smlibpy::Value;

const double NaN = std::numeric_limits<double>::quiet_NaN();
const double PI = 3.14159265358979323846;

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(status, what, __FILE__, __LINE__);
}

Value xyz(const SmVector3d& p) { return tup(p.x, p.y, p.z); }

SmVector3d cross(const SmVector3d& a, const SmVector3d& b)
{
    return SmVector3d(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

SmVector3d vector3(const std::vector<double>& v, const char* what)
{
    if (v.size() != 3 || !std::isfinite(v[0]) || !std::isfinite(v[1]) || !std::isfinite(v[2]))
        throw std::invalid_argument(std::string(what) + ": expected three finite numbers");
    return SmVector3d(v[0], v[1], v[2]);
}

SmTArray<SmPoint3d> point_array(const std::vector<double>& xyz, const char* what, ULONG at_least)
{
    if (xyz.size() % 3 != 0)
        throw std::invalid_argument(std::string(what) + ": the points must be x, y, z triples");
    const ULONG n = static_cast<ULONG>(xyz.size() / 3);
    if (n < at_least)
        throw std::invalid_argument(std::string(what) + ": at least " + std::to_string(at_least) + " points are needed");
    SmTArray<SmPoint3d> out;
    for (ULONG i = 0; i < n; i++)
    {
        if (!std::isfinite(xyz[3 * i]) || !std::isfinite(xyz[3 * i + 1]) || !std::isfinite(xyz[3 * i + 2]))
            throw std::invalid_argument(std::string(what) + ": the points must be finite numbers");
        out.Add(SmPoint3d(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]));
    }
    return out;
}

// The curve as a standalone B-spline (a copy; other curves approximated within 1e-9 of their size).
std::unique_ptr<SmBSplineCurve> bspline_copy(const SmCurve* curve)
{
    SmCurve* copy = nullptr;
    check(curve->Copy(ctx(), copy), "SmCurve::Copy");
    std::unique_ptr<SmCurve> own(copy);
    if (SmBSplineCurve* b = SM_CAST_PTR(SmBSplineCurve, copy))
    {
        own.release();
        return std::unique_ptr<SmBSplineCurve>(b);
    }
    SmTArray<double> breaks;
    const SmExtent1d ivl = copy->GetNaturalInterval();
    breaks.Add(ivl.GetMin());
    breaks.Add(ivl.GetMax());
    double gap = 0.0;
    SmBSplineCurve* a = nullptr;
    check(copy->ApproximateCurve(ctx(), breaks, 1e-9, gap, a, FALSE, TRUE), "SmCurve::ApproximateCurve");
    return std::unique_ptr<SmBSplineCurve>(a);
}

// The distance from a point to a curve and the parameter of its nearest point.
double distance_to(const SmCurve* curve, const SmPoint3d& p, double* param = nullptr)
{
    SmPoint3d q;
    double t = 0.0, d = 0.0;
    check(SmApiCurveClosestPoint(curve, p, q, t, d), "SmApiCurveClosestPoint");
    if (param)
        *param = t;
    return d;
}

double max_distance(const SmCurve* curve, const SmTArray<SmPoint3d>& points)
{
    double worst = 0.0;
    for (ULONG i = 0; i < points.GetSize(); i++)
        worst = std::max(worst, distance_to(curve, points[i]));
    return worst;
}

// [position, derivative, curvature vector] at t.
void frenet(const SmCurve* curve, double t, SmVector3d g[4])
{
    const SmExtent1d ivl = curve->GetNaturalInterval();
    g[2] = SmVector3d(0, 0, 0);
    check(curve->EvaluateGeometric(t, 2, t < ivl.GetMax() ? TRUE : FALSE, g), "SmCurve::EvaluateGeometric");
}

SmCurvePropertyType property_kind(const std::string& kind)
{
    if (kind == "inflections")
        return SM_CP_INFLECTION_POINTS;
    if (kind == "min_radius")
        return SM_CP_MINIMIZE_RADIUS_OF_CURVATURE;
    if (kind == "max_radius")
        return SM_CP_MAXIMIZE_RADIUS_OF_CURVATURE;
    if (kind == "radius")
        return SM_CP_RADIUS_OF_CURVATURE;
    throw std::invalid_argument("curve_properties: kind is 'inflections', 'min_radius', 'max_radius' or 'radius', not '" +
                                kind + "'");
}

// ---------------------------------------------------------------- lines and arcs
struct Piece
{
    bool arc = false;
    SmPoint3d start, mid, end;
    // arcs: center, unit normal (the arc turns counterclockwise about it), radius, sweep (radians)
    SmPoint3d center;
    SmVector3d normal;
    double radius = 0.0, sweep = 0.0;
};

// The circle through three points (false where they lie on a line).
bool circle_through(const SmPoint3d& a, const SmPoint3d& b, const SmPoint3d& c, Piece& out)
{
    const SmVector3d ab = b - a, ac = c - a;
    const SmVector3d n = cross(ab, ac);
    const double nn = n.Dot(n);
    if (!(nn > 1e-24 * ab.Dot(ab) * ac.Dot(ac)) || nn == 0.0)
        return false;
    const SmVector3d center = a + (cross(n, ab) * ac.Dot(ac) + cross(ac, n) * ab.Dot(ab)) / (2.0 * nn);
    out.center = center;
    out.normal = n / std::sqrt(nn);
    out.radius = (a - center).Length();
    const SmVector3d u = (a - center) / out.radius, v = cross(out.normal, u);
    const SmVector3d w = c - center;
    double sweep = std::atan2(w.Dot(v), w.Dot(u));
    if (sweep <= 0.0)
        sweep += 2.0 * PI;
    out.sweep = sweep;
    return true;
}

double distance_to_piece(const Piece& p, const SmPoint3d& q)
{
    if (!p.arc)
    {
        const SmVector3d d = p.end - p.start;
        const double L2 = d.Dot(d);
        double s = L2 > 0.0 ? (q - p.start).Dot(d) / L2 : 0.0;
        s = std::min(1.0, std::max(0.0, s));
        return (q - (p.start + d * s)).Length();
    }
    const SmVector3d r = q - p.center;
    const double h = r.Dot(p.normal);
    const SmVector3d in = r - p.normal * h;
    const double L = in.Length();
    double best = std::min((q - p.start).Length(), (q - p.end).Length());
    if (L > 0.0)
    {
        const SmVector3d u = (p.start - p.center) / p.radius, v = cross(p.normal, u);
        double a = std::atan2(in.Dot(v), in.Dot(u));
        if (a < 0.0)
            a += 2.0 * PI;
        if (a <= p.sweep)
            best = std::min(best, std::sqrt(h * h + (L - p.radius) * (L - p.radius)));
    }
    return best;
}

SmPoint3d point_of(const Piece& p, double f)
{
    if (!p.arc)
        return p.start + (p.end - p.start) * f;
    const SmVector3d u = (p.start - p.center) / p.radius, v = cross(p.normal, u);
    const double a = p.sweep * f;
    return p.center + (u * std::cos(a) + v * std::sin(a)) * p.radius;
}

// The pieces of one try at a given NLib tolerance.
std::vector<Piece> pieces_of(SmBSplineCurve* b, double tol)
{
    SmTArray<SmBSplineCurve*> out;
    const SmStatus status = b->SubdivideToLinesAndArcs(ctx(), tol, out);
    std::vector<std::unique_ptr<SmBSplineCurve>> owned;
    for (ULONG i = 0; i < out.GetSize(); i++)
        owned.emplace_back(out[i]);
    check(status, "SmBSplineCurve::SubdivideToLinesAndArcs");
    std::vector<Piece> pieces;
    auto add_span = [&](const SmCurve* c, double a, double z) {
        Piece p;
        check(c->EvaluatePoint(a, p.start), "SmCurve::EvaluatePoint");
        check(c->EvaluatePoint(0.5 * (a + z), p.mid), "SmCurve::EvaluatePoint");
        check(c->EvaluatePoint(z, p.end), "SmCurve::EvaluatePoint");
        if ((p.end - p.start).Length() <= 1e-12 * std::max(1.0, p.start.Length()) && (p.mid - p.start).Length() == 0.0)
            return;  // a span of no length
        if ((p.end - p.start).Length() <= 1e-12 * std::max(1.0, (p.mid - p.start).Length()))
        {
            // a whole circle: two halves
            Piece h1, h2;
            SmPoint3d q1, q3;
            check(c->EvaluatePoint(0.75 * a + 0.25 * z, q1), "SmCurve::EvaluatePoint");
            check(c->EvaluatePoint(0.25 * a + 0.75 * z, q3), "SmCurve::EvaluatePoint");
            h1.start = p.start, h1.mid = q1, h1.end = p.mid;
            h2.start = p.mid, h2.mid = q3, h2.end = p.end;
            for (Piece* h : {&h1, &h2})
            {
                h->arc = circle_through(h->start, h->mid, h->end, *h);
                pieces.push_back(*h);
            }
            return;
        }
        p.arc = circle_through(p.start, p.mid, p.end, p);
        if (p.arc)
        {
            // a span that is no circle (a nearly straight polynomial NLib took for a line): its chord
            SmPoint3d q;
            check(c->EvaluatePoint(0.75 * a + 0.25 * z, q), "SmCurve::EvaluatePoint");
            if (std::abs((q - p.center).Length() - p.radius) > 1e-9 * std::max(1.0, p.radius) || p.radius > 1e12)
                p.arc = false;
        }
        if (!p.arc)
            p.mid = (p.start + p.end) * 0.5;
        pieces.push_back(p);
    };
    if (owned.empty())
    {
        // the kernel leaves lines and arcs as they are: the curve itself, one piece
        const SmExtent1d ivl = b->GetNaturalInterval();
        if (b->IsLinear(tol))
        {
            Piece p;
            b->GetEnds(p.start, p.end);
            p.mid = (p.start + p.end) * 0.5;
            pieces.push_back(p);
        }
        else
            add_span(b, ivl.GetMin(), ivl.GetMax());
        return pieces;
    }
    for (auto& c : owned)
    {
        const SmExtent1d ivl = c->GetNaturalInterval();
        if (c->IsLinear(0.0) || c->GetDegree() == 1 || (!c->IsRational() && c->IsLinear(tol)))
        {
            Piece p;
            c->GetEnds(p.start, p.end);
            p.mid = (p.start + p.end) * 0.5;
            if ((p.end - p.start).Length() > 0.0)
                pieces.push_back(p);
            continue;
        }
        SmTArray<double> knots;
        check(c->GetKnots(knots, nullptr, &ivl), "SmCurve::GetKnots");
        for (ULONG k = 0; k + 1 < knots.GetSize(); k++)
            if (knots[k + 1] > knots[k])
                add_span(c.get(), knots[k], knots[k + 1]);
    }
    // end to end: each piece starts where the one before ends
    for (size_t i = 1; i < pieces.size(); i++)
    {
        pieces[i].start = pieces[i - 1].end;
        if (pieces[i].arc && !circle_through(pieces[i].start, pieces[i].mid, pieces[i].end, pieces[i]))
            pieces[i].arc = false;
    }
    return pieces;
}

// The largest distance between the pieces and the curve, both ways.
double pieces_deviation(const SmCurve* curve, const std::vector<Piece>& pieces)
{
    if (pieces.empty())
        return std::numeric_limits<double>::infinity();
    double worst = 0.0;
    const SmExtent1d ivl = curve->GetNaturalInterval();
    const int n = std::max(256, static_cast<int>(16 * pieces.size()));
    for (int i = 0; i <= n; i++)
    {
        SmPoint3d q;
        check(curve->EvaluatePoint(ivl.Evaluate(static_cast<double>(i) / n), q), "SmCurve::EvaluatePoint");
        double best = std::numeric_limits<double>::infinity();
        for (const Piece& p : pieces)
            best = std::min(best, distance_to_piece(p, q));
        worst = std::max(worst, best);
    }
    for (const Piece& p : pieces)
        for (double f : {0.125, 0.375, 0.625, 0.875})
            worst = std::max(worst, distance_to(curve, point_of(p, f)));
    SmPoint3d s, e;
    curve->GetEnds(s, e);
    worst = std::max(worst, (pieces.front().start - s).Length());
    worst = std::max(worst, (pieces.back().end - e).Length());
    return worst;
}

}  // namespace

namespace smlibpy {

CurveResult offset_curve(const SmCurve* curve, const std::vector<double>& normal, double distance, double tolerance)
{
    if (!curve)
        throw std::invalid_argument("curve is None");
    SmVector3d n = vector3(normal, "offset_curve");
    if (!(n.Length() > 0.0))
        throw std::invalid_argument("offset_curve: the normal has no length");
    n = n / n.Length();
    if (!std::isfinite(distance) || distance == 0.0)
        throw std::invalid_argument("offset_curve: the distance must be a number other than 0");
    if (!(tolerance > 0.0) || !std::isfinite(tolerance))
        throw std::invalid_argument("offset_curve: the tolerance must be positive");
    const double d = std::abs(distance);
    const SmExtent1d ivl = curve->GetNaturalInterval();
    CurveResult out;
    out.tight = NaN;

    // Where the curve bends toward the side it moves to with a radius of d or less, its offset has a
    // cusp or a loop. Such a stretch ends at a point where the radius is d, or at an end of the curve.
    auto too_tight = [&](double t, double slack) {
        SmVector3d g[4];
        frenet(curve, t, g);
        const double k = g[2].Length();
        if (!(k > 0.0))
            return false;
        SmVector3d side = cross(n, g[1]);
        if (distance < 0.0)
            side = side * -1.0;
        return g[2].Dot(side) > 0.0 && 1.0 / k <= d * (1.0 + slack);
    };
    for (double t : {ivl.GetMin(), ivl.GetMax()})
        if (too_tight(t, 1e-9))
        {
            out.tight = t;
            return out;
        }
    {
        SmSolutionArray sols;
        check(curve->GlobalPropertyAnalysis(ivl, SM_CP_RADIUS_OF_CURVATURE, &d, nullptr, tolerance, sols),
              "SmCurve::GlobalPropertyAnalysis");
        for (ULONG i = 0; i < sols.GetSize(); i++)
        {
            const double t = sols[i].m_vStart[0];
            if (too_tight(t, 1e-6))
            {
                out.tight = t;
                return out;
            }
        }
    }

    std::unique_ptr<SmBSplineCurve> b = bspline_copy(curve);
    SmBSplineCurve* moved = nullptr;
    double gap = 0.0;
    // (the kernel's positive offsets go to the right)
    check(b->CreateSimpleOffset(ctx(), tolerance, n, -distance, moved, gap), "SmBSplineCurve::CreateSimpleOffset");
    if (!moved)
        check(SM_ERR, "SmBSplineCurve::CreateSimpleOffset");
    std::unique_ptr<SmBSplineCurve> result(moved);

    // The ends exactly where they belong (the approximation leaves them up to its tolerance off, and
    // a curve the kernel takes for an arc within a hundredth of the tolerance is offset as that arc):
    // where the next piece of a wire starts, or the arc around a corner ends. The end control points
    // of the clamped result are its end points.
    auto exact = [&](double t) {
        SmVector3d pv[2];
        check(curve->Evaluate(t, 1, t < ivl.GetMax() ? TRUE : FALSE, pv, TRUE), "SmCurve::Evaluate");
        const SmVector3d side = cross(n, pv[1]);
        return side.Length() > 0.0 ? pv[0] + side * (distance / side.Length()) : pv[0];
    };
    const ULONG poles = moved->GetNumberControlPoints();
    const SmControlPointFormType form = moved->IsRational() ? SM_CP_EUCLIDIAN_RATIONAL : SM_CP_NON_RATIONAL;
    if (poles >= 2)
    {
        SmPoint3d first, last, start, end;
        double w0 = 1.0, w1 = 1.0;
        check(moved->GetControlPoint(form, 0, first, w0), "SmBSplineCurve::GetControlPoint");
        check(moved->GetControlPoint(form, poles - 1, last, w1), "SmBSplineCurve::GetControlPoint");
        moved->GetEnds(start, end);
        const double scale = std::max(1.0, start.Length() + end.Length());
        if ((first - start).Length() <= 1e-12 * scale && (last - end).Length() <= 1e-12 * scale)
        {
            check(moved->SetControlPoint(form, 0, exact(ivl.GetMin()), w0), "SmBSplineCurve::SetControlPoint");
            check(moved->SetControlPoint(form, poles - 1, exact(ivl.GetMax()), w1), "SmBSplineCurve::SetControlPoint");
        }
    }

    // Measured: the exact offset point of the curve at each of 129 parameters lies on the offset
    // (the kernel's gap measures the other way). Not the distance from the offset back to the curve:
    // where another part of the curve passes closer than d (a figure eight), that is less than d.
    double worst = std::isfinite(gap) ? gap : 0.0;
    const int samples = 128;
    for (int i = 0; i <= samples; i++)
    {
        const double t = ivl.Evaluate(static_cast<double>(i) / samples);
        SmVector3d pv[2];
        check(curve->Evaluate(t, 1, t < ivl.GetMax() ? TRUE : FALSE, pv, TRUE), "SmCurve::Evaluate");
        const SmVector3d side = cross(n, pv[1]);
        if (!(side.Length() > 0.0))
            continue;
        worst = std::max(worst, distance_to(moved, pv[0] + side * (distance / side.Length())));
    }
    out.curve = result.release();
    out.deviation = worst;
    return out;
}

CurveResult approximate_points(const std::vector<double>& points, int degree, double tolerance,
                               const std::vector<double>& start_tangent, const std::vector<double>& end_tangent,
                               bool closed)
{
    SmTArray<SmPoint3d> P = point_array(points, "approximate_points", 2);
    // A closed curve runs through its first point again (the kernel closes the curve by the
    // tangents only, ending at the last point given).
    if (closed && (P[P.GetSize() - 1] - P[0]).Length() > 0.0)
        P.Add(P[0]);
    if (degree < 1 || degree > 9)
        throw std::invalid_argument("approximate_points: the degree must be 1 to 9");
    if (!(tolerance >= 0.0) || !std::isfinite(tolerance))
        throw std::invalid_argument("approximate_points: the tolerance must be 0 or positive");
    // The kernel takes the tangents as derivatives along a parameter that runs from 0 to 1 along
    // the points (chord length): directions scaled to the length of the polyline.
    double length = 0.0;
    for (ULONG i = 1; i < P.GetSize(); i++)
        length += (P[i] - P[i - 1]).Length();
    if (!(length > 0.0))
        throw std::invalid_argument("approximate_points: the points all coincide");
    SmVector3d ts, te;
    SmVector3d* pts = nullptr;
    SmVector3d* pte = nullptr;
    if (!start_tangent.empty())
    {
        ts = vector3(start_tangent, "approximate_points");
        if (!(ts.Length() > 0.0))
            throw std::invalid_argument("approximate_points: the start tangent has no length");
        ts = ts * (length / ts.Length());
        pts = &ts;
    }
    if (!end_tangent.empty())
    {
        te = vector3(end_tangent, "approximate_points");
        if (!(te.Length() > 0.0))
            throw std::invalid_argument("approximate_points: the end tangent has no length");
        te = te * (length / te.Length());
        pte = &te;
    }
    // The kernel measures its error at the parameters it gave the points: where the curve passes
    // closer to a point elsewhere that is only better, but a fit measured farther off than asked is
    // made again with less.
    std::unique_ptr<SmBSplineCurve> best;
    double best_deviation = std::numeric_limits<double>::infinity();
    double tol = tolerance;
    for (int attempt = 0; attempt < (tolerance > 0.0 ? 4 : 1); attempt++)
    {
        SmBSplineCurve* c = nullptr;
        double asked = tol;
        check(SmBSplineCurve::ApproximatePoints(ctx(), P, static_cast<ULONG>(degree), pts, pte, closed ? TRUE : FALSE,
                                                tolerance > 0.0 ? &asked : nullptr, c),
              "SmBSplineCurve::ApproximatePoints");
        if (!c)
            check(SM_ERR, "SmBSplineCurve::ApproximatePoints");
        std::unique_ptr<SmBSplineCurve> own(c);
        const double deviation = max_distance(c, P);
        if (deviation < best_deviation)
            best = std::move(own), best_deviation = deviation;
        if (best_deviation <= tolerance)
            break;
        tol *= 0.5;
    }
    CurveResult out;
    out.deviation = best_deviation;
    out.curve = best.release();
    return out;
}

CurveResult interpolate_tangents(const std::vector<double>& points, const std::vector<double>& tangents, int degree)
{
    SmTArray<SmPoint3d> P = point_array(points, "interpolate_tangents", 2);
    if (tangents.size() != points.size())
        throw std::invalid_argument("interpolate_tangents: one tangent (x, y, z) per point");
    if (degree != 2 && degree != 3)
        throw std::invalid_argument("interpolate_tangents: the degree must be 2 or 3");
    SmTArray<SmVector3d> T;
    for (ULONG i = 0; i < P.GetSize(); i++)
    {
        SmVector3d t(tangents[3 * i], tangents[3 * i + 1], tangents[3 * i + 2]);
        if (!(t.Length() > 0.0) || !std::isfinite(t.Length()))
            throw std::invalid_argument("interpolate_tangents: tangent " + std::to_string(i + 1) + " has no direction");
        if (i > 0 && !((P[i] - P[i - 1]).Length() > 0.0))
            throw std::invalid_argument("interpolate_tangents: points " + std::to_string(i) + " and " +
                                        std::to_string(i + 1) + " coincide");
        T.Add(t / t.Length());
    }
    SmBSplineCurve* c = nullptr;
    check(SmBSplineCurve::CreateInterpolatingCurve(ctx(), SM_CP_CHORDLENGTH, 3, static_cast<ULONG>(degree), P, T, nullptr,
                                                   TRUE, c),
          "SmBSplineCurve::CreateInterpolatingCurve");
    if (!c)
        check(SM_ERR, "SmBSplineCurve::CreateInterpolatingCurve");
    std::unique_ptr<SmBSplineCurve> own(c);
    CurveResult out;
    out.deviation = max_distance(c, P);
    out.curve = own.release();
    return out;
}

Value curve_geometry(const SmCurve* curve, double t)
{
    if (!curve)
        throw std::invalid_argument("curve is None");
    const SmExtent1d ivl = curve->GetNaturalInterval();
    const SmBoolean from_left = t < ivl.GetMax() ? TRUE : FALSE;
    SmVector3d g[4];
    g[2] = g[3] = SmVector3d(0, 0, 0);
    if (curve->EvaluateGeometric(t, 3, from_left, g) != SM_SUCCESS)
    {
        // straight curves have no torsion; degenerate ones no curvature either
        g[2] = g[3] = SmVector3d(0, 0, 0);
        if (curve->EvaluateGeometric(t, 2, from_left, g) != SM_SUCCESS)
        {
            g[2] = SmVector3d(0, 0, 0);
            check(curve->EvaluateGeometric(t, 1, from_left, g), "SmCurve::EvaluateGeometric");
        }
    }
    Value out = Value::dict();
    out.set("point", xyz(g[0]));
    out.set("derivative", xyz(g[1]));
    out.set("curvature", xyz(g[2]));
    out.set("torsion", xyz(g[3]));
    return out;
}

Value curve_properties(const SmCurve* curve, double t0, double t1, const std::string& kind, double value,
                       double tolerance)
{
    if (!curve)
        throw std::invalid_argument("curve is None");
    if (!(std::isfinite(t0) && std::isfinite(t1) && t0 < t1))
        throw std::invalid_argument("curve_properties: the interval must run upwards");
    if (!(tolerance > 0.0) || !std::isfinite(tolerance))
        throw std::invalid_argument("curve_properties: the tolerance must be positive");
    const SmCurvePropertyType type = property_kind(kind);
    if (type == SM_CP_RADIUS_OF_CURVATURE && !(value > 0.0 && std::isfinite(value)))
        throw std::invalid_argument("curve_properties: the radius must be positive");
    SmSolutionArray sols;
    check(curve->GlobalPropertyAnalysis(SmExtent1d(t0, t1), type, type == SM_CP_RADIUS_OF_CURVATURE ? &value : nullptr,
                                        nullptr, tolerance, sols),
          "SmCurve::GlobalPropertyAnalysis");
    Value out = Value::make_list();
    for (ULONG i = 0; i < sols.GetSize(); i++)
    {
        Value d = Value::dict();
        d.set("t", v(sols[i].m_vStart[0]));
        d.set("end", sols[i].m_eSolutionType == SM_ST_RANGE_OF_VALUES ? v(sols[i].m_vEnd[0]) : Value());
        out.push(d);
    }
    return out;
}

Value curve_box(const SmCurve* curve, double t0, double t1)
{
    if (!curve)
        throw std::invalid_argument("curve is None");
    if (!(std::isfinite(t0) && std::isfinite(t1) && t0 <= t1))
        throw std::invalid_argument("curve_box: the interval must run upwards");
    SmExtent3d box;
    SmPoint3d p;
    for (double t : {t0, t1})
    {
        check(curve->EvaluatePoint(t, p), "SmCurve::EvaluatePoint");
        box.AddPoint3d(p);
    }
    if (t1 > t0)
    {
        // the corners: knots where the tangent jumps (as SmCurve::CalculateTightBoundingBox, which
        // takes them over the whole curve)
        if (curve->IsKindOf(SmBSplineCurve_TYPE))
        {
            SmTArray<double> knots;
            SmTArray<SmContinuityType> continuities;
            SmContinuityType lowest;
            const SmBSplineCurve* b = static_cast<const SmBSplineCurve*>(curve);
            if (b->GetKnots(knots, nullptr) == SM_SUCCESS && b->CalculateContinuities(lowest, continuities, 2.0) == SM_SUCCESS)
                for (ULONG i = 1; i + 1 < knots.GetSize() && i < continuities.GetSize(); i++)
                    if (knots[i] > t0 && knots[i] < t1 && continuities[i] <= SM_CT_C1)
                    {
                        check(curve->EvaluatePoint(knots[i], p), "SmCurve::EvaluatePoint");
                        box.AddPoint3d(p);
                    }
        }
        for (int axis = 0; axis < 3; axis++)
        {
            SmVector3d dir(axis == 0, axis == 1, axis == 2);
            SmSolutionArray sols;
            check(curve->GlobalPropertyAnalysis(SmExtent1d(t0, t1), SM_CP_PERPENDICULAR_TO_VECTOR, nullptr, &dir,
                                                SM_EFF_ZERO_SQRT, sols),
                  "SmCurve::GlobalPropertyAnalysis");
            for (ULONG i = 0; i < sols.GetSize(); i++)
            {
                check(curve->EvaluatePoint(sols[i].m_vStart[0], p), "SmCurve::EvaluatePoint");
                box.AddPoint3d(p);
                if (sols[i].m_eSolutionType == SM_ST_RANGE_OF_VALUES)
                {
                    check(curve->EvaluatePoint(sols[i].m_vEnd[0], p), "SmCurve::EvaluatePoint");
                    box.AddPoint3d(p);
                }
            }
        }
    }
    return tup(xyz(box.GetMin()), xyz(box.GetMax()));
}

Value lines_and_arcs(const SmCurve* curve, double tolerance)
{
    if (!curve)
        throw std::invalid_argument("curve is None");
    if (!(tolerance > 0.0) || !std::isfinite(tolerance))
        throw std::invalid_argument("lines_and_arcs: the tolerance must be positive");
    std::unique_ptr<SmBSplineCurve> b = bspline_copy(curve);
    // NLib fits the arcs within ten times the tolerance it is given (and the lines within it): a
    // tenth first, less while the result is not within the tolerance.
    double tol = tolerance / 10.0;
    std::vector<Piece> best;
    double best_dev = std::numeric_limits<double>::infinity();
    for (int attempt = 0; attempt < 12; attempt++)
    {
        std::vector<Piece> pieces;
        try
        {
            pieces = pieces_of(b.get(), tol);
        }
        catch (const std::exception&)
        {
            if (attempt == 0)
                throw;
            break;  // (a finer try the kernel cannot do: the best so far)
        }
        const double dev = pieces_deviation(b.get(), pieces);
        if (dev < best_dev)
            best = std::move(pieces), best_dev = dev;
        if (best_dev <= tolerance)
            break;
        tol *= std::min(0.5, 0.8 * tolerance / dev);
        if (best.size() > 100000)
            break;
    }
    Value list = Value::make_list();
    for (const Piece& p : best)
    {
        Value d = Value::dict();
        d.set("kind", Value::of(std::string(p.arc ? "arc" : "line")));
        d.set("start", xyz(p.start));
        d.set("mid", xyz(p.arc ? point_of(p, 0.5) : (p.start + p.end) * 0.5));
        d.set("end", xyz(p.end));
        list.push(d);
    }
    Value out = Value::dict();
    out.set("pieces", list);
    out.set("deviation", v(best_dev));
    return out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"
#include "py_value.h"

namespace
{

py::tuple result(const smlibpy::CurveResult& r)
{
    return py::make_tuple(r.curve ? py::cast(r.curve, py::return_value_policy::reference) : py::none(), r.deviation,
                          r.tight);
}

}  // namespace

void bind_curve_ops(py::module_ m)
{
    m.def("offset_curve", [](const SmCurve* curve, const std::vector<double>& normal, double distance, double tolerance) {
        return result(smlibpy::offset_curve(curve, normal, distance, tolerance));
    }, py::arg("curve"), py::arg("normal"), py::arg("distance"), py::arg("tolerance"),
          "The curve moved distance sideways in the plane with that normal, positive to the left of its direction "
          "seen from where the normal points (SmBSplineCurve::CreateSimpleOffset within tolerance): (curve, deviation, "
          "tight). curve is None where the curve bends toward that side with a radius of the distance or less; tight "
          "is a parameter there (else NaN). The curve is the caller's (ext.delete_curve).");
    m.def("approximate_points", [](const std::vector<double>& points, int degree, double tolerance,
                                   const std::vector<double>& start_tangent, const std::vector<double>& end_tangent,
                                   bool closed) {
        return result(smlibpy::approximate_points(points, degree, tolerance, start_tangent, end_tangent, closed));
    }, py::arg("points"), py::arg("degree") = 3, py::arg("tolerance") = 0.0, py::arg("start_tangent") = std::vector<double>(),
          py::arg("end_tangent") = std::vector<double>(), py::arg("closed") = false,
          "A B-spline near points (x, y, z flat) within tolerance (SmBSplineCurve::ApproximatePoints; 0: the "
          "least-squares fit of degree): (curve, deviation, nan), deviation the largest distance of a point from it. "
          "The curve is the caller's.");
    m.def("interpolate_tangents", [](const std::vector<double>& points, const std::vector<double>& tangents, int degree) {
        return result(smlibpy::interpolate_tangents(points, tangents, degree));
    }, py::arg("points"), py::arg("tangents"), py::arg("degree") = 3,
          "A B-spline through points (x, y, z flat) with a tangent direction at each "
          "(SmBSplineCurve::CreateInterpolatingCurve): (curve, deviation, nan). The curve is the caller's.");
    m.def("curve_geometry", [](const SmCurve* curve, double t) {
        return smlibpy::to_python(smlibpy::curve_geometry(curve, t));
    }, py::arg("curve"), py::arg("t"),
          "{point, derivative, curvature (vector toward the center of curvature, length 1/radius), torsion (vector "
          "along the binormal)} at parameter t (SmCurve::EvaluateGeometric).");
    m.def("curve_properties", [](const SmCurve* curve, double t0, double t1, const std::string& kind, double value,
                                 double tolerance) {
        return smlibpy::to_python(smlibpy::curve_properties(curve, t0, t1, kind, value, tolerance));
    }, py::arg("curve"), py::arg("t0"), py::arg("t1"), py::arg("kind"), py::arg("value") = 0.0, py::arg("tolerance") = 1e-9,
          "Parameters over [t0, t1] where kind holds (SmCurve::GlobalPropertyAnalysis): 'inflections', 'min_radius', "
          "'max_radius', 'radius' (of curvature equal to value). [{t, end}], end set for a stretch.");
    m.def("curve_box", [](const SmCurve* curve, double t0, double t1) {
        return smlibpy::to_python(smlibpy::curve_box(curve, t0, t1));
    }, py::arg("curve"), py::arg("t0"), py::arg("t1"),
          "The exact axis-aligned box of the curve over [t0, t1]: ((xmin, ymin, zmin), (xmax, ymax, zmax)).");
    m.def("lines_and_arcs", [](const SmCurve* curve, double tolerance) {
        return smlibpy::to_python(smlibpy::lines_and_arcs(curve, tolerance));
    }, py::arg("curve"), py::arg("tolerance"),
          "The curve as lines and circular arcs within tolerance (SmBSplineCurve::SubdivideToLinesAndArcs, "
          "measured): {pieces: [{kind: 'line' | 'arc', start, mid, end}], deviation}.");
}
#endif  // SMLIBPY_PYTHON
