// SPDX-License-Identifier: Apache-2.0
//
// Sheet metal: exact bending and unbending of Breps (`smlibpy._core.sheetmetal`).
//
// The kernel describes a bend with SmSpaceBend / SmSpaceUnbend: a bend axis, the bend angle,
// the inside radius, the sheet thickness and the K-factor (neutral radius = radius + K * t).
// Everything in the bend region (a strip of the bend allowance's width in the flat, a cylinder
// sector when bent) is mapped through an exact bend volume; everything before and after it is
// moved rigidly. Planes parallel to the sheet become exact cylinders, lines exact lines and
// circles; other geometry crossing the region becomes NURBS: faces within 1e-4, edges within 1e-7.
//
// The orchestration of the kernel (SmSpaceBend::DoSpaceBend, SmSpaceUnbend::DoSpaceUnbend) is
// redone here with the kernel's own steps, because in usd-brep 1.0.0
//   * DoSpaceBend passes an empty list to SmTopologyTraverser::GetSubTopologies and then empties
//     its list of faces in the region: nothing is bent, the whole body is only turned;
//   * DoSpaceUnbend lists every face in the region twice and maps it twice (a wrong body, or a
//     crash);
//   * SmBendVolume::MakeExactBSpline1stOutSurface builds the cylinder of a bent face at the bend
//     axis point instead of at the face (it computes the right origin but does not pass it);
//   * the unbend region starts at the axis point and ignores the start of the interval, and an
//     unbounded interval (SmExtent1d::Init) evaluates to SM_BIG_DOUBLE;
//   * the exact lines, arcs and planes made for the region build their NURBS data only when
//     asked, and SmPlane::DropCurve copies such a curve and reads the missing data (a crash when
//     trim curves are built later, seen for small radii and overlapping bends);
//   * the exact conversion samples the whole UV box of a face's surface, which for a strip cut
//     obliquely by the outline reaches outside the bend (no cylinder is made), and
//     SmEdge::ApproximateWithBSpline reports success when it replaces nothing.
// The bindings therefore place the axis point at the start of the region and pass the interval
// [0, length], give the region's planes a parameterization along the bend, move the cylinders
// onto their faces, approximate the curves left over and build the NURBS data of every new curve
// and surface at once. Callers make sure the region holds nothing but flat sheet (bend) or one
// bend (unbend); a region that does not cut the body in two is refused here.

#include "deform.h"
#include "kernel.h"
#include "sheetmetal.h"

#include <SmApiGeneral.h>
#include <SmBendVolume.h>
#include <SmCrvInVolume.h>
#include <SmCylinder.h>
#include <SmMerge.h>
#include <SmPlane.h>
#include <SmSpaceBend.h>
#include <SmSpaceUnbend.h>
#include <SmTopologyTraverser.h>
#include <SmUnbendVolume.h>

#include <algorithm>
#include <cmath>
#include <memory>
#include <string>

namespace
{

// Raise a RuntimeError with the whole message (SmPyRaise keeps only a C call name), the status
// name and the kernel's error trail.
[[noreturn]] void fail(SmStatus status, const std::string& message)
{
    std::string trail = SmPyErrorTrail::take();
    std::string text = message + " (" + sm_status_name(status) + ")";
    if (!trail.empty())
        text += ". Kernel trace: " + trail;
    throw std::runtime_error(text);
}

void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        fail(status, what);
}

SmVector3d vec(const std::vector<double>& v)
{
    if (v.size() != 3)
        throw std::invalid_argument("expected three coordinates");
    return SmVector3d(v[0], v[1], v[2]);
}

struct Transforms
{
    SmAxis2Placement before, inside, after;
};

// The region of a bend or unbend split from the rest of the body.
struct Partition
{
    SmTArray<SmFace*> in_faces, before_faces, after_faces;
    SmTArray<SmEdge*> in_edges, before_edges, after_edges;
    SmTArray<SmVertex*> in_vertices, before_vertices, after_vertices;
};

