// SPDX-License-Identifier: Apache-2.0
//
// Blends between two free edges of sheets (`smlibpy._core.ext`):
//
//   edge_blend(face1, edge1, face2, edge2, continuity, tension1, tension2)   a sheet of one face
//
// The kernel builds such a bridge in SmBrep::CreateEdgeEdgeBlend (SmPrimitiveCreation::
// CreateBlendPrimitive, SmApiCreateBlendPrimitive): cross sections from edge1 to edge2 that leave
// and reach each face with its derivatives, skinned along the two edges as rails. Its wrappers
// cannot be used as they are:
//
// - Where the edges run opposite ways (the flag "start of edge1 to end of edge2", or the guess that
//   picks it), CreateEdgeEdgeBlend reverses the second rail twice: once with the side it arrives
//   from, and again after the cusp options. The second turn restores the rail's direction but not
//   the side, so cross sections join the far ends: a twisted blend whose side edges cross. Its
//   linear reparameterization of the second rail also has the offset's parentheses wrong (right
//   only for intervals that start at 0).
// - SmPrimitiveCreation::CreateBlendPrimitive (face/edge overload, the one SM_API calls) drops the
//   status of the blend (always SM_SUCCESS) and fixes G2; SmApiCreateBlendPrimitive fixes the pairing
//   of the ends to the caller's flag.
// - The take-off lengths scale along each rail (start to end), the same at both edges, and only the
//   first cross derivative: SmDerivSurfDefinition::GetSampleValues rescales the surface's first
//   directional derivative to the take-off length but keeps the second (and third) as they are, so a
//   "G2" cross section has the face's curvature divided by the square of that scale, which depends on
//   the face's parameterization. Only flat faces come out G2.
//
// So this follows CreateEdgeEdgeBlend and SmSurface::CreateBlendSurface step by step, with those
// three things right: the ends of the edges are paired by distance and the second rail turned once,
// the cross derivatives at each edge are the face's own along the take-off direction, reparameterized
// to a take-off of `tension` times the gap (the second derivative by its square, the third by its
// cube), and every status is checked. The result's corners are checked against the paired ends.
//
// Two closed edges (the rims of two tubes) are bridged too: both rails become cubic interpolants of
// the same knots through points at equal steps of their lengths, the second starting at its point
// nearest the first one's start and running the same way round, both on past their starts by an
// eighth round; the blend skinned along them is cut back to once round in two halves (the kernel
// offsets no surface that closes around), sewn along the cuts, as smooth across them as elsewhere.
#include "kernel.h"
#include "blend.h"
#include "ext_shared.h"
#include "stitch.h"
#include "measure.h"

#include <SmApiGeneral.h>

#include <algorithm>
#include <cmath>
#include <memory>
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

struct CurveDeleter
{
    void operator()(SmCurve* c) const { delete c; }
};
using RailPtr = std::unique_ptr<SmBSplineCurve, CurveDeleter>;

// The edge's curve over the edge's interval as a plain B-spline curve, in the curve's direction
// (as SmEdge::CreateTrimmedNURBSCurve; conics are approximated).
RailPtr rail_of(const SmEdge* edge)
{
    const SmCurve* curve = edge->GetCurve();
    if (!curve)
        throw std::invalid_argument("edge_blend: an edge has no curve");
    RailPtr rail;
    if (const SmBSplineCurve* b = SM_CAST_PTR(SmBSplineCurve, curve))
    {
        rail.reset(new (ctx()) SmBSplineCurve(*b));
        SmExtent1d ivl = edge->GetInterval();
        SmExtent1d nat = rail->GetNaturalInterval();
        if (std::abs(ivl.GetMin() - nat.GetMin()) > 1e-12 || std::abs(ivl.GetMax() - nat.GetMax()) > 1e-12)
            check(rail->Trim(ivl), "SmBSplineCurve::Trim");
    }
    else
    {
        std::unique_ptr<SmCurve, CurveDeleter> trimmed(smlibpy::edge_curve(edge));
        rail.reset(smlibpy::approximate_curve(trimmed.get(), 1e-7));
    }
    return rail;
}

