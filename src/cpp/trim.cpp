// SPDX-License-Identifier: Apache-2.0
//
// Trimming and splitting faces with curves that lie on them (`smlibpy._core.ext`):
//
//   trim_with_curves(brep, curves, point, trim_type, tolerance)   a trimmed or split copy
//
// As SmBrep::TrimSurfaces: the curves are merged into the faces whose surfaces they lie on
// (SmBrep::MergeCurvesOnSurface), then the faces on the side of a reference point are kept or
// removed, or both sides are kept as faces of their own. That needs the surface of each curve, and a
// curve that runs across several faces split where it passes from one to the next. This finds them: along
// each curve, the face nearest to sample points (SmTopologySolver::BrepPointSolve), with the passage
// between two faces found by bisection. Each piece must lie on its face's surface within the
// tolerance. Samples on an edge or a vertex, or off the faces (a curve that runs on past a face, on
// its surface), belong to the face of their neighbours.
#include "kernel.h"
#include "trim.h"
#include "ext_shared.h"

#include <SmApiGeneral.h>
#include <SmTopologySolver.h>
#include <SmTopologyTraverser.h>

#include <algorithm>
#include <cmath>
#include <memory>
#include <stdexcept>
#include <utility>

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
struct BrepDeleter
{
    void operator()(SmBrep* b) const { delete b; }
};

// The face the point lies on (within tol), or nullptr: on an edge or a vertex, or farther away.
SmFace* face_at(const SmBrep* brep, const SmPoint3d& p, double tol)
{
    SmSolutionArray solutions;
    if (SmTopologySolver::BrepPointSolve(brep, p, SM_SO_MINIMIZE, SM_SR_SINGLE, SM_ZONE_TOL_3D, 1.0e40, nullptr,
                                         solutions) != SM_SUCCESS ||
        solutions.GetSize() < 1)
        return nullptr;
    const SmSolution& solution = solutions[0];
    SmPoint3d found;
    if (solution.GetPoint(0, found) != SM_SUCCESS || found.DistanceBetween(p) > tol)
        return nullptr;
    return SM_CAST_PTR(SmFace, solution.m_apObjects[0]);
}

double surface_gap(const SmSurface* surface, const SmPoint3d& p)
{
    SmBoolean ok = FALSE, multi = FALSE;
    SmPoint2d uv;
    double gap = 0.0;
    if (surface->DropPoint(p, surface->GetNaturalUVDomain(), nullptr, ok, uv, gap, multi) != SM_SUCCESS || !ok)
        return 1e300;
    return gap;
}

struct Piece
{
    double t0, t1;
    SmFace* face;
    double gap;  // the largest distance of the piece from its face's surface, sampled
};

// The pieces of a curve on the faces of a body.
std::vector<Piece> pieces_of(const SmBrep* brep, const SmCurve* curve, double tol)
{
    const SmExtent1d ivl = curve->GetNaturalInterval();
    auto at = [&](double t) {
        SmPoint3d p;
        check(curve->EvaluatePoint(t, p), "SmCurve::EvaluatePoint");
        return p;
    };
    const int n = 48;
    std::vector<double> ts;
    std::vector<SmFace*> faces;
    for (int i = 0; i <= n; ++i)
    {
        const double t = ivl.Evaluate(double(i) / n);
        if (SmFace* f = face_at(brep, at(t), tol))
            ts.push_back(t), faces.push_back(f);
    }
    if (ts.empty())
        throw std::invalid_argument("trim_with_curves: a curve does not lie on the faces");
    std::vector<Piece> out;
    double start = ivl.GetMin();
    for (size_t i = 1; i < ts.size(); ++i)
    {
        if (faces[i] == faces[i - 1])
            continue;
        // where the curve passes from faces[i - 1] to faces[i]
        double lo = ts[i - 1], hi = ts[i];
        for (int k = 0; k < 60 && hi - lo > 1e-12 * std::max(1.0, ivl.GetLength()); ++k)
        {
            const double mid = 0.5 * (lo + hi);
            SmFace* f = face_at(brep, at(mid), tol);
            if (f == faces[i - 1])
                lo = mid;
            else if (f == faces[i])
                hi = mid;
            else
            {
                lo = hi = mid;  // on the edge between them (or a third face): cut here
                break;
            }
        }
        const double cut = 0.5 * (lo + hi);
        out.push_back({start, cut, faces[i - 1], 0.0});
        start = cut;
    }
    out.push_back({start, ivl.GetMax(), faces.back(), 0.0});
    // pieces too short to matter (a corner grazed) go to their neighbours
    std::vector<Piece> kept;
    for (const Piece& p : out)
        if (at(p.t0).DistanceBetween(at(p.t1)) > 10.0 * tol || p.t1 - p.t0 > 1e-3 * ivl.GetLength())
            kept.push_back(p);
        else if (!kept.empty())
            kept.back().t1 = p.t1;
    if (kept.empty())
        kept.push_back({ivl.GetMin(), ivl.GetMax(), out.front().face, 0.0});
    else
        kept.front().t0 = ivl.GetMin(), kept.back().t1 = ivl.GetMax();
    // each piece on its face's surface
    for (Piece& p : kept)
        for (int i = 0; i <= 16; ++i)
        {
            const double gap = surface_gap(p.face->GetSurface(), at(p.t0 + (p.t1 - p.t0) * i / 16.0));
            if (gap > tol)
                throw std::invalid_argument("trim_with_curves: a curve does not lie on the surfaces of the faces it crosses");
            p.gap = std::max(p.gap, gap);
        }
    return kept;
}

}  // namespace