// Steps 1 to 3 of DoSpaceBend / DoSpaceUnbend: imprint the region on the body and sort its
// topology into the region, the part before it (connected to its start boundary) and the part
// after it (connected to its stop boundary).
SmStatus partition(SmBrep& brep, SmBrep* domain, SmBrep* start, SmBrep* stop, Partition& p)
{
    if (!domain || !start || !stop)
        return SM_ERR;
    const SmContext* cx = brep.GetContext();
    ULONG intersect_id = SM_AI_BOOLEAN_INTERSECT, save_id = SM_AI_BOOLEAN_SAVE, delete_id = SM_AI_BOOLEAN_DELETE;
    auto clear = [&] {
        brep.RemoveAttributeFromTopology(intersect_id);
        brep.RemoveAttributeFromTopology(save_id);
        brep.RemoveAttributeFromTopology(delete_id);
    };

    // 1. The faces inside the region are labelled "save" by the classifying imprint.
    {
        SmBrep* result = nullptr;
        SmMerge merge(*cx, &brep, domain);
        merge.SetClassifyFaces(TRUE);
        clear();
        SmStatus st = merge.NonManifoldBoolean(SM_BO_INTERSECTION, result);
        if (st == SM_SUCCESS)
            brep.GetFaces(p.in_faces, &save_id);
        clear();
        if (st != SM_SUCCESS)
            return st;
    }

    // 2. Topology on the start and stop boundaries of the region.
    SmTArray<SmTopology*> start_topology, stop_topology;
    for (int side = 0; side < 2; ++side)
    {
        SmBrep* result = nullptr;
        SmMerge merge(*cx, &brep, side == 0 ? start : stop);
        merge.SetClassifyFaces(TRUE);
        SmStatus st = merge.NonManifoldBoolean(SM_BO_INTERSECTION, result);
        if (st == SM_SUCCESS)
            brep.GetTopology(side == 0 ? start_topology : stop_topology, &intersect_id);
        clear();
        if (st != SM_SUCCESS)
            return st;
    }

    // 3. Edges and vertices of the region (the faces are seeds in a list of their own, so they
    //    are listed once), then everything connected to the boundaries outside the region.
    SmNewMarkAndLock lock(cx, SM_MT_ALLMARKS);
    SmMarkType mark = lock.GetMarkType();
    SmTopologyTraverser traverser;
    SmTArray<SmTopology*> seeds;
    for (ULONG i = 0; i < p.in_faces.GetSize(); ++i)
        seeds.Add(p.in_faces[i]);
    SmTArray<SmFace*> seed_faces;
    traverser.GetSubTopologies(seeds, nullptr, nullptr, &seed_faces, nullptr, &p.in_edges, &p.in_vertices, TRUE, mark);

    auto collect = [&](const SmTArray<SmTopology*>& boundary, SmTArray<SmFace*>& faces, SmTArray<SmEdge*>& edges,
                       SmTArray<SmVertex*>& vertices) {
        SmTArray<SmFace*> these_faces, edge_faces;
        SmTArray<SmEdge*> these_edges, vertex_edges;
        SmTArray<SmVertex*> these_vertices;
        for (int pass = 0; pass < 2; ++pass)
        {
            for (ULONG j = 0; j < boundary.GetSize(); ++j)
            {
                SmEdge* edge = SM_CAST_PTR(SmEdge, boundary[j]);
                SmVertex* vertex = SM_CAST_PTR(SmVertex, boundary[j]);
                if (pass == 0 && edge)
                {
                    edge_faces.ReSet();
                    edge->GetFaces(edge_faces);
                    for (ULONG k = 0; k < edge_faces.GetSize(); ++k)
                    {
                        if (edge_faces[k]->IsMarked(mark))
                            continue;
                        traverser.CollectFaces(edge_faces[k], these_faces, mark, &these_edges, &these_vertices);
                        faces.Append(these_faces);
                        edges.Append(these_edges);
                        vertices.Append(these_vertices);
                    }
                }
                else if (pass == 1 && vertex)
                {
                    vertex_edges.ReSet();
                    vertex->GetEdges(vertex_edges);
                    for (ULONG k = 0; k < vertex_edges.GetSize(); ++k)
                    {
                        if (vertex_edges[k]->IsMarked(mark))
                            continue;
                        traverser.CollectWireEdges(vertex_edges[k], these_edges, mark, &these_vertices);
                        edges.Append(these_edges);
                        vertices.Append(these_vertices);
                    }
                }
            }
        }
    };
    collect(start_topology, p.before_faces, p.before_edges, p.before_vertices);
    lock.NewMark();
    for (ULONG i = 0; i < p.in_faces.GetSize(); ++i)
        p.in_faces[i]->Mark(mark);
    for (ULONG i = 0; i < p.in_edges.GetSize(); ++i)
        p.in_edges[i]->Mark(mark);
    for (ULONG i = 0; i < p.in_vertices.GetSize(); ++i)
        p.in_vertices[i]->Mark(mark);
    collect(stop_topology, p.after_faces, p.after_edges, p.after_vertices);

    return SM_SUCCESS;
}

