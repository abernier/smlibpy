// SPDX-License-Identifier: Apache-2.0
//
// Meshes (PolyBreps) as arrays (`smlibpy._core.ext.poly_arrays`, `ext__poly_arrays` in the
// JavaScript module): what smlibpy's Mesh is made of.
//
// SmPyLib's PolyBrep.to_numpy_arrays (extract_mesh_arrays in SmPyPolyBrep.cpp) gives the points as
// float32: 7 digits, so a part 100 m from the origin was meshed 3.8 times the tolerance off its
// surface, and a box 1 km out lost 0.5 % of its mesh volume. This is the same extraction (the same
// points, polygons, normals and polygon normals, in the same order) with the points in double
// precision; the file writers narrow them where their format is float32 (STL, glTF).
//
// The tessellator gives a mesh point one normal per face it lies on. At a point where the face's
// surface has no normal (the apex of a cone: each line of the cone has its own normal there), all
// the corners there got the same normal, up to 127 degrees off the surface next to them. A corner
// at a vertex of the body whose surface is singular there (its partial derivatives vanish or are
// parallel) gets the normal of the surface a little inside its polygon instead, where that differs
// from the tessellator's by more than kReplaceAngle (at the pole of a sphere it does not).

#include "kernel.h"
#include "poly_arrays.h"

#include <SmApiQueries.h>
#include <SmCylinder.h>
#include <SmPoly.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace
{

// How far into its polygon a corner's normal is taken where the surface has none at the corner
// (a fraction of the way to the polygon's centre).
constexpr double kInside = 1e-3;
// A corner keeps the tessellator's normal unless the surface's normal inside the polygon differs
// from it by more than this (radians, a tenth of a degree; at the pole of a sphere they differ by
// about a thousandth of the polygon's turn).
constexpr double kReplaceAngle = 0.1 * 3.14159265358979323846 / 180.0;

SmVector3d unit_normal(const SmVector3d& normal, const SmVector3d& fallback)
{
    const double length = std::sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
    if (!std::isfinite(length) || length <= 1e-30)
        return fallback;
    return normal / length;
}

// The tessellator's normal at a point: the one for `original` (a face of the body), the average of
// all of its normals otherwise (as SmPyLib's extraction).
SmVector3d vertex_normal(SmPolyVertex* vertex, const SmFace* original)
{
    const auto& normals = vertex->GetNormalsRef();
    const auto& faces = vertex->GetFacesRef();
    SmVector3d average(0, 0, 0);
    for (ULONG i = 0; i < normals.GetSize(); ++i)
        average += normals[i];
    average = unit_normal(average, SmVector3d(0, 0, 1));
    // (face pointers are labels only here: the source Brep may be gone)
    if (original)
        for (ULONG i = 0; i < faces.GetSize() && i < normals.GetSize(); ++i)
            if (faces[i] == static_cast<const SmTopology*>(original))
                return unit_normal(normals[i], average);
    return average;
}

// The parameters of a corner on the surface: the tessellator's (on the polygon edge that starts at
// the corner) where they land on the corner, the closest point otherwise.
bool corner_uv(const SmSurface* surface, SmPolyEdge* edge, const SmPoint3d& p, SmPoint2d& uv)
{
    if (const SmPolyVertAuxData* aux = edge->GetAuxData())
    {
        SmPoint3d at;
        if (surface->EvaluatePoint(aux->m_vUV, at) == SM_SUCCESS && (at - p).Length() <= 1e-6 * (1.0 + p.Length()))
            return uv = aux->m_vUV, true;
    }
    SmPoint3d closest;
    SmTArray<SmPoint2d> uvs;
    double gap = 0;
    if (SmApiSurfaceClosestPoint(surface, p, closest, uvs, gap) != SM_SUCCESS || uvs.GetSize() < 1)
        return false;
    uv = uvs[0];
    return true;
}

// True where the surface has no normal: a partial derivative vanishes, or the two are parallel.
bool singular_at(const SmSurface* surface, const SmPoint2d& uv)
{
    SmPoint3d p;
    SmVector3d du, dv, duv, duu, dvv;
    if (surface->Evaluate2ndDerivatives(uv, TRUE, TRUE, p, du, dv, duv, duu, dvv) != SM_SUCCESS)
        return false;
    const double a = du.Length(), b = dv.Length();
    if (!(a > 0) || !(b > 0) || std::min(a, b) < 1e-6 * std::max(a, b))
        return true;
    return !((du * dv).Length() > 1e-6 * a * b);
}

// The surface's normal at the point of the surface closest to `q`, turned to the side of `side`.
bool normal_near(const SmSurface* surface, const SmPoint3d& q, const SmVector3d& side, SmVector3d& normal)
{
    SmPoint3d closest;
    SmTArray<SmPoint2d> uvs;
    double gap = 0;
    if (SmApiSurfaceClosestPoint(surface, q, closest, uvs, gap) != SM_SUCCESS || uvs.GetSize() < 1)
        return false;
    SmVector3d n;
    if (surface->EvaluateNormal(uvs[0], TRUE, TRUE, n) != SM_SUCCESS || !(n.Length() > 0))
        return false;
    n = unit_normal(n, side);
    normal = n.Dot(side) < 0 ? -n : n;
    return true;
}

}  // namespace

