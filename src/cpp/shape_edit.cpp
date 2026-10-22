// SPDX-License-Identifier: Apache-2.0
//
// Local edits of a face's surface (`smlibpy._core.ext`):
//
//   push_face(brep, face, at, by, normal, radius, continuity, shrink)    a point of the face moved
//   warp_face(brep, face, region, by, continuity)                        a region of the face raised
//   flatten_face(brep, face, region, origin, normal, continuity)         a region pressed onto a plane
//
// Each returns a copy of the body whose face lies on a new surface: the face's own surface S plus a
// change D, a non-rational B-spline over the same parameter rectangle that is zero away from the edit,
// added exactly. Its knots are the edit's own: those of S would narrow it (a push moves only the control
// points whose basis functions reach the point, so on a fitted surface with knots every millimetre it
// moved a millimetre-wide spot). The changes come from NLib's shaping routines:
//
// - push: N_SrfShapeDerivConstraints (in the kernel) solves for the change with the fewest control
//   points moved by the least, on knots around the point: the point moves exactly, the tangent plane
//   there stays or takes the normal asked; the rows of control points along the rectangle's sides stay
//   (G0, G1, G2 at the face's edges there).
// - warp: N_SrfShapeRegionWarp, flatten: N_SrfShapeFlatten (both compiled out of the kernel, copied into
//   nlib_shape.cpp) shape a plane z = 0 over the parameter rectangle: its height is the profile of the
//   edit (a bump over the region, scaled to the height asked; a plateau of 1 inside the region). The
//   change is that profile times the move (warp), or times the face's height over the plane (flatten).
//
// S + D is exact: on the knots of both where S's control points all weigh the same (planes, B-spline
// sheets), through the homogeneous form A + W·D where they do not (a cylinder's, a sphere's rational
// surface; W·D is NLib's product of the weight function and D, of the sum of their degrees). Editing the
// rational control points instead would crease the surface at every quarter turn: there the circle's
// B-spline is only C0 in its control points (C1 in its points, through its weights).
//
// The traps (ai/plan/kernel-deep-dive.md, U7/U8/U11):
// - An analytic surface (SmPlane, SmCylinder, ...) is an SmBSplineSurface whose evaluation is analytic:
//   an edit of its NURBS data does nothing. S is its B-spline (CopyAnalyticAsNurb), cut to the face.
// - A plane's B-spline is a bilinear net of 2 x 2 control points: edited as it is, the whole face moved
//   while its edges stayed (and smlibpy's is_valid() still said True). The change has knots of its own.
// - SmBrep::ReplaceSurface rebuilds the face's trims but never moves an edge: an edit that reaches an edge
//   (a hole's, a border cut across the surface) left the edge off its face, and the body still passed
//   smlibpy's validity check (a hole's edge 1.2 mm off). Every edge of the face is measured against the
//   new surface, and the edit refused where one would move.
// - NLib edits an NL_SURFACE in place and may reallocate its arrays on the stack it is given (the region
//   warp refines its input): every NLib surface here lives on an NLib stack of this file, and results are
//   copied into new SmBSplineSurfaces by the copying constructor. (The storing one keeps the pointer it is
//   given, as SmBSplineSurface::CreateHelicalSweep does with a surface on its stack, which it then frees.)
// - NLib's product of splines (N_SrfFuncMultiplySrf) loses its accuracy where the knots of the two lie
//   close together (spans 4e-4 apart gave control points at 1e11): the change's knots are moved onto the
//   surface's where they lie within a quarter span of one, and every result is checked against the
//   surface plus the change.
#include "kernel.h"
#include "shape_edit.h"
#include "ext_shared.h"
#include "extend.h"
#include "nlib_shape.h"

#include <SmApiGeneral.h>
#include <SmPlane.h>
#include <NL_FuncsAdv.h>
#include <NL_FuncsBasic.h>
#include <NL_SrfShape.h>
#include <NL_SrfTool.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(status, what, __FILE__, __LINE__);
}

std::string fmt(double x)
{
    char buf[32];
    std::snprintf(buf, sizeof buf, "%.4g", x);
    return buf;
}

std::string fmt(const SmPoint3d& p) { return "(" + fmt(p.x) + ", " + fmt(p.y) + ", " + fmt(p.z) + ")"; }

struct SurfaceDeleter
{
    void operator()(SmSurface* s) const
    {
        if (s && s->GetOwner() == nullptr)
            delete s;
    }
};
using SplinePtr = std::unique_ptr<SmBSplineSurface, SurfaceDeleter>;

struct BrepDeleter
{
    void operator()(SmBrep* b) const { smlibpy::delete_brep(b); }
};
using BrepPtr = std::unique_ptr<SmBrep, BrepDeleter>;

// An NLib stack: what is allocated on it is freed with it.
struct Stack
{
    NL_STACKS s;
    Stack() { N_InitNurbs(&s); }
    ~Stack() { N_EndNurbs(&s); }
    Stack(const Stack&) = delete;
    Stack& operator=(const Stack&) = delete;
};

// The NURBS data of a surface copied onto an NLib stack.
void nl_copy(SmBSplineSurface& s, NL_SURFACE& out, Stack& stack)
{
    N_SrfInitArrays(&out);
    NL_SURFACE* src = s.GetOrCreateGwNurbPointer();
    if (!src || N_SrfCopy(src, &out, &stack.s))
        throw std::runtime_error("the kernel could not copy the surface's NURBS data");
}

// A new SmBSplineSurface with its own copy of the data (the copying constructor).
SplinePtr from_nl(NL_SURFACE& nl) { return SplinePtr(new (ctx()) SmBSplineSurface(static_cast<const gw_SURFACE*>(&nl))); }

struct Net
{
    NL_INDEX n = 0, m = 0, r = 0, s = 0;
    NL_CPOINT** Pw = nullptr;
    NL_DEGREE p = 0, q = 0;
    NL_REAL *U = nullptr, *V = nullptr;
    explicit Net(NL_SURFACE& nl) { N_SrfGetCPtsDegreesAndKnots(&nl, &n, &m, &Pw, &p, &q, &r, &s, &U, &V); }
};

