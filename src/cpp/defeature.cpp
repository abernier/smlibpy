// SPDX-License-Identifier: Apache-2.0
//
// Fillet and face removal (`smlibpy._core.defeature`).
//
// Access to the kernel's defeaturing tools:
//   * SmBrep::DeleteFilletFace / SmFilletRemoval removes a four-sided fillet whose two ends
//     meet their neighbours at sharp edges, and extends the two faces it joined to a sharp
//     edge again;
//   * SmFeatureExecutive::DoDefeature cuts a connected set of faces out of a Brep and patches
//     the hole by extending the surrounding surfaces or with a planar cap. This also removes
//     fillets with corner patches and fillets that run around a boss or a hole.
//
// smlibpy works on copies: every function here leaves the given Brep unchanged and returns
// a new Brep (or None).

#include "ext.h"

#include <SmApiGeneral.h>
#include <SmCopyBrepMap.h>
#include <SmFeatureExecutive.h>
#include <SmFilletRemoval.h>

#include <algorithm>
#include <cmath>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

// SmFilletRemoval in two steps, so that a copy of the Brep can be kept for the step that edits
// it. (Its corner parameters come through SmVertex::GetVertexuseOfFace, which needs the fix in
// third_party/patches/SMLib/src/SmVertex.cpp: without it the kernel removes no fillet.)
class FilletRemoval : public SmFilletRemoval
{
public:
    FilletRemoval(SmFace* face, double tolerance) : SmFilletRemoval(face, tolerance) {}

    // Everything up to the first change of the Brep. The kernel gathers all geometry before
    // it edits anything; a failure here leaves the Brep as it was.
    SmStatus Prepare()
    {
        SER(CollectFilletTopology());
        for (ULONG end = 0; end < 2; ++end)
        {
            SER(CalcNewCornerVertices(end));
            for (ULONG side = 0; side < 2; ++side)
                SER(FindSideEdgeExtensions(end, side));
        }
        return IntersectTangentSurfaces();
    }

    // Edits the Brep; a failure here can leave it half edited.
    SmStatus Apply() { return DoRemoval(); }
};

// A cheap check of the topology the fillet removal edited: every vertex and edge still belongs
// to the Brep, every edge has its curve and both vertices, and every edge of the solid joins
// two faces (or one face twice, at a seam). The kernel can leave a dangling vertex behind
// where a corner did not go as planned, and stitching such a Brep crashes.
bool sound_topology(const SmBrep* brep)
{
    SmTArray<SmVertex*> vertices;
    brep->GetVertices(vertices);
    for (ULONG i = 0; i < vertices.GetSize(); ++i)
        if (vertices[i] == nullptr || vertices[i]->GetBrep() != brep)
            return false;
    SmTArray<SmEdge*> edges;
    brep->GetEdges(edges);
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        SmEdge* e = edges[i];
        if (e == nullptr || e->GetCurve() == nullptr)
            return false;
        SmVertex* v0 = e->GetStartVertex();
        SmVertex* v1 = e->GetEndVertex();
        if (v0 == nullptr || v1 == nullptr || v0->GetBrep() != brep || v1->GetBrep() != brep)
            return false;
        SmTArray<SmEdgeuse*> uses;
        e->GetEdgeuses(uses);
        if (uses.GetSize() != 4)  // two faces, each used from both sides
            return false;
        for (ULONG j = 0; j < uses.GetSize(); ++j)
            if (uses[j] == nullptr || uses[j]->GetFace() == nullptr)
                return false;
    }
    return true;
}

// A copy of `brep` and the faces of the copy that correspond to `faces`.
SmBrep* copy_mapping(const SmBrep* brep, const std::vector<SmFace*>& faces, std::vector<SmFace*>& mapped)
{
    SmCopyBrepMap reverse;  // original -> copy
    SmBrep* copy = new (ctx()) SmBrep(*brep, nullptr, &reverse, TRUE, FALSE);
    mapped.clear();
    for (SmFace* f : faces)
        mapped.push_back(static_cast<SmFace*>(reverse.GetAt(f)));
    return copy;
}