namespace smlibpy {

PolyArrays poly_arrays(SmPolyBrep* poly, bool face_varying_normals, SmBrep* brep)
{
    if (!poly)
        throw std::invalid_argument("poly_arrays: no mesh");
    PolyArrays data;

    SmTArray<SmPolyVertex*> poly_vertices;
    SmTArray<SmPolyFace*> poly_faces;
    poly->GetPolyVertices(poly_vertices);
    poly->GetPolyFaces(poly_faces);

    const ULONG n_vertices = poly_vertices.GetSize();
    const ULONG n_faces = poly_faces.GetSize();
    data.points.reserve(static_cast<size_t>(n_vertices) * 3);
    data.normals.reserve(static_cast<size_t>(n_vertices) * 3);
    data.faces.reserve(static_cast<size_t>(n_faces) * 4);
    data.face_normals.reserve(static_cast<size_t>(n_faces) * 3);

    // the faces of the body whose surfaces may be read
    std::unordered_set<const SmFace*> live;
    if (brep && face_varying_normals)
    {
        SmTArray<SmFace*> faces;
        brep->GetFaces(faces);
        for (ULONG i = 0; i < faces.GetSize(); ++i)
            live.insert(faces[i]);
    }

    std::unordered_map<SmPolyVertex*, ULONG> index;
    index.reserve(n_vertices);
    for (ULONG i = 0; i < n_vertices; ++i)
    {
        SmPolyVertex* pv = poly_vertices[i];
        index[pv] = i;
        const SmPoint3d& p = pv->GetPoint();
        data.points.insert(data.points.end(), {p.x, p.y, p.z});
        if (!face_varying_normals)
        {
            const SmVector3d n = vertex_normal(pv, nullptr);
            data.normals.insert(data.normals.end(), {static_cast<float>(n.x), static_cast<float>(n.y), static_cast<float>(n.z)});
        }
    }

    // whether a face's surface is singular at a point of the mesh (asked once per point and face)
    struct PairHash
    {
        size_t operator()(const std::pair<const SmPolyVertex*, const SmFace*>& k) const
        {
            return std::hash<const void*>()(k.first) * 31u ^ std::hash<const void*>()(k.second);
        }
    };
    std::unordered_map<std::pair<const SmPolyVertex*, const SmFace*>, bool, PairHash> singular;
    std::vector<int32_t> corners;
    for (ULONG i = 0; i < n_faces; ++i)
    {
        SmPolyFace* pf = poly_faces[i];
        SmPolyLoop* loop = pf->GetOuterPolyLoop();
        if (!loop)
            continue;
        SmTArray<SmPolyEdge*> edges;
        loop->GetPolyEdges(edges);
        const ULONG n_edges = edges.GetSize();
        if (n_edges == 0)
            continue;
        if (n_edges > static_cast<ULONG>(std::numeric_limits<int32_t>::max()))
            throw std::overflow_error("PolyBrep face has too many vertices for an int32 mesh stream");
        corners.clear();
        bool bad = false;
        for (ULONG j = 0; j < n_edges && !bad; ++j)
        {
            const auto it = index.find(edges[j]->GetStartPolyVertex());
            if (it == index.end())
                bad = true;
            else if (it->second > static_cast<ULONG>(std::numeric_limits<int32_t>::max()))
                throw std::overflow_error("PolyBrep has too many vertices for int32 mesh indices");
            else
                corners.push_back(static_cast<int32_t>(it->second));
        }
        if (bad)
            continue;

        data.faces.push_back(static_cast<int32_t>(n_edges));
        data.faces.insert(data.faces.end(), corners.begin(), corners.end());
        const SmVector3d facet = unit_normal(pf->GetNormal(TRUE, FALSE), SmVector3d(0, 0, 1));

        if (face_varying_normals)
        {
            const SmFace* original = pf->GetOriginalFace();
            const SmSurface* surface = original && live.count(original) ? original->GetSurface() : nullptr;
            // (planes, cylinders and extruded curves have a normal everywhere)
            if (surface && (surface->IsKindOf(SmPlane_TYPE) || surface->IsKindOf(SmCylinder_TYPE) ||
                            surface->IsKindOf(SmSurfOfExtrusion_TYPE)))
                surface = nullptr;
            SmPoint3d centre(0, 0, 0);
            if (surface)
            {
                for (ULONG j = 0; j < n_edges; ++j)
                    centre += edges[j]->GetStartPolyVertex()->GetPoint();
                centre = centre * (1.0 / static_cast<double>(n_edges));
            }
            for (ULONG j = 0; j < n_edges; ++j)
            {
                SmPolyVertex* pv = edges[j]->GetStartPolyVertex();
                SmVector3d n = vertex_normal(pv, original);
                if (surface && pv->GetOriginalVertex())
                {
                    const SmPoint3d& p = pv->GetPoint();
                    auto known = singular.find({pv, original});
                    if (known == singular.end())
                    {
                        SmPoint2d uv;
                        known = singular.emplace(std::make_pair(pv, original),
                                                 corner_uv(surface, edges[j], p, uv) && singular_at(surface, uv)).first;
                    }
                    SmVector3d inside;
                    double angle = 0.0;
                    if (known->second && normal_near(surface, p + (centre - p) * kInside, facet, inside) &&
                        inside.AngleBetween(n, angle) == SM_SUCCESS && angle > kReplaceAngle)
                        n = inside;
                }
                data.normals.insert(data.normals.end(), {static_cast<float>(n.x), static_cast<float>(n.y), static_cast<float>(n.z)});
            }
        }
        data.face_normals.insert(data.face_normals.end(),
                                 {static_cast<float>(facet.x), static_cast<float>(facet.y), static_cast<float>(facet.z)});
    }
    return data;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

#include <pybind11/numpy.h>

#include <memory>

void bind_poly_arrays(py::module_ m)
{
    m.def(
        "poly_arrays",
        [](SmPolyBrep* poly, bool face_varying_normals, SmBrep* brep) {
            auto owned = std::make_unique<smlibpy::PolyArrays>(smlibpy::poly_arrays(poly, face_varying_normals, brep));
            smlibpy::PolyArrays* data = owned.release();
            py::capsule owner(data, [](void* value) { delete static_cast<smlibpy::PolyArrays*>(value); });
            auto rows = [](size_t n) { return static_cast<py::ssize_t>(n / 3); };
            py::dict out;
            out["points"] = py::array_t<double>({rows(data->points.size()), py::ssize_t(3)}, data->points.data(), owner);
            out["normals"] = py::array_t<float>({rows(data->normals.size()), py::ssize_t(3)}, data->normals.data(), owner);
            out["faces"] = py::array_t<int32_t>({static_cast<py::ssize_t>(data->faces.size())}, data->faces.data(), owner);
            out["face_normals"] =
                py::array_t<float>({rows(data->face_normals.size()), py::ssize_t(3)}, data->face_normals.data(), owner);
            return out;
        },
        py::arg("poly"), py::arg("face_varying_normals") = false, py::arg("brep") = nullptr,
        "The mesh as arrays, as PolyBrep.to_numpy_arrays gives them ({'points', 'normals', 'faces', "
        "'face_normals'}), with the points in float64 (n, 3). With face_varying_normals, a normal per polygon "
        "corner: that of the face of `brep` (the body the mesh was made from, while it exists) its polygon was "
        "made from; where that surface has no normal at the corner (the apex of a cone), the surface's normal a "
        "little inside the polygon.");
}
#endif  // SMLIBPY_PYTHON