// The region must cut the body in two: a face reached from both boundaries (the sheet goes
// around the region, as beside a partial bend without relief cuts) cannot be both kept and
// turned, and the kernel crashes on such a body.
void check_partition(const Partition& p, const char* what)
{
    if (p.in_faces.GetSize() == 0)
        fail(SM_ERR_INVALID_INPUT, std::string(what) + ": no material in the bend region");
    SmTArray<SmFace*> common;
    p.before_faces.FindCommonElements(p.after_faces, common);
    if (common.GetSize() > 0 || p.before_faces.GetSize() == 0 || p.after_faces.GetSize() == 0)
        fail(SM_ERR_INVALID_INPUT, std::string(what) + ": the bend region does not cut the body in two");
}

// Points along the edges of a face.
template <class Visit>
void sample_boundary(SmFace* face, Visit visit)
{
    SmTArray<SmEdge*> edges;
    face->GetEdges(edges);
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        SmCurve* curve = edges[i]->GetCurve();
        SmExtent1d ivl = edges[i]->GetInterval();
        for (int j = 0; j <= 8; ++j)
        {
            SmPoint3d p;
            if (curve->EvaluatePoint(ivl.Evaluate(j / 8.0), p) == SM_SUCCESS)
                visit(p);
        }
    }
}

// Give the planar faces of the bend region that are parallel to the sheet a plane parameterized
// along the bend (across it and along the axis). The exact conversion of a bent face samples the
// UV box of its surface, which must stay within the bend: for a strip cut obliquely by the
// outline, the box in the plate's own parameterization reaches far outside the strip.
void align_planes(SmBrep& brep, const SmTArray<SmFace*>& faces, const SmVector3d& axis, const SmVector3d& direction)
{
    SmVector3d across = axis * direction;
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        SmFace* face = faces[i];
        SmSurface* surface = face->GetSurface();
        if (!surface || surface->GetType() != SmPlane_TYPE)
            continue;
        SmAxis2Placement placement;
        if (static_cast<SmPlane*>(surface)->GetCanonical(placement) != SM_SUCCESS)
            continue;
        SmVector3d normal = placement.GetXAxisRef() * placement.GetYAxisRef();
        if (std::abs(std::abs(normal.Dot(direction)) - 1.0) > 1e-9)
            continue;
        SmVector3d x = across, y = axis;
        if ((x * y).Dot(normal) < 0.0)
            std::swap(x, y);
        SmPoint3d origin = placement.GetOriginRef();
        SmExtent2d domain;
        sample_boundary(face, [&](const SmPoint3d& p) {
            domain.AddPoint2d(SmPoint2d((p - origin).Dot(x), (p - origin).Dot(y)));
        });
        if (domain.IsInit())
            continue;
        domain.ExpandAbsolute(1e-6 * (1.0 + domain.GetMaxDimension()));
        SmPlane* plane = new (brep.GetContext()) SmPlane(origin, x, y, SmVector2d(1.0, 1.0), domain, brep.GetContext());
        if (brep.ReplaceSurface(face, plane, FALSE, nullptr, TRUE) != SM_SUCCESS && plane->GetOwner() == nullptr)
            delete plane;
    }
}