// ---------------------------------------------------------------------------------------------
// Fillet recognition
// ---------------------------------------------------------------------------------------------

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

// A parameter inside the face, as near the middle of its parameter box as the grid finds.
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

struct Curvature
{
    double radius = 0.0;    // radius in the more curved principal direction (0: flat)
    bool convex = false;    // the surface bends away from its outward normal there
    bool umbilic = false;   // equally curved in every direction (a sphere): no principal direction
    SmVector3d direction;   // the more curved principal direction
};

// Curvature of a face at `uv`, judged against the face's outward normal.
bool curvature_at(const SmFace* face, const SmPoint2d& uv, Curvature& out)
{
    const SmSurface* s = face->GetSurface();
    double gauss = 0, mean = 0, k1 = 0, k2 = 0;
    SmVector3d efg, lmn, d1, d2;
    if (s->EvaluateGeometric(uv, TRUE, TRUE, gauss, mean, k1, k2, efg, lmn, d1, d2) != SM_SUCCESS)
        return false;
    double kmax = std::max(std::fabs(k1), std::fabs(k2));
    if (!(kmax > 1e-12))
    {
        out.radius = 0.0;
        return true;
    }
    out.radius = 1.0 / kmax;
    out.umbilic = std::fabs(std::fabs(k1) - std::fabs(k2)) <= 1e-6 * kmax;
    out.direction = std::fabs(k1) >= std::fabs(k2) ? d1 : d2;
    if (out.direction.Unitize() != SM_SUCCESS)
        return false;
    // Step along that direction in parameter space and see to which side of the tangent plane
    // the surface goes: away from the outward normal is convex.
    SmPoint3d p;
    SmVector3d su, sv;
    if (s->Evaluate1stDerivatives(uv, TRUE, TRUE, p, su, sv) != SM_SUCCESS)
        return false;
    double a11 = su.Dot(su), a12 = su.Dot(sv), a22 = sv.Dot(sv);
    double b1 = su.Dot(out.direction), b2 = sv.Dot(out.direction);
    double det = a11 * a22 - a12 * a12;
    if (!(std::fabs(det) > 0))
        return false;
    double du = (b1 * a22 - b2 * a12) / det, dv = (a11 * b2 - a12 * b1) / det;
    double step = 0.05 * out.radius;
    double scale = std::sqrt((su * du + sv * dv).LengthSquared());
    if (!(scale > 0))
        return false;
    SmVector3d n;
    if (s->EvaluateNormal(uv, TRUE, TRUE, n) != SM_SUCCESS)
        return false;
    n = n * outward_sign(face);
    double bend = 0.0;
    for (double sgn : {1.0, -1.0})
    {
        SmPoint2d q(uv.x + sgn * du * step / scale, uv.y + sgn * dv * step / scale);
        SmPoint3d pq;
        if (s->EvaluatePoint(q, pq) != SM_SUCCESS)
            return false;
        bend += (pq - p).Dot(n);
    }
    out.convex = bend < 0.0;
    return true;
}

// Parameter on `face` of the middle of `edge`, from the edge's use in that face.
bool edge_mid_uv(SmEdge* edge, const SmFace* face, SmPoint2d& uv, SmVector3d& tangent)
{
    SmEdgeuse* eu = edge->GetEdgeuseOfFace(face);
    if (eu == nullptr)
        return false;
    SmPoint3d p;
    if (eu->NormalizedEvaluate(0.5, TRUE, p) != SM_SUCCESS)
        return false;
    uv.Set(p.x, p.y);
    SmVector3d d[2];
    if (edge->GetCurve()->Evaluate(edge->GetInterval().Evaluate(0.5), 1, TRUE, d) != SM_SUCCESS)
        return false;
    tangent = d[1];
    return tangent.Unitize() == SM_SUCCESS;
}