// A non-rational surface of degrees p, q over the rectangle with the given interior knots, its control
// points at the origin, on the stack.
void zero_surface(NL_SURFACE& out, const SmExtent2d& dom, NL_DEGREE p, NL_DEGREE q, const std::vector<double>& ku,
                  const std::vector<double>& kv, Stack& stack)
{
    const NL_INDEX r = NL_INDEX(ku.size()) + 2 * (p + 1) - 1, s = NL_INDEX(kv.size()) + 2 * (q + 1) - 1;
    N_SrfInitArrays(&out);
    if (N_AllocSrfArrays(&out, r - p - 1, s - q - 1, p, q, r, s, &stack.s))
        throw std::runtime_error("out of memory");
    Net net(out);
    for (int k = 0; k <= p; ++k)
        net.U[k] = dom.GetMin().x, net.U[r - k] = dom.GetMax().x;
    for (size_t k = 0; k < ku.size(); ++k)
        net.U[p + 1 + k] = ku[k];
    for (int k = 0; k <= q; ++k)
        net.V[k] = dom.GetMin().y, net.V[s - k] = dom.GetMax().y;
    for (size_t k = 0; k < kv.size(); ++k)
        net.V[q + 1 + k] = kv[k];
    for (NL_INDEX i = 0; i <= net.n; ++i)
        for (NL_INDEX j = 0; j <= net.m; ++j)
            net.Pw[i][j].x = net.Pw[i][j].y = net.Pw[i][j].z = 0.0, net.Pw[i][j].w = NL_NOW;
}

SmVector3d vec(const std::vector<double>& v, const char* what, const char* name)
{
    if (v.size() != 3 || !std::isfinite(v[0]) || !std::isfinite(v[1]) || !std::isfinite(v[2]))
        throw std::invalid_argument(std::string(what) + ": " + name + " must be three finite numbers");
    return SmVector3d(v[0], v[1], v[2]);
}

SmPoint3d at(const SmSurface& s, const SmPoint2d& uv)
{
    SmPoint3d p;
    check(s.EvaluatePoint(uv, p), "SmSurface::EvaluatePoint");
    return p;
}

double face_size(const SmFace* face)
{
    SmExtent3d bb;
    check(face->CalculateBoundingBox(bb), "SmFace::CalculateBoundingBox");
    return bb.GetMin().DistanceBetween(bb.GetMax());
}

// How far the face's edges may end up from the new surface: the body's tolerance, between 1e-9 and
// 1e-6 of the face's size.
double edge_tolerance(const SmFace* face, double size)
{
    double t = face->GetBrep() ? double(face->GetBrep()->GetTolerance()) : 0.0;
    if (!(t > 0.0))
        t = 1e-6 * size;
    return std::max(1e-9 * size, std::min(t, 1e-6 * size));
}

// Where the point lies on the surface (closest), and how far from it.
SmPoint2d drop(const SmSurface& s, const SmPoint3d& p, double& gap)
{
    SmBoolean ok = FALSE, multi = FALSE;
    SmPoint2d uv;
    gap = 0.0;
    check(s.DropPoint(p, s.GetNaturalUVDomain(), nullptr, ok, uv, gap, multi), "SmSurface::DropPoint");
    if (!ok)
        gap = 1e300;
    return uv;
}

// ---------------------------------------------------------------- the face and its surface

// A copy of the body, and the copy of its face.
struct Body
{
    BrepPtr brep;
    SmFace* face = nullptr;
    double size = 0.0, tol = 0.0;
};

Body copy_body(const SmBrep* brep, const SmFace* face, const char* what)
{
    if (!brep || !face || face->GetBrep() != brep)
        throw std::invalid_argument(std::string(what) + ": the face is not a face of the body");
    if (!face->GetSurface())
        throw std::invalid_argument(std::string(what) + ": the face has no surface");
    smlibpy::CopyMap map = smlibpy::copy_with_map(brep, {const_cast<SmFace*>(face)}, {}, {});
    Body out;
    out.brep.reset(map.brep);
    out.face = map.faces.empty() ? nullptr : map.faces[0];
    if (!out.face)
        throw std::runtime_error(std::string(what) + ": the face was lost in the copy of the body");
    out.size = face_size(out.face);
    out.tol = edge_tolerance(out.face, out.size);
    return out;
}

// The knots of one direction of a B-spline, each once, with their multiplicities.
void knots_of(const SmBSplineSurface& s, SmSurfParamType dir, std::vector<double>& knots, std::vector<unsigned long>& mult)
{
    SmTArray<double> k;
    SmTArray<ULONG> m;
    check(s.GetKnots(dir, k, &m), "SmBSplineSurface::GetKnots");
    knots.assign(k.GetSize(), 0.0);
    mult.assign(k.GetSize(), 0);
    for (ULONG i = 0; i < k.GetSize(); ++i)
        knots[i] = k[i], mult[i] = i < m.GetSize() ? m[i] : 1;
}

// The rectangle of the B-spline's parameters the face's edges lie in; all of a direction in which it
// closes around.
SmExtent2d edge_box(const SmFace* face, const SmBSplineSurface& s, double size)
{
    const SmExtent2d dom = s.GetNaturalUVDomain();
    bool closed[2] = {true, true};
    for (int k = 0; k <= 4; ++k)
    {
        const double f = k / 4.0;
        closed[0] = closed[0] && at(s, dom.Evaluate(0.0, f)).DistanceBetween(at(s, dom.Evaluate(1.0, f))) <= 1e-9 * size;
        closed[1] = closed[1] && at(s, dom.Evaluate(f, 0.0)).DistanceBetween(at(s, dom.Evaluate(f, 1.0))) <= 1e-9 * size;
    }
    SmExtent2d box;
    SmTArray<SmEdge*> edges;
    face->GetEdges(edges);
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        const SmCurve* curve = edges[i]->GetCurve();
        if (!curve)
            continue;
        const SmExtent1d ivl = edges[i]->GetInterval();
        for (int k = 0; k <= 64; ++k)
        {
            SmPoint3d p;
            check(curve->EvaluatePoint(ivl.Evaluate(k / 64.0), p), "SmCurve::EvaluatePoint");
            double gap = 0.0;
            box.AddPoint2d(drop(s, p, gap));
        }
    }
    if (box.IsInit())
        return dom;
    SmPoint2d mn = box.GetMin(), mx = box.GetMax();
    const double eu = 1e-9 * (dom.GetMax().x - dom.GetMin().x), ev = 1e-9 * (dom.GetMax().y - dom.GetMin().y);
    mn.x = closed[0] ? dom.GetMin().x : std::max(dom.GetMin().x, mn.x - eu);
    mx.x = closed[0] ? dom.GetMax().x : std::min(dom.GetMax().x, mx.x + eu);
    mn.y = closed[1] ? dom.GetMin().y : std::max(dom.GetMin().y, mn.y - ev);
    mx.y = closed[1] ? dom.GetMax().y : std::min(dom.GetMax().y, mx.y + ev);
    if (!(mn.x < mx.x) || !(mn.y < mx.y))
        return dom;
    return SmExtent2d(mn, mx);
}

