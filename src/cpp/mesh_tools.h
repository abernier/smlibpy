// SPDX-License-Identifier: Apache-2.0
//
// Triangle meshes as arrays (mesh_tools.cpp): nearest points, corner normals, decimation, holes
// and repair, faceted bodies. Plain C++, shared by the Python extension and the JavaScript module.
// A mesh is `vertices` (x, y, z each) and `triangles` (three vertex indices each).

#pragma once

#include <cstdint>
#include <vector>

class SmBrep;

namespace smlibpy {

// The nearest point of a mesh to each of `points` (x, y, z each): the index of its triangle (-1
// for none: a mesh without triangles), the distance and the point (x, y, z each).
struct MeshNearest
{
    std::vector<int32_t> triangles;
    std::vector<double> distances;
    std::vector<double> points;
};

MeshNearest mesh_nearest_points(const std::vector<double>& vertices, const std::vector<int64_t>& triangles,
                             const std::vector<double>& points);

// Corner normals (x, y, z for each corner, nine per triangle): at each corner the average of the
// normals of the triangles around its point (weighted by their angle there) that turn from this
// triangle's normal by at most `crease_angle_deg`; sharper edges stay sharp. Points that lie on
// each other count as one. A sliver (no higher than a tenth of its longest side) that turns from
// all its neighbours by more than the crease angle takes the normals around it.
std::vector<float> crease_normals(const std::vector<double>& vertices, const std::vector<int64_t>& triangles,
                                  double crease_angle_deg);

// A mesh as arrays.
struct TriangleArrays
{
    std::vector<double> vertices;
    std::vector<int64_t> triangles;
};

// The kernel's quadric decimation (SmPolyDecimate::DoQuadricDecimation) of a mesh: `fraction` of
// its points removed (0 < fraction < 1; the triangles go down by about as much), by collapsing the
// edges whose removal changes the shape least first. Edges between triangles that turn by more
// than `feature_angle_deg` are features; `keep_boundary` keeps the edges of an open mesh's
// border. Points that lie on each other are merged first.
TriangleArrays decimate_triangles(const std::vector<double>& vertices, const std::vector<int64_t>& triangles,
                                  double fraction, double feature_angle_deg, bool keep_boundary);

// What repair_triangles did, and the mesh it made: `triangles` refer to the input's vertices
// (points that lie on each other by the first of them) and, from vertices.size() / 3 on, to
// `new_vertices`; `sources` gives for each triangle the input triangle it is (-1: a new one,
// filling a hole).
struct MeshRepair
{
    std::vector<int64_t> triangles;
    std::vector<double> new_vertices;
    std::vector<int64_t> sources;
    int64_t merged_vertices = 0;    // vertices merged into another that lies on them
    int64_t removed_triangles = 0;  // triangles left out: without area (corners merged) or repeated
    int64_t flipped_triangles = 0;  // triangles turned to face the way their neighbours face
    int64_t filled_holes = 0;       // holes closed
    int64_t open_holes = 0;         // holes left open (borders that do not close, or failed)
    int64_t open_edges = 0;         // edges of the result not shared by two triangles
};

// Repair of a mesh. Points that lie on each other (to 1e-9 of the largest coordinate) are one
// point. With `clean`, triangles whose corners merged and repeated triangles are left out, and the
// triangles are turned to face the way their neighbours face (a closed piece outward, an open one
// as most of its triangles did). With `fill`, every hole (a border of edges that only one triangle
// has, closing on itself) is closed by triangles: the kernel's triangulation of the polygon.
MeshRepair repair_triangles(const std::vector<double>& vertices, const std::vector<int64_t>& triangles, bool clean,
                            bool fill);

// A faceted body of a closed mesh (SmBrep::CreateFromPolyBrep: a planar face per polygon,
// stitched). With `merge_coplanar`, neighbouring triangles in one plane (within the mesh's
// tolerance, 1e-7 of its size) become one face first. `faces` is the number of faces the body
// gets; with more than `max_faces` (0: no limit) no body is made (`brep` is null).
struct FacetedBody
{
    SmBrep* brep = nullptr;
    int64_t faces = 0;
};

FacetedBody brep_from_triangles(const std::vector<double>& vertices, const std::vector<int64_t>& triangles,
                                bool merge_coplanar, int64_t max_faces);

}  // namespace smlibpy