SmPoint3d point_at(const SmCurve& c, double t)
{
    SmPoint3d p;
    check(c.EvaluatePoint(t, p), "SmCurve::EvaluatePoint");
    return p;
}

// The parameter of a curve's point nearest to q over its interval (samples, then golden sections).
double nearest_param(const SmCurve& c, const SmExtent1d& ivl, const SmPoint3d& q)
{
    const int n = 128;
    double best = 1e300, at = ivl.GetMin();
    for (int k = 0; k <= n; ++k)
    {
        const double t = ivl.Evaluate(double(k) / n);
        const double d = point_at(c, t).DistanceBetween(q);
        if (d < best)
            best = d, at = t;
    }
    double a = std::max(ivl.GetMin(), at - ivl.GetLength() / n), b = std::min(ivl.GetMax(), at + ivl.GetLength() / n);
    const double g = 0.5 * (std::sqrt(5.0) - 1.0);
    for (int it = 0; it < 100 && b - a > 1e-15 * (1.0 + std::abs(a) + std::abs(b)); ++it)
    {
        const double x1 = b - g * (b - a), x2 = a + g * (b - a);
        if (point_at(c, x1).DistanceBetween(q) < point_at(c, x2).DistanceBetween(q))
            b = x2;
        else
            a = x1;
    }
    return 0.5 * (a + b);
}

// How far a closed blend's rails run on past their starts, as a fraction of the way round.
constexpr double kOver = 0.125;

// A closed rail as a cubic interpolant (uniform parameters) through points of it at equal steps of
// its length, starting at parameter t and running forward or backward round it, within `tol` of it.
// Both rails of a closed blend are made so: they get the same knots, and the cross sections join
// points at the same fraction of the length round each. (The blend's skin takes the knots of both
// rails: two rails each fitted on its own had knots 1e-8 apart, spans the kernel's offset could not
// follow, so a closed blend could not be thickened. A full circle's own NURBS has double knots at its
// quarters, which left control points 2e-7 apart in the skin.) `n`: the number of points round the
// rail, doubled until the interpolant is within `tol` (the number taken). Over fractions [f0, f1] of
// the length other than [0, 1] (f0 < 0, f1 > 1: round the rail and on past its start at both ends),
// an open curve through the points at the same steps, without end tangents.
RailPtr uniform_rail(const SmBSplineCurve& rail, double t, bool forward, double tol, int& n, double f0 = 0.0,
                     double f1 = 1.0)
{
    const bool round = f0 == 0.0 && f1 == 1.0;
    const SmExtent1d ivl = rail.GetNaturalInterval();
    const double length = smlibpy::curve_length(&rail, ivl.GetMin(), ivl.GetMax(), 1e-12);
    const double head = smlibpy::curve_length(&rail, t, ivl.GetMax(), 1e-12);  // from t to the end
    if (!(length > 0.0))
        throw std::invalid_argument("edge_blend: a closed edge has no length");
    // the parameter at length s along the rail from t, the way it runs round
    auto param_at = [&](double s) {
        if (!forward)
            s = length - s;  // (backward by s is forward by the rest of the way round)
        if (!round)
            s -= length * std::floor(s / length);  // (once more round)
        s = std::min(std::max(s, 0.0), length);
        if (s <= head)
            return smlibpy::curve_parameter_at_length(&rail, t, s, 1e-12).first;
        return smlibpy::curve_parameter_at_length(&rail, ivl.GetMin(), s - head, 1e-12).first;
    };
    SmVector3d d[2];
    check(rail.Evaluate(t, 1, TRUE, d, FALSE), "SmCurve::Evaluate");
    SmVector3d tangent = d[1];
    if (tangent.Unitize() != SM_SUCCESS)
        throw std::invalid_argument("edge_blend: a closed edge has no direction at its start");
    if (!forward)
        tangent = tangent * -1.0;
    for (; n <= 4096; n *= 2)
    {
        const int m = static_cast<int>(std::lround(n * (f1 - f0)));  // steps of 1/n of the length
        SmTArray<SmPoint3d> pts;
        for (int k = 0; k < m; ++k)
            pts.Add(point_at(rail, param_at(length * (f0 + double(k) / n))));
        // (round: through the start again)
        pts.Add(round ? pts[0] : point_at(rail, param_at(length * (f0 + double(m) / n))));
        // end tangents along the rail, of the length a parameter interval of `span` needs
        auto build = [&](double span) {
            SmTArray<SmVector3d> ends;
            if (span > 0.0)
            {
                ends.Add(tangent * (length / span));
                ends.Add(tangent * (length / span));
            }
            SmBSplineCurve* out = nullptr;
            check(SmBSplineCurve::CreateInterpolatingCurve(ctx(), SM_CP_UNIFORM, 3, 3, pts, ends, nullptr, FALSE, out),
                  "SmBSplineCurve::CreateInterpolatingCurve");
            return RailPtr(out);
        };
        RailPtr q = round ? build(build(0.0)->GetNaturalInterval().GetLength()) : build(0.0);
        const SmExtent1d qi = q->GetNaturalInterval();
        double gap = 0.0;
        for (int k = 0; k < m; ++k)
        {
            const double f = (k + 0.5) / m;
            gap = std::max(gap, point_at(rail, param_at(length * (f0 + (k + 0.5) / n))).DistanceBetween(point_at(*q, qi.Evaluate(f))));
        }
        if (gap <= tol)
            return q;
    }
    throw std::runtime_error("edge_blend: a closed edge could not be followed by a spline");
}

