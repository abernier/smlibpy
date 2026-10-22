// SPDX-License-Identifier: Apache-2.0
//
// Face drafts (`smlibpy._core.face_draft`).
//
// A draft tilts faces of a solid by the draft angle about the line where each one meets the
// neutral plane, so that a molded or cast part comes out of its mold. The plane's normal is the
// pull direction: a positive angle turns the outward normal of a face towards it. A plane is
// turned about that line; a cylinder or cone whose axis is perpendicular to the neutral plane
// becomes the cone that keeps its circle in the neutral plane. SmBrep::LocalOperation then
// rebuilds the Brep from the new surfaces of the drafted faces and the extended surfaces of the
// others; the lines and circles among its new edges get their analytic curves back.
//
// LocalOperation has rules the kernel does not document (found by AWV's ClassCAD, whose draft
// feature is built on the same call):
//   * it does not intersect faces that meet tangentially: it lifts the parameter curve of the
//     old edge onto the new surface. So the new surface needs the parameters of the old one (the
//     point (u, v) of the new surface is where the point (u, v) of the old one moves to): a cone
//     is made by moving the control points of a NURBS copy of the face's surface;
//   * it compares the normal in the middle of the new surface's natural domain with the face's
//     and reverses the new surface in u if they oppose: that NURBS copy covers just the face;
//   * a face that touches a drafted face tangentially must be drafted too, or the kernel may
//     return a closed body whose edges leave its faces: such a selection is refused, and the
//     gaps between the vertices, edges and faces of the result are measured;
//   * it edits the Brep in place, also when it fails: it works on a copy.

#include "kernel.h"
#include "analytic.h"
#include "face_draft.h"

#include <SmApiGeneral.h>
#include <SmCone.h>
#include <SmCopyBrepMap.h>
#include <SmLine.h>
#include <SmPlane.h>

#include <algorithm>
#include <cmath>
#include <memory>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

// Two directions are parallel when the sine of the angle between them is below this.
const double kParallel = 1e-6;
// The most draft a face may have afterwards (the kernel needs it to cross the neutral plane).
const double kMaxLean = 89.0 * SM_PI / 180.0;

SmVector3d vec(const std::vector<double>& v, const char* what)
{
    if (v.size() != 3)
        throw std::invalid_argument(std::string(what) + " must have three components");
    return SmVector3d(v[0], v[1], v[2]);
}

