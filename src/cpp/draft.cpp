// SPDX-License-Identifier: Apache-2.0
//
// Draft analysis and parting lines (`smlibpy._core.draft`).
//
// The draft of a face at a point is the angle between the face and the pull direction:
// asin(n . d) for the outward normal n and the unit pull direction d. Here:
//   * face_draft_range: the least and the greatest n . d over a face, sampled on a grid of the
//     face's parameters and along its edges, then refined;
//   * split_at_silhouettes: a copy of a Brep whose faces are split where n . d changes sign
//     (the silhouettes of the direction), so that each face of the copy faces one way. The
//     curves are exact for spheres, cylinders and tori around the direction, and traced by
//     the kernel (SmSurface::CreateSilhouetteCurves, the tracer behind SmHCR) otherwise; they
//     go into the faces as edges with SmBrep::MergeCurvesOnSurface.

#include "kernel.h"
#include "draft.h"

#include <SmApiGeneral.h>
#include <SmCopyBrepMap.h>
#include <SmCylinder.h>
#include <SmSphere.h>
#include <SmTorus.h>

#include <algorithm>
#include <cmath>
#include <functional>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

SmVector3d unit(const std::vector<double>& d)
{
    if (d.size() != 3)
        throw std::invalid_argument("direction must have three components");
    SmVector3d v(d[0], d[1], d[2]);
    if (!(v.Length() > 0) || v.Unitize() != SM_SUCCESS)
        throw std::invalid_argument("direction must not be zero");
    return v;
}

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

// n . d at a parameter of the face (outward normal).
struct DraftField
{
    const SmFace* face;
    const SmSurface* surface;
    SmVector3d d;
    double sign;

    bool at(const SmPoint2d& uv, double& value) const
    {
        SmVector3d n;
        if (surface->EvaluateNormal(uv, TRUE, TRUE, n) != SM_SUCCESS)
            return false;
        value = sign * n.Dot(d);
        return std::isfinite(value);
    }
};

struct Extreme
{
    double value;
    SmPoint2d uv;
    bool found = false;
};

void consider(Extreme& lo, Extreme& hi, double v, const SmPoint2d& uv)
{
    if (!lo.found || v < lo.value) { lo.value = v; lo.uv = uv; lo.found = true; }
    if (!hi.found || v > hi.value) { hi.value = v; hi.uv = uv; hi.found = true; }
}

// Pattern search for the extreme of n . d from `start`, staying inside the face.
void refine_inside(const DraftField& f, Extreme& e, double step, bool minimum)
{
    double best = e.value;
    SmPoint2d uv = e.uv;
    const double dirs[8][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}};
    for (int iter = 0; iter < 400 && step > 1e-13; ++iter)
    {
        bool moved = false;
        for (const auto& dv : dirs)
        {
            SmPoint2d q(uv.x + dv[0] * step, uv.y + dv[1] * step);
            double v;
            if (!f.at(q, v))
                continue;
            if ((minimum ? v < best : v > best) && uv_inside(f.face, q))
            {
                best = v;
                uv = q;
                moved = true;
                break;
            }
        }
        if (!moved)
            step *= 0.5;
    }
    e.value = best;
    e.uv = uv;
}

// Golden-section refinement of n . d along an edgeuse (its UV trim curve on the face).
void refine_edge(const DraftField& f, SmEdgeuse* eu, double t0, double t1, Extreme& lo, Extreme& hi)
{
    auto value_at = [&](double t, double& v, SmPoint2d& uv) {
        SmPoint3d p;
        if (eu->NormalizedEvaluate(t, TRUE, p) != SM_SUCCESS)
            return false;
        uv.Set(p.x, p.y);
        return f.at(uv, v);
    };
    for (int pass = 0; pass < 2; ++pass)
    {
        bool minimum = pass == 0;
        double a = std::max(0.0, t0), b = std::min(1.0, t1);
        const double g = 0.5 * (std::sqrt(5.0) - 1.0);
        double c = b - g * (b - a), d = a + g * (b - a);
        double vc, vd;
        SmPoint2d uc, ud;
        if (!value_at(c, vc, uc) || !value_at(d, vd, ud))
            continue;
        for (int i = 0; i < 80 && b - a > 1e-13; ++i)
        {
            bool left = minimum ? vc < vd : vc > vd;
            if (left)
            {
                b = d; d = c; vd = vc; ud = uc;
                c = b - g * (b - a);
                if (!value_at(c, vc, uc)) break;
            }
            else
            {
                a = c; c = d; vc = vd; uc = ud;
                d = a + g * (b - a);
                if (!value_at(d, vd, ud)) break;
            }
        }
        consider(lo, hi, vc, uc);
        consider(lo, hi, vd, ud);
    }
}