// TRUE when cross sections leave (or reach) the rail on its right: walking along the rail with the
// face's surface normal up, to the right. `outward`: the cross sections leave the face (edge 1);
// otherwise they come in from outside and go on into it (edge 2).
SmBoolean to_the_right(const SmEdgeuse* eu, const SmSurface& surface, const SmBSplineCurve& rail,
                       const SmExtent1d& ivl, bool outward)
{
    const SmEdge* edge = eu->GetEdge();
    SmExtent1d eivl = edge->GetInterval();
    SmPoint3d pos;
    SmVector3d inward;  // unit, into the face from the edge
    SmPoint2d uv;
    check(eu->EvaluateBinormal(eivl.Evaluate(0.5), TRUE, pos, inward, nullptr, nullptr, &uv), "SmEdgeuse::EvaluateBinormal");
    // the rail where it passes the edge's middle (the rail is the edge's curve, turned, rescaled, or
    // started elsewhere along a closed edge)
    SmVector3d pv[2];
    check(rail.Evaluate(nearest_param(rail, ivl, pos), 1, TRUE, pv, FALSE), "SmCurve::Evaluate");
    SmVector3d normal;
    check(surface.EvaluateNormal(uv, TRUE, TRUE, normal), "SmSurface::EvaluateNormal");
    const SmVector3d right = pv[1] * normal;  // cross product
    const double side = right.Dot(inward);
    if (!(std::abs(side) > 1e-12 * right.Length()))
        throw std::invalid_argument("edge_blend: an edge runs along its face's normal; the blend cannot leave the face");
    return (outward ? side < 0.0 : side > 0.0) ? TRUE : FALSE;
}

// The outward normal of the edge's face at the edge's point nearest to `at`: the surface's own,
// turned where the face's upward faceuse does not bound the infinite region (as SmFace's
// outward_normal_at_uv).
SmVector3d outward_normal(const SmEdgeuse* eu, const SmSurface& surface, const SmPoint3d& at)
{
    const SmEdge* edge = eu->GetEdge();
    SmPoint3d pos;
    SmVector3d inward;
    SmPoint2d uv;
    check(eu->EvaluateBinormal(nearest_param(*edge->GetCurve(), edge->GetInterval(), at), TRUE, pos, inward, nullptr,
                               nullptr, &uv),
          "SmEdgeuse::EvaluateBinormal");
    SmVector3d normal;
    check(surface.EvaluateNormal(uv, TRUE, TRUE, normal), "SmSurface::EvaluateNormal");
    const SmFace* face = eu->GetFace();
    const SmBrep* brep = face ? face->GetBrep() : nullptr;
    const SmFaceuse* upward = face ? face->GetUpwardFaceuse() : nullptr;
    if (brep && upward && upward->GetShell() && brep->GetInfiniteRegion() != upward->GetShell()->GetRegion())
        normal = normal * -1.0;
    return normal;
}