// Move the exact cylinder of a bent face along its axis onto the face (see the file comment).
void move_cylinder_onto_face(SmBSplineSurface* cylinder, SmFace* face)
{
    SmAxis2Placement placement;
    double radius = 0.0;
    if (static_cast<SmCylinder*>(cylinder)->GetCanonical(placement, radius) != SM_SUCCESS)
        return;
    SmPoint3d origin = placement.GetOriginRef();
    SmVector3d x = placement.GetXAxisRef();
    SmVector3d y = placement.GetYAxisRef();
    SmVector3d axis = x * y;
    double lo = SM_BIG_DOUBLE;
    sample_boundary(face, [&](const SmPoint3d& p) { lo = std::min(lo, (p - origin).Dot(axis)); });
    if (lo == SM_BIG_DOUBLE || std::abs(lo) < 1e-12)
        return;
    SmAxis2Placement shift(origin, x, y, origin + lo * axis, x, y);
    cylinder->Transform(shift);
}

// The edges of the bend region are fitted within kCurveTolerance of the exact bend (deform.cpp's
// parameter-keeping fit, else the kernel's curve approximation), its faces within the kernel's
// tolerance (GetApproxTol, which it clamps to 1e-4). The curve fits cost nothing: a hole across a
// bend comes back from a fold and an unfold round to 5e-13 instead of 1.8e-5, so the flat
// pattern's outline gets it back as one circle. The kernel's surface fits at 1e-6 cost up to
// twenty times as long (7 s instead of 0.3 s to unfold an R20 bend with two holes in it), so the
// faces stay at the kernel's tolerance. Where a curve fit at 1e-7 fails, the kernel's tolerance
// is the fallback.
constexpr double kCurveTolerance = 1e-7;

