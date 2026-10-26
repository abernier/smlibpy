// SPDX-License-Identifier: Apache-2.0
//
// Triangle meshes as arrays (src/cpp/mesh_tools.cpp) for JavaScript: Python's ext.mesh_nearest_points,
// ext.crease_normals, ext.decimate_triangles, ext.repair_triangles and ext.brep_from_triangles as
// ext__<name>. Arrays of numbers go in (vertices x, y, z each; triangles three vertex indices each);
// typed arrays come out.

#include "common.h"
#include "mesh_tools.h"

using namespace emscripten;

namespace {

std::vector<int64_t> indices(const val& a)
{
    const std::vector<double> v = smjs::numbers(a);
    return std::vector<int64_t>(v.begin(), v.end());
}

val int32_of(const std::vector<int64_t>& v)
{
    return smjs::int32(std::vector<int32_t>(v.begin(), v.end()));
}

// {triangles (Int32Array, -1 for none), distances, points (Float64Arrays)}
val mesh_nearest_points(val vertices, val triangles, val points)
{
    const smlibpy::MeshNearest r = smjs::guard([&] {
        return smlibpy::mesh_nearest_points(smjs::numbers(vertices), indices(triangles), smjs::numbers(points));
    });
    val out = val::object();
    out.set("triangles", smjs::int32(r.triangles));
    out.set("distances", smjs::float64(r.distances));
    out.set("points", smjs::float64(r.points));
    return out;
}

// Float32Array, nine numbers per triangle
val crease_normals(val vertices, val triangles, double crease_angle)
{
    return smjs::float32(smjs::guard([&] {
        return smlibpy::crease_normals(smjs::numbers(vertices), indices(triangles), crease_angle);
    }));
}

// {vertices (Float64Array), triangles (Int32Array)}
val decimate_triangles(val vertices, val triangles, double fraction, double feature_angle, bool keep_boundary)
{
    const smlibpy::TriangleArrays r = smjs::guard([&] {
        return smlibpy::decimate_triangles(smjs::numbers(vertices), indices(triangles), fraction, feature_angle,
                                           keep_boundary);
    });
    val out = val::object();
    out.set("vertices", smjs::float64(r.vertices));
    out.set("triangles", int32_of(r.triangles));
    return out;
}

// {triangles, sources (Int32Arrays), new_vertices (Float64Array), and the counts}
val repair_triangles(val vertices, val triangles, bool clean, bool fill)
{
    const smlibpy::MeshRepair r = smjs::guard([&] {
        return smlibpy::repair_triangles(smjs::numbers(vertices), indices(triangles), clean, fill);
    });
    val out = val::object();
    out.set("triangles", int32_of(r.triangles));
    out.set("new_vertices", smjs::float64(r.new_vertices));
    out.set("sources", int32_of(r.sources));
    out.set("merged_vertices", static_cast<double>(r.merged_vertices));
    out.set("removed_triangles", static_cast<double>(r.removed_triangles));
    out.set("flipped_triangles", static_cast<double>(r.flipped_triangles));
    out.set("filled_holes", static_cast<double>(r.filled_holes));
    out.set("open_holes", static_cast<double>(r.open_holes));
    out.set("open_edges", static_cast<double>(r.open_edges));
    return out;
}

// {brep (a new Brep, the caller's; 0 with more faces than max_faces > 0), faces}
val brep_from_triangles(val vertices, val triangles, bool merge_coplanar, double max_faces)
{
    const smlibpy::FacetedBody r = smjs::guard([&] {
        return smlibpy::brep_from_triangles(smjs::numbers(vertices), indices(triangles), merge_coplanar,
                                            static_cast<int64_t>(max_faces));
    });
    val out = val::object();
    out.set("brep", smjs::ptr(r.brep));
    out.set("faces", static_cast<double>(r.faces));
    return out;
}

}  // namespace

EMSCRIPTEN_BINDINGS(smlib_mesh_tools)
{
    function("ext__mesh_nearest_points", &mesh_nearest_points);
    function("ext__crease_normals", &crease_normals);
    function("ext__decimate_triangles", &decimate_triangles);
    function("ext__repair_triangles", &repair_triangles);
    function("ext__brep_from_triangles", &brep_from_triangles);
}
