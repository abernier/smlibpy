// SPDX-License-Identifier: Apache-2.0
//
// Drawing views with hidden lines (`smlibpy._core.ext.hidden_lines`, `ext__hidden_lines` in the
// JavaScript module).
//
// The kernel's hidden curve removal (SmHCR, SMLib/inc/SmHCR.h) splits every edge of a body and
// every contour of its curved faces into the pieces seen from a direction and the pieces behind the
// body (ComputeGlobalVisibility, by casting rays). SM_API keeps only the visible ones
// (SmApiProjectBrepOntoPlane, behind Part.outline). Here both, projected onto the view's plane as
// SmApiProjectBrepOntoPlane does, and tidied for a drawing:
//
//   * edges seen end-on (projected to a point) are left out;
//   * seams and the edges between tangent faces are left out unless asked for (SmHCR is asked to
//     show them: the ones it hides itself make the edges at their ends hidden, also in front);
//   * a line is drawn once: a piece of a curve that runs under one drawn before it is cut away
//     (visible lines first, then the hidden ones: the back edges of a box seen from the front lie
//     under its front edges);
//   * slivers (shorter than 1e-4 of the body's size: left between such pieces, or edges seen
//     nearly end-on) are dropped.

#include "kernel.h"
#include "hidden_lines.h"

#include <SmApiGeneral.h>
#include <SmApiQueries.h>
#include <SmAxis2Placement.h>
#include <SmHCR.h>

#include <algorithm>
#include <cmath>
#include <memory>
#include <stdexcept>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

SmVector3d vec(const std::vector<double>& v, const char* what)
{
    if (v.size() != 3 || !std::isfinite(v[0]) || !std::isfinite(v[1]) || !std::isfinite(v[2]))
        throw std::invalid_argument(std::string("hidden_lines: ") + what + " must be three finite numbers");
    return SmVector3d(v[0], v[1], v[2]);
}

// A drawn curve: the curve and the box around it (grown by the tolerance), for the overlap tests.
struct Drawn
{
    SmCurve* curve;
    SmExtent1d interval;
    SmExtent3d box;
};

bool in_box(const SmExtent3d& box, const SmPoint3d& p)
{
    const SmPoint3d lo = box.GetMin(), hi = box.GetMax();
    return p.x >= lo.x && p.y >= lo.y && p.z >= lo.z && p.x <= hi.x && p.y <= hi.y && p.z <= hi.z;
}

// How far p is from the drawn curves, as far as it is within tol of one (more than tol otherwise).
double gap(const std::vector<Drawn>& drawn, const SmPoint3d& p, double tol)
{
    double best = SM_BIG_DOUBLE;
    for (const Drawn& d : drawn)
    {
        if (!in_box(d.box, p))
            continue;
        SmBoolean found = FALSE;
        double t = 0, distance = SM_BIG_DOUBLE;
        if (d.curve->DropPoint(d.interval, p, nullptr, tol, nullptr, found, t, distance) == SM_SUCCESS && found)
            best = std::min(best, distance);
        if (best <= 0.1 * tol)
            break;
    }
    return best;
}

// The length of a curve over [a, b]. (The kernel fails on some projections, whose speed is 0 at an
// end where the curve ran along the view: there a polyline of 256 points.)
double length(const SmCurve* curve, double a, double b)
{
    double out = 0.0;
    if (curve->Length(SmExtent1d(a, b), 1e-9, out) == SM_SUCCESS && out > 0)
        return out;
    out = 0.0;
    SmPoint3d last;
    for (int i = 0; i <= 256; ++i)
    {
        SmPoint3d p;
        if (curve->EvaluatePoint(a + (b - a) * i / 256, p) != SM_SUCCESS)
            return 0.0;
        if (i > 0)
            out += p.DistanceBetween(last);
        last = p;
    }
    return out;
}

