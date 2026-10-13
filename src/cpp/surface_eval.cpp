// SPDX-License-Identifier: Apache-2.0
//
// Exact surface derivatives and curvatures (`smlibpy._core.ext`).
//
//   surface_derivatives(surface, uv)  position and first and second partial derivatives
//   face_curvatures(face, uv)         principal curvatures and outward normals on a face
//   poly_curvatures(poly)             the same at every corner of a tessellation, in the corner
//                                     order of PolyBrep.to_numpy_arrays(face_varying_normals=True)
//
// Curvatures come from the first and second fundamental forms of the face's surface at the
// point, so they judge the exact surface, not the facets. Their sign follows the outward
// normal of the face: a convex surface (a sphere seen from outside) is positive, a bore is
// negative, a plane is zero.

#include "kernel.h"
#include "surface_eval.h"

#include <SmApiGeneral.h>
#include <SmApiQueries.h>
#include <SmApiSurfaces.h>


#include <cmath>
#include <limits>
#include <unordered_set>
#include <vector>

namespace
{

constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();

struct Derivatives
{
    SmPoint3d p;
    SmVector3d du, dv, duu, duv, dvv;
};

bool evaluate(const SmSurface* surface, const SmPoint2d& uv, Derivatives& d)
{
    return surface->Evaluate2ndDerivatives(uv, TRUE, TRUE, d.p, d.du, d.dv, d.duv, d.duu, d.dvv) == SM_SUCCESS;
}

// Principal curvatures at one point, k1 >= k2, from the fundamental forms
//   I  = [E F; F G] with E = Su.Su, F = Su.Sv, G = Sv.Sv
//   II = [L M; M N] with L = -Suu.n, M = -Suv.n, N = -Svv.n
// (the minus sign makes a surface that bends away from its normal positive). The normal is
// turned to agree with `outward` when one is given. Returns false at a singular point.
bool principal(const Derivatives& d, const SmVector3d* outward, double& k1, double& k2, SmVector3d& normal)
{
    // singular: a tangent that vanishes (a pole) or two that are parallel
    const double a = d.du.Length(), b = d.dv.Length();
    if (!(a > 0) || !(b > 0) || std::min(a, b) < 1e-6 * std::max(a, b))
        return false;
    SmVector3d n = d.du * d.dv;  // cross product
    const double length = n.Length();
    if (!(length > 1e-6 * a * b))
        return false;
    n = n * (1.0 / length);
    if (outward && n.Dot(*outward) < 0)
        n = n * -1.0;
    const double E = d.du.Dot(d.du), F = d.du.Dot(d.dv), G = d.dv.Dot(d.dv);
    const double L = -d.duu.Dot(n), M = -d.duv.Dot(n), N = -d.dvv.Dot(n);
    const double det = E * G - F * F;
    if (!(det > 0))
        return false;
    const double gaussian = (L * N - M * M) / det;
    const double mean = (E * N - 2.0 * F * M + G * L) / (2.0 * det);
    const double root = std::sqrt(std::max(mean * mean - gaussian, 0.0));
    k1 = mean + root;
    k2 = mean - root;
    normal = n;
    return std::isfinite(k1) && std::isfinite(k2);
}

// Curvatures at uv; at a singular point (the pole of a sphere, the apex of a cone) the
// surface is evaluated a little towards the middle of `domain` instead.
bool curvature_at(const SmSurface* surface, const SmPoint2d& uv, const SmExtent2d* domain,
                  const SmVector3d* outward, double& k1, double& k2, SmVector3d& normal)
{
    Derivatives d;
    if (evaluate(surface, uv, d) && principal(d, outward, k1, k2, normal))
        return true;
    if (!domain)
        return false;
    const SmPoint2d mid = domain->GetMid();
    for (double t : {1e-6, 1e-4, 1e-2})
    {
        const SmPoint2d near(uv.x + (mid.x - uv.x) * t, uv.y + (mid.y - uv.y) * t);
        if (evaluate(surface, near, d) && principal(d, outward, k1, k2, normal))
            return true;
    }
    return false;
}

// The outward normal of a face at uv, as SmFace::outward_normal_at_uv computes it.
bool outward_normal(const SmFace* face, const SmPoint2d& uv, SmVector3d& n)
{
    if (SmApiEvaluateSurfaceNormal(face->GetSurface(), uv, n) != SM_SUCCESS)
        return false;
    SmBrep* brep = face->GetBrep();
    SmFaceuse* upward = face->GetUpwardFaceuse();
    if (brep && upward && upward->GetShell() && brep->GetInfiniteRegion() != upward->GetShell()->GetRegion())
        n = n * -1.0;
    return true;
}

// The tessellation's normal at a corner, the same one PolyBrep.to_numpy_arrays reports.
SmVector3d corner_normal(SmPolyVertex* vertex, SmFace* original)
{
    const auto& normals = vertex->GetNormalsRef();
    const auto& faces = vertex->GetFacesRef();
    SmVector3d average(0, 0, 0);
    for (ULONG i = 0; i < normals.GetSize(); ++i)
        average += normals[i];
    if (original)
        for (ULONG i = 0; i < faces.GetSize() && i < normals.GetSize(); ++i)
            if (faces[i] == static_cast<SmTopology*>(original))
                return normals[i];
    return average;
}

std::vector<SmPoint2d> to_uvs(const std::vector<double>& uv)
{
    if (uv.size() % 2 != 0)
        throw std::invalid_argument("uv must be an (n, 2) array");
    std::vector<SmPoint2d> out(uv.size() / 2);
    for (size_t i = 0; i < out.size(); ++i)
        out[i] = SmPoint2d(uv[2 * i], uv[2 * i + 1]);
    return out;
}

void push(std::vector<double>& flat, const SmVector3d& v)
{
    flat.insert(flat.end(), {v.x, v.y, v.z});
}

} // namespace

