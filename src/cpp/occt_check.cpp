// SPDX-License-Identifier: Apache-2.0
//
// A check of an OpenCASCADE shape before it is written (occt_text): what OpenCASCADE's own check
// (BRepCheck_Analyzer) takes a face for invalid for, found on the records the writer made. Each edge
// of a face has its curve in the face's parameters (on a plane OpenCASCADE projects it), that curve
// keeps within the edge's tolerance of the edge's 3D curve along it (SameParameter), each wire closes
// in the parameters, and the wires of a face enclose a positive area (the outer one counterclockwise).
// A shape that fails is not written: occt_text throws, naming the face and what is wrong.

#include "occt.h"

#include "OcctFileRecords.h"
#include "OcctGeometryConvert.h"
#include "UsdBrepGeometryEval.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

namespace {

using occt::ECurveType;
using occt::EOrientation;
using occt::EShapeType;
using occt::ESurfaceType;
using occt::SCurve2d;
using occt::SCurveRepr;
using occt::SOcctModel;
using occt::SShapeRecord;
using occt::SSurface;
using pxr::GfVec2d;
using pxr::GfVec3d;

GfVec3d vec(const occt::SPnt3& p) { return GfVec3d(p.dX, p.dY, p.dZ); }
GfVec3d vec(const occt::SDir3& p) { return GfVec3d(p.dX, p.dY, p.dZ); }

std::vector<double> flat(const std::vector<double>& knots, const std::vector<int>& mults)
{
    std::vector<double> out;
    for (size_t i = 0; i < knots.size() && i < mults.size(); ++i)
        out.insert(out.end(), static_cast<size_t>(std::max(0, mults[i])), knots[i]);
    return out;
}

// the B-spline basis functions of degree p at t (span i), as The NURBS Book's A2.2
int span(const std::vector<double>& U, int n, int p, double t)
{
    if (t >= U[static_cast<size_t>(n + 1)])
        return n;
    if (t <= U[static_cast<size_t>(p)])
        return p;
    int lo = p, hi = n + 1, mid = (lo + hi) / 2;
    while (t < U[static_cast<size_t>(mid)] || t >= U[static_cast<size_t>(mid + 1)])
    {
        (t < U[static_cast<size_t>(mid)] ? hi : lo) = mid;
        mid = (lo + hi) / 2;
    }
    return mid;
}

void basis(const std::vector<double>& U, int i, double t, int p, double* N)
{
    double left[32], right[32];
    N[0] = 1.0;
    for (int j = 1; j <= p; ++j)
    {
        left[j] = t - U[static_cast<size_t>(i + 1 - j)];
        right[j] = U[static_cast<size_t>(i + j)] - t;
        double saved = 0.0;
        for (int r = 0; r < j; ++r)
        {
            const double d = right[r + 1] + left[j - r];
            const double temp = d != 0.0 ? N[r] / d : 0.0;
            N[r] = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        N[j] = saved;
    }
}

// a surface's point at (u, v) in OpenCASCADE's parameters; false for a kind it does not take
bool surface_point(const SSurface& s, double u, double v, GfVec3d& out)
{
    const GfVec3d o = vec(s.sLocation), x = vec(s.sXAxis), y = vec(s.sYAxis), z = vec(s.sAxis);
    switch (s.eType)
    {
    case ESurfaceType::Plane: out = o + x * u + y * v; return true;
    case ESurfaceType::Cylinder: out = o + (x * std::cos(u) + y * std::sin(u)) * s.dRadius + z * v; return true;
    case ESurfaceType::Cone:
        out = o + (x * std::cos(u) + y * std::sin(u)) * (s.dRadius + v * std::sin(s.dSemiAngle)) + z * (v * std::cos(s.dSemiAngle));
        return true;
    case ESurfaceType::Sphere:
        out = o + (x * std::cos(u) + y * std::sin(u)) * (s.dRadius * std::cos(v)) + z * (s.dRadius * std::sin(v));
        return true;
    case ESurfaceType::Torus:
        out = o + (x * std::cos(u) + y * std::sin(u)) * (s.dRadius + s.dMinorRadius * std::cos(v)) + z * (s.dMinorRadius * std::sin(v));
        return true;
    case ESurfaceType::BSpline:
    {
        if (s.bUPeriodic || s.bVPeriodic || s.iUDegree > 30 || s.iVDegree > 30)
            return false;
        const std::vector<double> U = flat(s.dUKnots, s.iUMults), V = flat(s.dVKnots, s.iVMults);
        const int nu = s.iNbUPoles - 1, nv = s.iNbVPoles - 1, pu = s.iUDegree, pv = s.iVDegree;
        if (nu < pu || nv < pv || U.size() != static_cast<size_t>(nu + pu + 2) || V.size() != static_cast<size_t>(nv + pv + 2) ||
            s.sPoles.size() != static_cast<size_t>((nu + 1) * (nv + 1)))
            return false;
        const int su = span(U, nu, pu, u), sv = span(V, nv, pv, v);
        double Nu[32], Nv[32];
        basis(U, su, u, pu, Nu);
        basis(V, sv, v, pv, Nv);
        GfVec3d p(0.0);
        double w = 0.0;
        const bool rational = s.bURational || s.bVRational;
        for (int a = 0; a <= pu; ++a)
            for (int b = 0; b <= pv; ++b)
            {
                const size_t k = static_cast<size_t>((su - pu + a) * (nv + 1) + (sv - pv + b));
                const double wk = rational && k < s.dWeights.size() ? s.dWeights[k] : 1.0;
                p += vec(s.sPoles[k]) * (Nu[a] * Nv[b] * wk);
                w += Nu[a] * Nv[b] * wk;
            }
        out = w != 0.0 ? p / w : p;
        return true;
    }
    default: return false;
    }
}

// a 2D curve's point at t; false for a kind it does not take
bool curve2d_point(const SCurve2d& c, double t, GfVec2d& out)
{
    if (c.eType == ECurveType::Line)
    {
        out = GfVec2d(c.sLocation.dX + t * c.sXAxis.dX, c.sLocation.dY + t * c.sXAxis.dY);
        return true;
    }
    if (c.eType != ECurveType::BSpline || c.bPeriodic)
        return false;
    const std::vector<double> U = flat(c.dKnots, c.iMults);
    const int n = static_cast<int>(c.sPoles.size()) - 1, p = c.iDegree;
    if (n < p || p > 30 || U.size() != static_cast<size_t>(n + p + 2))
        return false;
    const int s = span(U, n, p, t);
    double N[32];
    basis(U, s, t, p, N);
    GfVec2d q(0.0, 0.0);
    double w = 0.0;
    for (int j = 0; j <= p; ++j)
    {
        const size_t k = static_cast<size_t>(s - p + j);
        const double wk = c.bRational && k < c.dWeights.size() ? c.dWeights[k] : 1.0;
        q += GfVec2d(c.sPoles[k].dX, c.sPoles[k].dY) * (N[j] * wk);
        w += N[j] * wk;
    }
    out = w != 0.0 ? q / w : q;
    return true;
}

}  // namespace

namespace smlibpy {

std::string occt_check(const SOcctModel& m)
{
    const size_t shapes = m.sShapes.size();
    auto shape = [&](int storage) -> const SShapeRecord* {
        return storage >= 1 && static_cast<size_t>(storage) <= shapes ? &m.sShapes[static_cast<size_t>(storage - 1)] : nullptr;
    };
    size_t face_number = 0;
    for (size_t fi = 0; fi < shapes; ++fi)
    {
        const SShapeRecord& face = m.sShapes[fi];
        if (face.eType != EShapeType::Face)
            continue;
        const std::string which = "face " + std::to_string(face_number++);
        const int isurface = face.sFace.iSurface;
        if (isurface < 1 || static_cast<size_t>(isurface) > m.sSurfaces.size())
            return which + " has no surface";
        const SSurface& srf = m.sSurfaces[static_cast<size_t>(isurface - 1)];
        GfVec3d probe;
        if (!surface_point(srf, 0.0, 0.0, probe))
            continue;  // (a kind of surface the check does not evaluate)
        const bool plane = srf.eType == ESurfaceType::Plane;
        const GfVec3d po = vec(srf.sLocation), px = vec(srf.sXAxis), py = vec(srf.sYAxis);
        double area = 0.0, perimeter = 0.0, face_tol = 0.0;  // (perimeter: in the parameters)
        bool measured = true;
        std::vector<GfVec2d> face_box;  // (the points of its wires' curves)
        for (const occt::SSubShapeRef& wref : face.sSubShapes)
        {
            const SShapeRecord* wire = shape(wref.iStorageIndex);
            if (!wire || wire->eType != EShapeType::Wire)
                continue;
            // the edges share their vertices, one to the next (OpenCASCADE's topological closure)
            {
                std::vector<std::pair<int, int>> ends;  // (start vertex, end vertex) of each occurrence
                for (const occt::SSubShapeRef& eref : wire->sSubShapes)
                {
                    const SShapeRecord* edge = shape(eref.iStorageIndex);
                    if (!edge || edge->sSubShapes.size() < 2)
                        continue;
                    int a = edge->sSubShapes[0].iStorageIndex, b = edge->sSubShapes[1].iStorageIndex;
                    if (edge->sSubShapes[0].eOrientation == EOrientation::Reversed)
                        std::swap(a, b);
                    if (eref.eOrientation == EOrientation::Reversed)
                        std::swap(a, b);
                    ends.emplace_back(a, b);
                }
                for (size_t k = 0; k < ends.size(); ++k)
                    if (ends[k].second != ends[(k + 1) % ends.size()].first)
                        return which + ": two edges of a wire meet at different vertices";
            }
            // each occurrence's points in the face's parameters, in the direction of its use
            std::vector<std::vector<GfVec2d>> uses;
            double wire_tol = 0.0;
            for (const occt::SSubShapeRef& eref : wire->sSubShapes)
            {
                const SShapeRecord* edge = shape(eref.iStorageIndex);
                if (!edge || edge->eType != EShapeType::Edge)
                    return which + ": a wire holds something that is no edge";
                const bool forward = eref.eOrientation == EOrientation::Forward;
                const double tol = std::max(edge->sEdge.dTolerance, 1e-7);
                wire_tol = std::max(wire_tol, tol);
                const SCurveRepr* c3 = nullptr;
                const SCurveRepr* c2 = nullptr;
                for (const SCurveRepr& r : edge->sEdge.sReprs)
                {
                    if (r.iKind == 1)
                        c3 = &r;
                    else if ((r.iKind == 2 || r.iKind == 3) && r.iSurface == isurface)
                        c2 = &r;
                }
                std::vector<GfVec2d> pts;
                // (128 points along each: the area of a crescent between arcs 0.016 wide and 35 long, a STEP
                // file's, came out negative from 16; the distance to the edge is checked at every 8th)
                const int samples = 128;
                if (c2)
                {
                    const int ic = (c2->iKind == 3 && !forward) ? c2->iPCurve2 : c2->iPCurve;
                    if (ic < 1 || static_cast<size_t>(ic) > m.sCurve2ds.size())
                        return which + ": an edge's curve on it is missing";
                    const SCurve2d& pc = m.sCurve2ds[static_cast<size_t>(ic - 1)];
                    if (pc.eType == ECurveType::BSpline)
                    {
                        // (knots that rise, multiplicities a B-spline of its degree can have)
                        bool sound = pc.dKnots.size() == pc.iMults.size() && pc.dKnots.size() >= 2;
                        for (size_t k = 0; k < pc.dKnots.size() && sound; ++k)
                        {
                            const bool end = k == 0 || k + 1 == pc.dKnots.size();
                            sound = std::isfinite(pc.dKnots[k]) && (k == 0 || pc.dKnots[k] > pc.dKnots[k - 1]) && pc.iMults[k] >= 1 &&
                                    pc.iMults[k] <= pc.iDegree + (end ? 1 : 0);
                        }
                        if (!sound)
                            return which + ": an edge's curve on it is not a sound B-spline (its knots)";
                    }
                    for (int i = 0; i <= samples && measured; ++i)
                    {
                        const double t = c2->dFirst + (c2->dLast - c2->dFirst) * i / samples;
                        GfVec2d uv;
                        if (!curve2d_point(pc, t, uv))
                        {
                            measured = false;
                            break;
                        }
                        if (!std::isfinite(uv[0]) || !std::isfinite(uv[1]))
                            return which + ": an edge's curve on it is not finite";
                        pts.push_back(uv);
                        if (i % 8 != 0)
                            continue;
                        GfVec3d on;
                        surface_point(srf, uv[0], uv[1], on);
                        if (c3 && !edge->sEdge.bDegenerated && static_cast<size_t>(c3->iCurve3d) >= 1 &&
                            static_cast<size_t>(c3->iCurve3d) <= m.sCurves.size())
                        {
                            const GfVec3d x = occt::EvalCurve3dPoint(m.sCurves[static_cast<size_t>(c3->iCurve3d - 1)], pxr::GfMatrix4d(1.0), t);
                            if ((on - x).GetLength() > 1.5 * tol)
                                return which + ": an edge's curve on it lies " + std::to_string((on - x).GetLength()) +
                                       " from the edge, more than its tolerance " + std::to_string(tol);
                        }
                    }
                    if (!forward)
                        std::reverse(pts.begin(), pts.end());
                }
                else if (plane && c3 && static_cast<size_t>(c3->iCurve3d) >= 1 && static_cast<size_t>(c3->iCurve3d) <= m.sCurves.size())
                {
                    // (OpenCASCADE projects an edge onto a plane: so does the check)
                    for (int i = 0; i <= samples; ++i)
                    {
                        const double t = c3->dFirst + (c3->dLast - c3->dFirst) * i / samples;
                        const GfVec3d x = occt::EvalCurve3dPoint(m.sCurves[static_cast<size_t>(c3->iCurve3d - 1)], pxr::GfMatrix4d(1.0), t);
                        pts.push_back(GfVec2d((x - po) * px, (x - po) * py));
                    }
                    if (!forward)
                        std::reverse(pts.begin(), pts.end());
                }
                else
                    return which + ": an edge has no curve on it";
                if (!measured)
                    break;
                uses.push_back(std::move(pts));
            }
            if (!measured || uses.empty())
            {
                measured = false;
                break;
            }
            // the wire closes in the parameters
            double size = 1.0;
            for (const auto& u : uses)
                for (const GfVec2d& p : u)
                    size = std::max({size, std::fabs(p[0]), std::fabs(p[1])});
            for (size_t k = 0; k < uses.size(); ++k)
            {
                const GfVec2d a = uses[k].back(), b = uses[(k + 1) % uses.size()].front();
                const double gap = (b - a).GetLength();
                // (on a plane OpenCASCADE projects the edges: their ends meet within the tolerance)
                const double allowed = plane ? 2.0 * wire_tol + 1e-9 * size : 1e-7 * size;
                if (gap > allowed)
                {
                    GfVec3d pa, pb;
                    surface_point(srf, a[0], a[1], pa);
                    surface_point(srf, b[0], b[1], pb);
                    return which + ": a wire does not close in its parameters (a gap of " + std::to_string(gap) +
                           ", " + std::to_string((pb - pa).GetLength()) + " in space)";
                }
            }
            std::vector<GfVec2d> poly;
            for (const auto& u : uses)
                poly.insert(poly.end(), u.begin(), u.end());
            if (!plane)
                face_box.insert(face_box.end(), poly.begin(), poly.end());
            for (size_t i = 0; i < poly.size(); ++i)
            {
                const GfVec2d& p = poly[i];
                const GfVec2d& q = poly[(i + 1) % poly.size()];
                area += 0.5 * (p[0] * q[1] - q[0] * p[1]);
                perimeter += (q - p).GetLength();
            }
            face_tol = std::max(face_tol, wire_tol);
        }
        if (measured && !(area > 0.0))
        {
            // A face narrower than its edges' tolerance (a sliver of 0.002 between two edges 0.16 long,
            // a STEP file's) has no side its curves can tell to within the tolerance: their area, of either
            // sign, is less than its perimeter by the tolerance (in the parameters, through the surface's
            // speed at the middle of its wires), and OpenCASCADE takes it as it is.
            double speed = 1.0;
            if (!face_box.empty() || plane)
            {
                GfVec2d mid(0.0, 0.0);
                for (const GfVec2d& p : face_box)
                    mid += p / static_cast<double>(face_box.size());
                GfVec3d p0, pu, pv;
                const double h = 1e-6;
                if (!plane && surface_point(srf, mid[0], mid[1], p0) && surface_point(srf, mid[0] + h, mid[1], pu) &&
                    surface_point(srf, mid[0], mid[1] + h, pv))
                    speed = std::max({(pu - p0).GetLength() / h, (pv - p0).GetLength() / h, 1e-300});
            }
            if (!(std::fabs(area) <= perimeter * face_tol / speed))
                return which + ": its wires run clockwise in its parameters (an area of " + std::to_string(area) + ")";
        }
        // a face lies within one period of a closed surface, a sphere's between its poles, a B-spline's in its
        // knots (OpenCASCADE integrates over the parameters its wires enclose)
        if (measured && !face_box.empty())
        {
            const double pi = 3.14159265358979323846;
            double lo[2] = {1e300, 1e300}, hi[2] = {-1e300, -1e300};
            for (const GfVec2d& p : face_box)
                for (int k = 0; k < 2; ++k)
                    lo[k] = std::min(lo[k], p[k]), hi[k] = std::max(hi[k], p[k]);
            // (ends of edges apart within the tolerance may overshoot a period a little, and curves fitted within
            // the edges' tolerance pass the range by as much: 0.0011 of v on a B-spline face 0.2 wide, 0.00018 of a
            // turn on a cone where an edge 0.0009 long ends 0.00036 past the seam, a STEP file's; OpenCASCADE
            // extends a B-spline surface past its knots)
            const double eps = 1e-6 * std::max({1.0, std::fabs(lo[0]), std::fabs(hi[0]), std::fabs(lo[1]), std::fabs(hi[1])});
            double ue = eps, ve = eps;
            {
                const GfVec2d mid((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2);
                const double h = 1e-6 * std::max(1.0, std::max(hi[0] - lo[0], hi[1] - lo[1]));
                GfVec3d p0, pu, pv;
                if (face_tol > 0 && surface_point(srf, mid[0], mid[1], p0) && surface_point(srf, mid[0] + h, mid[1], pu) &&
                    surface_point(srf, mid[0], mid[1] + h, pv))
                {
                    const double su = (pu - p0).GetLength() / h, sv = (pv - p0).GetLength() / h;
                    if (su > 0 && std::isfinite(su))
                        ue += std::min(face_tol / su, 0.01 * std::max(1.0, hi[0] - lo[0]));
                    if (sv > 0 && std::isfinite(sv))
                        ve += std::min(face_tol / sv, 0.01 * std::max(1.0, hi[1] - lo[1]));
                }
            }
            bool fits = true;
            switch (srf.eType)
            {
            case ESurfaceType::Cylinder:
            case ESurfaceType::Cone: fits = hi[0] - lo[0] <= 2 * pi + ue; break;
            case ESurfaceType::Sphere: fits = hi[0] - lo[0] <= 2 * pi + ue && lo[1] >= -pi / 2 - ve && hi[1] <= pi / 2 + ve; break;
            case ESurfaceType::Torus: fits = hi[0] - lo[0] <= 2 * pi + ue && hi[1] - lo[1] <= 2 * pi + ve; break;
            case ESurfaceType::BSpline:
                if (!srf.dUKnots.empty() && !srf.dVKnots.empty())
                {
                    ue += 1e-9 * (srf.dUKnots.back() - srf.dUKnots.front());
                    ve += 1e-9 * (srf.dVKnots.back() - srf.dVKnots.front());
                    fits = lo[0] >= srf.dUKnots.front() - ue && hi[0] <= srf.dUKnots.back() + ue && lo[1] >= srf.dVKnots.front() - ve &&
                           hi[1] <= srf.dVKnots.back() + ve;
                }
                break;
            default: break;
            }
            if (!fits)
                return which + ": its wires reach past its surface's range of parameters (u " + std::to_string(lo[0]) + " to " +
                       std::to_string(hi[0]) + ", v " + std::to_string(lo[1]) + " to " + std::to_string(hi[1]) + ")";
        }
    }
    return "";
}

void occt_tolerances(SOcctModel& m, double least)
{
    const size_t shapes = m.sShapes.size();
    auto shape = [&](int storage) -> SShapeRecord* {
        return storage >= 1 && static_cast<size_t>(storage) <= shapes ? &m.sShapes[static_cast<size_t>(storage - 1)] : nullptr;
    };
    auto curve3d = [&](const SShapeRecord& edge) -> const SCurveRepr* {
        for (const SCurveRepr& r : edge.sEdge.sReprs)
            if (r.iKind == 1 && r.iCurve3d >= 1 && static_cast<size_t>(r.iCurve3d) <= m.sCurves.size())
                return &r;
        return nullptr;
    };
    auto point3d = [&](const SCurveRepr& c, double t) {
        return occt::EvalCurve3dPoint(m.sCurves[static_cast<size_t>(c.iCurve3d - 1)], pxr::GfMatrix4d(1.0), t);
    };
    // how far each edge's curve lies from its faces' surfaces along their curves on them (or from a plane it
    // is projected onto), and each vertex from the ends of its edges' curves and of their curves on faces
    std::vector<double> edge_off(shapes, 0.0), vertex_off(shapes, 0.0);
    std::vector<char> unmeasured(shapes, 0);  // (edges a face or a curve on it is not evaluated for: kept as written)
    // (the curves on faces pass through points of their edges at even steps of the parameter: the samples lie
    // between those, at the ends, and 97 more off any even step)
    const int samples = 98;
    auto step = [](int i) { return i == 0 ? 0.0 : i == samples ? 1.0 : (i - 0.5 + 0.2360679774997897 * ((i * 7) % 5 - 2) / 2.0) / (samples - 1); };
    auto vertex_at = [&](const SShapeRecord& edge, bool last) -> SShapeRecord* {
        // (an edge's vertex oriented forward is at the start of its curve, the reversed one at the end)
        for (const occt::SSubShapeRef& v : edge.sSubShapes)
            if ((v.eOrientation == EOrientation::Reversed) == last)
                return shape(v.iStorageIndex);
        return nullptr;
    };
    auto near_vertex = [&](const SShapeRecord& edge, bool last, const GfVec3d& x) {
        SShapeRecord* v = vertex_at(edge, last);
        if (v && v->eType == EShapeType::Vertex)
        {
            const size_t i = static_cast<size_t>(v - m.sShapes.data());
            vertex_off[i] = std::max(vertex_off[i], (x - vec(v->sVertex.sPoint)).GetLength());
        }
    };
    for (size_t ei = 0; ei < shapes; ++ei)
    {
        const SShapeRecord& edge = m.sShapes[ei];
        if (edge.eType != EShapeType::Edge)
            continue;
        if (!curve3d(edge) && !edge.sEdge.bDegenerated)
            unmeasured[ei] = 1;
        if (const SCurveRepr* c3 = curve3d(edge))
        {
            const GfVec3d a = point3d(*c3, c3->dFirst), b = point3d(*c3, c3->dLast);
            near_vertex(edge, false, a);
            near_vertex(edge, true, b);
            for (const occt::SSubShapeRef& v : edge.sSubShapes)
                if (const SShapeRecord* vr = shape(v.iStorageIndex); vr && vr->eType == EShapeType::Vertex)
                {
                    const GfVec3d end = v.eOrientation == EOrientation::Reversed ? b : a;
                    edge_off[ei] = std::max(edge_off[ei], (end - vec(vr->sVertex.sPoint)).GetLength());
                }
        }
    }
    for (size_t fi = 0; fi < shapes; ++fi)
    {
        const SShapeRecord& face = m.sShapes[fi];
        if (face.eType != EShapeType::Face)
            continue;
        const int isurface = face.sFace.iSurface;
        if (isurface < 1 || static_cast<size_t>(isurface) > m.sSurfaces.size())
            continue;
        const SSurface& srf = m.sSurfaces[static_cast<size_t>(isurface - 1)];
        GfVec3d probe;
        const bool evaluated = surface_point(srf, 0.0, 0.0, probe);  // (else its edges keep what they have)
        const bool plane = srf.eType == ESurfaceType::Plane;
        const GfVec3d po = vec(srf.sLocation), pz = vec(srf.sAxis);
        for (const occt::SSubShapeRef& wref : face.sSubShapes)
        {
            const SShapeRecord* wire = shape(wref.iStorageIndex);
            if (!wire || wire->eType != EShapeType::Wire)
                continue;
            for (const occt::SSubShapeRef& eref : wire->sSubShapes)
            {
                SShapeRecord* edge = shape(eref.iStorageIndex);
                if (!edge || edge->eType != EShapeType::Edge)
                    continue;
                const size_t ei = static_cast<size_t>(edge - m.sShapes.data());
                if (!evaluated)
                {
                    unmeasured[ei] = 1;
                    continue;
                }
                const SCurveRepr* c3 = curve3d(*edge);
                bool on = false;
                for (const SCurveRepr& r : edge->sEdge.sReprs)
                {
                    if ((r.iKind != 2 && r.iKind != 3) || r.iSurface != isurface)
                        continue;
                    on = true;
                    for (int ic : {r.iPCurve, r.iKind == 3 ? r.iPCurve2 : -1})
                    {
                        if (ic == -1)
                            continue;
                        if (ic < 1 || static_cast<size_t>(ic) > m.sCurve2ds.size())
                        {
                            unmeasured[ei] = 1;
                            continue;
                        }
                        const SCurve2d& pc = m.sCurve2ds[static_cast<size_t>(ic - 1)];
                        for (int i = 0; i <= samples; ++i)
                        {
                            const double t = r.dFirst + (r.dLast - r.dFirst) * step(i);
                            GfVec2d uv;
                            GfVec3d x;
                            if (!curve2d_point(pc, t, uv) || !surface_point(srf, uv[0], uv[1], x) || !std::isfinite(x[0]))
                            {
                                unmeasured[ei] = 1;
                                break;
                            }
                            if (c3 && !edge->sEdge.bDegenerated)
                                edge_off[ei] = std::max(edge_off[ei], (x - point3d(*c3, t)).GetLength());
                            if (i == 0 || i == samples)
                                near_vertex(*edge, i == samples, x);
                        }
                    }
                }
                if (!on && plane && c3)  // (OpenCASCADE projects the curve onto the plane)
                    for (int i = 0; i <= samples; ++i)
                        edge_off[ei] = std::max(edge_off[ei], std::fabs((point3d(*c3, c3->dFirst + (c3->dLast - c3->dFirst) * step(i)) - po) * pz));
                else if (!on)
                    unmeasured[ei] = 1;
            }
        }
    }
    // each its own: twice what was found, at least `least` (an edge not measured on each of its faces, and
    // its vertices, as written); a vertex at least what its edges have, a face `least`
    std::vector<char> kept(shapes, 0);
    for (size_t i = 0; i < shapes; ++i)
    {
        SShapeRecord& edge = m.sShapes[i];
        if (edge.eType != EShapeType::Edge)
            continue;
        if (!unmeasured[i])
            edge.sEdge.dTolerance = std::max(least, 2.0 * edge_off[i]);
        else
            for (const occt::SSubShapeRef& v : edge.sSubShapes)
                if (const SShapeRecord* vr = shape(v.iStorageIndex); vr && vr->eType == EShapeType::Vertex)
                    kept[static_cast<size_t>(vr - m.sShapes.data())] = 1;
    }
    for (size_t i = 0; i < shapes; ++i)
    {
        SShapeRecord& r = m.sShapes[i];
        if (r.eType == EShapeType::Vertex && !kept[i])
            r.sVertex.dTolerance = std::max(least, 2.0 * vertex_off[i]);
        else if (r.eType == EShapeType::Face)
            r.sFace.dTolerance = std::min(r.sFace.dTolerance, least);
    }
    for (size_t ei = 0; ei < shapes; ++ei)
    {
        const SShapeRecord& edge = m.sShapes[ei];
        if (edge.eType != EShapeType::Edge)
            continue;
        for (const occt::SSubShapeRef& v : edge.sSubShapes)
            if (SShapeRecord* vr = shape(v.iStorageIndex); vr && vr->eType == EShapeType::Vertex)
                vr->sVertex.dTolerance = std::max(vr->sVertex.dTolerance, edge.sEdge.dTolerance);
    }
}

}  // namespace smlibpy