// Step 4: map the region, move the rest, then replace the mapped (volume) geometry by exact
// analytic geometry where the kernel can make it, else by NURBS within `tolerance` (faces) and
// kCurveTolerance (edges; `tolerance` where that fails).
template <class MapRegion, class MoveRegion>
SmStatus map_and_move(SmBrep& brep, Partition& p, const Transforms& t, MapRegion map_region, MoveRegion move,
                      double tolerance)
{
    const double tight = std::min(kCurveTolerance, tolerance);
    // a mapped (volume) curve as a B-spline within `tol` of it, keeping its parameters: deform.cpp's
    // fit on the knots of the original (quintic, 20 to 30 control points for a hole's arc across a
    // bend), else the kernel's (cubic, 193 control points at 1e-7)
    auto fit_curve = [&brep](SmEdge* edge, double tol) {
        SmCurve* curve = edge->GetCurve();
        if (!curve || curve->IsKindOf(SmBSplineCurve_TYPE))
            return true;
        const SmExtent1d ivl = edge->GetInterval();
        const SmCurve* base = curve->IsKindOf(SmCrvInVolume_TYPE) ? static_cast<SmCrvInVolume*>(curve)->GetCurve() : nullptr;
        if (SmBSplineCurve* fit = smlibpy::fit_curve_keeping_parameters(curve, base, ivl.GetMin(), ivl.GetMax(), tol))
        {
            brep.ReplaceCurve(edge, fit);
            return true;
        }
        SmTArray<double> breaks;
        const SmExtent1d nat = curve->GetNaturalInterval();
        breaks.Add(nat.GetMin());
        breaks.Add(nat.GetMax());
        double gap = 0.0;
        SmBSplineCurve* approx = nullptr;
        if (curve->ApproximateCurve(*brep.GetContext(), breaks, tol / 2.0, gap, approx, FALSE, TRUE) == SM_SUCCESS &&
            approx && gap <= tol)
        {
            brep.ReplaceCurve(edge, approx);
            return true;
        }
        delete approx;
        return false;
    };
    for (ULONG i = 0; i < p.in_faces.GetSize(); ++i)
        p.in_faces[i]->ShrinkGeometry();
    SmStatus st = map_region(p.in_faces, p.in_edges, p.in_vertices);
    if (st == SM_SUCCESS)
        st = move(t.before, p.before_faces, p.before_edges, p.before_vertices);
    if (st == SM_SUCCESS)
        st = move(t.inside, p.in_faces, p.in_edges, p.in_vertices);
    if (st == SM_SUCCESS)
        st = move(t.after, p.after_faces, p.after_edges, p.after_vertices);
    if (st != SM_SUCCESS)
        return st;

    SmStatus result = SM_SUCCESS;
    double achieved = 0.0;
    for (ULONG i = 0; i < p.in_faces.GetSize(); ++i)
    {
        SmFace* face = p.in_faces[i];
        SmSurface* surface = face->GetSurface();
        if (!surface || surface->IsKindOf(SmBSplineSurface_TYPE))
            continue;
        SmBSplineSurface* exact = nullptr;
        surface->MakeExactBSplineIfPossible(exact);
        if (exact)
        {
            if (exact->GetType() == SmCylinder_TYPE)
                move_cylinder_onto_face(exact, face);
            if (brep.ReplaceSurface(face, exact, FALSE, nullptr, FALSE) != SM_SUCCESS)
                result = SM_ERR;
        }
        else if (face->ApproximateWithBSpline(tolerance / 2.0, achieved) != SM_SUCCESS)
            result = SM_ERR;
    }
    for (ULONG i = 0; i < p.in_edges.GetSize(); ++i)
    {
        // an exact line or arc where the kernel can make one (as SmEdge::ApproximateWithBSpline does
        // first), else the exact image fitted within kCurveTolerance (the kernel's constrained
        // approximation follows the fitted faces: 1.2e-6 off a line across a bend), else the kernel's
        SmEdge* edge = p.in_edges[i];
        SmCurve* curve = edge->GetCurve();
        if (!curve || curve->IsKindOf(SmBSplineCurve_TYPE))
            continue;
        SmBSplineCurve* exact = nullptr;
        curve->MakeExactBSplineIfPossible(exact);
        if (exact)
        {
            if (brep.ReplaceCurve(edge, exact) != SM_SUCCESS)
                result = SM_ERR;
        }
        else if (!fit_curve(edge, tight) && edge->ApproximateWithBSpline(tolerance / 2.0, achieved) != SM_SUCCESS)
            result = SM_ERR;
    }
    if (result != SM_SUCCESS)
        return result;

    // SmEdge::ApproximateWithBSpline reports success also when its constrained approximation fails
    // and it replaces nothing (the bent arc of a hole that crosses the bend): approximate such a
    // curve keeping its parameterization (as the STEP export does). The exact lines, arcs and
    // planes build their NURBS data only when asked, and SmPlane::DropCurve copies such a curve and
    // reads the missing data: build it now.
    for (ULONG i = 0; i < p.in_edges.GetSize(); ++i)
    {
        SmEdge* edge = p.in_edges[i];
        if (!fit_curve(edge, tight))
            fit_curve(edge, tolerance);
        SmCurve* curve = edge->GetCurve();
        if (curve && curve->IsKindOf(SmBSplineCurve_TYPE) &&
            !static_cast<SmBSplineCurve*>(curve)->GetOrCreateGwNurbPointer())
            return SM_ERR_NOT_WITHIN_TOLERANCE;
    }
    for (ULONG i = 0; i < p.in_faces.GetSize(); ++i)
    {
        SmSurface* surface = p.in_faces[i]->GetSurface();
        if (surface && surface->IsKindOf(SmBSplineSurface_TYPE) &&
            !static_cast<SmBSplineSurface*>(surface)->GetOrCreateGwNurbPointer())
            return SM_ERR_NOT_WITHIN_TOLERANCE;
    }
    return SM_SUCCESS;
}

