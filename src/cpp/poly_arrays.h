// SPDX-License-Identifier: Apache-2.0
//
// Meshes (PolyBreps) as arrays (poly_arrays.cpp): what smlibpy's Mesh is made of. Plain C++,
// shared by the Python extension and the JavaScript module.

#pragma once

#include <cstdint>
#include <vector>

class SmBrep;
class SmPolyBrep;

namespace smlibpy {

// The points of a mesh (x, y, z each, in double precision), the normals (per point, or per polygon
// corner), the polygons as a stream [n, i0, ..., i(n-1), n, ...] (those with an outer loop whose
// corners are points of the mesh, in the mesh's order) and one normal per polygon.
struct PolyArrays
{
    std::vector<double> points;
    std::vector<float> normals;
    std::vector<int32_t> faces;
    std::vector<float> face_normals;
};

// The arrays of a mesh, as SmPyLib's PolyBrep.to_numpy_arrays makes them (the same points,
// polygons and normals), with the points in double precision. With face_varying_normals, a corner
// gets the normal of the face of `brep` its polygon was made from; where that face's surface has no
// normal at the corner (the apex of a cone, where every line of the cone has a normal of its own),
// the normal of the surface a little inside the polygon. `brep` is the body the mesh was made from,
// while it exists: without it (or for polygons of other faces) the corners keep the
// tessellation's normals.
PolyArrays poly_arrays(SmPolyBrep* poly, bool face_varying_normals, SmBrep* brep = nullptr);

}  // namespace smlibpy
