// SPDX-License-Identifier: Apache-2.0
//
// Face edits (`smlibpy._core.face_edit`): direct editing of a solid's faces.
//
// Each edited face gets a new surface: its own moved by a rigid motion (push-pull, moving a hole or
// a boss) and then offset along its outward normal (push-pull by a distance, a hole or a boss
// resized, a wall made thicker). SmBrep::LocalOperation then rebuilds the Brep from the new surfaces
// and the extended or trimmed surfaces of the faces around them, as face_draft.cpp does for drafts.
// Its rules (face_draft.cpp lists them) hold here too:
//   * it does not intersect faces that meet tangentially: it lifts the parameter curve of the old
//     edge onto the new surface, so the new surface needs the parameters of the old one. A moved
//     copy of the surface has them, and so has its offset: the kernel's own CreateOffsetSurface
//     keeps them (the point (u, v) of the offset is the point (u, v) of the surface moved along its
//     normal: planes move, cylinders, cones, spheres and tori change their radius, other surfaces
//     become offset surfaces of themselves);
//   * a face that touches an edited face tangentially must be edited with it, with the same move or
//     distance (a slot's halves, a round and the walls it joins), or the kernel may return a closed
//     body whose edges leave its faces: such faces are added (`grow`) or the edit is refused, and the
//     gaps between the vertices, edges and faces of the result are measured;
//   * it drops the inner shells of a solid (its cavities), edited or not: a part with a cavity is
//     refused ('void');
//   * it edits the Brep in place, also when it fails: it works on a copy.

#include "kernel.h"
#include "face_edit.h"

#include <SmApiGeneral.h>
#include <SmCopyBrepMap.h>
#include <SmCircle.h>
#include <SmCone.h>
#include <SmLine.h>
#include <SmPlane.h>
#include <SmSphere.h>

#include <algorithm>
#include <cmath>
#include <deque>
#include <memory>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