// The pieces of `curve` that do not run along the drawn curves: parameter intervals, found at
// samples along the curve and refined at their ends. A stretch within `tol` of a drawn curve runs
// along it only where it stays close all the way: a curve that crosses a drawn one, or leaves the
// end of one it touches (tangent: a line out of an arc), comes within `tol` too, but its gap grows
// to `tol` inside that stretch.
std::vector<std::pair<double, double>> uncovered(const SmCurve* curve, const SmExtent1d& interval,
                                                 const std::vector<Drawn>& drawn, double tol, int samples)
{
    const double a = interval.GetMin(), b = interval.GetMax();
    auto distance = [&](double t) {
        SmPoint3d p;
        return curve->EvaluatePoint(t, p) != SM_SUCCESS ? SM_BIG_DOUBLE : gap(drawn, p, tol);
    };
    auto off = [&](double t) { return distance(t) > tol; };
    std::vector<double> ts(samples + 1);
    std::vector<char> free(samples + 1);
    for (int i = 0; i <= samples; ++i)
    {
        ts[i] = a + (b - a) * i / samples;
        free[i] = off(ts[i]);
    }
    // where the state changes between two samples: bisect for the parameter
    auto edge = [&](double lo, double hi, bool lo_free) {
        for (int k = 0; k < 40 && hi - lo > 1e-12 * (std::fabs(b - a) + 1.0); ++k)
        {
            const double mid = 0.5 * (lo + hi);
            (off(mid) == lo_free ? lo : hi) = mid;
        }
        return 0.5 * (lo + hi);
    };
    // the stretches, alternately free and close
    std::vector<double> cuts{a};
    for (int i = 1; i <= samples; ++i)
        if (free[i] != free[i - 1])
            cuts.push_back(edge(ts[i - 1], ts[i], free[i - 1]));
    cuts.push_back(b);
    std::vector<char> runs_free;
    for (size_t r = 0; r + 1 < cuts.size(); ++r)
    {
        bool f = (r % 2 == 0) == static_cast<bool>(free[0]);
        if (!f)
        {
            // close all the way, or only crossing or touching?
            double worst = 0.0;
            for (int k = 1; k <= 7; ++k)
                worst = std::max(worst, distance(cuts[r] + (cuts[r + 1] - cuts[r]) * k / 8.0));
            f = worst > 0.5 * tol;
        }
        runs_free.push_back(f);
    }
    std::vector<std::pair<double, double>> out;
    for (size_t r = 0; r < runs_free.size(); ++r)
    {
        if (!runs_free[r])
            continue;
        if (!out.empty() && out.back().second == cuts[r])
            out.back().second = cuts[r + 1];
        else
            out.push_back({cuts[r], cuts[r + 1]});
    }
    return out;
}

// The seams of closed faces and the edges between tangent faces (as SmHCR finds them) that are not
// to be drawn, unless the view direction runs along a face all along them (then they are contours).
std::vector<const SmEdge*> undrawn_edges(const SmBrep* brep, const SmVector3d& d, bool seams, bool smooth_edges)
{
    std::vector<const SmEdge*> out;
    SmTArray<SmEdge*> edges;
    brep->GetEdges(edges);
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        SmEdge* e = edges[i];
        if (!((!seams && e->IsSeam()) || (!smooth_edges && e->IsTangentEdge(2.0))))
            continue;
        // a contour where a face along it is seen edge-on at a quarter, the middle and three
        // quarters of it
        SmTArray<SmFace*> faces;
        e->GetFaces(faces);
        const SmExtent1d ivl = e->GetInterval();
        bool contour = false;
        for (ULONG f = 0; f < faces.GetSize() && !contour && e->GetCurve(); ++f)
        {
            const SmSurface* surface = faces[f]->GetSurface();
            contour = surface != nullptr;
            for (double at : {0.25, 0.5, 0.75})
            {
                SmPoint3d p, q;
                SmTArray<SmPoint2d> uvs;
                double distance = 0;
                SmVector3d n;
                if (!contour || e->GetCurve()->EvaluatePoint(ivl.GetMin() + ivl.GetLength() * at, p) != SM_SUCCESS ||
                    SmApiSurfaceClosestPoint(surface, p, q, uvs, distance) != SM_SUCCESS || uvs.GetSize() < 1 ||
                    surface->EvaluateNormal(uvs[0], TRUE, TRUE, n) != SM_SUCCESS ||
                    std::fabs(n.Dot(d)) > 1e-6 * n.Length())
                    contour = false;
            }
        }
        if (!contour)
            out.push_back(e);
    }
    return out;
}