py::object blend_info(SmFace* face, double tangency_deg)
{
    const SmSurface* surface = face->GetSurface();
    if (surface == nullptr || surface->IsKindOf(SmPlane_TYPE))
        return py::none();
    SmPoint2d uv;
    if (!interior_uv(face, uv))
        return py::none();
    Curvature c;
    if (!curvature_at(face, uv, c) || c.radius == 0.0)
        return py::none();

    SmTArray<SmEdge*> edges;
    face->GetEdges(edges);
    py::list smooth, rails, sharp;
    int edge_count = 0;
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        SmEdge* e = edges[i];
        if (e->IsSeam(*surface))
            continue;
        ++edge_count;
        SmTArray<SmFace*> faces;
        e->GetFaces(faces);
        bool is_smooth = faces.GetSize() == 2 && faces[0] != faces[1] && e->IsTangentEdge(tangency_deg);
        py::object ref = py::cast(e, py::return_value_policy::reference);
        if (!is_smooth)
        {
            sharp.append(ref);
            continue;
        }
        smooth.append(ref);
        // A rail runs across the direction in which the fillet is curved. The curvature is
        // taken a little inside the face: a curvature-continuous blend is flat at its rails.
        SmPoint2d euv;
        SmVector3d t;
        Curvature ce;
        if (edge_mid_uv(e, face, euv, t))
        {
            SmPoint2d probe(euv.x + 0.3 * (uv.x - euv.x), euv.y + 0.3 * (uv.y - euv.y));
            if (curvature_at(face, probe, ce) && ce.radius > 0.0 && !ce.umbilic &&
                std::fabs(t.Dot(ce.direction)) < 0.5)
                rails.append(ref);
        }
    }
    py::dict d;
    d["radius"] = c.radius;
    d["convex"] = c.convex;
    d["smooth"] = smooth;
    d["rails"] = rails;
    d["sharp"] = sharp;
    d["edges"] = edge_count;
    return d;
}

// ---------------------------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------------------------

SmRebuildBrepType rebuild_type(const std::string& name)
{
    if (name == "planar_cap") return SM_RB_PLANAR_CAP;
    if (name == "extend") return SM_RB_EXTEND_SURFACE;
    throw std::invalid_argument("rebuild must be 'extend' or 'planar_cap'");
}

// Remove four-sided fillets one by one with SmFilletRemoval. Fillets that do not qualify yet
// may after a neighbour went (two mitred fillets of different radii), so the faces are tried
// in rounds until a round removes none.
py::dict remove_fillet_faces(const SmBrep* brep, const std::vector<SmFace*>& faces, double tolerance)
{
    std::vector<SmFace*> pending;
    SmBrep* work = copy_mapping(brep, faces, pending);
    std::vector<size_t> index(pending.size());  // position of each pending face in `faces`
    for (size_t i = 0; i < index.size(); ++i)
        index[i] = i;
    std::vector<bool> removed(faces.size(), false);
    size_t count = 0;
    bool progress = true;
    while (progress && !pending.empty())
    {
        progress = false;
        for (size_t i = 0; i < pending.size(); ++i)
        {
            SmFace* face = pending[i];
            double tol = tolerance > 0 ? tolerance : static_cast<double>(face->GetTolerance());
            SmBrep* backup = nullptr;
            std::vector<SmFace*> backup_faces;
            bool applied = false;
            {
                SmTemporaryChangeValue<SmBoolean> editing(work->m_bEditingEnabled, TRUE);
                FilletRemoval removal(face, tol);
                if (removal.Prepare() != SM_SUCCESS)
                    continue;
                // The edit itself can fail half way: keep a copy to go back to.
                backup = copy_mapping(work, pending, backup_faces);
                applied = removal.Apply() == SM_SUCCESS && sound_topology(work);
            }
            if (applied)
            {
                delete backup;
                removed[index[i]] = true;
                ++count;
            }
            else
            {
                delete work;
                work = backup;
                pending = backup_faces;
            }
            pending.erase(pending.begin() + static_cast<long>(i));
            index.erase(index.begin() + static_cast<long>(i));
            progress = true;
            break;
        }
    }
    py::dict d;
    if (count > 0)
    {
        SmTemporaryChangeValue<SmBoolean> editing(work->m_bEditingEnabled, TRUE);
        work->StitchAndOrient();
        d["brep"] = py::cast(work, py::return_value_policy::take_ownership);
    }
    else
    {
        delete work;
        d["brep"] = py::none();
    }
    py::list flags;
    for (bool r : removed)
        flags.append(r);
    d["removed"] = flags;
    return d;
}