namespace smlibpy {

SurfaceDerivatives surface_derivatives(const SmSurface* surface, const std::vector<double>& uv)
{
    const auto uvs = to_uvs(uv);
    SurfaceDerivatives r;
    for (const auto& q : uvs)
    {
        Derivatives d;
        if (!evaluate(surface, q, d))
            throw std::invalid_argument("surface_derivatives: the surface cannot be evaluated at a parameter");
        push(r.point, d.p), push(r.du, d.du), push(r.dv, d.dv), push(r.duu, d.duu), push(r.duv, d.duv), push(r.dvv, d.dvv);
    }
    return r;
}

FaceCurvatures face_curvatures(const SmFace* face, const std::vector<double>& uv)
{
    const auto uvs = to_uvs(uv);
    const SmExtent2d domain = face->GetUVDomain();
    FaceCurvatures r;
    r.k1.assign(uvs.size(), kNaN);
    r.k2.assign(uvs.size(), kNaN);
    r.normal.reserve(uvs.size() * 3);
    for (size_t i = 0; i < uvs.size(); ++i)
    {
        SmVector3d out(0, 0, 0), n(0, 0, 0);
        const bool oriented = outward_normal(face, uvs[i], out);
        curvature_at(face->GetSurface(), uvs[i], &domain, oriented ? &out : nullptr, r.k1[i], r.k2[i], n);
        push(r.normal, n);
    }
    return r;
}

PolyCurvatures poly_curvatures(SmPolyBrep& poly)
{
    // the corner walk of PolyBrep.to_numpy_arrays: faces in order, the corners of the
    // outer loop, faces with a corner outside the vertex list left out
    SmTArray<SmPolyVertex*> vertices;
    SmTArray<SmPolyFace*> faces;
    poly.GetPolyVertices(vertices);
    poly.GetPolyFaces(faces);
    std::unordered_set<SmPolyVertex*> known;
    for (ULONG i = 0; i < vertices.GetSize(); ++i)
        known.insert(vertices[i]);
    PolyCurvatures r;
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        SmPolyFace* pf = faces[i];
        SmPolyLoop* loop = pf->GetOuterPolyLoop();
        if (!loop)
            continue;
        SmTArray<SmPolyEdge*> edges;
        loop->GetPolyEdges(edges);
        bool bad = edges.GetSize() == 0;
        for (ULONG j = 0; j < edges.GetSize() && !bad; ++j)
            bad = !known.count(edges[j]->GetStartPolyVertex());
        if (bad)
            continue;
        SmFace* face = pf->GetOriginalFace();
        const SmSurface* surface = face ? face->GetSurface() : nullptr;
        const SmExtent2d domain = face ? face->GetUVDomain() : SmExtent2d();
        for (ULONG j = 0; j < edges.GetSize(); ++j)
        {
            double a = kNaN, b = kNaN;
            SmPoint2d q(kNaN, kNaN);
            SmPolyVertex* pv = edges[j]->GetStartPolyVertex();
            if (surface)
            {
                const SmPolyVertAuxData* aux = edges[j]->GetAuxData();
                bool found = false;
                if (aux)
                {
                    // the tessellator's parameter, if it lands on the corner
                    SmPoint3d at;
                    q = aux->m_vUV;
                    found = surface->EvaluatePoint(q, at) == SM_SUCCESS
                            && (at - pv->GetPoint()).Length() <= 1e-6 * (1.0 + pv->GetPoint().Length());
                }
                if (!found)
                {
                    SmPoint3d closest;
                    SmTArray<SmPoint2d> uvs;
                    double gap = 0;
                    if (SmApiSurfaceClosestPoint(surface, pv->GetPoint(), closest, uvs, gap) == SM_SUCCESS
                        && uvs.GetSize() > 0)
                    {
                        q = uvs[0];
                        found = true;
                    }
                }
                if (found)
                {
                    const SmVector3d out = corner_normal(pv, face);
                    SmVector3d n;
                    if (!curvature_at(surface, q, &domain, out.Length() > 0 ? &out : nullptr, a, b, n))
                        a = b = kNaN;
                    r.solved++;
                }
            }
            r.k1.push_back(a);
            r.k2.push_back(b);
            r.uv.insert(r.uv.end(), {q.x, q.y});
        }
    }
    return r;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"
#include <pybind11/numpy.h>

namespace {

using UV = py::array_t<double, py::array::c_style | py::array::forcecast>;

std::vector<double> flat_uv(const UV& uv)
{
    if (uv.ndim() != 2 || uv.shape(1) != 2)
        throw py::value_error("uv must be an (n, 2) array");
    return std::vector<double>(uv.data(), uv.data() + uv.size());
}

py::array_t<double> rows(const std::vector<double>& flat, py::ssize_t width)
{
    py::array_t<double> a({static_cast<py::ssize_t>(flat.size()) / width, width});
    std::copy(flat.begin(), flat.end(), a.mutable_data());
    return a;
}

py::array_t<double> values(const std::vector<double>& v)
{
    py::array_t<double> a(static_cast<py::ssize_t>(v.size()));
    std::copy(v.begin(), v.end(), a.mutable_data());
    return a;
}

}  // namespace

void bind_surface_eval(py::module_ m)
{
    m.def("surface_derivatives", [](const SmSurface* surface, const UV& uv) {
        const smlibpy::SurfaceDerivatives r = smlibpy::surface_derivatives(surface, flat_uv(uv));
        py::dict out;
        out["point"] = rows(r.point, 3), out["du"] = rows(r.du, 3), out["dv"] = rows(r.dv, 3);
        out["duu"] = rows(r.duu, 3), out["duv"] = rows(r.duv, 3), out["dvv"] = rows(r.dvv, 3);
        return out;
    }, py::arg("surface"), py::arg("uv"),
          "Position and partial derivatives (du, dv, duu, duv, dvv) of a surface at (n, 2) parameters.");

    m.def("face_curvatures", [](const SmFace* face, const UV& uv) {
        const smlibpy::FaceCurvatures r = smlibpy::face_curvatures(face, flat_uv(uv));
        py::dict out;
        out["k1"] = values(r.k1), out["k2"] = values(r.k2), out["normal"] = rows(r.normal, 3);
        return out;
    }, py::arg("face"), py::arg("uv"),
          "Principal curvatures k1 >= k2 (1/length; convex positive) and outward normals of a face at "
          "(n, 2) parameters. NaN where the surface has no curvature (a singular point).");

    m.def("poly_curvatures", [](SmPolyBrep& poly) {
        const smlibpy::PolyCurvatures r = smlibpy::poly_curvatures(poly);
        py::dict out;
        out["k1"] = values(r.k1), out["k2"] = values(r.k2);
        out["uv"] = rows(r.uv, 2);
        out["solved"] = r.solved;
        return out;
    }, py::arg("poly"),
          "Principal curvatures k1 >= k2 (1/length; convex positive) of the exact surface at every corner of "
          "a tessellation, in the corner order of to_numpy_arrays(face_varying_normals=True). The source "
          "Brep must still exist. NaN where a corner has no source face or the surface no curvature.");
}
#endif  // SMLIBPY_PYTHON