// The face's surface as an exact B-spline over the rectangle of its parameters the face lies in.
SplinePtr face_spline(const SmFace* face, double size, const char* what)
{
    const SmSurface* own = face->GetSurface();
    const SmBSplineSurface* bs = SM_CAST_PTR(SmBSplineSurface, own);
    if (!bs)
        throw std::invalid_argument(std::string(what) + ": only faces of planes, analytic and B-spline surfaces can be "
                                                        "shaped (this face lies on an offset surface)");
    const SmExtent2d own_box = smlibpy::face_parameter_box(face);
    SmExtent2d box = own_box;
    SplinePtr whole;
    if (own->GetType() != SmBSplineSurface_TYPE)
    {
        SmSurface* copy = nullptr;
        const SmStatus st = own->CopyAnalyticAsNurb(ctx(), copy);
        SplinePtr owned(copy ? SM_CAST_PTR(SmBSplineSurface, copy) : nullptr);
        if (copy && !owned)
            delete copy;
        if (st != SM_SUCCESS || !owned || owned->GetType() != SmBSplineSurface_TYPE)
            throw std::runtime_error(std::string(what) + ": the kernel has no B-spline of this face's surface");
        whole = std::move(owned);
        bs = whole.get();
        if (SM_CAST_PTR(SmPlane, own))
        {
            // a plane's B-spline is bilinear: its parameters are the plane's where its corners are
            for (int i = 0; i <= 1; ++i)
                for (int j = 0; j <= 1; ++j)
                {
                    const SmPoint2d uv = box.Evaluate(i, j);
                    if (at(*own, uv).DistanceBetween(at(*bs, uv)) > 1e-9 * std::max(size, 1.0))
                        throw std::runtime_error(std::string(what) + ": the kernel's B-spline of this face's plane does "
                                                                     "not follow the plane's parameters");
                }
        }
        else
            // (a circle's rational B-spline runs at another speed than its angle)
            box = edge_box(face, *bs, size);
    }
    const SmExtent2d dom = bs->GetNaturalUVDomain();
    const SmPoint2d mn(std::max(box.GetMin().x, dom.GetMin().x), std::max(box.GetMin().y, dom.GetMin().y));
    const SmPoint2d mx(std::min(box.GetMax().x, dom.GetMax().x), std::min(box.GetMax().y, dom.GetMax().y));
    if (!(mn.x < mx.x) || !(mn.y < mx.y))
        throw std::runtime_error(std::string(what) + ": the face lies outside its surface's parameter rectangle");
    SmBSplineSurface* sub = nullptr;
    check(bs->CopySubPatch(ctx(), SmExtent2d(mn, mx), sub), "SmBSplineSurface::CopySubPatch");
    SplinePtr out(sub);
    if (!out)
        throw std::runtime_error(std::string(what) + ": the kernel could not copy the face's surface");
    // the copy runs the way the face's surface does (their normals agree)
    const SmPoint2d c = own_box.Evaluate(0.5, 0.5);
    double gap = 0.0;
    const SmPoint2d cn = drop(*out, at(*own, c), gap);
    SmVector3d n0, n1;
    check(own->EvaluateNormal(c, TRUE, TRUE, n0), "SmSurface::EvaluateNormal");
    check(out->EvaluateNormal(cn, TRUE, TRUE, n1), "SmSurface::EvaluateNormal");
    if (gap > 1e-6 * size || n0.Dot(n1) < 0.0)
        throw std::runtime_error(std::string(what) + ": the kernel's B-spline of this face's surface does not match it");
    return out;
}

// Points along the face's edges, at most `spacing` apart (and 64 per edge at least), with their parameters
// on the face's surface S: an edit S + D keeps an edge where D is zero along it.
struct EdgePoints
{
    std::vector<SmPoint3d> p;
    std::vector<SmPoint2d> uv;
};

EdgePoints edge_points(const SmFace* face, const SmSurface& s, double spacing)
{
    EdgePoints out;
    SmTArray<SmEdge*> edges;
    face->GetEdges(edges);
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        const SmCurve* curve = edges[i]->GetCurve();
        if (!curve)
            continue;
        const SmExtent1d ivl = edges[i]->GetInterval();
        // the edge's length, roughly
        double length = 0.0;
        SmPoint3d prev;
        check(curve->EvaluatePoint(ivl.GetMin(), prev), "SmCurve::EvaluatePoint");
        for (int k = 1; k <= 32; ++k)
        {
            SmPoint3d q;
            check(curve->EvaluatePoint(ivl.Evaluate(k / 32.0), q), "SmCurve::EvaluatePoint");
            length += prev.DistanceBetween(q);
            prev = q;
        }
        const int n = int(std::min(4096.0, std::max(64.0, std::ceil(length / spacing))));
        for (int k = 0; k <= n; ++k)
        {
            SmPoint3d q;
            check(curve->EvaluatePoint(ivl.Evaluate(double(k) / n), q), "SmCurve::EvaluatePoint");
            double gap = 0.0;
            out.uv.push_back(drop(s, q, gap));
            out.p.push_back(q);
        }
    }
    return out;
}

// The edge point farthest from the new surface at its parameters: how far, and where.
struct Moved
{
    double gap = 0.0;
    SmPoint3d where;
};

Moved farthest_edge(const EdgePoints& edges, const SmSurface& result)
{
    Moved worst;
    for (size_t i = 0; i < edges.p.size(); ++i)
    {
        const double gap = at(result, edges.uv[i]).DistanceBetween(edges.p[i]);
        if (gap > worst.gap)
            worst.gap = gap, worst.where = edges.p[i];
    }
    return worst;
}

// The face's surface replaced by `surface` (the body's afterwards, also when this fails).
void replace(Body& body, SplinePtr surface)
{
    surface->SetBSplineSurfaceForm(SM_SF_UNSPECIFIED);
    SmBSplineSurface* raw = surface.release();
    const SmStatus st = body.brep->ReplaceSurface(body.face, raw, FALSE, nullptr, TRUE);
    if (st != SM_SUCCESS)
    {
        if (raw->GetOwner() == nullptr)
            delete raw;
        check(st, "SmBrep::ReplaceSurface");
    }
}

// ---------------------------------------------------------------- the surface plus a change

// Knots of an NLib product mapped linearly onto [lo, hi] (NLib's products come back over a range of their
// own), each onto one of `known` where it is within 1e-11 of the range of it.
void rescale(NL_REAL* K, NL_INDEX last, double lo, double hi, const std::vector<double>& known)
{
    const double k0 = K[0], k1 = K[last];
    if (!(k1 > k0))
        throw std::runtime_error("an NLib product has an empty knot range");
    for (NL_INDEX k = 0; k <= last; ++k)
    {
        double t = lo + (hi - lo) * ((K[k] - k0) / (k1 - k0));
        for (double x : known)
            if (std::abs(x - t) <= 1e-11 * (hi - lo))
                t = x;
        K[k] = t;
    }
    K[0] = lo, K[last] = hi;
}

