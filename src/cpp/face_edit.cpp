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
//   * it edits the Brep in place, also when it fails: it works on a copy;
//   * the faces around the edited ones that it extends or trims come back on surfaces of its own (a
//     cylinder as a surface of extrusion of its rim, a cone as a B-spline): where they still lie on
//     their cone or cylinder, they get it back (restore_analytic_surfaces).

#include "kernel.h"
#include "face_edit.h"
#include "analytic.h"

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

// Lines and circles among the edges the kernel rebuilt as B-splines get their exact analytic curve
// back, keeping the parameters of the B-spline (as face_draft.cpp); a fitted B-spline where a plane
// meets a cylinder, cone or sphere becomes the exact circle.
long exact_edge_curves(SmBrep* brep)
{
    SmTArray<SmEdge*> edges;
    brep->GetEdges(edges);
    long changed = 0;
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        SmCurve* curve = edges[i]->GetCurve();
        if (curve == nullptr || curve->GetType() != SmBSplineCurve_TYPE)
            continue;
        // (the exact circle first, where the faces meet in one: the kernel's own test can take a fitted
        // B-spline for a curve of its own kind and give back a B-spline)
        SmCurve* exact = smlibpy::as_circle(edges[i], curve);
        if (exact == nullptr &&
            (curve->CreateAnalyticCurve(ctx(), curve->GetNaturalInterval(), exact) != SM_SUCCESS || exact == nullptr ||
             exact->GetType() == SmBSplineCurve_TYPE))
        {
            delete exact;
            exact = as_line(curve);
        }
        if (exact == nullptr)
            continue;
        if (brep->ReplaceCurve(edges[i], exact) == SM_SUCCESS)
            ++changed;
        else
            delete exact;
    }
    return changed;
}

// Points of a face: along its edges (9 a piece) and on a 5 x 5 grid of its parameters, inside it.
std::vector<SmPoint3d> face_points(const SmFace* face)
{
    std::vector<SmPoint3d> pts;
    SmTArray<SmEdge*> edges;
    face->GetEdges(edges);
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        const SmCurve* c = edges[i]->GetCurve();
        if (c == nullptr)
            continue;
        const SmExtent1d ivl = edges[i]->GetInterval();
        for (int k = 0; k <= 8; ++k)
        {
            SmPoint3d p;
            if (c->EvaluatePoint(ivl.Evaluate(k / 8.0), p) == SM_SUCCESS)
                pts.push_back(p);
        }
    }
    const SmSurface* s = face->GetSurface();
    const SmExtent2d dom = face->GetUVDomain();
    for (int i = 0; s && i <= 4; ++i)
        for (int j = 0; j <= 4; ++j)
        {
            SmPoint3d p;
            const SmPoint2d uv(dom.GetMin().x + (dom.GetMax().x - dom.GetMin().x) * i / 4.0,
                               dom.GetMin().y + (dom.GetMax().y - dom.GetMin().y) * j / 4.0);
            if (uv_inside(face, uv) && s->EvaluatePoint(uv, p) == SM_SUCCESS)
                pts.push_back(p);
        }
    return pts;
}

// A copy of the cone or cylinder `cone` whose parameters reach over the points `pts` (angles about
// its axis and heights along it: its STEP domain widened), where every point lies on it within `tol`
// and it does not reach its apex there; else null.
SmSurface* cone_over(const SmCone* cone, const std::vector<SmPoint3d>& pts, double tol)
{
    SmAxis2Placement pos;
    double r0 = 0.0, semi = 0.0;
    if (pts.empty() || cone->GetCanonical(pos, r0, semi) != SM_SUCCESS)
        return nullptr;
    const SmPoint3d o = pos.GetOriginRef();
    SmVector3d x = pos.GetXAxisRef(), y = pos.GetYAxisRef();
    SmVector3d z = cross(x, y);
    if (!(length(x) > 0) || !(length(y) > 0) || !(length(z) > 0))
        return nullptr;
    x = scaled(x, 1.0 / length(x)), y = scaled(y, 1.0 / length(y)), z = scaled(z, 1.0 / length(z));
    const SmExtent2d step = cone->GetSTEPUVDomain();  // degrees about the axis, heights along it
    double a0 = step.GetUMin(), a1 = step.GetUMax(), h0 = step.GetVMin(), h1 = step.GetVMax();
    const double mid = 0.5 * (a0 + a1);
    for (const SmPoint3d& p : pts)
    {
        const SmVector3d v = p - o;
        const double h = dot(v, z);
        const SmVector3d radial = v - scaled(z, h);
        const double r = length(radial);
        if (std::fabs(r - cone->GetRadius(h)) > tol)
            return nullptr;
        if (r > tol)
        {
            double deg = std::atan2(dot(radial, y), dot(radial, x)) * 180.0 / SM_PI;
            while (deg - mid > 180.0)
                deg -= 360.0;
            while (deg - mid < -180.0)
                deg += 360.0;
            a0 = std::min(a0, deg), a1 = std::max(a1, deg);
        }
        h0 = std::min(h0, h), h1 = std::max(h1, h);
    }
    if (a1 - a0 > 360.0 + 1e-6 || !(cone->GetRadius(h0) > tol) || !(cone->GetRadius(h1) > tol))
        return nullptr;
    SmSurface* copy = nullptr;
    if (cone->Copy(ctx(), copy) != SM_SUCCESS || copy == nullptr)
        return nullptr;
    const SmExtent2d want(SmPoint2d(a0, h0), SmPoint2d(std::min(a1, a0 + 360.0), h1));
    const bool same = std::fabs(a0 - step.GetUMin()) <= 1e-12 && std::fabs(a1 - step.GetUMax()) <= 1e-12 &&
                      std::fabs(h0 - step.GetVMin()) <= 1e-12 && std::fabs(h1 - step.GetVMax()) <= 1e-12;
    if (!same && static_cast<SmCone*>(copy)->AdjustSTEPUVDomain(want) != SM_SUCCESS)
    {
        delete copy;
        return nullptr;
    }
    return copy;
}