void check_mapped(SmStatus status, const char* what)
{
    if (status == SM_ERR_NOT_WITHIN_TOLERANCE)
        fail(status, std::string(what) + ": the bend region came out degenerate (a curve or surface without "
                                         "NURBS data)");
    check(status, what);
}

void check_bend_input(double angle, double radius, double k_factor, double thickness, double length)
{
    if (!(angle > 0.0 && angle <= 180.0))
        throw std::invalid_argument("the bend angle must be in (0, 180] degrees");
    if (!(radius > 0.0))
        throw std::invalid_argument("the bend radius must be positive");
    if (!(thickness > 0.0))
        throw std::invalid_argument("the thickness must be positive");
    if (!(k_factor >= 0.0 && k_factor <= 1.0))
        throw std::invalid_argument("the K-factor must be between 0 and 1");
    if (!(length > 0.0))
        throw std::invalid_argument("the bend length must be positive");
}

// Unit vectors that are perpendicular to each other.
void check_frame(const SmVector3d& axis, const SmVector3d& direction)
{
    if (std::abs(axis.Length() - 1.0) > 1e-9 || std::abs(direction.Length() - 1.0) > 1e-9 ||
        std::abs(axis.Dot(direction)) > 1e-9)
        throw std::invalid_argument("axis and direction must be perpendicular unit vectors");
}

}  // namespace