// The face's derivatives across a rail, sampled as SmSurface::CreateBlendSurface samples them, with
// the take-off at each sample set to `tension` times the gap to the other rail (the higher
// derivatives reparameterized with it).
struct Samples
{
    SmTArray<double> params;
    SmTArray<SmVector3d> pos, d1, d2, d3;
};

void sample(const SmSurface& surface, const SmBSplineCurve& rail, SmExtent1d& ivl, SmBoolean right, bool start,
            const SmBSplineCurve& other, int continuity, double tension, int count, Samples& out)
{
    SmDerivSurfDefinition def;
    def.m_lNumSamples = count;
    def.m_eTangencyType = SM_TT_DIR_TO_REFERENCE_CURVE;
    def.m_pTangentReference = &other;
    def.m_dStartTanLength = 0.0;  // the derivatives as they are: rescaled below
    def.m_dEndTanScale = 1.0;
    def.m_dStartAngleDeg = def.m_dEndAngleDeg = 0.0;
    def.m_eCurvatureType = continuity == 1 ? SM_CT_NO_CURVATURE : continuity == 2 ? SM_CT_G2_FROM_SURFACE : SM_CT_G3_FROM_SURFACE;
    def.m_eBlendEndType = SM_BE_NO_CUSP;
    check(def.GetSampleValues(surface, rail, ivl, right, start ? TRUE : FALSE, out.params, out.pos, out.d1,
                              continuity >= 2 ? &out.d2 : nullptr, continuity >= 3 ? &out.d3 : nullptr),
          "SmDerivSurfDefinition::GetSampleValues");
    for (ULONG i = 0; i < out.pos.GetSize(); ++i)
    {
        const SmPoint3d there = point_at(other, out.params[i]);
        const double gap = there.DistanceBetween(out.pos[i]);
        const double length = out.d1[i].Length();
        if (!(length > 0.0) || !(gap > 0.0))
            throw std::invalid_argument("edge_blend: the edges touch, or a face has no direction across its edge");
        const double s = tension * gap / length;
        out.d1[i] = out.d1[i] * s;
        if (continuity >= 2)
            out.d2[i] = out.d2[i] * (s * s);
        if (continuity >= 3)
            out.d3[i] = out.d3[i] * (s * s * s);
    }
}

}  // namespace