double dot(const SmVector3d& a, const SmVector3d& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

SmVector3d cross(const SmVector3d& a, const SmVector3d& b)
{
    return SmVector3d(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

double length(const SmVector3d& a) { return std::sqrt(dot(a, a)); }

SmVector3d scaled(const SmVector3d& a, double f) { return SmVector3d(a.x * f, a.y * f, a.z * f); }

SmVector3d unit(const SmVector3d& a)
{
    double l = length(a);
    return l > 0 ? scaled(a, 1.0 / l) : a;
}

struct NeutralPlane
{
    SmPoint3d point;
    SmVector3d normal;  // unit

    double height(const SmPoint3d& p) const { return dot(p - point, normal); }
};

// Why a face cannot be drafted (the Python side words the message).
struct Refusal
{
    std::string reason;
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

// A plane turned by `angle` about the line where it meets the neutral plane, so that its
// outward normal turns towards the pull direction. `before` is its draft angle before.
SmSurface* tilted_plane(const SmFace* face, const NeutralPlane& plane, double angle, const SmPoint3d& point,
                        const SmVector3d& outward, double tol, double& before)
{
    // The hinge: turning the outward normal about this axis turns it towards the pull direction.
    SmVector3d axis = cross(outward, plane.normal);
    if (length(axis) < kParallel)
        throw Refusal{std::fabs(plane.height(point)) <= tol ? "in_plane" : "parallel"};
    axis = unit(axis);
    before = std::asin(std::max(-1.0, std::min(1.0, dot(outward, plane.normal))));
    if (std::fabs(before + angle) > kMaxLean)
        throw Refusal{"too_steep"};
    // From `point` straight up or down the face to the hinge line
    SmVector3d up = cross(axis, outward);
    SmPoint3d hinge = point + scaled(up, -plane.height(point) / dot(up, plane.normal));
    SmSurface* surface = nullptr;
    if (face->GetSurface()->Copy(ctx(), surface) != SM_SUCCESS || surface == nullptr)
        throw Refusal{"copy"};
    SmAxis2Placement rotation;
    rotation.RotateAboutAxisAtPoint(angle, hinge, axis);
    if (surface->Transform(rotation) != SM_SUCCESS)
    {
        delete surface;
        throw Refusal{"copy"};
    }
    return surface;
}

// The cone a cylindrical or conical face becomes: it keeps the face's circle in the neutral
// plane and its draft grows by `angle`. It keeps the parameters of the face's surface too: the
// control points of a NURBS copy that just covers the face are moved, each one keeps its height
// along the axis and its distance from the axis is scaled like the radius there (exact: the
// control points of a cone are those of circles, scaled by the radius). `before` is the face's
// draft angle before.
SmSurface* drafted_cone(const SmFace* face, const SmCone* cone, const NeutralPlane& plane, double angle,
                        const SmPoint3d& point, const SmVector3d& outward, double tol, double& before)
{
    const SmAxis2Placement& pos = cone->GetPosition();
    SmPoint3d origin = pos.GetOriginRef();
    SmVector3d axis = unit(cross(pos.GetXAxisRef(), pos.GetYAxisRef()));
    if (length(cross(axis, plane.normal)) > kParallel)
        throw Refusal{"axis"};
    // Positions along the axis are measured from the cone's origin; heights along the pull
    // direction from the neutral plane, which the axis meets at `hinge`.
    double sense = dot(axis, plane.normal) > 0 ? 1.0 : -1.0;
    double hinge = -plane.height(origin) * sense;
    double hinge_radius = cone->GetRadius(hinge);
    if (!(hinge_radius > tol))
        throw Refusal{"apex"};  // the cone ends in its tip before it reaches the neutral plane
    SmVector3d to_point = point - origin;
    SmVector3d radial = to_point - scaled(axis, dot(to_point, axis));
    // 1 when the material is inside the cone (a shaft, a boss), -1 when outside (a hole)
    double convex = dot(outward, radial) > 0 ? 1.0 : -1.0;
    // A shaft that narrows along the pull direction, or a hole that widens, has draft.
    double growth = sense * (cone->GetRadius(1.0) - cone->GetRadius(0.0));  // radius per height
    before = std::atan(-convex * growth);
    if (std::fabs(before + angle) > kMaxLean)
        throw Refusal{"too_steep"};
    double new_growth = -convex * std::tan(before + angle);

    SmSurface* copy = nullptr;
    if (face->GetSurface()->CopyAnalyticAsNurb(ctx(), copy) != SM_SUCCESS || copy == nullptr)
        throw Refusal{"copy"};
    std::unique_ptr<SmSurface> owner(copy);
    SmBSplineSurface* nurbs = copy->IsKindOf(SmBSplineSurface_TYPE) ? static_cast<SmBSplineSurface*>(copy) : nullptr;
    SmExtent2d natural = copy->GetNaturalUVDomain();
    SmExtent2d dom = face->GetUVDomain();
    // the face's box can stick out of the surface's by rounding
    SmExtent2d trim(SmPoint2d(std::max(dom.GetMin().x, natural.GetMin().x), std::max(dom.GetMin().y, natural.GetMin().y)),
                    SmPoint2d(std::min(dom.GetMax().x, natural.GetMax().x), std::min(dom.GetMax().y, natural.GetMax().y)));
    if (nurbs == nullptr || nurbs->TrimWithDomain(trim) != SM_SUCCESS)
        throw Refusal{"copy"};

    ULONG udeg = 0, vdeg = 0;
    SmTArray<SmPoint3d> poles;
    SmBSplineSurfaceForm form;
    SmKnotType knot_type;
    SmTArray<ULONG> umults, vmults;
    SmTArray<double> uknots, vknots, weights;
    if (nurbs->GetCanonical(udeg, vdeg, poles, form, umults, vmults, uknots, vknots, knot_type, weights) != SM_SUCCESS)
        throw Refusal{"copy"};
    for (ULONG i = 0; i < poles.GetSize(); ++i)
    {
        double along = dot(poles[i] - origin, axis);
        double old_radius = cone->GetRadius(along);
        double new_radius = hinge_radius + new_growth * sense * (along - hinge);
        if (!(old_radius > tol))
            throw Refusal{"apex"};  // the face reaches the cone's tip
        if (!(new_radius > tol))
            throw Refusal{"tip"};  // the drafted face would come to a point
        SmPoint3d on_axis = origin + scaled(axis, along);
        poles[i] = on_axis + scaled(poles[i] - on_axis, new_radius / old_radius);
    }
    SmBSplineSurface* surface = nullptr;
    SmStatus status = SmBSplineSurface::CreateCanonical(ctx(), udeg, vdeg, poles, SM_SF_UNSPECIFIED, umults, vmults,
                                                         uknots, vknots, SM_KT_UNSPECIFIED,
                                                         weights.GetSize() > 0 ? &weights : nullptr, nullptr, surface);
    if (status != SM_SUCCESS || surface == nullptr)
    {
        delete surface;
        throw Refusal{"copy"};
    }
    return surface;
}

// The new surface of a drafted face; `before` gets its draft angle before.
SmSurface* drafted_surface(const SmFace* face, const NeutralPlane& plane, double angle, double tol, double& before)
{
    const SmSurface* surface = face->GetSurface();
    SmPoint2d uv;
    if (surface == nullptr || !interior_uv(face, uv))
        throw Refusal{"invalid"};
    SmPoint3d point;
    SmVector3d normal;
    if (surface->EvaluatePoint(uv, point) != SM_SUCCESS || surface->EvaluateNormal(uv, TRUE, TRUE, normal) != SM_SUCCESS)
        throw Refusal{"invalid"};
    SmVector3d outward = unit(scaled(normal, outward_sign(face)));
    if (surface->IsKindOf(SmPlane_TYPE) || surface->IsPlanar(1e-7))  // as Face.is_planar
        return tilted_plane(face, plane, angle, point, outward, tol, before);
    if (surface->IsKindOf(SmCone_TYPE))  // a cylinder is a cone without an angle
        return drafted_cone(face, static_cast<const SmCone*>(surface), plane, angle, point, outward, tol, before);
    throw Refusal{"unsupported"};
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

smlibpy::FaceDraft draft_impl(const SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<double>& origin,
                              const std::vector<double>& normal, double angle, double tangency_deg)
{
    if (brep == nullptr)
        throw std::invalid_argument("brep is None");
    NeutralPlane plane;
    plane.point = vec(origin, "origin");
    plane.normal = vec(normal, "normal");
    if (!(length(plane.normal) > 0))
        throw std::invalid_argument("normal must not be zero");
    plane.normal = unit(plane.normal);
    const double tol = std::max(static_cast<double>(brep->GetTolerance()), 1e-9);

    smlibpy::FaceDraft d;

    // The new surfaces, built from the faces of the given Brep (its copy has the same geometry).
    SmTArray<SmSurface*> surfaces;
    d.tolerance = tol;
    auto drop_surfaces = [&]() {
        for (ULONG i = 0; i < surfaces.GetSize(); ++i)
            delete surfaces[i];
        surfaces.RemoveAll();
    };
    for (size_t i = 0; i < faces.size(); ++i)
    {
        if (faces[i] == nullptr || faces[i]->GetBrep() != brep)
        {
            drop_surfaces();
            throw std::invalid_argument("every face must belong to the brep");
        }
        double before = 0.0;
        try
        {
            surfaces.Add(drafted_surface(faces[i], plane, angle, tol, before));
            d.before.push_back(before);
        }
        catch (const Refusal& r)
        {
            drop_surfaces();
            d.before.push_back(before);
            d.error = r.reason;
            d.face = static_cast<long>(i);
            return d;
        }
    }

    // A face that meets a drafted face tangentially is drafted too, or refused.
    for (size_t i = 0; i < faces.size(); ++i)
    {
        SmTArray<SmEdge*> edges;
        faces[i]->GetEdges(edges);
        for (ULONG j = 0; j < edges.GetSize(); ++j)
        {
            SmTArray<SmFace*> adjacent;
            edges[j]->GetFaces(adjacent);
            for (ULONG k = 0; k < adjacent.GetSize(); ++k)
            {
                SmFace* other = adjacent[k];
                if (other == faces[i] || std::find(faces.begin(), faces.end(), other) != faces.end())
                    continue;
                if (edges[j]->IsTangentEdge(tangency_deg))
                {
                    drop_surfaces();
                    d.error = "tangent";
                    d.face = static_cast<long>(i);
                    d.other = other;
                    return d;
                }
            }
        }
    }

    // LocalOperation edits the Brep it is given: a copy, with the faces of the copy.
    SmCopyBrepMap reverse;  // original -> copy
    SmBrep* copy = new (ctx()) SmBrep(*brep, nullptr, &reverse, TRUE, FALSE);
    SmTArray<SmFace*> targets;
    for (SmFace* f : faces)
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
    d.restored = smlibpy::restore_analytic_curves(copy);
    auto g = gaps(copy);
    d.has_gaps = true;
    d.gaps[0] = g.first, d.gaps[1] = g.second;
    d.brep = copy;
    return d;
}

}  // namespace

namespace smlibpy {

FaceDraft draft_faces(const SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<double>& origin,
                      const std::vector<double>& normal, double angle, double tangency_deg)
{
    return draft_impl(brep, faces, origin, normal, angle, tangency_deg);
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_face_draft(py::module_& root)
{
    py::module_ m = root.def_submodule("face_draft", "smlibpy: face drafts (SmBrep::LocalOperation).");

    m.def("draft_faces", [](const SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<double>& origin,
                            const std::vector<double>& normal, double angle, double tangency_deg) {
        const smlibpy::FaceDraft r = smlibpy::draft_faces(brep, faces, origin, normal, angle, tangency_deg);
        py::dict d;
        d["brep"] = r.brep ? py::cast(r.brep, py::return_value_policy::take_ownership) : py::object(py::none());
        d["error"] = r.error.empty() ? py::object(py::none()) : py::object(py::str(r.error));
        d["face"] = r.face;
        d["other"] = r.other ? py::cast(r.other, py::return_value_policy::reference) : py::object(py::none());
        d["gaps"] = r.has_gaps ? py::object(py::make_tuple(r.gaps[0], r.gaps[1])) : py::object(py::none());
        d["gaps_before"] = r.has_gaps_before ? py::object(py::make_tuple(r.gaps_before[0], r.gaps_before[1]))
                                             : py::object(py::none());
        py::list before;
        for (double b : r.before)
            before.append(b);
        d["before"] = before;
        d["tolerance"] = r.tolerance;
        if (r.has_restored)
            d["restored"] = r.restored;
        return d;
    }, py::arg("brep"), py::arg("faces"), py::arg("origin"), py::arg("normal"),
          py::arg("angle"), py::arg("tangency_deg") = 1.0,
          "Tilt faces of a copy of a solid by `angle` (radians; positive turns their outward normals towards the "
          "plane's normal, the pull direction) about the lines where they meet the neutral plane (origin, normal). "
          "Faces meeting a drafted face at an edge whose normals differ by less than `tangency_deg` must be drafted "
          "too. Returns {'brep': the drafted copy or None, 'error': None or why not ('in_plane', 'parallel', 'axis', "
          "'apex', 'tip', 'too_steep', 'unsupported', 'invalid', 'copy', 'tangent', 'kernel', 'open'), 'face': the "
          "index of the face it is about, 'other': for 'tangent' the face that meets it tangentially, 'before': the "
          "draft angle of each face before (radians, against the normal), 'gaps' and 'gaps_before': (largest "
          "vertex-edge gap, largest vertex-face gap) of the result and of the given Brep, 'tolerance': the Brep's "
          "tolerance, 'restored': the number of B-spline edges that became lines and circles}.");
}
#endif  // SMLIBPY_PYTHON