smlibpy::DraftRange draft_range(const SmFace* face, const std::vector<double>& direction, int grid)
{
    DraftField f{face, face->GetSurface(), unit(direction), outward_sign(face)};
    if (f.surface == nullptr)
        throw std::invalid_argument("face has no surface");
    Extreme lo, hi;
    SmExtent2d dom = face->GetUVDomain();
    double du = dom.GetMax().x - dom.GetMin().x, dv = dom.GetMax().y - dom.GetMin().y;
    bool planar = f.surface->IsKindOf(SmPlane_TYPE) == TRUE;
    int n = planar ? 4 : std::max(4, grid);

    // Inside the face: a grid of its parameter box.
    for (int i = 0; i <= n; ++i)
        for (int j = 0; j <= n; ++j)
        {
            SmPoint2d uv(dom.GetMin().x + du * i / n, dom.GetMin().y + dv * j / n);
            double v;
            if (f.at(uv, v) && uv_inside(face, uv))
                consider(lo, hi, v, uv);
        }
    // Along its edges: samples, then each local extreme refined.
    SmTArray<SmLoopuse*> loops;
    SmFaceuse* fu = face->GetUpwardFaceuse();
    if (fu)
        fu->GetLoopuses(loops);
    for (ULONG l = 0; l < loops.GetSize(); ++l)
    {
        if (loops[l]->IsVertexLoopuse())
            continue;
        SmTArray<SmEdgeuse*> eus;
        loops[l]->GetEdgeuses(eus);
        for (ULONG k = 0; k < eus.GetSize(); ++k)
        {
            const int m = planar ? 2 : 24;
            std::vector<double> vals(m + 1);
            std::vector<bool> ok(m + 1, false);
            for (int s = 0; s <= m; ++s)
            {
                SmPoint3d p;
                if (eus[k]->NormalizedEvaluate(double(s) / m, TRUE, p) != SM_SUCCESS)
                    continue;
                SmPoint2d uv(p.x, p.y);
                double v;
                if (!f.at(uv, v))
                    continue;
                vals[s] = v;
                ok[s] = true;
                consider(lo, hi, v, uv);
            }
            if (planar)
                continue;
            for (int s = 0; s <= m; ++s)
            {
                if (!ok[s])
                    continue;
                bool is_min = true, is_max = true;
                for (int t : {s - 1, s + 1})
                    if (t >= 0 && t <= m && ok[t])
                    {
                        is_min = is_min && vals[s] <= vals[t];
                        is_max = is_max && vals[s] >= vals[t];
                    }
                if (is_min || is_max)
                    refine_edge(f, eus[k], double(s - 1) / m, double(s + 1) / m, lo, hi);
            }
        }
    }
    if (!lo.found)
    {
        // A face too thin for the grid: its middle.
        SmPoint2d uv = dom.GetMid();
        double v;
        if (f.at(uv, v))
            consider(lo, hi, v, uv);
    }
    if (!lo.found)
        throw std::runtime_error("cannot evaluate the face's normal");
    if (!planar)
    {
        double step = 0.5 * std::max(du, dv) / n;
        refine_inside(f, lo, step, true);
        refine_inside(f, hi, step, false);
    }
    auto point = [&](const SmPoint2d& uv, double* out) {
        SmPoint3d p;
        f.surface->EvaluatePoint(uv, p);
        out[0] = p.x, out[1] = p.y, out[2] = p.z;
    };
    smlibpy::DraftRange d;
    d.min = std::max(-1.0, std::min(1.0, lo.value));
    d.max = std::max(-1.0, std::min(1.0, hi.value));
    point(lo.uv, d.min_point);
    point(hi.uv, d.max_point);
    return d;
}

// ---------------------------------------------------------------------------------------------
// Silhouettes
// ---------------------------------------------------------------------------------------------