// Whether the normals of `face`'s surface and of `exact` agree at the face's interior point.
bool same_side(const SmFace* face, const SmSurface* exact)
{
    SmPoint2d uv;
    SmPoint3d p;
    SmVector3d n, m;
    SmBoolean ok = FALSE, multi = FALSE;
    SmPoint2d st;
    double gap = 0.0;
    const SmSurface* s = face->GetSurface();
    if (!s || !interior_uv(face, uv) || s->EvaluatePoint(uv, p) != SM_SUCCESS ||
        s->EvaluateNormal(uv, TRUE, TRUE, n) != SM_SUCCESS ||
        exact->DropPoint(p, exact->GetNaturalUVDomain(), nullptr, ok, st, gap, multi) != SM_SUCCESS || !ok ||
        exact->EvaluateNormal(st, TRUE, TRUE, m) != SM_SUCCESS)
        return false;
    return dot(n, m) > 0.999 * length(n) * length(m);
}

// A Brep that ReplaceSurface failed on half way is never freed (its destructor may read what the
// failure left behind; see revolutions.cpp).
void keep_forever(SmBrep* brep)
{
    static std::vector<SmBrep*> kept;
    kept.push_back(brep);
}

// The largest gaps between the vertices and the edges and faces they lie on.
std::pair<double, double> gaps(SmBrep* brep);

// The faces around the edited ones that LocalOperation extended or trimmed come back as new faces on
// surfaces of its own: a cylinder as a surface of extrusion of its rim, a cone as a B-spline (within
// about 1e-7 of the size). A face of `copy` that is on no cone or cylinder but lies on one of
// `cones` (the surfaces of the faces of the given Brep that were not edited) gets that surface back,
// its parameters widened over the face and its trims made again (SmBrep::ReplaceSurface), in a copy
// of `copy`; that copy replaces `copy` unless its edges then leave the faces by more than before (10
// times, or 10 tolerances). Returns the number of faces changed.
std::vector<const SmCone*> cone_surfaces(const SmBrep* brep, const std::vector<SmFace*>& edited)
{
    std::vector<const SmCone*> out;
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        const SmSurface* s = faces[i]->GetSurface();
        if (s != nullptr && s->IsKindOf(SmCone_TYPE) &&
            std::find(edited.begin(), edited.end(), faces[i]) == edited.end())
            out.push_back(static_cast<const SmCone*>(s));
    }
    return out;
}

long restore_analytic_surfaces(const std::vector<const SmCone*>& cones, SmBrep*& copy, double tol)
{
    if (cones.empty())
        return 0;
    SmTArray<SmFace*> faces;
    copy->GetFaces(faces);
    std::vector<std::pair<SmFace*, SmSurface*>> found;  // a face of copy, its analytic surface
    SmExtent3d box;
    copy->CalculateBoundingBox(box);
    const double on = 1e-6 * (1.0 + box.GetSize().Length());
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        SmFace* g = faces[i];
        const SmSurface* now = g->GetSurface();
        if (now == nullptr || now->IsKindOf(SmCone_TYPE) || now->IsKindOf(SmPlane_TYPE) || now->IsKindOf(SmSphere_TYPE))
            continue;
        const std::vector<SmPoint3d> pts = face_points(g);
        for (const SmCone* cone : cones)
        {
            SmSurface* exact = cone_over(cone, pts, on);
            if (exact == nullptr)
                continue;
            if (!same_side(g, exact))
            {
                delete exact;
                continue;
            }
            found.emplace_back(g, exact);
            break;
        }
    }
    if (found.empty())
        return 0;
    SmCopyBrepMap second;  // copy -> its copy
    SmBrep* again = new (ctx()) SmBrep(*copy, nullptr, &second, TRUE, FALSE);
    SmStatus st = SM_SUCCESS;
    size_t done = 0;
    for (; done < found.size() && st == SM_SUCCESS; ++done)
    {
        SmFace* face = static_cast<SmFace*>(second.GetAt(found[done].first));
        st = face ? again->ReplaceSurface(face, found[done].second, FALSE, nullptr, TRUE) : SM_ERR;
        if (st != SM_SUCCESS && found[done].second->GetOwner() == nullptr)
            delete found[done].second;
    }
    for (; done < found.size(); ++done)
        delete found[done].second;
    if (st != SM_SUCCESS)
    {
        keep_forever(again);
        return 0;
    }
    const auto g0 = gaps(copy), g1 = gaps(again);
    const double was = std::max(g0.first, g0.second), now = std::max(g1.first, g1.second);
    if (!again->IsManifoldSolid() || !(now <= std::max(10.0 * was, 10.0 * tol)))
    {
        delete again;
        return 0;
    }
    delete copy;
    copy = again;
    return static_cast<long>(found.size());
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
    const auto cones = cone_surfaces(brep, edited);
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
    d.restored = exact_edge_curves(copy);
    d.surfaces = restore_analytic_surfaces(cones, copy, tol);
    if (d.surfaces > 0)
        d.restored += exact_edge_curves(copy);  // (the edges where a plane meets a cone it got back)
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
        d["surfaces"] = r.surfaces;
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
          "edges that became lines and circles, 'surfaces': the number of faces around the edited ones that got "
          "their cone or cylinder back (LocalOperation extends them as surfaces of extrusion or B-splines)}.");
}
#endif  // SMLIBPY_PYTHON