namespace smlibpy {

SmBrep* trim_with_curves(const SmBrep* brep, const std::vector<SmCurve*>& curves, const std::vector<double>& point,
                         int trim_type, double tolerance)
{
    if (!brep)
        throw std::invalid_argument("trim_with_curves: brep is None");
    if (curves.empty())
        throw std::invalid_argument("trim_with_curves: no curves");
    if (point.size() != 3)
        throw std::invalid_argument("trim_with_curves: the point needs three coordinates");
    if (trim_type < 0 || trim_type > 2)
        throw std::invalid_argument("trim_with_curves: trim_type is 0 (keep), 1 (remove) or 2 (split)");
    if (!(tolerance > 0.0) || !std::isfinite(tolerance))
        throw std::invalid_argument("trim_with_curves: the tolerance must be positive");
    std::unique_ptr<SmBrep, BrepDeleter> copy(new (ctx()) SmBrep(*brep, nullptr, nullptr, TRUE, FALSE));
    SmBrep* body = copy.get();
    std::vector<std::unique_ptr<SmCurve, CurveDeleter>> held;
    std::vector<std::pair<SmSurface*, SmCurve*>> merge;  // each piece with its surface
    double gap = 0.0;
    for (const SmCurve* c : curves)
    {
        if (!c)
            throw std::invalid_argument("trim_with_curves: a curve is None");
        for (const Piece& p : pieces_of(body, c, tolerance))
        {
            SmCurve* piece = nullptr;
            check(c->Copy(ctx(), piece), "SmCurve::Copy");
            held.emplace_back(piece);
            const SmExtent1d nat = c->GetNaturalInterval();
            if (p.t0 > nat.GetMin() || p.t1 < nat.GetMax())
            {
                SmExtent1d ivl(p.t0, p.t1);
                check(piece->Trim(ivl), "SmCurve::Trim");
            }
            merge.emplace_back(p.face->GetSurface(), piece);
            gap = std::max(gap, p.gap);
        }
    }

    // As SmBrep::TrimSurfaces, which merges with the body's own tolerance: curves that lie off their
    // surfaces by more than that (a curve projected onto a B-spline sheet, 1e-4 off) merge nothing.
    // Here the tolerance also covers the gaps measured above.
    const double merge_tol = std::max(double(body->GetTolerance()), 2.0 * gap);
    SmNewMarkAndLock lock(body->GetContext(), SM_MT_ALLMARKS);
    const SmMarkType mark = lock.GetMarkType();
    {
        SmTemporaryChangeValue<SmBoolean> editing(body->m_bEditingEnabled, TRUE);
        std::vector<SmSurface*> done;
        for (const auto& entry : merge)
        {
            if (std::find(done.begin(), done.end(), entry.first) != done.end())
                continue;
            done.push_back(entry.first);
            SmTArray<SmCurve*> on;
            for (const auto& other : merge)
                if (other.first == entry.first)
                    on.Add(other.second);
            SmTArray<SmFace*> new_faces;
            SmTArray<SmEdge*> edges;
            check(body->MergeCurvesOnSurface(*entry.first, merge_tol, on, nullptr, new_faces, edges, TRUE),
                  "SmBrep::MergeCurvesOnSurface");
        }
    }
    if (trim_type == 2)
        return copy.release();

    // The edges along the curves bound the sides. (The edges the merges report miss pieces of a
    // curve that a later curve split where it crosses: found again here by where they lie.)
    {
        SmTArray<SmEdge*> all;
        body->GetEdges(all);
        for (ULONG i = 0; i < all.GetSize(); ++i)
        {
            const SmCurve* curve = all[i]->GetCurve();
            SmPoint3d mid;
            if (!curve || curve->EvaluatePoint(all[i]->GetInterval().Evaluate(0.5), mid) != SM_SUCCESS)
                continue;
            for (const auto& entry : merge)
            {
                SmBoolean found = FALSE;
                double t = 0.0, distance = 0.0;
                if (entry.second->DropPoint(entry.second->GetNaturalInterval(), mid, nullptr, merge_tol, nullptr, found, t,
                                            distance) == SM_SUCCESS &&
                    found && distance <= std::max(merge_tol, tolerance))
                {
                    all[i]->Mark(mark);
                    break;
                }
            }
        }
    }

    // the faces reachable from the one nearest to the point without crossing the curves
    SmSolutionArray solutions;
    check(SmTopologySolver::BrepPointSolve(body, SmPoint3d(point[0], point[1], point[2]), SM_SO_MINIMIZE, SM_SR_SINGLE,
                                           body->GetTolerance(), SM_BIG_DOUBLE, nullptr, solutions),
          "SmTopologySolver::BrepPointSolve");
    if (solutions.GetSize() != 1)
        throw std::runtime_error("trim_with_curves: no face is nearest to the point");
    const SmSolution& solution = solutions[0];
    SmTArray<SmFace*> seeds;
    if (SmFace* f = SM_CAST_PTR(SmFace, solution.m_apObjects[0]))
        seeds.Add(f);
    else if (SmEdge* e = SM_CAST_PTR(SmEdge, solution.m_apObjects[0]))
        e->GetFaces(seeds);
    else if (SmVertex* v = SM_CAST_PTR(SmVertex, solution.m_apObjects[0]))
        v->GetFaces(seeds);
    if (seeds.GetSize() == 0)
        throw std::runtime_error("trim_with_curves: no face is nearest to the point");
    SmTopologyTraverser traverser;
    SmTArray<SmFace*> side;
    check(traverser.CollectFaces(seeds[0], side, mark), "SmTopologyTraverser::CollectFaces");
    SmTArray<SmFace*> drop;
    if (trim_type == 0)
    {
        SmTArray<SmFace*> all;
        body->GetFaces(all);
        for (ULONG i = 0; i < all.GetSize(); ++i)
        {
            ULONG index = 0;
            if (!side.FindElement(all[i], index))
                drop.Add(all[i]);
        }
    }
    else
        drop = side;
    if (drop.GetSize() > 0)
    {
        SmTemporaryChangeValue<SmBoolean> editing(body->m_bEditingEnabled, TRUE);
        check(body->RemoveFaces(drop), "SmBrep::RemoveFaces");
    }
    return copy.release();
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_trim(py::module_ m)
{
    m.def("trim_with_curves", &smlibpy::trim_with_curves, py::arg("brep"), py::arg("curves"), py::arg("point"),
          py::arg("trim_type"), py::arg("tolerance"), py::return_value_policy::take_ownership,
          "A copy of a body whose faces are trimmed by curves lying on them (SmBrep::TrimSurfaces), each curve cut "
          "where it passes from face to face: trim_type 0 keeps the side nearest to point, 1 removes it, 2 splits "
          "and keeps both. The curves are not consumed.");
}
#endif  // SMLIBPY_PYTHON