// Exact silhouette curves of analytic surfaces, long enough to cross the face (the merge trims
// them). Returns false where the curves must be traced.
bool exact_silhouettes(const SmFace* face, const SmVector3d& d, double size, SmTArray<SmCurve*>& out)
{
    const SmSurface* s = face->GetSurface();
    const double parallel = 1e-12;
    if (s->GetType() == SmSphere_TYPE)
    {
        SmAxis2Placement a;
        double r = 0;
        SmBoolean swap = FALSE, inside_out = FALSE;
        if (static_cast<const SmSphere*>(s)->GetCanonical(a, r, &swap, &inside_out) != SM_SUCCESS)
            return false;
        SmVector3d x, y, z(d);
        d.MakeUnitOrthoVectors(NULL, z, x, y);
        out.Add(new (ctx()) SmCircle(a.GetOriginRef(), x, y, SmExtent1d(0.0, 360.0), r, 3, &ctx()));
        return true;
    }
    if (s->GetType() == SmCylinder_TYPE)
    {
        SmAxis2Placement a;
        double r = 0;
        if (static_cast<const SmCylinder*>(s)->GetCanonical(a, r) != SM_SUCCESS)
            return false;
        SmVector3d axis = a.GetXAxisRef() * a.GetYAxisRef();
        axis.Unitize();
        SmVector3d across = axis * d;
        if (across.Length() < parallel || across.Unitize() != SM_SUCCESS)
            return false;  // along the direction: no silhouette inside, the caller skips it
        // The lines through the face's extent along the axis.
        SmExtent3d box;
        face->CalculateBoundingBox(box);
        SmPoint3d o = a.GetOriginRef();
        double t0 = SM_BIG_DOUBLE, t1 = -SM_BIG_DOUBLE;
        for (int i = 0; i < 8; ++i)
        {
            SmPoint3d c((i & 1) ? box.GetMax().x : box.GetMin().x, (i & 2) ? box.GetMax().y : box.GetMin().y,
                        (i & 4) ? box.GetMax().z : box.GetMin().z);
            double t = (c - o).Dot(axis);
            t0 = std::min(t0, t);
            t1 = std::max(t1, t);
        }
        t0 -= size;
        t1 += size;
        for (double sgn : {1.0, -1.0})
        {
            SmPoint3d base = o + across * (sgn * r);
            SmLine* line = nullptr;
            if (SmLine::CreateLineSegment(ctx(), 3, base + axis * t0, base + axis * t1, line) != SM_SUCCESS || !line)
                return false;
            out.Add(line);
        }
        return true;
    }
    if (s->GetType() == SmTorus_TYPE)
    {
        SmAxis2Placement a;
        double R = 0, r = 0;
        SmBoolean swap = FALSE, inside_out = FALSE;
        if (static_cast<const SmTorus*>(s)->GetCanonical(a, R, r, &swap, &inside_out) != SM_SUCCESS)
            return false;
        SmVector3d axis = a.GetXAxisRef() * a.GetYAxisRef();
        axis.Unitize();
        if ((axis * d).Length() > parallel)
            return false;  // tilted: traced
        for (double radius : {R + r, R - r})
            if (radius > 0)
                out.Add(new (ctx()) SmCircle(a.GetOriginRef(), a.GetXAxisRef(), a.GetYAxisRef(),
                                             SmExtent1d(0.0, 360.0), radius, 3, &ctx()));
        return true;
    }
    return false;
}

void free_curves(SmTArray<SmCurve*>& curves)
{
    for (ULONG i = 0; i < curves.GetSize(); ++i)
        delete curves[i];
    curves.ReSet();
}

