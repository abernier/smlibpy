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
#include "kernel.h"
#include "blend.h"
#include "ext_shared.h"

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
    // the rail's middle is the edge's middle (the rail is the edge's curve, turned and rescaled linearly)
    SmVector3d pv[2];
    check(rail.Evaluate(ivl.Evaluate(0.5), 1, TRUE, pv, FALSE), "SmCurve::Evaluate");
    SmVector3d normal;
    check(surface.EvaluateNormal(uv, TRUE, TRUE, normal), "SmSurface::EvaluateNormal");
    const SmVector3d right = pv[1] * normal;  // cross product
    const double side = right.Dot(inward);
    if (!(std::abs(side) > 1e-12 * right.Length()))
        throw std::invalid_argument("edge_blend: an edge runs along its face's normal; the blend cannot leave the face");
    return (outward ? side < 0.0 : side > 0.0) ? TRUE : FALSE;
}

// The outward normal of the edge's face at the edge's middle: the surface's own, turned where the
// face's upward faceuse does not bound the infinite region (as SmFace's outward_normal_at_uv).
SmVector3d outward_normal(const SmEdgeuse* eu, const SmSurface& surface)
{
    const SmEdge* edge = eu->GetEdge();
    SmPoint3d pos;
    SmVector3d inward;
    SmPoint2d uv;
    check(eu->EvaluateBinormal(edge->GetInterval().Evaluate(0.5), TRUE, pos, inward, nullptr, nullptr, &uv),
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
            const SmBSplineCurve& other, int continuity, double tension, Samples& out)
{
    SmDerivSurfDefinition def;
    def.m_lNumSamples = 100;
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
    if (a0.DistanceBetween(a1) <= tol || b0.DistanceBetween(b1) <= tol)
        throw std::invalid_argument("edge_blend: closed edges (a full circle, a closed loop) cannot be blended; "
                                    "split them into two edges first");

    // pair the nearest ends: turn rail 2 once where it runs the other way
    const bool same = a0.DistanceBetween(b0) + a1.DistanceBetween(b1) <= a0.DistanceBetween(b1) + a1.DistanceBetween(b0);
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
    if (c0.DistanceBetween(same ? b0 : b1) > 1e3 * tol || c1.DistanceBetween(same ? b1 : b0) > 1e3 * tol)
        throw std::runtime_error("edge_blend: the second edge's curve could not be turned to run along the first");

    const SmBoolean right1 = to_the_right(eu1, *surface1, *rail1, ivl1, true);
    const SmBoolean right2 = to_the_right(eu2, *surface2, *rail2, ivl2, false);

    Samples s1, s2;
    sample(*surface1, *rail1, ivl1, right1, true, *rail2, continuity, tension1, s1);
    sample(*surface2, *rail2, ivl2, right2, false, *rail1, continuity, tension2, s2);
    if (s1.pos.GetSize() != s2.pos.GetSize())
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
    const double approx = std::max(double(edge1->GetTolerance()), double(edge2->GetTolerance()));
    check(def.SkinDerivSurface(ctx(), skinned, sections, s1.params, *rail1, rail2.get(), approx),
          "SmDerivSurfDefinition::SkinDerivSurface");
    if (!skinned)
        throw std::runtime_error("edge_blend: the kernel made no blend surface");
    std::unique_ptr<SmSurface> surface(skinned);

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
    const double reach = std::max(1e-4 * size, 1e3 * tol);
    int key[4][2] = {};
    const SmPoint3d* ends[4] = {&a0, &a1, &c0, &c1};
    bool found = true;
    for (int n = 0; n < 4; ++n)
        found = found && nearest(*ends[n], key[n][0], key[n][1]) <= reach;
    auto code = [&](int n) { return key[n][0] * 2 + key[n][1]; };
    auto adjacent = [&](int m, int n) { return (key[m][0] != key[n][0]) != (key[m][1] != key[n][1]); };
    const bool distinct = found && code(0) != code(1) && code(0) != code(2) && code(0) != code(3) &&
                          code(1) != code(2) && code(1) != code(3) && code(2) != code(3);
    // all four corners taken, each edge along one side, and edge 1's start across from its partner
    if (!distinct || !adjacent(0, 1) || !adjacent(0, 2))
        throw std::runtime_error("edge_blend: the blend does not join the nearest ends of the edges (twisted)");

    // the blend's normal follows face 1's (outward, as Face.normal_at reports it) at edge 1
    {
        const bool along_u = key[0][0] != key[1][0];
        const double u = along_u ? 0.5 * (dom.GetMin().x + dom.GetMax().x) : (key[0][0] ? dom.GetMax().x : dom.GetMin().x);
        const double v = along_u ? (key[0][1] ? dom.GetMax().y : dom.GetMin().y) : 0.5 * (dom.GetMin().y + dom.GetMax().y);
        SmVector3d blend_normal;
        check(surface->EvaluateNormal(SmPoint2d(u, v), TRUE, TRUE, blend_normal), "SmSurface::EvaluateNormal");
        if (blend_normal.Dot(outward_normal(eu1, *surface1)) < 0.0)
            check(skinned->SwapUV(), "SmBSplineSurface::SwapUV");
    }

    SmBrep* out = new (ctx()) SmBrep();
    SmFace* face = nullptr;
    SmSurface* owned = surface.release();
    const SmStatus st = out->CreateFaceFromSurface(owned, owned->GetNaturalUVDomain(), face);
    if (st != SM_SUCCESS)
    {
        if (owned->GetOwner() == nullptr)
            delete owned;
        delete out;
        check(st, "SmBrep::CreateFaceFromSurface");
    }
    return out;
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