// Cut connected face sets out of a copy and patch the holes (SmFeatureExecutive).
py::dict defeature(const SmBrep* brep, const std::vector<std::vector<SmFace*>>& groups, const std::string& rebuild)
{
    std::vector<SmFace*> all, mapped;
    for (const auto& g : groups)
        all.insert(all.end(), g.begin(), g.end());
    SmRebuildBrepType type = rebuild_type(rebuild);
    SmBrep* copy = copy_mapping(brep, all, mapped);
    py::dict d;
    SmBrep* base = nullptr;
    SmTArray<SmBrep*> feature_breps;
    bool applied = true, added = true;
    {
        SmFeatureExecutive exec(ctx(), *copy);
        std::vector<SmFeature*> features;
        size_t k = 0;
        for (const auto& g : groups)
        {
            SmTArray<SmFace*> faces;
            for (size_t i = 0; i < g.size(); ++i)
                faces.Add(mapped[k++]);
            // The feature's own side is not rebuilt: it is thrown away.
            SmFeature* feature = exec.AddFeature(faces, type, SM_RB_NONE);
            if (feature == nullptr)
            {
                added = false;
                break;
            }
            features.push_back(feature);
        }
        if (added)
        {
            exec.DoDefeature(base, &feature_breps);
            for (SmFeature* feature : features)
                applied = applied && feature->GetBaseWasApplied() == TRUE;
        }
    }
    for (ULONG i = 0; i < feature_breps.GetSize(); ++i)
        if (feature_breps[i] != nullptr && feature_breps[i] != copy)
            delete feature_breps[i];
    d["added"] = added;
    d["applied"] = added && applied;
    if (added && applied && base == copy)
    {
        // The patches are faces of their own; merge them with the faces they extend.
        SmTemporaryChangeValue<SmBoolean> editing(copy->m_bEditingEnabled, TRUE);
        copy->RemoveTopologicalEdgesAndVertices();
        d["brep"] = py::cast(copy, py::return_value_policy::take_ownership);
    }
    else
    {
        delete copy;
        d["brep"] = py::none();
    }
    return d;
}

}  // namespace

void bind_defeature(py::module_& root)
{
    py::module_ m = root.def_submodule("defeature", "smlibpy: fillet and face removal.");

    m.def("blend_info", &blend_info, py::arg("face"), py::arg("tangency_deg") = 2.0,
          "What makes a face a fillet: None for a planar or flat face, else a dict with 'radius' (in the "
          "more curved direction, at a point inside the face), 'convex', the edges where it meets its "
          "neighbours tangentially ('smooth'), those of them that run across its curvature ('rails'), "
          "the others ('sharp') and the number of edges without seams ('edges').");

    m.def("remove_fillet_faces", &remove_fillet_faces, py::arg("brep"), py::arg("faces"),
          py::arg("tolerance") = -1.0,
          "Remove four-sided fillets with sharp ends (SmFilletRemoval) from a copy. Returns {'brep': the "
          "copy or None if nothing was removed, 'removed': one flag per face}.");

    m.def("defeature", &defeature, py::arg("brep"), py::arg("groups"), py::arg("rebuild") = "extend",
          "Cut groups of connected faces out of a copy and patch the holes (SmFeatureExecutive) by extending "
          "the surrounding surfaces ('extend') or with planar caps ('planar_cap'). Returns {'brep': the patched "
          "copy or None, 'added': every group was accepted as a feature, 'applied': every patch was applied}.");
}