// The change to the homogeneous control points that adds the non-rational `change` to the surface: the
// change times the weight (one number where all weigh the same, else the weight function: NLib's product).
// On `stack`, over the surface's rectangle.
void weighted(SmBSplineSurface& s, NL_SURFACE& change, NL_SURFACE& out, Stack& stack, const char* what)
{
    NL_SURFACE sn;
    nl_copy(s, sn, stack);
    Net net(sn);
    const double w0 = net.Pw[0][0].w;
    bool even = true;
    for (NL_INDEX i = 0; i <= net.n && even; ++i)
        for (NL_INDEX j = 0; j <= net.m && even; ++j)
            even = std::abs(net.Pw[i][j].w - w0) <= 1e-14 * std::abs(w0);
    N_SrfInitArrays(&out);
    if (N_SrfCopy(&change, &out, &stack.s))
        throw std::runtime_error(std::string(what) + ": out of memory");
    if (even)
    {
        if (w0 != NL_NOW)
        {
            Net o(out);
            for (NL_INDEX i = 0; i <= o.n; ++i)
                for (NL_INDEX j = 0; j <= o.m; ++j)
                    o.Pw[i][j].x *= w0, o.Pw[i][j].y *= w0, o.Pw[i][j].z *= w0;
        }
        return;
    }
    NL_SFUN w;
    N_SFuncInitArrays(&w);
    NL_SURFACE product;
    N_SrfInitArrays(&product);
    if (N_SrfGetDenominatorFunc(&sn, &w, &stack.s) || N_SrfFuncMultiplySrf(&w, &out, &product, &stack.s))
        throw std::runtime_error(std::string(what) + ": the kernel could not multiply the change by the surface's weights");
    // the product's knots run over [0, 1]: back over the rectangle, onto the knots they were
    std::vector<double> known[2];
    for (int d = 0; d < 2; ++d)
    {
        std::vector<unsigned long> mult;
        knots_of(s, d ? SM_SP_V : SM_SP_U, known[d], mult);
        Net c(change);
        for (NL_INDEX k = 0; k <= (d ? c.s : c.r); ++k)
            known[d].push_back(d ? c.V[k] : c.U[k]);
    }
    Net pr(product);
    const SmExtent2d dom = s.GetNaturalUVDomain();
    rescale(pr.U, pr.r, dom.GetMin().x, dom.GetMax().x, known[0]);
    rescale(pr.V, pr.s, dom.GetMin().y, dom.GetMax().y, known[1]);
    out = product;
}

// The surface with its homogeneous control points changed by the non-rational `change_h` (over the same
// rectangle; on any knots), exactly.
SplinePtr added_homogeneous(SmBSplineSurface& s, NL_SURFACE& change_h, const char* what)
{
    Stack stack;
    NL_SURFACE dh;
    N_SrfInitArrays(&dh);
    if (N_SrfCopy(&change_h, &dh, &stack.s))
        throw std::runtime_error(std::string(what) + ": out of memory");
    // the numerator (homogeneous points) and the weights of the surface as non-rational surfaces
    NL_SURFACE num, weights;
    nl_copy(s, num, stack);
    nl_copy(s, weights, stack);
    {
        Net a(num), w(weights);
        for (NL_INDEX i = 0; i <= a.n; ++i)
            for (NL_INDEX j = 0; j <= a.m; ++j)
            {
                const double wt = a.Pw[i][j].w == NL_NOW ? 1.0 : a.Pw[i][j].w;
                a.Pw[i][j].w = NL_NOW;
                w.Pw[i][j].x = wt, w.Pw[i][j].y = w.Pw[i][j].z = 0.0, w.Pw[i][j].w = NL_NOW;
            }
    }
    NL_SURFACE* all[3] = {&num, &weights, &dh};
    if (N_MakeSrfsCompatible(all, 2, NL_UVDIR, &stack.s))
        throw std::runtime_error(std::string(what) + ": the kernel could not bring the surface and the change to the same "
                                                     "knots");
    Net a(num), w(weights), d(dh);
    bool same = a.n == d.n && a.m == d.m && a.n == w.n && a.m == w.m && a.p == d.p && a.q == d.q && a.r == d.r &&
                a.s == d.s;
    for (NL_INDEX k = 0; same && k <= a.r; ++k)
        same = std::abs(a.U[k] - d.U[k]) <= 1e-12 * std::abs(a.U[a.r] - a.U[0]);
    for (NL_INDEX k = 0; same && k <= a.s; ++k)
        same = std::abs(a.V[k] - d.V[k]) <= 1e-12 * std::abs(a.V[a.s] - a.V[0]);
    if (!same)
        throw std::runtime_error(std::string(what) + ": the surface and the change did not come to the same knots");
    bool rational = false;
    for (NL_INDEX i = 0; i <= a.n; ++i)
        for (NL_INDEX j = 0; j <= a.m; ++j)
            rational = rational || std::abs(w.Pw[i][j].x - 1.0) > 1e-14;
    for (NL_INDEX i = 0; i <= a.n; ++i)
        for (NL_INDEX j = 0; j <= a.m; ++j)
        {
            a.Pw[i][j].x += d.Pw[i][j].x, a.Pw[i][j].y += d.Pw[i][j].y, a.Pw[i][j].z += d.Pw[i][j].z;
            a.Pw[i][j].w = rational ? w.Pw[i][j].x : NL_NOW;
        }
    return from_nl(num);
}

// The surface plus a non-rational change over the same rectangle, exactly (see the file comment).
SplinePtr added(SmBSplineSurface& s, NL_SURFACE& change, const char* what)
{
    Stack stack;
    NL_SURFACE dh;
    weighted(s, change, dh, stack, what);
    return added_homogeneous(s, dh, what);
}

// The result is the surface plus the change, to rounding, over the whole rectangle: NLib's products and
// merges of knots can lose their accuracy (see knots_around).
template <class F>
void verify(const SmSurface& s, const SmSurface& result, F change, double size, const char* what)
{
    const SmExtent2d dom = s.GetNaturalUVDomain();
    double worst = 0.0;
    for (int i = 0; i <= 32; ++i)
        for (int j = 0; j <= 32; ++j)
        {
            const SmPoint2d uv = dom.Evaluate(i / 32.0, j / 32.0);
            worst = std::max(worst, at(result, uv).DistanceBetween(at(s, uv) + change(uv)));
        }
    if (!(worst <= 1e-9 * size))
        throw std::runtime_error(std::string(what) + ": the kernel's sum of the face's surface and the change is " +
                                 fmt(worst) + " off");
}