namespace smlibpy {

BendFaces sheet_bend(SmBrep* brep, double angle, double radius, double k_factor, double thickness,
                     const std::vector<double>& axis_point, const std::vector<double>& axis,
                     const std::vector<double>& direction, double length)
{
    check_bend_input(angle, radius, k_factor, thickness, length);
    SmVector3d a = vec(axis), d = vec(direction);
    check_frame(a, d);
    double neutral = radius + k_factor * thickness;
    std::unique_ptr<SmSpaceBend> bend(new (brep->GetContext()) SmSpaceBend(
        *brep, angle, neutral, vec(axis_point), a, d, SmExtent1d(0.0, length), thickness, k_factor,
        SM_BO_FIXED_BEFORE_BENDING));
    Partition p;
    check(partition(*brep, bend->GetBendDomain(), bend->GetStartBendBoundary(), bend->GetStopBendBoundary(), p),
          "sheet metal bend: classifying the bend region");
    check_partition(p, "sheet metal bend");
    align_planes(*brep, p.in_faces, a, d);
    Transforms t{bend->GetBeforeBendTransform(), bend->GetInsideBendTransform(), bend->GetAfterBendTransform()};
    auto map_region = [&](const SmTArray<SmFace*>& f, const SmTArray<SmEdge*>& e, const SmTArray<SmVertex*>& v) {
        std::unique_ptr<SmBendVolume> volume(bend->CreateBendVolume(*brep->GetContext()));
        return bend->BendTopology(*volume, *brep, f, e, v);
    };
    auto move = [&](const SmAxis2Placement& m, const SmTArray<SmFace*>& f, const SmTArray<SmEdge*>& e,
                    const SmTArray<SmVertex*>& v) { return bend->TransformTopology(m, *brep, f, e, v); };
    check_mapped(map_and_move(*brep, p, t, map_region, move, bend->GetApproxTol()), "sheet metal bend");
    return {p.in_faces.GetSize(), p.before_faces.GetSize(), p.after_faces.GetSize()};
}

int sheet_unbend(SmBrep* brep, double angle, double radius, double k_factor, double thickness,
                 const std::vector<double>& axis_point, const std::vector<double>& axis,
                 const std::vector<double>& direction, double length, SmFace* anchor)
{
    check_bend_input(angle, radius, k_factor, thickness, length);
    SmVector3d a = vec(axis), d = vec(direction);
    check_frame(a, d);
    double neutral = radius + k_factor * thickness;
    auto make = [&](SmUnbendOrientTYPE orient) {
        return std::unique_ptr<SmSpaceUnbend>(new (brep->GetContext()) SmSpaceUnbend(
            *brep, angle, neutral, vec(axis_point), a, d, SmExtent1d(0.0, length), thickness, k_factor, orient));
    };
    auto unbend = make(SM_UO_FIXED_BEFORE_UNBENDING);
    Partition p;
    check(partition(*brep, unbend->GetUnbendDomain(), unbend->GetStartUnbendBoundary(),
                    unbend->GetStopUnbendBoundary(), p),
          "sheet metal unbend: classifying the bend region");
    check_partition(p, "sheet metal unbend");
    ULONG found = 0;
    int fixed = -1;  // the part before the region stays
    if (anchor && p.after_faces.FindElement(anchor, found))
        fixed = 1;
    else if (anchor && !p.before_faces.FindElement(anchor, found))
        fail(SM_ERR_INVALID_INPUT, "sheet metal unbend: the anchor face is on neither side of the bend region");
    // The unbend ignores the orientation argument of its Get*Transform methods; an object
    // built for the other orientation supplies the transforms.
    auto oriented = fixed > 0 ? make(SM_UO_FIXED_AFTER_UNBENDING) : nullptr;
    SmSpaceUnbend* u = oriented ? oriented.get() : unbend.get();
    Transforms t{u->GetBeforeUnbendTransform(), u->GetInsideUnbendTransform(), u->GetAfterUnbendTransform()};
    auto map_region = [&](const SmTArray<SmFace*>& f, const SmTArray<SmEdge*>& e, const SmTArray<SmVertex*>& v) {
        std::unique_ptr<SmUnbendVolume> volume(unbend->CreateUnbendVolume(*brep->GetContext()));
        return unbend->UnbendTopology(*volume, *brep, f, e, v);
    };
    auto move = [&](const SmAxis2Placement& m, const SmTArray<SmFace*>& f, const SmTArray<SmEdge*>& e,
                    const SmTArray<SmVertex*>& v) { return unbend->TransformTopology(m, *brep, f, e, v); };
    check_mapped(map_and_move(*brep, p, t, map_region, move, unbend->GetApproxTol()), "sheet metal unbend");
    return fixed;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_sheetmetal(py::module_ m)
{
    m.def("bend", [](SmBrep* brep, double angle, double radius, double k_factor, double thickness,
                     const std::vector<double>& axis_point, const std::vector<double>& axis,
                     const std::vector<double>& direction, double length) {
        const smlibpy::BendFaces f =
            smlibpy::sheet_bend(brep, angle, radius, k_factor, thickness, axis_point, axis, direction, length);
        return py::make_tuple(f.in, f.before, f.after);
    }, py::arg("brep"), py::arg("angle"), py::arg("radius"), py::arg("k_factor"), py::arg("thickness"),
       py::arg("axis_point"), py::arg("axis"), py::arg("direction"), py::arg("length"),
       "Bend a Brep in place by `angle` degrees about the axis through `axis_point` along `axis`, with inside "
       "radius `radius`. `direction` points from the axis to the sheet (perpendicular to it); the region spans "
       "[0, length] along the axis from `axis_point`. The part on the side of cross(direction, axis) stays in "
       "place. Returns the numbers of faces in, before and after the region.");

    m.def("unbend", &smlibpy::sheet_unbend,
       py::arg("brep"), py::arg("angle"), py::arg("radius"), py::arg("k_factor"), py::arg("thickness"),
       py::arg("axis_point"), py::arg("axis"), py::arg("direction"), py::arg("length"), py::arg("anchor") = nullptr,
       "Unbend a Brep in place: the inverse of `bend`, with `direction` pointing from the axis to the middle "
       "of the bent region. The side that holds the face `anchor` stays in place (without one, the side of "
       "cross(direction, axis)). Returns -1 if the side of cross(direction, axis) stayed, +1 if the other one.");
}
#endif  // SMLIBPY_PYTHON