smlibpy::SilhouetteSplit silhouette_split(const SmBrep* brep, const std::vector<double>& direction, double tolerance,
                                          const std::vector<SmFace*>& straddling)
{
    SmVector3d d = unit(direction);
    SmCopyBrepMap reverse;  // original -> copy
    SmBrep* copy = new (ctx()) SmBrep(*brep, nullptr, &reverse, TRUE, FALSE);
    SmTemporaryChangeValue<SmBoolean> editing(copy->m_bEditingEnabled, TRUE);
    SmExtent3d box;
    copy->CalculateBoundingBox(box);
    double size = box.GetSize().Length();
    double ang = 10.0 * SM_PI / 180.0;
    smlibpy::SilhouetteSplit out;
    for (size_t i = 0; i < straddling.size(); ++i)
    {
        SmFace* face = static_cast<SmFace*>(reverse.GetAt(straddling[i]));
        if (face == nullptr)
            continue;
        SmSurface* surface = face->GetSurface();
        SmTArray<SmCurve*> curves3d, curves_uv;
        bool is_exact = exact_silhouettes(face, d, size, curves3d);
        SmStatus st = SM_SUCCESS;
        if (!is_exact)
        {
            free_curves(curves3d);
            st = surface->CreateSilhouetteCurves(ctx(), face->GetUVDomain(), d, FALSE,
                                                 SM_CAST_APPROXTOL3D_PTR(&tolerance), &ang, &curves3d, &curves_uv);
        }
        SmTArray<SmFace*> new_faces;
        SmTArray<SmEdge*> merged;
        if (st == SM_SUCCESS && curves3d.GetSize() > 0)
            st = copy->MergeCurvesOnSurface(*surface, tolerance, curves3d, is_exact ? nullptr : &curves_uv,
                                            new_faces, merged, TRUE);
        else if (st == SM_SUCCESS)
            st = SM_ERR;
        free_curves(curves3d);
        free_curves(curves_uv);
        if (st != SM_SUCCESS)
        {
            out.failed.push_back(static_cast<int>(i));
            continue;
        }
        (is_exact ? out.exact : out.traced) += 1;
        for (ULONG j = 0; j < merged.GetSize(); ++j)
            out.edges.push_back(merged[j]);
    }
    out.brep = copy;
    return out;
}

}  // namespace

namespace smlibpy {

DraftRange face_draft_range(const SmFace* face, const std::vector<double>& direction, int grid)
{
    return draft_range(face, direction, grid);
}

SilhouetteSplit split_at_silhouettes(const SmBrep* brep, const std::vector<double>& direction, double tolerance,
                                     const std::vector<SmFace*>& straddling)
{
    return silhouette_split(brep, direction, tolerance, straddling);
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_draft(py::module_& root)
{
    py::module_ m = root.def_submodule("draft", "smlibpy: draft analysis and parting lines.");

    m.def("face_draft_range", [](const SmFace* face, const std::vector<double>& direction, int grid) {
        const smlibpy::DraftRange r = smlibpy::face_draft_range(face, direction, grid);
        py::dict d;
        d["min"] = r.min;
        d["max"] = r.max;
        d["min_point"] = py::make_tuple(r.min_point[0], r.min_point[1], r.min_point[2]);
        d["max_point"] = py::make_tuple(r.max_point[0], r.max_point[1], r.max_point[2]);
        return d;
    }, py::arg("face"), py::arg("direction"), py::arg("grid") = 12,
          "The least and greatest n . d over a face (n the outward normal, d the unit direction): "
          "{'min', 'max', 'min_point', 'max_point'}. Sampled on a grid of the face's parameters and "
          "along its edges, then refined.");

    m.def("split_at_silhouettes", [](const SmBrep* brep, const std::vector<double>& direction, double tolerance,
                                     const std::vector<SmFace*>& faces) {
        const smlibpy::SilhouetteSplit r = smlibpy::split_at_silhouettes(brep, direction, tolerance, faces);
        py::list edges, failed;
        for (SmEdge* e : r.edges)
            edges.append(py::cast(e, py::return_value_policy::reference));
        for (int i : r.failed)
            failed.append(i);
        py::dict out;
        out["brep"] = py::cast(r.brep, py::return_value_policy::take_ownership);
        out["edges"] = edges;
        out["failed"] = failed;
        out["exact"] = r.exact;
        out["traced"] = r.traced;
        return out;
    }, py::arg("brep"), py::arg("direction"), py::arg("tolerance"), py::arg("faces"),
          "A copy of the Brep with the given faces (those whose n . d changes sign) split along their "
          "silhouettes for `direction`. Returns {'brep', 'edges' (the merged silhouette edges of the copy), "
          "'failed' (indices into `faces`), 'exact', 'traced'}.");
}
#endif  // SMLIBPY_PYTHON