// The largest value of f over the box (a grid, then refined), and where.
template <class F>
double peak(F f, const SmExtent2d& box, SmPoint2d* where = nullptr)
{
    auto value = [&](double fu, double fv) {
        return f(box.Evaluate(std::min(1.0, std::max(0.0, fu)), std::min(1.0, std::max(0.0, fv))));
    };
    const int n = 40;
    double best = -1e300, bu = 0.5, bv = 0.5;
    for (int i = 0; i <= n; ++i)
        for (int j = 0; j <= n; ++j)
        {
            const double l = value(double(i) / n, double(j) / n);
            if (l > best)
                best = l, bu = double(i) / n, bv = double(j) / n;
        }
    double step = 1.0 / n;
    for (int it = 0; it < 80 && step > 1e-10; ++it)
    {
        bool moved = false;
        for (int du = -1; du <= 1; ++du)
            for (int dv = -1; dv <= 1; ++dv)
            {
                if (!du && !dv)
                    continue;
                const double u = std::min(1.0, std::max(0.0, bu + du * step)), v = std::min(1.0, std::max(0.0, bv + dv * step));
                const double l = value(u, v);
                if (l > best)
                    best = l, bu = u, bv = v, moved = true;
            }
        if (!moved)
            step *= 0.5;
    }
    if (where)
        *where = box.Evaluate(bu, bv);
    return best;
}

// ---------------------------------------------------------------- push

// The knots t0 + k * h (k = -p..p) strictly inside the surface's knot range; one within h / 4 of a knot of
// the surface becomes that knot (NLib's products of splines lose their accuracy where knots of the two lie
// close together, see snap_knots).
std::vector<double> knots_around(const SmBSplineSurface& s, SmSurfParamType dir, int p, double t0, double h)
{
    std::vector<double> knots;
    std::vector<unsigned long> mult;
    knots_of(s, dir, knots, mult);
    const double lo = knots.front(), hi = knots.back(), eps = std::max(0.25 * h, 1e-12 * (hi - lo));
    std::vector<double> out;
    for (int k = -p; k <= p; ++k)
    {
        double t = t0 + k * h;
        for (double x : knots)
            if (std::abs(x - t) <= eps)
                t = x;
        if (t > lo + eps && t < hi - eps && (out.empty() || t > out.back()))
            out.push_back(t);
    }
    return out;
}

// N_SrfShapeDerivConstraints: the point at uv of `nl` moves by `by`, its tangents by du and dv; the rows of
// control points along the sides stay: 1 (G0), 2 (G1) or 3 (G2).
void solve(NL_SURFACE& nl, const SmPoint2d& uv, const SmVector3d& by, const SmVector3d& du, const SmVector3d& dv,
           int continuity)
{
    Net net(nl);
    std::vector<NL_INDEX> I(net.n + 1, 1), J(net.m + 1, 1);
    for (int k = 0; k <= continuity; ++k)
    {
        if (k <= net.n)
            I[k] = I[net.n - k] = 0;
        if (k <= net.m)
            J[k] = J[net.m - k] = 0;
    }
    NL_PARAMETER u[1] = {uv.x}, v[1] = {uv.y};
    NL_INDEX iu[1] = {0}, jv[1] = {0};
    NL_VECTOR dd[3];
    NL_INDEX ku[3] = {0, 1, 0}, kv[3] = {0, 0, 1};
    dd[0].x = by.x, dd[0].y = by.y, dd[0].z = by.z;
    dd[1].x = du.x, dd[1].y = du.y, dd[1].z = du.z;
    dd[2].x = dv.x, dd[2].y = dv.y, dd[2].z = dv.z;
    NL_VECTOR* DD[1] = {dd};
    NL_INDEX* KU[1] = {ku};
    NL_INDEX* KV[1] = {kv};
    NL_INDEX nd[1] = {2};
    NL_RMATRIX rma;
    NL_INDEX* K = nullptr;
    Stack solver;
    if (N_SrfShapeDerivConstraints(&nl, u, v, 0, 0, iu, jv, 0, I.data(), J.data(), DD, KU, KV, nd, NL_PREPARE, &rma, &K,
                                   &solver.s))
        throw std::invalid_argument("push: the point cannot move: it lies on (or next to) an edge of the face, which "
                                    "stays where it is");
}

// The surface with the point at uv moved to `target` and its normal there `normal` (null: as before),
// changing within `radius` of it along the surface's directions.
SplinePtr pushed(SmBSplineSurface& s, const SmPoint2d& uv, const SmPoint3d& target, const SmVector3d* normal, double radius,
                 int continuity, double size, double tol)
{
    SmPoint3d p;
    SmVector3d su, sv;
    check(s.Evaluate1stDerivatives(uv, TRUE, TRUE, p, su, sv), "SmSurface::Evaluate1stDerivatives");
    if (!(su.Length() > 1e-9 * size) || !(sv.Length() > 1e-9 * size))
        throw std::invalid_argument("push: the point lies where the face's surface degenerates (a pole or a tip): push a "
                                    "point next to it");
    const SmVector3d by = target - p;
    SmVector3d du(0, 0, 0), dv(0, 0, 0);
    if (normal)
        du = *normal * -su.Dot(*normal), dv = *normal * -sv.Dot(*normal);
    // the change: cubic, its knots spaced radius / 3 around the point (its basis functions there reach
    // `radius` far), over the surface's rectangle
    const NL_DEGREE p3 = 3;
    const std::vector<double> ku = knots_around(s, SM_SP_U, p3, uv.x, radius / su.Length() / p3);
    const std::vector<double> kv = knots_around(s, SM_SP_V, p3, uv.y, radius / sv.Length() / p3);
    Stack stack;
    NL_SURFACE change;
    zero_surface(change, s.GetNaturalUVDomain(), p3, p3, ku, kv, stack);
    solve(change, uv, by, du, dv, continuity);
    SplinePtr out = added(s, change, "push");
    SplinePtr d = from_nl(change);
    verify(s, *out, [&](const SmPoint2d& t) { const SmPoint3d c = at(*d, t); return SmVector3d(c.x, c.y, c.z); },
           size + by.Length(), "push");

    // exactly where asked
    SmPoint3d q;
    SmVector3d qu, qv;
    check(out->Evaluate1stDerivatives(uv, TRUE, TRUE, q, qu, qv), "SmSurface::Evaluate1stDerivatives");
    const double miss = q.DistanceBetween(target);
    if (miss > std::max(1e-9 * (size + by.Length()), 0.01 * tol))
        throw std::runtime_error("push: the point ended " + fmt(miss) + " from where it was to go");
    if (normal)
    {
        SmVector3d nn = qu * qv;
        if (!(nn.Length() > 0.0))
            throw std::runtime_error("push: the surface degenerates at the point");
        nn = nn * (1.0 / nn.Length());
        const double off = std::abs(nn.Dot(*normal));
        if (std::abs(1.0 - off) > 1e-9)
            throw std::runtime_error("push: the normal at the point is " + fmt(std::acos(std::min(1.0, off)) * 180.0 / M_PI) +
                                     " degrees from the one asked");
    }
    return out;
}