namespace smlibpy {

SmBrep* edge_blend(const SmFace* face1, const SmEdge* edge1, const SmFace* face2, const SmEdge* edge2,
                   int continuity, double tension1, double tension2)
{
    if (!face1 || !edge1 || !face2 || !edge2)
        throw std::invalid_argument("edge_blend: a face or an edge is None");
    if (continuity < 1 || continuity > 3)
        throw std::invalid_argument("edge_blend: continuity must be 1 (G1), 2 (G2) or 3 (G3)");
    if (!(tension1 > 0.0) || !(tension2 > 0.0) || !std::isfinite(tension1) || !std::isfinite(tension2))
        throw std::invalid_argument("edge_blend: the tensions must be positive");
    if (edge1 == edge2)
        throw std::invalid_argument("edge_blend: the two edges are the same edge");
    const SmEdgeuse* eu1 = edge1->GetEdgeuseOfFace(face1);
    const SmEdgeuse* eu2 = edge2->GetEdgeuseOfFace(face2);
    if (!eu1 || !eu2)
        throw std::invalid_argument("edge_blend: an edge does not bound its face");
    const SmSurface* surface1 = face1->GetSurface();
    const SmSurface* surface2 = face2->GetSurface();
    if (!surface1 || !surface2)
        throw std::invalid_argument("edge_blend: a face has no surface");

    RailPtr rail1 = rail_of(edge1), rail2 = rail_of(edge2);
    SmExtent1d ivl1 = rail1->GetNaturalInterval(), ivl2 = rail2->GetNaturalInterval();
    const SmPoint3d a0 = point_at(*rail1, ivl1.GetMin()), a1 = point_at(*rail1, ivl1.GetMax());
    const SmPoint3d b0 = point_at(*rail2, ivl2.GetMin()), b1 = point_at(*rail2, ivl2.GetMax());
    const double size = std::max({a0.DistanceBetween(a1), b0.DistanceBetween(b1), a0.DistanceBetween(b0),
                                  a0.DistanceBetween(b1), 1e-9});
    const double tol = std::max({1e-9 * size, double(edge1->GetTolerance()), double(edge2->GetTolerance())});
    const bool closed1 = a0.DistanceBetween(a1) <= tol, closed2 = b0.DistanceBetween(b1) <= tol;
    if (closed1 != closed2)
        throw std::invalid_argument("edge_blend: one edge is closed (a full circle, a closed loop) and the other is not; "
                                    "bridge two closed edges or two open ones");
    const bool closed = closed1;
    bool same = true;
    if (closed)
    {
        // Two closed edges (the rims of two tubes): rail 2 starts at its point nearest to rail 1's
        // start, and runs the way rail 1 does (judged a quarter of the way round both), so that the
        // cross sections join the nearest points all round; both rails as uniform_rail makes them.
        const double t = nearest_param(*rail2, ivl2, a0);
        const double fit = 1e-8 * size;
        int n = 64;  // (the same for both: the same knots)
        RailPtr r1 = uniform_rail(*rail1, ivl1.GetMin(), true, fit, n);
        RailPtr r2 = uniform_rail(*rail2, t, true, fit, n);
        const SmExtent1d i1 = r1->GetNaturalInterval(), i2 = r2->GetNaturalInterval();
        const SmPoint3d q1 = point_at(*r1, i1.Evaluate(0.25)), q3 = point_at(*r1, i1.Evaluate(0.75));
        const SmPoint3d p1 = point_at(*r2, i2.Evaluate(0.25)), p3 = point_at(*r2, i2.Evaluate(0.75));
        const bool forward = q1.DistanceBetween(p1) + q3.DistanceBetween(p3) <= q1.DistanceBetween(p3) + q3.DistanceBetween(p1);
        // Both on past their starts by an eighth round at both ends, with as many points as the one
        // that needed most: the blend is skinned along them and cut back to once round (in two
        // halves, sewn: the kernel offsets no surface that closes around), so that it is as smooth
        // across its seam as elsewhere. (Skinned once round, it met itself at the seam with a crease
        // of up to 0.19 degrees, which the kernel's offset could not close.)
        for (int taken = 0; taken != n;)
        {
            taken = n;
            r1 = uniform_rail(*rail1, ivl1.GetMin(), true, fit, n, -kOver, 1.0 + kOver);
            r2 = uniform_rail(*rail2, t, forward, fit, n, -kOver, 1.0 + kOver);
        }
        rail1 = std::move(r1), rail2 = std::move(r2);
        ivl1 = rail1->GetNaturalInterval(), ivl2 = rail2->GetNaturalInterval();
    }
    else
        // pair the nearest ends: turn rail 2 once where it runs the other way
        same = a0.DistanceBetween(b0) + a1.DistanceBetween(b1) <= a0.DistanceBetween(b1) + a1.DistanceBetween(b0);
    const SmPoint3d e0 = point_at(*rail2, ivl2.GetMin()), e1 = point_at(*rail2, ivl2.GetMax());
    if (!same)
    {
        SmExtent1d turned;
        check(rail2->ReverseParameterization(ivl2, turned), "SmBSplineCurve::ReverseParameterization");
        ivl2 = turned;
    }
    // rail 2 over rail 1's interval
    if (!ivl1.AreEqual(ivl2))
    {
        const double scale = ivl1.GetLength() / ivl2.GetLength();
        const double offset = ivl1.GetMin() - ivl2.GetMin() * scale;
        SmExtent1d nat = rail2->GetNaturalInterval();
        check(rail2->EditParameterization(SmExtent1d(nat.GetMin() * scale + offset, nat.GetMax() * scale + offset), FALSE),
              "SmBSplineCurve::EditParameterization");
        ivl2 = ivl1;
    }
    const SmPoint3d c0 = point_at(*rail2, ivl2.GetMin()), c1 = point_at(*rail2, ivl2.GetMax());
    if (c0.DistanceBetween(same ? e0 : e1) > 1e3 * tol || c1.DistanceBetween(same ? e1 : e0) > 1e3 * tol)
        throw std::runtime_error("edge_blend: the second edge's curve could not be turned to run along the first");

    const SmBoolean right1 = to_the_right(eu1, *surface1, *rail1, ivl1, true);
    const SmBoolean right2 = to_the_right(eu2, *surface2, *rail2, ivl2, false);
    const double reach = std::max(1e-4 * size, 1e3 * tol);
    // the skin's tolerance: the edges' (1e-5 on a cylinder's rim; the skin of an open blend follows
    // its rails within 1e-9 all the same), 1e-8 of the size round closed ones (at the edges' it was
    // 6.8e-6 off a circle of r 10)
    double approx = std::max(double(edge1->GetTolerance()), double(edge2->GetTolerance()));
    if (closed)
        approx = std::min(approx, 1e-8 * size);

    // The blend between the rails over [lo, hi] (both over rail 1's interval), its corners checked
    // against the rails' ends there and its normal turned to follow face 1's.
    bool rails_along_u = true;  // (set by skin: the rails run along the blend's u)
    // cross sections along the rails: 100 along an open edge, 200 for once round a closed one (with
    // 100, a blend between circles of r 10 and 6 was 1.1e-7 off them, with 250 2.5e-8)
    const int samples = closed ? static_cast<int>(std::lround(200 * (1.0 + 2.0 * kOver))) : 100;
    auto skin = [&](double lo, double hi) {
        RailPtr r1(new (ctx()) SmBSplineCurve(*rail1)), r2(new (ctx()) SmBSplineCurve(*rail2));
        SmExtent1d i1(lo, hi), i2(lo, hi);
        if (!i1.AreEqual(ivl1))
        {
            check(r1->Trim(i1), "SmBSplineCurve::Trim");
            check(r2->Trim(i2), "SmBSplineCurve::Trim");
            i1 = r1->GetNaturalInterval(), i2 = r2->GetNaturalInterval();
        }
        Samples s1, s2;
        sample(*surface1, *r1, i1, right1, true, *r2, continuity, tension1, samples, s1);
        sample(*surface2, *r2, i2, right2, false, *r1, continuity, tension2, samples, s2);
        if (s1.pos.GetSize() != s2.pos.GetSize() || s1.params.GetSize() != s1.pos.GetSize())
            throw std::runtime_error("edge_blend: the two edges were sampled differently");

        SmDerivSurfDefinition def;  // for the cross sections and the skin: their degree and continuity
        def.m_eTangencyType = SM_TT_DIR_TO_REFERENCE_CURVE;
        def.m_eCurvatureType = continuity == 1 ? SM_CT_NO_CURVATURE : continuity == 2 ? SM_CT_G2_FROM_SURFACE : SM_CT_G3_FROM_SURFACE;
        SmTArray<SmBSplineCurve*> sections;
        SmObjsDelete<SmBSplineCurve*> clean(&sections);
        check(def.CreateCrossSectionCurves(ctx(), sections, s1.pos, s1.d1, continuity >= 2 ? &s1.d2 : nullptr,
                                           continuity >= 3 ? &s1.d3 : nullptr, &s2.pos, &s2.d1,
                                           continuity >= 2 ? &s2.d2 : nullptr, continuity >= 3 ? &s2.d3 : nullptr),
              "SmDerivSurfDefinition::CreateCrossSectionCurves");
        SmBSplineSurface* skinned = nullptr;
        check(def.SkinDerivSurface(ctx(), skinned, sections, s1.params, *r1, r2.get(), approx),
              "SmDerivSurfDefinition::SkinDerivSurface");
        if (!skinned)
            throw std::runtime_error("edge_blend: the kernel made no blend surface");
        std::unique_ptr<SmBSplineSurface> surface(skinned);

        // the corners: each edge's ends, and across the blend the paired ends (a twisted blend joins
        // each end of edge 1 to the far end of edge 2)
        const SmExtent2d dom = surface->GetNaturalUVDomain();
        SmPoint3d corner[2][2];
        for (int i = 0; i < 2; ++i)
            for (int j = 0; j < 2; ++j)
                check(surface->EvaluatePoint(SmPoint2d(i ? dom.GetMax().x : dom.GetMin().x, j ? dom.GetMax().y : dom.GetMin().y),
                                             corner[i][j]),
                      "SmSurface::EvaluatePoint");
        auto nearest = [&](const SmPoint3d& p, int& ci, int& cj) {
            double best = 1e300;
            for (int i = 0; i < 2; ++i)
                for (int j = 0; j < 2; ++j)
                    if (corner[i][j].DistanceBetween(p) < best)
                        best = corner[i][j].DistanceBetween(p), ci = i, cj = j;
            return best;
        };
        const SmPoint3d ends[4] = {point_at(*r1, i1.GetMin()), point_at(*r1, i1.GetMax()), point_at(*r2, i2.GetMin()),
                                   point_at(*r2, i2.GetMax())};
        int key[4][2] = {};
        bool found = true;
        for (int n = 0; n < 4; ++n)
            found = found && nearest(ends[n], key[n][0], key[n][1]) <= reach;
        auto code = [&](int n) { return key[n][0] * 2 + key[n][1]; };
        auto adjacent = [&](int m, int n) { return (key[m][0] != key[n][0]) != (key[m][1] != key[n][1]); };
        const bool distinct = found && code(0) != code(1) && code(0) != code(2) && code(0) != code(3) &&
                              code(1) != code(2) && code(1) != code(3) && code(2) != code(3);
        // all four corners taken, each edge along one side, and edge 1's start across from its partner
        if (!distinct || !adjacent(0, 1) || !adjacent(0, 2))
            throw std::runtime_error("edge_blend: the blend does not join the nearest ends of the edges (twisted)");

        // the blend's normal follows face 1's (outward, as Face.normal_at reports it) at edge 1
        const bool along_u = key[0][0] != key[1][0];
        const double u = along_u ? 0.5 * (dom.GetMin().x + dom.GetMax().x) : (key[0][0] ? dom.GetMax().x : dom.GetMin().x);
        const double v = along_u ? (key[0][1] ? dom.GetMax().y : dom.GetMin().y) : 0.5 * (dom.GetMin().y + dom.GetMax().y);
        SmVector3d blend_normal;
        SmPoint3d there;
        check(surface->EvaluateNormal(SmPoint2d(u, v), TRUE, TRUE, blend_normal), "SmSurface::EvaluateNormal");
        check(surface->EvaluatePoint(SmPoint2d(u, v), there), "SmSurface::EvaluatePoint");
        const bool swap = blend_normal.Dot(outward_normal(eu1, *surface1, there)) < 0.0;
        if (swap)
            check(surface->SwapUV(), "SmBSplineSurface::SwapUV");
        rails_along_u = along_u != swap;
        return surface;
    };

    std::unique_ptr<SmBrep> out(new (ctx()) SmBrep());
    auto add_face = [&](std::unique_ptr<SmBSplineSurface> surface) {
        SmFace* face = nullptr;
        SmSurface* owned = surface.release();
        const SmStatus st = out->CreateFaceFromSurface(owned, owned->GetNaturalUVDomain(), face);
        if (st != SM_SUCCESS)
        {
            if (owned->GetOwner() == nullptr)
                delete owned;
            check(st, "SmBrep::CreateFaceFromSurface");
        }
    };
    if (!closed)
    {
        add_face(skin(ivl1.GetMin(), ivl1.GetMax()));
        return out.release();
    }
    // Closed edges: the blend along the rails (on past their starts), cut back to once round in two
    // halves (at the rails' fractions 0, 1/2 and 1), sewn along the two cuts.
    std::unique_ptr<SmBSplineSurface> all = skin(ivl1.GetMin(), ivl1.GetMax());
    const SmExtent2d dom = all->GetNaturalUVDomain();
    const double a = rails_along_u ? dom.GetUMin() : dom.GetVMin();
    const double span = rails_along_u ? dom.GetUMax() - dom.GetUMin() : dom.GetVMax() - dom.GetVMin();
    // (the cuts fall on knots, the rails' points there: snapped to them, so that the halves get no
    // spans of rounding size)
    SmTArray<double> knots;
    check(all->GetKnots(rails_along_u ? SM_SP_U : SM_SP_V, knots, nullptr), "SmBSplineSurface::GetKnots");
    auto at_fraction = [&](double f) {
        double c = a + span * (f + kOver) / (1.0 + 2.0 * kOver);
        for (ULONG i = 0; i < knots.GetSize(); ++i)
            if (std::abs(knots[i] - c) <= 1e-9 * span)
                c = knots[i];
        return c;
    };
    for (const double f : {0.0, 0.5, 1.0})
    {
        // (the blend's parameter along the rails is theirs: its rim there is rail 1's point there)
        const double c = at_fraction(f);
        SmPoint3d p, q;
        check(all->EvaluatePoint(rails_along_u ? SmPoint2d(c, dom.GetVMin()) : SmPoint2d(dom.GetUMin(), c), p),
              "SmSurface::EvaluatePoint");
        check(all->EvaluatePoint(rails_along_u ? SmPoint2d(c, dom.GetVMax()) : SmPoint2d(dom.GetUMax(), c), q),
              "SmSurface::EvaluatePoint");
        const SmPoint3d r = point_at(*rail1, ivl1.Evaluate((f + kOver) / (1.0 + 2.0 * kOver)));
        if (std::min(p.DistanceBetween(r), q.DistanceBetween(r)) > reach)
            throw std::runtime_error("edge_blend: the blend between the closed edges does not follow their curves");
    }
    for (const double f : {0.0, 0.5})
    {
        std::unique_ptr<SmBSplineSurface> half(new (ctx()) SmBSplineSurface(*all));
        SmExtent2d keep = rails_along_u
                              ? SmExtent2d(SmPoint2d(at_fraction(f), dom.GetVMin()), SmPoint2d(at_fraction(f + 0.5), dom.GetVMax()))
                              : SmExtent2d(SmPoint2d(dom.GetUMin(), at_fraction(f)), SmPoint2d(dom.GetUMax(), at_fraction(f + 0.5)));
        check(half->TrimWithDomain(keep), "SmBSplineSurface::TrimWithDomain");
        add_face(std::move(half));
    }
    smlibpy::stitch_faces(out.get(), std::max(1e-7 * size, 100.0 * tol));
    SmTArray<SmEdge*> edges;
    out->GetEdges(edges);
    ULONG free_edges = 0;
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        SmTArray<SmFace*> faces;
        edges[i]->GetFaces(faces);
        free_edges += faces.GetSize() == 1 ? 1 : 0;
    }
    if (free_edges != 4)
        throw std::runtime_error("edge_blend: the two halves of the blend between the closed edges could not be sewn");
    return out.release();
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_blend(py::module_ m)
{
    m.def("edge_blend", &smlibpy::edge_blend, py::arg("face1"), py::arg("edge1"), py::arg("face2"), py::arg("edge2"),
          py::arg("continuity") = 2, py::arg("tension1") = 1.0, py::arg("tension2") = 1.0,
          py::return_value_policy::take_ownership,
          "A sheet of one face bridging edge1 of face1 and edge2 of face2, G1, G2 or G3 to both faces (continuity "
          "1, 2, 3); the tensions scale the take-off at each edge (1: as long as the gap). The nearest ends of "
          "the edges are joined; the result's corners are checked against them.");
}
#endif  // SMLIBPY_PYTHON
