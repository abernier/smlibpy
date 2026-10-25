// SPDX-License-Identifier: Apache-2.0
//
// Many rays at once (rays.cpp): the first triangle of a mesh each ray meets, by the kernel's grid
// ray tracer, and the first face of a body, from its mesh. Plain C++, shared by the Python
// extension and the JavaScript module.

#pragma once

#include <cstdint>
#include <vector>

class SmBrep;

namespace smlibpy {

// Per ray: the distance t along the ray (NaN for a miss), the point and the triangle's unit normal
// (x, y, z each; NaN for a miss) and the triangle's index (-1 for a miss).
struct FirstHits
{
    std::vector<double> t;
    std::vector<double> points;
    std::vector<double> normals;
    std::vector<int32_t> triangles;
};

// The first triangle of the mesh (vertices x, y, z each; triangles three vertex indices each) that
// each ray meets: rays from origins[i] along directions[i] (x, y, z each, any length but zero),
// hits at t >= 0 (and a hair before). Triangles without an area are never hit.
FirstHits mesh_first_hits(const std::vector<double>& vertices, const std::vector<int64_t>& triangles,
                          const std::vector<double>& origins, const std::vector<double>& directions);

// Per ray: what was found (0: a miss, 1: the hit, 2: ask the body: the mesh's first face is missed
// where the mesh met it, or met behind the start), the distance t, the point and the face's outward
// unit normal (x, y, z each) and the face's index (in brep->GetFaces(); -1 for a miss).
struct BodyHits
{
    std::vector<uint8_t> found;
    std::vector<double> t;
    std::vector<double> points;
    std::vector<double> normals;
    std::vector<int32_t> faces;
};

// The first face of a body each ray meets, from a mesh of it: `vertices` and `triangles` as for
// mesh_first_hits, `owners` the index of the face of each triangle, `mesh_tolerance` how far the
// mesh is off the faces. The first triangle a ray meets gives the face; the hit is moved onto that
// face along the ray (within `tolerance`), and must lie inside it: further from its border than the
// mesh says, or inside by the face's own test.
BodyHits body_first_hits(SmBrep* brep, const std::vector<double>& vertices, const std::vector<int64_t>& triangles,
                         const std::vector<int64_t>& owners, const std::vector<double>& origins,
                         const std::vector<double>& directions, double tolerance, double mesh_tolerance);

}  // namespace smlibpy