// Whether the curve lies on one of the edges (its middle within tol of one).
bool on_edges(const SmCurve* curve, const std::vector<const SmEdge*>& edges, double tol)
{
    if (edges.empty())
        return false;
    SmPoint3d middle;
    if (curve->EvaluatePoint(curve->GetNaturalInterval().GetMid(), middle) != SM_SUCCESS)
        return false;
    for (const SmEdge* e : edges)
    {
        SmBoolean found = FALSE;
        double t = 0, distance = SM_BIG_DOUBLE;
        if (e->GetCurve()->DropPoint(e->GetInterval(), middle, nullptr, tol, nullptr, found, t, distance) == SM_SUCCESS &&
            found && distance <= tol)
            return true;
    }
    return false;
}

}  // namespace

namespace smlibpy {

HiddenLines hidden_lines(const SmBrep* brep, const std::vector<double>& plane_point, const std::vector<double>& plane_normal,
                         bool seams, bool smooth_edges)
{
    if (!brep)
        throw std::invalid_argument("hidden_lines: no body");
    const SmPoint3d origin = vec(plane_point, "the plane's point");
    SmVector3d normal = vec(plane_normal, "the plane's normal");
    if (normal.Unitize() != SM_SUCCESS)
        throw std::invalid_argument("hidden_lines: the plane's normal must not be zero");

    // the view, as SmApiProjectBrepOntoPlane sets it up
    SmExtent3d bounds;
    brep->CalculateBoundingBox(bounds);
    const double size = bounds.GetSize().Length();
    HiddenLines out;
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    if (faces.IsEmpty() || !(size > 0))
        return out;  // (nothing to see)
    SmVector3d x, y, z;
    normal.MakeUnitOrthoVectors(0, x, y, z);
    SmAxis2Placement view, inverse;
    view.SetCanonical(bounds.GetMid() - normal * size, y, z);
    view.Invert(inverse);
    const double approx = std::min(size * 1.0e-6, brep->GetTolerance() * 0.1);
    // (SmHCR is asked to show seams and tangent edges, which are dropped below where they are not
    // wanted: the ones it hides itself pass on "hidden" to the edges at their ends, and a circle
    // that starts on a cylinder's seam came out hidden in front)
    SmHCR hcr(ctx(), brep, inverse, approx, 10.0 * SM_PI / 180.0, TRUE, TRUE);
    SmPyErrorTrail::clear();
    const SmStatus status = hcr.ComputeGlobalVisibility();
    if (status != SM_SUCCESS)
        SmPyRaise(status, "hidden_lines: SmHCR::ComputeGlobalVisibility", __FILE__, __LINE__);
    SmTArray<SmCurve*> seen, behind;  // (the HCR's)
    hcr.GetVisibleCurves(seen);
    hcr.GetInvisibleCurves(behind);
    const std::vector<const SmEdge*> undrawn = undrawn_edges(brep, normal, seams, smooth_edges);

    // A line is the same as one drawn before within `same`; lines and pieces shorter than `sliver`
    // are dropped, and so are edges seen end-on.
    const double same = std::max(1e-5 * size, 10.0 * approx);
    const double sliver = 10.0 * same;
    std::vector<Drawn> drawn;
    auto discard = [](std::vector<SmCurve*>& curves) {
        for (SmCurve* c : curves)
            delete c;
        curves.clear();
    };
    try
    {
        for (int pass = 0; pass < 2; ++pass)
        {
            const SmTArray<SmCurve*>& source = pass == 0 ? seen : behind;
            std::vector<SmCurve*>& kept = pass == 0 ? out.visible : out.hidden;
            for (ULONG i = 0; i < source.GetSize(); ++i)
            {
                const SmCurve* curve3d = source[i];
                if (on_edges(curve3d, undrawn, same))
                    continue;  // (a seam or tangent edge not asked for)
                // seen end-on: its points all project to one
                const SmExtent1d whole3d = curve3d->GetNaturalInterval();
                bool point = true;
                SmPoint3d first;
                for (int k = 0; k <= 8 && point; ++k)
                {
                    SmPoint3d p;
                    if (curve3d->EvaluatePoint(whole3d.GetMin() + whole3d.GetLength() * k / 8, p) != SM_SUCCESS)
                    {
                        point = false;
                        break;
                    }
                    const SmPoint3d q = p - normal * (p - origin).Dot(normal);
                    if (k == 0)
                        first = q;
                    else if (q.DistanceBetween(first) > same)
                        point = false;
                }
                if (point)
                    continue;
                SmCurve* projected = nullptr;
                if (curve3d->CreatePlaneProjection(ctx(), SM_PT_PARALLEL, origin, normal, -normal, projected) != SM_SUCCESS ||
                    !projected)
                {
                    delete projected;
                    SmPyRaise(SM_ERR, "hidden_lines: SmCurve::CreatePlaneProjection", __FILE__, __LINE__);
                }
                std::unique_ptr<SmCurve> owned(projected);
                const SmExtent1d whole = projected->GetNaturalInterval();
                const double full = length(projected, whole.GetMin(), whole.GetMax());
                if (full <= sliver)
                    continue;  // (seen nearly end-on, or a sliver of the kernel's)
                const int samples = static_cast<int>(std::clamp(std::ceil(full / (2e-3 * size)), 32.0, 1024.0));
                const auto pieces = uncovered(projected, whole, drawn, same, samples);
                // (each kept curve is the result's at once: freed with it on a failure)
                auto keep = [&](SmCurve* c) {
                    kept.push_back(c);
                    Drawn d{c, c->GetNaturalInterval(), SmExtent3d()};
                    c->CalculateBoundingBox(d.interval, &d.box);
                    d.box.ExpandAbsolute(same);
                    drawn.push_back(d);
                };
                if (pieces.size() == 1 && pieces[0].first == whole.GetMin() && pieces[0].second == whole.GetMax())
                {
                    keep(owned.release());
                    continue;
                }
                for (const auto& [a, b] : pieces)
                {
                    if (length(projected, a, b) <= sliver)
                        continue;
                    SmCurve* piece = nullptr;
                    if (projected->Copy(ctx(), piece) != SM_SUCCESS || !piece)
                    {
                        delete piece;
                        SmPyRaise(SM_ERR, "hidden_lines: SmCurve::Copy", __FILE__, __LINE__);
                    }
                    SmExtent1d trim(a, b);
                    if (piece->Trim(trim) != SM_SUCCESS)
                    {
                        delete piece;
                        SmPyRaise(SM_ERR, "hidden_lines: SmCurve::Trim", __FILE__, __LINE__);
                    }
                    keep(piece);
                }
            }
        }
    }
    catch (...)
    {
        discard(out.visible);
        discard(out.hidden);
        throw;
    }
    return out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_hidden_lines(py::module_ m)
{
    m.def(
        "hidden_lines",
        [](const SmBrep* brep, const std::vector<double>& plane_point, const std::vector<double>& plane_normal, bool seams,
           bool smooth_edges) {
            const smlibpy::HiddenLines r = smlibpy::hidden_lines(brep, plane_point, plane_normal, seams, smooth_edges);
            return py::make_tuple(py::cast(r.visible, py::return_value_policy::reference),
                                  py::cast(r.hidden, py::return_value_policy::reference));
        },
        py::arg("brep"), py::arg("plane_point"), py::arg("plane_normal"), py::arg("seams") = false,
        py::arg("smooth_edges") = false,
        "The view of a Brep seen from the side plane_normal points to, projected onto the plane: (visible, hidden), "
        "lists of new standalone curves (the caller's). Edges and the contours of curved faces, split where they "
        "pass behind the body; edges seen end-on are left out, a line is drawn once (hidden pieces under visible "
        "lines are cut away). seams: also the seams of closed faces; smooth_edges: also the edges between "
        "tangent faces (fillet tangent lines).");
}
#endif  // SMLIBPY_PYTHON

