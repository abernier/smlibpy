// SPDX-License-Identifier: Apache-2.0
//
// Sheet metal: exact bending and unbending of Breps (`smlibpy._core.sheetmetal`).
//
// The kernel describes a bend with SmSpaceBend / SmSpaceUnbend: a bend axis, the bend angle,
// the inside radius, the sheet thickness and the K-factor (neutral radius = radius + K * t).
// Everything in the bend region (a strip of the bend allowance's width in the flat, a cylinder
// sector when bent) is mapped through an exact bend volume; everything before and after it is
// moved rigidly. Planes parallel to the sheet become exact cylinders, lines exact lines and
// circles; other geometry crossing the region becomes NURBS within 1e-4.
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
//     unbounded interval (SmExtent1d::Init) evaluates to SM_BIG_DOUBLE.
// The bindings therefore always place the axis point at the start of the region and pass the
// interval [0, length].

#include "ext.h"

#include <SmApiGeneral.h>
#include <SmBendVolume.h>
#include <SmCylinder.h>
#include <SmMerge.h>
#include <SmSpaceBend.h>
#include <SmSpaceUnbend.h>
#include <SmTopologyTraverser.h>
#include <SmUnbendVolume.h>

#include <algorithm>
#include <cmath>
#include <memory>

namespace
{

void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(status, what, __FILE__, __LINE__);
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
                lo = std::min(lo, (p - origin).Dot(axis));
        }
    }
    if (lo == SM_BIG_DOUBLE || std::abs(lo) < 1e-12)
        return;
    SmAxis2Placement shift(origin, x, y, origin + lo * axis, x, y);
    cylinder->Transform(shift);
}

// Step 4: map the region, move the rest, then replace the mapped (volume) geometry by exact
// analytic geometry where the kernel can make it, else by NURBS within `tolerance`.
template <class MapRegion, class MoveRegion>
SmStatus map_and_move(SmBrep& brep, Partition& p, const Transforms& t, MapRegion map_region, MoveRegion move,
                      double tolerance)
{
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
        if (p.in_edges[i]->ApproximateWithBSpline(tolerance / 2.0, achieved) != SM_SUCCESS)
            result = SM_ERR;
    }
    return result;
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

void bind_sheetmetal(py::module_ m)
{
    m.def("bend", [](SmBrep* brep, double angle, double radius, double k_factor, double thickness,
                     const std::vector<double>& axis_point, const std::vector<double>& axis,
                     const std::vector<double>& direction, double length) {
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
        if (p.in_faces.GetSize() == 0)
            check(SM_ERR_INVALID_INPUT, "sheet metal bend: no material in the bend region");
        Transforms t{bend->GetBeforeBendTransform(), bend->GetInsideBendTransform(), bend->GetAfterBendTransform()};
        auto map_region = [&](const SmTArray<SmFace*>& f, const SmTArray<SmEdge*>& e, const SmTArray<SmVertex*>& v) {
            std::unique_ptr<SmBendVolume> volume(bend->CreateBendVolume(*brep->GetContext()));
            return bend->BendTopology(*volume, *brep, f, e, v);
        };
        auto move = [&](const SmAxis2Placement& m, const SmTArray<SmFace*>& f, const SmTArray<SmEdge*>& e,
                        const SmTArray<SmVertex*>& v) { return bend->TransformTopology(m, *brep, f, e, v); };
        check(map_and_move(*brep, p, t, map_region, move, bend->GetApproxTol()), "sheet metal bend");
        return py::make_tuple(p.in_faces.GetSize(), p.before_faces.GetSize(), p.after_faces.GetSize());
    }, py::arg("brep"), py::arg("angle"), py::arg("radius"), py::arg("k_factor"), py::arg("thickness"),
       py::arg("axis_point"), py::arg("axis"), py::arg("direction"), py::arg("length"),
       "Bend a Brep in place by `angle` degrees about the axis through `axis_point` along `axis`, with inside "
       "radius `radius`. `direction` points from the axis to the sheet (perpendicular to it); the region spans "
       "[0, length] along the axis from `axis_point`. The part on the side of cross(direction, axis) stays in "
       "place. Returns the numbers of faces in, before and after the region.");

    m.def("unbend", [](SmBrep* brep, double angle, double radius, double k_factor, double thickness,
                       const std::vector<double>& axis_point, const std::vector<double>& axis,
                       const std::vector<double>& direction, double length, SmFace* anchor) {
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
        if (p.in_faces.GetSize() == 0)
            check(SM_ERR_INVALID_INPUT, "sheet metal unbend: no material in the bend region");
        ULONG found = 0;
        int fixed = -1;  // the part before the region stays
        if (anchor && p.after_faces.FindElement(anchor, found))
            fixed = 1;
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
        check(map_and_move(*brep, p, t, map_region, move, unbend->GetApproxTol()), "sheet metal unbend");
        return fixed;
    }, py::arg("brep"), py::arg("angle"), py::arg("radius"), py::arg("k_factor"), py::arg("thickness"),
       py::arg("axis_point"), py::arg("axis"), py::arg("direction"), py::arg("length"), py::arg("anchor") = nullptr,
       "Unbend a Brep in place: the inverse of `bend`, with `direction` pointing from the axis to the middle "
       "of the bent region. The side that holds the face `anchor` stays in place (without one, the side of "
       "cross(direction, axis)). Returns -1 if that side stayed, +1 if the other side stayed.");
}