double dot(const SmVector3d& a, const SmVector3d& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

SmVector3d cross(const SmVector3d& a, const SmVector3d& b)
{
    return SmVector3d(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

double length(const SmVector3d& a) { return std::sqrt(dot(a, a)); }

SmVector3d scaled(const SmVector3d& a, double f) { return SmVector3d(a.x * f, a.y * f, a.z * f); }

// Why a face cannot be edited (the Python side words the message).
struct Refusal
{
    std::string reason;
};

// What happens to one face: a rigid motion (none when `moves` is false), then an offset.
struct Edit
{
    bool moves = false;
    double m[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
    double distance = 0.0;

    bool same(const Edit& o) const
    {
        if (std::fabs(distance - o.distance) > 1e-12 * (1.0 + std::fabs(distance)))
            return false;
        for (int i = 0; i < 16; ++i)
            if (std::fabs(m[i] - o.m[i]) > 1e-12 * (1.0 + std::fabs(m[i])))
                return false;
        return true;
    }

    SmAxis2Placement placement() const
    {
        return SmAxis2Placement(SmPoint3d(m[12], m[13], m[14]), SmVector3d(m[0], m[1], m[2]), SmVector3d(m[4], m[5], m[6]));
    }
};

double outward_sign(const SmFace* face)
{
    SmBrep* brep = face->GetBrep();
    SmFaceuse* up = face->GetUpwardFaceuse();
    if (brep && up && up->GetShell() && brep->GetInfiniteRegion() != up->GetShell()->GetRegion())
        return -1.0;
    return 1.0;
}

bool uv_inside(const SmFace* face, const SmPoint2d& uv)
{
    SmZoneTol3d tol = SmTol::GetZoneTol3d(face);
    SmPointClassification pc(tol, face->GetContext());
    if (face->PointClassify(uv, tol, FALSE, TRUE, pc) != SM_SUCCESS)
        return false;
    return pc.GetPointClass() == SM_PC_FACE;
}

// A parameter inside the face, as near the middle of its parameter box as a grid finds.
bool interior_uv(const SmFace* face, SmPoint2d& uv)
{
    SmExtent2d dom = face->GetUVDomain();
    SmPoint2d mid = dom.GetMid();
    if (uv_inside(face, mid))
    {
        uv = mid;
        return true;
    }
    const int n = 12;
    double best = SM_BIG_DOUBLE;
    bool found = false;
    for (int i = 1; i < n; ++i)
        for (int j = 1; j < n; ++j)
        {
            SmPoint2d p(dom.GetMin().x + (dom.GetMax().x - dom.GetMin().x) * i / n,
                        dom.GetMin().y + (dom.GetMax().y - dom.GetMin().y) * j / n);
            double dist = (p - mid).Length();
            if (dist < best && uv_inside(face, p))
            {
                best = dist;
                uv = p;
                found = true;
            }
        }
    return found;
}

// The matrix as an Edit's move; throws for anything but a rotation and a translation.
Edit move_of(const double* m)
{
    Edit e;
    SmVector3d x(m[0], m[1], m[2]), y(m[4], m[5], m[6]), z(m[8], m[9], m[10]);
    const double eps = 1e-9;
    bool rigid = std::fabs(length(x) - 1) <= eps && std::fabs(length(y) - 1) <= eps && std::fabs(length(z) - 1) <= eps &&
                 std::fabs(dot(x, y)) <= eps && std::fabs(dot(y, z)) <= eps && std::fabs(dot(z, x)) <= eps &&
                 dot(cross(x, y), z) > 0 && m[3] == 0 && m[7] == 0 && m[11] == 0 && m[15] == 1;
    for (int i = 0; i < 16; ++i)
        rigid = rigid && std::isfinite(m[i]);
    if (!rigid)
        throw std::invalid_argument("a move must be a rotation and a translation (no scale, no mirror)");
    for (int i = 0; i < 16; ++i)
    {
        e.m[i] = m[i];
        e.moves = e.moves || m[i] != (i % 5 == 0 ? 1.0 : 0.0);
    }
    return e;
}

// The new surface of an edited face (the caller owns it).
SmSurface* new_surface(const SmFace* face, const Edit& edit, double tol)
{
    const SmSurface* surface = face->GetSurface();
    SmPoint2d uv;
    if (surface == nullptr || !interior_uv(face, uv))
        throw Refusal{"invalid"};
    SmSurface* moved = nullptr;
    if (edit.moves)
    {
        if (surface->Copy(ctx(), moved) != SM_SUCCESS || moved == nullptr)
            throw Refusal{"copy"};
        if (moved->Transform(edit.placement()) != SM_SUCCESS)
        {
            delete moved;
            throw Refusal{"copy"};
        }
    }
    if (edit.distance == 0.0)
    {
        if (moved != nullptr)
            return moved;
        SmSurface* copy = nullptr;  // (an edit that changes nothing: the face's own surface, copied)
        if (surface->Copy(ctx(), copy) != SM_SUCCESS || copy == nullptr)
            throw Refusal{"copy"};
        return copy;
    }
    std::unique_ptr<SmSurface> owner(moved);
    const SmSurface* base = moved ? moved : surface;
    SmPoint3d p;
    SmVector3d n;
    if (base->EvaluatePoint(uv, p) != SM_SUCCESS || base->EvaluateNormal(uv, TRUE, TRUE, n) != SM_SUCCESS || !(length(n) > 0))
        throw Refusal{"invalid"};
    const double sign = outward_sign(face);
    const SmVector3d outward = scaled(n, sign / length(n));
    SmSurface* offset = nullptr;
    if (base->CreateOffsetSurface(ctx(), sign * edit.distance, SmApproxTol3d(tol / 10.0), offset) != SM_SUCCESS)
    {
        delete offset;
        throw Refusal{"offset"};
    }
    if (offset == nullptr)
        throw Refusal{"collapse"};  // a radius that would reach 0 (a hole or a sphere shrunk to nothing)
    // The offset keeps the parameters: its point at uv is the face's moved along the normal.
    SmPoint3d q;
    const SmPoint3d expect = p + scaled(outward, edit.distance);
    if (offset->EvaluatePoint(uv, q) != SM_SUCCESS || length(q - expect) > 1e-6 * (1.0 + std::fabs(edit.distance)))
    {
        delete offset;
        throw Refusal{"offset"};
    }
    return offset;
}

// A line with the parameters of `curve`, if the curve runs straight at constant speed (a
// straight cubic, as LocalOperation makes them), else null. (As face_draft.cpp.)
SmCurve* as_line(const SmCurve* curve)
{
    SmExtent1d ivl = curve->GetNaturalInterval();
    double t0 = ivl.GetMin(), t1 = ivl.GetMax();
    SmPoint3d p0, p1;
    if (!(t1 > t0) || curve->EvaluatePoint(t0, p0) != SM_SUCCESS || curve->EvaluatePoint(t1, p1) != SM_SUCCESS)
        return nullptr;
    SmVector3d span = p1 - p0;
    double len = length(span);
    if (!(len > 0))
        return nullptr;
    for (int i = 1; i < 8; ++i)
    {
        double f = i / 8.0;
        SmPoint3d p;
        if (curve->EvaluatePoint(t0 + f * (t1 - t0), p) != SM_SUCCESS || length(p - (p0 + scaled(span, f))) > 1e-12 * (1.0 + len))
            return nullptr;
    }
    SmVector3d direction = scaled(span, 1.0 / len);
    return new (ctx()) SmLine(p0 - scaled(direction, t0 * len / (t1 - t0)), direction, ivl, len / (t1 - t0), 3);
}

// The circle where a plane meets a cylinder or cone whose axis runs along the plane's normal, or a
// sphere: the edge between a face pulled along a cylinder and the extended cylinder, which the kernel
// fits with a B-spline (to about 1e-7 of the radius). False if the edge is not such an edge.
bool exact_circle(SmEdge* edge, SmPoint3d& center, SmVector3d& normal, double& radius)
{
    SmTArray<SmFace*> faces;
    edge->GetFaces(faces);
    if (faces.GetSize() != 2 || faces[0] == faces[1])
        return false;
    for (int k = 0; k < 2; ++k)
    {
        const SmSurface* plane = faces[k]->GetSurface();
        const SmSurface* other = faces[1 - k]->GetSurface();
        if (plane == nullptr || other == nullptr || !plane->IsKindOf(SmPlane_TYPE))
            continue;
        const SmAxis2Placement& pp = static_cast<const SmPlane*>(plane)->GetPosition();
        const SmPoint3d p0 = pp.GetOriginRef();
        SmVector3d n = cross(pp.GetXAxisRef(), pp.GetYAxisRef());
        if (!(length(n) > 0))
            return false;
        n = scaled(n, 1.0 / length(n));
        if (other->IsKindOf(SmCone_TYPE))
        {
            const SmCone* cone = static_cast<const SmCone*>(other);
            const SmAxis2Placement& pos = cone->GetPosition();
            SmVector3d axis = cross(pos.GetXAxisRef(), pos.GetYAxisRef());
            if (!(length(axis) > 0))
                return false;
            axis = scaled(axis, 1.0 / length(axis));
            if (length(cross(axis, n)) > 1e-9)
                return false;
            const SmPoint3d origin = pos.GetOriginRef();
            const double along = dot(p0 - origin, n) / dot(axis, n);
            center = origin + scaled(axis, along);
            radius = cone->GetRadius(along);
            normal = n;
            return radius > 0;
        }
        if (other->IsKindOf(SmSphere_TYPE))
        {
            const SmSphere* sphere = static_cast<const SmSphere*>(other);
            const SmPoint3d c = sphere->GetOrigin();
            const double h = dot(c - p0, n), r = sphere->GetRadius();
            if (!(r * r - h * h > 0))
                return false;
            center = c - scaled(n, h);
            radius = std::sqrt(r * r - h * h);
            normal = n;
            return true;
        }
        return false;
    }
    return false;
}

// The edge's curve as an exact arc or circle (see exact_circle), from its start to its end and the
// same way round, or null. The curve must lie on the circle within 1e-5 of its radius.
SmCurve* as_circle(SmEdge* edge, const SmCurve* curve)
{
    SmPoint3d center;
    SmVector3d normal;
    double radius = 0.0;
    if (!exact_circle(edge, center, normal, radius))
        return nullptr;
    SmExtent1d ivl = curve->GetNaturalInterval();
    const double t0 = ivl.GetMin(), t1 = ivl.GetMax();
    if (!(t1 > t0))
        return nullptr;
    // on the circle: in its plane and at its radius from its center
    auto onto = [&](const SmPoint3d& p, SmPoint3d& q) {
        SmVector3d v = p - center;
        v = v - scaled(normal, dot(v, normal));
        const double l = length(v);
        if (!(l > 0))
            return false;
        q = center + scaled(v, radius / l);
        return length(q - p) <= 1e-5 * (1.0 + radius);
    };
    SmPoint3d samples[17];
    for (int i = 0; i <= 16; ++i)
    {
        SmPoint3d p;
        if (curve->EvaluatePoint(t0 + (t1 - t0) * i / 16.0, p) != SM_SUCCESS || !onto(p, samples[i]))
            return nullptr;
    }
    const bool closed = length(samples[0] - samples[16]) <= 1e-9 * (1.0 + radius);
    SmCircle* circle = closed ? new (ctx()) SmCircle(samples[0], samples[5], samples[11], 3, TRUE, &ctx())
                              : new (ctx()) SmCircle(samples[0], samples[8], samples[16], 3, FALSE, &ctx());
    // the same way round (the circle's parameters are not the curve's: its point a third of the way
    // lies near the curve's, not on it), and from the same start
    SmExtent1d civl = circle->GetNaturalInterval();
    SmPoint3d a, b, m;
    if (circle->EvaluatePoint(civl.GetMin(), a) != SM_SUCCESS || circle->EvaluatePoint(civl.GetMax(), b) != SM_SUCCESS ||
        circle->EvaluatePoint(civl.GetMin() + (civl.GetMax() - civl.GetMin()) * (closed ? 5.0 : 8.0) / 16.0, m) != SM_SUCCESS ||
        length(a - samples[0]) > 1e-9 * (1.0 + radius) || length(b - samples[closed ? 0 : 16]) > 1e-9 * (1.0 + radius) ||
        length(m - samples[closed ? 5 : 8]) > 0.25 * radius)
    {
        delete circle;
        return nullptr;
    }
    return circle;
}

// Lines and circles among the edges the kernel rebuilt as B-splines get their exact analytic curve
// back, keeping the parameters of the B-spline (as face_draft.cpp); a fitted B-spline where a plane
// meets a cylinder, cone or sphere becomes the exact circle.
long restore_analytic_curves(SmBrep* brep)
{
    SmTArray<SmEdge*> edges;
    brep->GetEdges(edges);
    long changed = 0;
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        SmCurve* curve = edges[i]->GetCurve();
        if (curve == nullptr || curve->GetType() != SmBSplineCurve_TYPE)
            continue;
        SmCurve* exact = nullptr;
        if (curve->CreateAnalyticCurve(ctx(), curve->GetNaturalInterval(), exact) != SM_SUCCESS || exact == nullptr)
            exact = as_line(curve);
        if (exact == nullptr)
            exact = as_circle(edges[i], curve);
        if (exact == nullptr)
            continue;
        if (brep->ReplaceCurve(edges[i], exact) == SM_SUCCESS)
            ++changed;
        else
            delete exact;
    }
    return changed;
}

// The largest gaps between the vertices and the edges and faces they lie on.
std::pair<double, double> gaps(SmBrep* brep)
{
    SmBoolean violated = FALSE;
    double trim = 0.0, vertex_edge = 0.0, vertex_face = 0.0;
    if (brep->ValidateAndUpdateTolerances(TRUE, violated, trim, vertex_edge, vertex_face) != SM_SUCCESS)
        return {SM_BIG_DOUBLE, SM_BIG_DOUBLE};
    return {vertex_edge, vertex_face};
}

}  // namespace

namespace smlibpy {

FaceEdit edit_faces(const SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<double>& matrices,
                    const std::vector<double>& distances, bool grow, double tangency_deg)
{
    if (brep == nullptr)
        throw std::invalid_argument("brep is None");
    const size_t n = faces.size();
    if (!(matrices.empty() || matrices.size() == 16 || matrices.size() == 16 * n))
        throw std::invalid_argument("matrices must hold 16 numbers, or 16 for each face");
    if (!(distances.empty() || distances.size() == 1 || distances.size() == n))
        throw std::invalid_argument("distances must hold one number, or one for each face");
    std::vector<SmFace*> edited;
    std::vector<Edit> edits;
    for (size_t i = 0; i < n; ++i)
    {
        if (faces[i] == nullptr || faces[i]->GetBrep() != brep)
            throw std::invalid_argument("every face must belong to the brep");
        if (std::find(edited.begin(), edited.end(), faces[i]) != edited.end())
            throw std::invalid_argument("a face is given twice");
        Edit e;
        if (!matrices.empty())
            e = move_of(&matrices[matrices.size() == 16 ? 0 : 16 * i]);
        if (!distances.empty())
            e.distance = distances[distances.size() == 1 ? 0 : i];
        if (!std::isfinite(e.distance))
            throw std::invalid_argument("distances must be finite");
        edited.push_back(faces[i]);
        edits.push_back(e);
    }

    smlibpy::FaceEdit d;
    const double tol = std::max(static_cast<double>(brep->GetTolerance()), 1e-9);
    d.tolerance = tol;

    // LocalOperation drops the inner shells of a solid (its cavities), edited or not.
    {
        SmTArray<SmRegion*> regions;
        brep->GetRegions(regions);
        for (ULONG i = 0; i < regions.GetSize(); ++i)
        {
            if (regions[i] == brep->GetInfiniteRegion())
                continue;
            SmTArray<SmShell*> shells;
            regions[i]->GetShells(shells);
            if (shells.GetSize() > 1)
            {
                d.error = "void";
                return d;
            }
        }
    }

    // Faces that meet an edited face tangentially: edited with it (grow), or refused. Two edited
    // faces that meet so must be edited alike.
    std::deque<size_t> todo;
    for (size_t i = 0; i < edited.size(); ++i)
        todo.push_back(i);
    while (!todo.empty())
    {
        const size_t i = todo.front();
        todo.pop_front();
        SmTArray<SmEdge*> edges;
        edited[i]->GetEdges(edges);
        for (ULONG j = 0; j < edges.GetSize(); ++j)
        {
            SmTArray<SmFace*> adjacent;
            edges[j]->GetFaces(adjacent);
            for (ULONG k = 0; k < adjacent.GetSize(); ++k)
            {
                SmFace* other = adjacent[k];
                if (other == edited[i] || !edges[j]->IsTangentEdge(tangency_deg))
                    continue;
                auto at = std::find(edited.begin(), edited.end(), other);
                if (at != edited.end())
                {
                    if (!edits[at - edited.begin()].same(edits[i]))
                    {
                        d.error = "conflict";
                        d.face = static_cast<long>(i);
                        d.other = other;
                        return d;
                    }
                    continue;
                }
                if (!grow)
                {
                    d.error = "tangent";
                    d.face = static_cast<long>(i);
                    d.other = other;
                    return d;
                }
                edited.push_back(other);
                edits.push_back(edits[i]);
                d.added.push_back(other);
                todo.push_back(edited.size() - 1);
            }
        }
    }

    // A face that meets no other face (a sphere's void, a body of one face): the kernel drops it.
    for (size_t i = 0; i < edited.size(); ++i)
    {
        SmTArray<SmEdge*> edges;
        edited[i]->GetEdges(edges);
        bool meets = false;
        for (ULONG j = 0; j < edges.GetSize() && !meets; ++j)
        {
            SmTArray<SmFace*> adjacent;
            edges[j]->GetFaces(adjacent);
            for (ULONG k = 0; k < adjacent.GetSize(); ++k)
                meets = meets || adjacent[k] != edited[i];
        }
        if (!meets)
        {
            d.error = "alone";
            d.face = static_cast<long>(i);
            return d;
        }
    }

    // The new surfaces, from the faces of the given Brep (its copy has the same geometry).
    SmTArray<SmSurface*> surfaces;
    auto drop_surfaces = [&]() {
        for (ULONG i = 0; i < surfaces.GetSize(); ++i)
            delete surfaces[i];
        surfaces.RemoveAll();
    };
    for (size_t i = 0; i < edited.size(); ++i)
    {
        try
        {
            surfaces.Add(new_surface(edited[i], edits[i], tol));
        }
        catch (const Refusal& r)
        {
            drop_surfaces();
            d.error = r.reason;
            d.face = static_cast<long>(i);
            return d;
        }
    }

    // LocalOperation edits the Brep it is given: a copy, with the faces of the copy.
    SmCopyBrepMap reverse;  // original -> copy
    SmBrep* copy = new (ctx()) SmBrep(*brep, nullptr, &reverse, TRUE, FALSE);
    SmTArray<SmFace*> targets;
    for (SmFace* f : edited)
        targets.Add(static_cast<SmFace*>(reverse.GetAt(f)));
    auto g0 = gaps(copy);
    d.has_gaps_before = true;
    d.gaps_before[0] = g0.first, d.gaps_before[1] = g0.second;

    // From here on the kernel owns the new surfaces (it puts them into the faces it builds).
    SmStatus status = copy->LocalOperation(targets, surfaces);
    if (status != SM_SUCCESS)
    {
        delete copy;
        d.error = "kernel";
        return d;
    }
    if (!copy->IsManifoldSolid())
    {
        delete copy;
        d.error = "open";
        return d;
    }
    d.has_restored = true;
    d.restored = restore_analytic_curves(copy);
    auto g = gaps(copy);
    d.has_gaps = true;
    d.gaps[0] = g.first, d.gaps[1] = g.second;
    d.brep = copy;
    return d;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_face_edit(py::module_& root)
{
    py::module_ m = root.def_submodule("face_edit", "smlibpy: faces moved and offset (SmBrep::LocalOperation).");

    m.def("edit_faces", [](const SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<double>& matrices,
                           const std::vector<double>& distances, bool grow, double tangency_deg) {
        const smlibpy::FaceEdit r = smlibpy::edit_faces(brep, faces, matrices, distances, grow, tangency_deg);
        py::dict d;
        d["brep"] = r.brep ? py::cast(r.brep, py::return_value_policy::take_ownership) : py::object(py::none());
        d["error"] = r.error.empty() ? py::object(py::none()) : py::object(py::str(r.error));
        d["face"] = r.face;
        d["other"] = r.other ? py::cast(r.other, py::return_value_policy::reference) : py::object(py::none());
        py::list added;
        for (SmFace* f : r.added)
            added.append(py::cast(f, py::return_value_policy::reference));
        d["added"] = added;
        d["gaps"] = r.has_gaps ? py::object(py::make_tuple(r.gaps[0], r.gaps[1])) : py::object(py::none());
        d["gaps_before"] = r.has_gaps_before ? py::object(py::make_tuple(r.gaps_before[0], r.gaps_before[1]))
                                             : py::object(py::none());
        d["tolerance"] = r.tolerance;
        if (r.has_restored)
            d["restored"] = r.restored;
        return d;
    }, py::arg("brep"), py::arg("faces"), py::arg("matrices") = std::vector<double>(),
          py::arg("distances") = std::vector<double>(), py::arg("grow") = false, py::arg("tangency_deg") = 1.0,
          "Move faces of a copy of a solid by a rigid motion (`matrices`: 16 numbers for all faces or for each, "
          "a row-vector matrix as transform_brep takes it) and offset them along their outward normals "
          "(`distances`: one for all or one each); the faces around them are extended or trimmed "
          "(SmBrep::LocalOperation). Faces meeting an edited face at an edge whose normals differ by less than "
          "`tangency_deg` are edited with it when `grow` is true, and refused otherwise. Returns {'brep': the "
          "edited copy or None, 'error': None or why not ('void', 'tangent', 'conflict', 'alone', "
          "'collapse', 'offset', 'invalid', 'copy', 'kernel', 'open'), 'face': the index of the face it is about (in faces, then in "
          "added), 'other': for 'tangent' and 'conflict' the face that meets it tangentially, 'added': the faces "
          "grow added, 'gaps' and 'gaps_before': (largest vertex-edge gap, largest vertex-face gap) of the "
          "result and of the given Brep, 'tolerance': the Brep's tolerance, 'restored': the number of B-spline "
          "edges that became lines and circles}.");
}
#endif  // SMLIBPY_PYTHON