// ---------------------------------------------------------------- warp and flatten

// The region's points on the surface, as a closed polygon of its parameters, and the polygon's box.
std::vector<NL_POINT> polygon_of(const SmSurface& s, const std::vector<double>& region, double size, const char* what,
                                 SmExtent2d& box)
{
    if (region.size() % 3 != 0 || region.size() < 9)
        throw std::invalid_argument(std::string(what) + ": the region needs three points or more (x, y, z each)");
    std::vector<NL_POINT> pts;
    box = SmExtent2d();
    double worst = 0.0;
    for (size_t i = 0; i + 2 < region.size(); i += 3)
    {
        const SmPoint3d p(region[i], region[i + 1], region[i + 2]);
        double gap = 0.0;
        const SmPoint2d uv = drop(s, p, gap);
        worst = std::max(worst, gap);
        NL_POINT pt;
        pt.x = uv.x, pt.y = uv.y, pt.z = 0.0;
        if (!pts.empty() && pts.back().x == pt.x && pts.back().y == pt.y)
            continue;
        pts.push_back(pt);
        box.AddPoint2d(uv);
    }
    if (worst > 1e-4 * size)
        throw std::invalid_argument(std::string(what) + ": the region does not lie on the face: a point of it is " +
                                    fmt(worst) + " off the face's surface");
    if (pts.size() > 1 && (pts.front().x != pts.back().x || pts.front().y != pts.back().y))
        pts.push_back(pts.front());
    if (pts.size() < 4 || box.IsInit() || !(box.GetMax().x > box.GetMin().x) || !(box.GetMax().y > box.GetMin().y))
        throw std::invalid_argument(std::string(what) + ": the region encloses no area of the face");
    return pts;
}

// The knots the region routines insert across the region's box (one more than this): 15, which halves the
// box into 16 equal spans (the routines split the longest span first, the first of equal ones; their
// default of 3p + 1 = 10 left the profile lopsided).
constexpr NL_INDEX SPLITS = 14;

// The kernel's continuity control (1 <= k <= p: C^(p - k) across the region's border) for continuity 0
// (a crease), 1 (G1) or 2 (G2) at degree 3.
NL_INDEX continuity_index(int continuity) { return NL_INDEX(3 - continuity); }

// The profile's inner knots moved onto the surface's where they lie within a quarter of the profile's
// spans of one: NLib's products and merges of splines lose their accuracy where the knots of the two lie
// close together (spans 4e-4 apart gave control points at 1e11). The profile is a different one then, as
// smooth (still 1 wherever all its control points are, still 0 wherever none is).
void snap_knots(NL_SURFACE& profile, const SmBSplineSurface& s)
{
    Net net(profile);
    for (int d = 0; d < 2; ++d)
    {
        std::vector<double> known;
        std::vector<unsigned long> mult;
        knots_of(s, d ? SM_SP_V : SM_SP_U, known, mult);
        NL_REAL* K = d ? net.V : net.U;
        const NL_INDEX last = d ? net.s : net.r;
        // the distinct values, each with its neighbours
        std::vector<double> values;
        for (NL_INDEX k = 0; k <= last; ++k)
            if (values.empty() || K[k] != values.back())
                values.push_back(K[k]);
        std::vector<double> moved = values;
        for (size_t i = 1; i + 1 < values.size(); ++i)
        {
            const double gap = std::min(values[i] - values[i - 1], values[i + 1] - values[i]);
            for (size_t j = 1; j + 1 < known.size(); ++j)
                if (std::abs(known[j] - values[i]) < 0.25 * gap)
                    moved[i] = known[j];
        }
        for (NL_INDEX k = 0; k <= last; ++k)
            for (size_t i = 0; i < values.size(); ++i)
                if (K[k] == values[i])
                {
                    K[k] = moved[i];
                    break;
                }
    }
}

// The plane z = 0 over the surface's rectangle (x = u, y = v), as a non-rational bicubic without inner
// knots, on the stack: what the region routines shape, its height the profile of an edit.
void parameter_plane(NL_SURFACE& out, const SmBSplineSurface& s, Stack& stack)
{
    zero_surface(out, s.GetNaturalUVDomain(), 3, 3, {}, {}, stack);
    // the control points at the Greville abscissae: the plane is x = u, y = v exactly
    Net net(out);
    for (NL_INDEX i = 0; i <= net.n; ++i)
        for (NL_INDEX j = 0; j <= net.m; ++j)
            net.Pw[i][j].x = (net.U[i + 1] + net.U[i + 2] + net.U[i + 3]) / 3.0,
            net.Pw[i][j].y = (net.V[j + 1] + net.V[j + 2] + net.V[j + 3]) / 3.0;
}

// What a region edit starts from: the body, its face's surface S, the region on it.
struct Region
{
    Body body;
    SplinePtr s;
    std::vector<NL_POINT> polygon;
    SmExtent2d box;
};

Region region_of(const SmBrep* brep, const SmFace* face, const std::vector<double>& region, int continuity, const char* what)
{
    if (continuity < 0 || continuity > 2)
        throw std::invalid_argument(std::string(what) + ": continuity must be 0 (a crease), 1 (G1) or 2 (G2)");
    Region e;
    e.body = copy_body(brep, face, what);
    e.s = face_spline(e.body.face, e.body.size, what);
    e.polygon = polygon_of(*e.s, region, e.body.size, what, e.box);
    return e;
}

// The edit, unless it would move an edge of the face.
SmBrep* finish(Region& e, SplinePtr result, const char* what)
{
    // (edge points at most 1/64 of the region's diagonal apart)
    const double diagonal = at(*e.s, e.box.GetMin()).DistanceBetween(at(*e.s, e.box.GetMax()));
    const Moved moved = farthest_edge(edge_points(e.body.face, *e.s, std::max(1e-6 * e.body.size, diagonal / 64.0)), *result);
    if (moved.gap > e.body.tol)
        throw std::invalid_argument(std::string(what) + ": the change reaches an edge of the face (it would move it by " +
                                    fmt(moved.gap) + " at " + fmt(moved.where) + "): keep the rectangle around the "
                                    "region (along the surface's directions) clear of the face's edges and holes");
    replace(e.body, std::move(result));
    return e.body.brep.release();
}

}  // namespace

