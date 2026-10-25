// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Meshes (PolyBreps) as arrays, what Python's PolyBrep.to_numpy_arrays gives smlibpy's Mesh.
// The extraction is SmPyLib's extract_mesh_arrays (SmPyPolyBrep.cpp), copied as it is: the same
// points, normals, polygon stream and face normals, so both bindings make the same meshes.

#include "common.h"
#include "poly_arrays.h"
#include "rays.h"

#include <SmApiPolygons.h>

#include <cmath>
#include <limits>
#include <stdexcept>
#include <unordered_map>

using namespace emscripten;

namespace {

struct MeshArrays
{
    std::vector<float> points;
    std::vector<float> normals;
    std::vector<int32_t> faces;
    std::vector<float> faceNormals;
};

SmVector3d unit_normal(const SmVector3d& normal, const SmVector3d& fallback)
{
    const double length = std::sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
    if (!std::isfinite(length) || length <= 1e-30)
        return fallback;
    return normal / length;
}

SmVector3d vertex_normal(SmPolyVertex* vertex, SmFace* original)
{
    const auto& normals = vertex->GetNormalsRef();
    const auto& faces = vertex->GetFacesRef();
    SmVector3d average(0, 0, 0);
    for (ULONG i = 0; i < normals.GetSize(); ++i)
        average += normals[i];
    average = unit_normal(average, SmVector3d(0, 0, 1));
    // Source-face pointers are labels only; the source Brep may be gone.
    if (original)
        for (ULONG i = 0; i < faces.GetSize() && i < normals.GetSize(); ++i)
            if (faces[i] == static_cast<SmTopology*>(original))
                return unit_normal(normals[i], average);
    return average;
}

MeshArrays extract_mesh_arrays(SmPolyBrep& self, bool faceVaryingNormals)
{
    MeshArrays data;

    SmTArray<SmPolyVertex*> polyVerts;
    SmTArray<SmPolyFace*> polyFaces;
    self.GetPolyVertices(polyVerts);
    self.GetPolyFaces(polyFaces);

    const ULONG nVerts = polyVerts.GetSize();
    const ULONG nFaces = polyFaces.GetSize();
    data.points.reserve(static_cast<size_t>(nVerts) * 3);
    data.normals.reserve(static_cast<size_t>(nVerts) * 3);
    data.faces.reserve(static_cast<size_t>(nFaces) * 4);
    data.faceNormals.reserve(static_cast<size_t>(nFaces) * 3);

    std::unordered_map<SmPolyVertex*, ULONG> vertIdx;
    vertIdx.reserve(nVerts);

    for (ULONG i = 0; i < nVerts; ++i)
    {
        SmPolyVertex* pv = polyVerts[i];
        vertIdx[pv] = i;

        const SmPoint3d& pt = pv->GetPoint();
        data.points.push_back(static_cast<float>(pt.x));
        data.points.push_back(static_cast<float>(pt.y));
        data.points.push_back(static_cast<float>(pt.z));

        if (!faceVaryingNormals)
        {
            const SmVector3d normal = vertex_normal(pv, nullptr);
            data.normals.insert(data.normals.end(), {
                static_cast<float>(normal.x), static_cast<float>(normal.y), static_cast<float>(normal.z)});
        }
    }

    for (ULONG i = 0; i < nFaces; ++i)
    {
        SmPolyFace* pf = polyFaces[i];
        SmPolyLoop* pLoop = pf->GetOuterPolyLoop();
        if (!pLoop)
        {
            continue;
        }

        SmTArray<SmPolyEdge*> edges;
        pLoop->GetPolyEdges(edges);
        const ULONG nEdges = edges.GetSize();
        if (nEdges == 0)
        {
            continue;
        }
        if (nEdges > static_cast<ULONG>(std::numeric_limits<int32_t>::max()))
        {
            throw std::overflow_error("PolyBrep face has too many vertices for an int32 mesh stream");
        }

        std::vector<int32_t> faceVerts;
        faceVerts.reserve(nEdges);
        bool badFace = false;
        for (ULONG j = 0; j < nEdges; ++j)
        {
            SmPolyVertex* pv = edges[j]->GetStartPolyVertex();
            const auto it = vertIdx.find(pv);
            if (it == vertIdx.end())
            {
                badFace = true;
                break;
            }
            if (it->second > static_cast<ULONG>(std::numeric_limits<int32_t>::max()))
            {
                throw std::overflow_error("PolyBrep has too many vertices for int32 mesh indices");
            }
            faceVerts.push_back(static_cast<int32_t>(it->second));
        }
        if (badFace)
        {
            continue;
        }

        data.faces.push_back(static_cast<int32_t>(nEdges));
        data.faces.insert(data.faces.end(), faceVerts.begin(), faceVerts.end());

        if (faceVaryingNormals)
        {
            for (ULONG j = 0; j < nEdges; ++j)
            {
                const SmVector3d normal = vertex_normal(edges[j]->GetStartPolyVertex(), pf->GetOriginalFace());
                data.normals.insert(data.normals.end(), {
                    static_cast<float>(normal.x), static_cast<float>(normal.y), static_cast<float>(normal.z)});
            }
        }

        const SmVector3d fn = unit_normal(pf->GetNormal(TRUE, FALSE), SmVector3d(0, 0, 1));
        data.faceNormals.push_back(static_cast<float>(fn.x));
        data.faceNormals.push_back(static_cast<float>(fn.y));
        data.faceNormals.push_back(static_cast<float>(fn.z));
    }

    return data;
}

// {points, normals, faces, face_normals}: Float32Arrays of xyz, and the polygons as an Int32Array
// [n, i0, ..., i(n-1), n, ...]. Normals per polygon corner when face_varying_normals, otherwise
// per point.
val poly_mesh(uintptr_t p, bool face_varying_normals)
{
    const MeshArrays data = smjs::guard([&] { return extract_mesh_arrays(*smjs::poly(p), face_varying_normals); });
    val out = val::object();
    out.set("points", smjs::float32(data.points));
    out.set("normals", smjs::float32(data.normals));
    out.set("faces", smjs::int32(data.faces));
    out.set("face_normals", smjs::float32(data.faceNormals));
    return out;
}

// smlibpy's extraction (src/cpp/poly_arrays.cpp), Python's ext.poly_arrays: {points (a
// Float64Array), normals, faces, face_normals}; with face_varying_normals, corners where the
// surface of their face of `brep` (0: none) has no normal get the surface's normal next to them.
val poly_arrays(uintptr_t p, bool face_varying_normals, val brep)
{
    const smlibpy::PolyArrays data = smjs::guard([&] {
        return smlibpy::poly_arrays(smjs::poly(p), face_varying_normals, smjs::maybe<SmBrep>(brep));
    });
    val out = val::object();
    out.set("points", smjs::float64(data.points));
    out.set("normals", smjs::float32(data.normals));
    out.set("faces", smjs::int32(data.faces));
    out.set("face_normals", smjs::float32(data.face_normals));
    return out;
}

// Python's ext.mesh_first_hits: arrays of numbers in (vertices, origins and directions x, y, z
// each; triangles three vertex indices each); {t, points, normals (Float64Arrays), triangles (an
// Int32Array, -1 for a miss)}.
std::vector<int64_t> indices(const val& a)
{
    const std::vector<double> v = smjs::numbers(a);
    return std::vector<int64_t>(v.begin(), v.end());
}

val mesh_first_hits(val vertices, val triangles, val origins, val directions)
{
    const smlibpy::FirstHits r = smjs::guard([&] {
        return smlibpy::mesh_first_hits(smjs::numbers(vertices), indices(triangles), smjs::numbers(origins),
                                        smjs::numbers(directions));
    });
    val out = val::object();
    out.set("t", smjs::float64(r.t));
    out.set("points", smjs::float64(r.points));
    out.set("normals", smjs::float64(r.normals));
    out.set("triangles", smjs::int32(r.triangles));
    return out;
}

// Python's ext.body_first_hits: {found (a Uint8Array: 0 a miss, 1 the hit, 2 cast at the body
// itself), t, points, normals (Float64Arrays), faces (an Int32Array, -1 for a miss)}.
val body_first_hits(uintptr_t b, val vertices, val triangles, val owners, val origins, val directions, double tolerance,
                    double mesh_tolerance)
{
    const smlibpy::BodyHits r = smjs::guard([&] {
        return smlibpy::body_first_hits(smjs::brep(b), smjs::numbers(vertices), indices(triangles), indices(owners),
                                        smjs::numbers(origins), smjs::numbers(directions), tolerance, mesh_tolerance);
    });
    val out = val::object();
    out.set("found", val::global("Uint8Array").new_(emscripten::typed_memory_view(r.found.size(), r.found.data())));
    out.set("t", smjs::float64(r.t));
    out.set("points", smjs::float64(r.points));
    out.set("normals", smjs::float64(r.normals));
    out.set("faces", smjs::int32(r.faces));
    return out;
}

// A deep copy, the caller's (the kernel's mesh Booleans consume their operands).
uintptr_t poly_copy(uintptr_t p)
{
    SmPolyBrep* result = nullptr;
    SMJS_CHECK(SmApiPolyBrepCopy(smjs::poly(p), result));
    return smjs::ptr(result);
}

}  // namespace

EMSCRIPTEN_BINDINGS(smlib_mesh)
{
    function("poly_mesh", &poly_mesh);
    function("poly_copy", &poly_copy);
    function("ext__poly_arrays", &poly_arrays);
    function("ext__mesh_first_hits", &mesh_first_hits);
    function("ext__body_first_hits", &body_first_hits);
}