namespace smlibpy {

SmBrep* push_face(const SmBrep* brep, const SmFace* face, const std::vector<double>& at_, const std::vector<double>& by_,
                  const std::vector<double>& normal_, double radius, int continuity, bool shrink)
{
    const char* what = "push";
    const SmVector3d a = vec(at_, what, "the point");
    const SmVector3d by = vec(by_, what, "the move");
    SmVector3d normal;
    const bool has_normal = !normal_.empty();
    if (has_normal)
    {
        normal = vec(normal_, what, "the normal");
        if (!(normal.Length() > 0.0))
            throw std::invalid_argument("push: the normal must not be zero");
        normal = normal * (1.0 / normal.Length());
    }
    if (!(radius > 0.0) || !std::isfinite(radius))
        throw std::invalid_argument("push: the radius must be positive");
    if (continuity < 0 || continuity > 2)
        throw std::invalid_argument("push: continuity must be 0 (G0), 1 (G1) or 2 (G2)");
    Body body = copy_body(brep, face, what);
    if (!(by.Length() > 1e-12 * body.size) && !has_normal)
        throw std::invalid_argument("push: the move is zero");
    SplinePtr s = face_spline(body.face, body.size, what);
    double gap = 0.0;
    const SmPoint2d uv = drop(*s, SmPoint3d(a.x, a.y, a.z), gap);
    if (gap > 1e-6 * body.size)
        throw std::invalid_argument("push: the point is not on the face (" + fmt(gap) + " off its surface)");
    const SmPoint3d target = at(*s, uv) + by;
    if (has_normal)
    {
        // (which way the face's normal points along that line is the face's: the caller checks)
        SmVector3d n0;
        check(s->EvaluateNormal(uv, TRUE, TRUE, n0), "SmSurface::EvaluateNormal");
        if (!(std::abs(n0.Dot(normal)) > 1e-9))
            throw std::invalid_argument("push: the normal must not lie in the face's tangent plane");
    }
    const EdgePoints edges = edge_points(body.face, *s, radius / 16.0);
    for (int attempt = 0;; ++attempt)
    {
        SplinePtr result = pushed(*s, uv, target, has_normal ? &normal : nullptr, radius, continuity, body.size, body.tol);
        const Moved moved = farthest_edge(edges, *result);
        if (moved.gap <= body.tol)
        {
            replace(body, std::move(result));
            return body.brep.release();
        }
        if (!shrink || attempt >= 5)
            throw std::invalid_argument("push: the change reaches an edge of the face that cannot move (it would move by " +
                                        fmt(moved.gap) + " at " + fmt(moved.where) + "): take a radius below the distance "
                                        "from the point to that edge, or a point farther from it");
        radius *= 0.5;
    }
}

SmBrep* warp_face(const SmBrep* brep, const SmFace* face, const std::vector<double>& region, const std::vector<double>& by_,
                  int continuity)
{
    const char* what = "warp";
    const SmVector3d by = vec(by_, what, "the move");
    Region e = region_of(brep, face, region, continuity, what);
    const double h = by.Length();
    if (!(h > 1e-12 * e.body.size))
        throw std::invalid_argument("warp: the move is zero");

    // the profile: the parameter plane warped up by 1 over the region (the kernel's bivariate rational
    // basis function), then scaled to a peak of 1
    Stack sp, sq;
    NL_SURFACE plane, warped;
    parameter_plane(plane, *e.s, sp);
    N_SrfInitArrays(&warped);
    NL_SFUN basis;
    if (smlibpy_N_SrfShapeCreateRatBasis(1.0, 3, 3, &basis, NL_NEW, &sq.s))
        throw std::runtime_error("warp: the kernel could not make its warp function");
    NL_EPOLYGON ppl;
    ppl.n = NL_INDEX(e.polygon.size()) - 1;
    ppl.P = e.polygon.data();
    NL_VECTOR up;
    up.x = 0.0, up.y = 0.0, up.z = 1.0;
    NL_REAL *tu = nullptr, *tv = nullptr;
    NL_INDEX siu = 0, eiu = 0, siv = 0, eiv = 0;
    NL_BOOLEAN** inside = nullptr;
    const NL_INDEX k = continuity_index(continuity);
    if (smlibpy_N_SrfShapeRegionWarp(&plane, &ppl, SPLITS, SPLITS, k, k, k, k, nullptr, up, &basis, 1.0, 0.0, NL_PREPARE, NL_YES, &tu,
                                     &tv, &siu, &eiu, &siv, &eiv, &inside, &warped, &sp.s, &sq.s))
        throw std::invalid_argument("warp: the kernel could not warp the region (it must overlap the face)");
    snap_knots(warped, *e.s);
    SplinePtr profile = from_nl(warped);
    const double top = peak([&](const SmPoint2d& uv) { return at(*profile, uv).z; }, e.box);
    if (!(top > 1e-9))
        throw std::invalid_argument("warp: the region is too small for the face's surface: draw it larger");
    // the change: the profile's height times the move
    {
        Net net(warped);
        for (NL_INDEX i = 0; i <= net.n; ++i)
            for (NL_INDEX j = 0; j <= net.m; ++j)
            {
                const double f = net.Pw[i][j].z / top;
                net.Pw[i][j].x = by.x * f, net.Pw[i][j].y = by.y * f, net.Pw[i][j].z = by.z * f, net.Pw[i][j].w = NL_NOW;
            }
    }
    SplinePtr result = added(*e.s, warped, what);
    verify(*e.s, *result, [&](const SmPoint2d& t) { return by * (at(*profile, t).z / top); }, e.body.size + h, what);
    const SmVector3d w = by * (1.0 / h);
    const double rose = peak([&](const SmPoint2d& uv) { return (at(*result, uv) - at(*e.s, uv)).Dot(w); }, e.box);
    if (std::abs(rose - h) > 1e-6 * h + e.body.tol)
        throw std::runtime_error("warp: the region rose by " + fmt(rose) + " instead of " + fmt(h));
    return finish(e, std::move(result), what);
}

SmBrep* flatten_face(const SmBrep* brep, const SmFace* face, const std::vector<double>& region,
                     const std::vector<double>& origin_, const std::vector<double>& normal_, int continuity)
{
    const char* what = "flatten";
    const SmVector3d o = vec(origin_, what, "the plane's origin");
    SmVector3d nrm = vec(normal_, what, "the plane's normal");
    if (!(nrm.Length() > 0.0))
        throw std::invalid_argument("flatten: the plane's normal must not be zero");
    nrm = nrm * (1.0 / nrm.Length());
    Region e = region_of(brep, face, region, continuity, what);

    // the profile: the parameter plane lifted onto z = 1 inside the region (a plateau, 0 outside)
    Stack sp, sq;
    NL_SURFACE plane, lifted;
    parameter_plane(plane, *e.s, sp);
    N_SrfInitArrays(&lifted);
    NL_EPOLYGON ppl;
    ppl.n = NL_INDEX(e.polygon.size()) - 1;
    ppl.P = e.polygon.data();
    NL_PLANE one;
    one.P.x = 0.0, one.P.y = 0.0, one.P.z = 1.0;
    one.N.x = 0.0, one.N.y = 0.0, one.N.z = 1.0;
    const NL_INDEX k = continuity_index(continuity);
    if (smlibpy_N_SrfShapeFlatten(&plane, &ppl, SPLITS, SPLITS, k, k, k, k, &one, one.N, 0.0, NL_NO, NL_LEFT, NL_YES, &lifted, &sp.s,
                                  &sq.s))
        throw std::invalid_argument("flatten: the kernel could not flatten the region (it must overlap the face)");
    snap_knots(lifted, *e.s);
    NL_SFUN mask;
    N_SFuncInitArrays(&mask);
    {
        Net net(lifted);
        if (N_AllocSFuncArrays(&mask, net.n, net.m, net.p, net.q, net.r, net.s, &sq.s))
            throw std::runtime_error("flatten: out of memory");
        for (NL_INDEX i = 0; i <= net.r; ++i)
            mask.knu->U[i] = net.U[i];
        for (NL_INDEX j = 0; j <= net.s; ++j)
            mask.knv->U[j] = net.V[j];
        for (NL_INDEX i = 0; i <= net.n; ++i)
            for (NL_INDEX j = 0; j <= net.m; ++j)
                mask.svl->fuv[i][j] = std::min(1.0, std::max(0.0, net.Pw[i][j].z));
    }
    // the change of the homogeneous points: -N (g mask), g the face's height over the plane (times the
    // weight: homogeneous)
    Stack stack;
    NL_SURFACE height, dh;
    nl_copy(*e.s, height, stack);
    {
        Net net(height);
        const double on = SmVector3d(o.x, o.y, o.z).Dot(nrm);
        for (NL_INDEX i = 0; i <= net.n; ++i)
            for (NL_INDEX j = 0; j <= net.m; ++j)
            {
                const double w = net.Pw[i][j].w == NL_NOW ? 1.0 : net.Pw[i][j].w;
                const double g = net.Pw[i][j].x * nrm.x + net.Pw[i][j].y * nrm.y + net.Pw[i][j].z * nrm.z - w * on;
                net.Pw[i][j].x = g, net.Pw[i][j].y = net.Pw[i][j].z = 0.0, net.Pw[i][j].w = NL_NOW;
            }
    }
    N_SrfInitArrays(&dh);
    if (N_SrfFuncMultiplySrf(&mask, &height, &dh, &stack.s))
        throw std::runtime_error("flatten: the kernel could not multiply the face's height by the region's profile");
    {
        Net net(dh);
        const SmExtent2d dom = e.s->GetNaturalUVDomain();
        std::vector<double> known[2];
        for (int d = 0; d < 2; ++d)
        {
            std::vector<unsigned long> mult;
            knots_of(*e.s, d ? SM_SP_V : SM_SP_U, known[d], mult);
            Net l(lifted);
            for (NL_INDEX k = 0; k <= (d ? l.s : l.r); ++k)
                known[d].push_back(d ? l.V[k] : l.U[k]);
        }
        rescale(net.U, net.r, dom.GetMin().x, dom.GetMax().x, known[0]);
        rescale(net.V, net.s, dom.GetMin().y, dom.GetMax().y, known[1]);
        for (NL_INDEX i = 0; i <= net.n; ++i)
            for (NL_INDEX j = 0; j <= net.m; ++j)
            {
                const double g = net.Pw[i][j].x;
                net.Pw[i][j].x = -nrm.x * g, net.Pw[i][j].y = -nrm.y * g, net.Pw[i][j].z = -nrm.z * g;
            }
    }
    SplinePtr result = added_homogeneous(*e.s, dh, what);
    SplinePtr profile = from_nl(lifted);
    const double on = SmVector3d(o.x, o.y, o.z).Dot(nrm);
    verify(*e.s, *result,
           [&](const SmPoint2d& t) {
               const SmPoint3d q = at(*e.s, t);
               const double mask = std::min(1.0, std::max(0.0, at(*profile, t).z));
               return nrm * (-(SmVector3d(q.x, q.y, q.z).Dot(nrm) - on) * mask);
           },
           e.body.size, what);
    const double moved = std::max(peak([&](const SmPoint2d& uv) { return (at(*result, uv) - at(*e.s, uv)).Dot(nrm); }, e.box),
                                  peak([&](const SmPoint2d& uv) { return -(at(*result, uv) - at(*e.s, uv)).Dot(nrm); }, e.box));
    if (!(moved > e.body.tol))
        throw std::invalid_argument("flatten: nothing to flatten: the face already lies in the plane there");
    return finish(e, std::move(result), what);
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_shape_edit(py::module_ m)
{
    m.def("push_face", &smlibpy::push_face, py::arg("brep"), py::arg("face"), py::arg("at"), py::arg("by"),
          py::arg("normal"), py::arg("radius"), py::arg("continuity") = 1, py::arg("shrink") = false,
          py::return_value_policy::take_ownership,
          "A copy of the body whose face's point `at` moved by `by` (its normal there `normal`, empty: kept), the face "
          "changing within `radius` of it; continuity 0, 1 or 2 holds the face's sides G0, G1 or G2.");
    m.def("warp_face", &smlibpy::warp_face, py::arg("brep"), py::arg("face"), py::arg("region"), py::arg("by"),
          py::arg("continuity") = 2, py::return_value_policy::take_ownership,
          "A copy of the body whose face is raised by `by` over a region (points x, y, z, ... of a closed polygon on "
          "the face); continuity 0 crease, 1 G1, 2 G2.");
    m.def("flatten_face", &smlibpy::flatten_face, py::arg("brep"), py::arg("face"), py::arg("region"), py::arg("origin"),
          py::arg("normal"), py::arg("continuity") = 2, py::return_value_policy::take_ownership,
          "A copy of the body whose face is pressed onto the plane through `origin` with normal `normal` inside a region "
          "(points x, y, z, ... of a closed polygon on the face); continuity 0 crease, 1 G1, 2 G2.");
}
#endif  // SMLIBPY_PYTHON
