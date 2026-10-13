// SPDX-License-Identifier: Apache-2.0
//
// The kernel's calls that transform, measure, intersect and project, heal, and the mesh path
// (SmPyTransforms.cpp, SmPyQueries.cpp, SmPyIntersectors.cpp, SmPyCutProjectTrim.cpp,
// SmPyHeal.cpp, SmPyPolyOps.cpp, SmPyTessellation.cpp). Conventions in bind_kernel.cpp.

#include "bind_kernel.h"

#include <SmApiBrep.h>
#include <SmApiGeneral.h>
#include <SmApiHeal.h>
#include <SmApiIntersectors.h>
#include <SmApiPolygons.h>
#include <SmApiQueries.h>
#include <SmAxis2Placement.h>
#include <SmPolyMerge.h>

using namespace emscripten;

namespace {

using namespace smjs;
using namespace smjs::kernel;

// ---------------------------------------------------------------- transforms (SmPyTransforms.cpp)
// Python's Axis2Placement(origin, x_axis, y_axis) is a kernel value; here it is the plain object
// {origin, x, y} of the kernel's canonical frame (unit axes, y made perpendicular to x), which
// transform takes.
val axis2_placement(val origin, val x_axis, val y_axis)
{
    const SmAxis2Placement p(vec(origin), vec(x_axis), vec(y_axis));
    val out = val::object();
    out.set("origin", vec3(p.GetOrigin()));
    out.set("x", vec3(p.GetXAxis()));
    out.set("y", vec3(p.GetYAxis()));
    return out;
}

SmAxis2Placement placement_of(const val& p)
{
    if (absent(p) || absent(p["origin"]) || absent(p["x"]) || absent(p["y"]))
        throw_error("placement must be {origin, x, y} (Axis2Placement)");
    return SmAxis2Placement(vec(p["origin"]), vec(p["x"]), vec(p["y"]));
}

// Mutates target (a Brep, PolyBrep, standalone curve or surface; not one owned by a Brep);
// returns it. The axis is the line ref_point + t * axis; right-hand rule.
uintptr_t rotate(uintptr_t target, val ref_point, val axis, double angle_deg)
{
    SMJS_CHECK(SmApiRotate(object(target), vec(ref_point), vec(axis), angle_deg));
    return target;
}

// Mutates target as rotate; returns it. Moves the world frame onto the placement's frame.
uintptr_t transform(uintptr_t target, val placement)
{
    const SmAxis2Placement p = placement_of(placement);
    SMJS_CHECK(SmApiTransform(object(target), p));
    return target;
}

EMSCRIPTEN_BINDINGS(smlib_kernel_transforms)
{
    function("Axis2Placement", &axis2_placement);
    function("rotate", &rotate);
    function("transform", &transform);
}

// ---------------------------------------------------------------- queries (SmPyQueries.cpp)
// [closest_point, distance]
val brep_closest_point(uintptr_t b, val point)
{
    SmPoint3d closest;
    double distance = 0;
    SMJS_CHECK(SmApiBrepClosestPoint(brep(b), vec(point), closest, distance));
    return tuple(vec3(closest), distance);
}

// [closest_point, parameter, distance]
val curve_closest_point(uintptr_t c, val point)
{
    SmPoint3d closest;
    double parameter = 0, distance = 0;
    SMJS_CHECK(SmApiCurveClosestPoint(smjs::curve(c), vec(point), closest, parameter, distance));
    return tuple(vec3(closest), parameter, distance);
}

// [closest_point, uvs, distance]: uvs lists every known [u, v] of the point (seam aliases too).
val surface_closest_point(uintptr_t s, val point)
{
    SmPoint3d closest;
    SmTArray<SmPoint2d> uvs;
    double distance = 0;
    SMJS_CHECK(SmApiSurfaceClosestPoint(smjs::surface(s), vec(point), closest, uvs, distance));
    val uv = val::array();
    for (ULONG i = 0; i < uvs.GetSize(); ++i)
        uv.call<void>("push", tuple(uvs[i].x, uvs[i].y));
    return tuple(vec3(closest), uv, distance);
}

// {relationship, distance}: relationship 'separate', 'touching', 'interpenetrating',
// 'a_contains_b' or 'b_contains_a'; distance the gap between the surfaces (0 when they meet).
val brep_relationship(uintptr_t a, uintptr_t b)
{
    int relationship = 0;
    double distance = 0;
    SMJS_CHECK(SmApiBrepRelationship(brep(a), brep(b), relationship, distance));
    static const char* const names[] = {"separate", "touching", "interpenetrating", "a_contains_b", "b_contains_a"};
    val out = val::object();
    out.set("relationship", val::u8string(relationship >= 0 && relationship <= 4 ? names[relationship] : "unknown"));
    out.set("distance", distance);
    return out;
}

EMSCRIPTEN_BINDINGS(smlib_kernel_queries)
{
    function("brep_closest_point", &brep_closest_point);
    function("curve_closest_point", &curve_closest_point);
    function("surface_closest_point", &surface_closest_point);
    function("brep_relationship", &brep_relationship);
}

// ---------------------------------------------------------------- intersect (SmPyIntersectors.cpp)
// Inputs unchanged; the curves are new and the caller's.

// [curves, points]: intersection curves and isolated touching points ([x, y, z]).
val intersect_breps(uintptr_t brep1, uintptr_t brep2)
{
    SmTArray<SmCurve*> curves;
    SmTArray<SmPoint3d> points;
    SMJS_CHECK(SmApiIntersectBreps(brep(brep1), brep(brep2), curves, &points));
    return tuple(curve_array(curves), point_array(points));
}

// The section curves of the plane through plane_point.
val intersect_brep_with_plane(uintptr_t b, val plane_point, val plane_normal)
{
    SmTArray<SmCurve*> curves;
    SMJS_CHECK(SmApiIntersectBrepWithPlane(brep(b), vec(plane_point), vec(plane_normal), curves));
    return curve_array(curves);
}

// [points, params_on_curve1, params_on_curve2]: points [x, y, z]; the parameters Float64Arrays.
val intersect_curves(uintptr_t curve1, uintptr_t curve2)
{
    SmTArray<SmPoint3d> points;
    SmTArray<double> t1, t2;
    SMJS_CHECK(SmApiIntersectCurves(smjs::curve(curve1), smjs::curve(curve2), &points, &t1, &t2));
    return tuple(point_array(points), float64(doubles(t1)), float64(doubles(t2)));
}

EMSCRIPTEN_BINDINGS(smlib_kernel_intersect)
{
    function("intersect_breps", &intersect_breps);
    function("intersect_brep_with_plane", &intersect_brep_with_plane);
    function("intersect_curves", &intersect_curves);
}

// ---------------------------------------------------------------- cutting (SmPyCutProjectTrim.cpp)
// brep unchanged; the curves are new and the caller's.

// The Brep's edges projected along plane_normal onto the plane.
val project_brep_onto_plane(uintptr_t b, val plane_point, val plane_normal)
{
    SmTArray<SmCurve*> curves;
    SMJS_CHECK(SmApiProjectBrepOntoPlane(brep(b), vec(plane_point), vec(plane_normal), curves));
    return curve_array(curves);
}

// The silhouette seen along plane_normal (plane_point is not used).
val create_silhouette_curves(uintptr_t b, val plane_point, val plane_normal)
{
    SmTArray<SmCurve*> curves;
    SMJS_CHECK(SmApiCreateSilhouetteCurves(brep(b), vec(plane_point), vec(plane_normal), curves));
    return curve_array(curves);
}

// The curve (a B-spline, unchanged) projected along projection_vector onto the Brep's faces.
val project_curve(uintptr_t b, uintptr_t c, val projection_vector)
{
    SmBSplineCurve* bsp = bspline(c, "curve");
    SmTArray<SmCurve*> curves;
    SMJS_CHECK(SmApiProjectCurve(brep(b), bsp, vec(projection_vector), curves));
    return curve_array(curves);
}

EMSCRIPTEN_BINDINGS(smlib_kernel_cutting)
{
    function("project_brep_onto_plane", &project_brep_onto_plane);
    function("create_silhouette_curves", &create_silhouette_curves);
    function("project_curve", &project_curve);
}

// ---------------------------------------------------------------- heal (SmPyHeal.cpp)
// Mutates brep; returns it.
uintptr_t heal_brep(uintptr_t b)
{
    SMJS_CHECK(SmApiHealBrep(brep(b)));
    return b;
}

EMSCRIPTEN_BINDINGS(smlib_kernel_heal)
{
    function("heal_brep", &heal_brep);
}

// ---------------------------------------------------------------- poly (SmPyPolyOps.cpp)
// Consumes both meshes: the result is poly_brep1, changed; poly_brep2 is deleted.
// operation: PolyBooleanOp.
uintptr_t poly_boolean(uintptr_t poly_brep1, uintptr_t poly_brep2, int operation)
{
    const SmPolyBooleanOperationType op = one_of<SmPolyBooleanOperationType>(
        operation, {SM_PBO_UNION, SM_PBO_INTERSECTION, SM_PBO_DIFFERENCE, SM_PBO_MERGE, SM_PBO_PARTIAL_MERGE},
        "operation (PolyBooleanOp)");
    SmPolyBrep* r = nullptr;
    SMJS_CHECK(SmApiPolyBoolean(poly(poly_brep1), poly(poly_brep2), op, r));
    return ptr(r);
}

EMSCRIPTEN_BINDINGS(smlib_kernel_poly)
{
    function("poly_boolean", &poly_boolean);
}

// ---------------------------------------------------------------- tessellation (SmPyTessellation.cpp)
// [points, counts, edges]: one polyline per edge of brep. points is a Float64Array, flat (x, y, z
// per point; Python: a list of tuples), counts a Float64Array (the points of each edge, in order),
// edges the edges themselves (they belong to brep). allow_partial keeps the edges that could be
// sampled when others fail (those count 0). Python defaults (keyword-only): angle_tolerance_deg 5,
// allow_partial false.
val tessellate_boundaries(uintptr_t b, double angle_tolerance_deg, bool allow_partial)
{
    SmBrep* source = brep(b);
    SmTArray<SmPoint3d> points;
    SmTArray<ULONG> counts;
    SmTArray<SmEdge*> edges;
    SmPyErrorTrail::clear();
    const SmStatus status = SmApiTessellateBoundaries(source, angle_tolerance_deg, points, counts, edges);
    // (as SmPyLib: the edges are listed before sampling, so only sampled points show a usable result)
    const SmStatus effective = allow_partial && status == SM_ERR && points.GetSize() > 0 ? SM_SUCCESS : status;
    if (effective != SM_SUCCESS)
        raise_status(effective, "SmApiTessellateBoundaries", __FILE__, __LINE__);
    std::vector<double> flat;
    flat.reserve(3 * points.GetSize());
    for (const SmPoint3d& p : points)
    {
        flat.push_back(p.x);
        flat.push_back(p.y);
        flat.push_back(p.z);
    }
    return tuple(float64(flat), float64(doubles(counts)), pointer_array(edges));
}

// SmPyLib's report of a tessellation (tessellation_report_to_dict).
val tessellation_report(const SmTessellationReport& report)
{
    val failures = val::array();
    for (ULONG i = 0; i < report.failures.GetSize(); ++i)
    {
        const SmTessellationFailure& f = report.failures[i];
        val entry = val::object();
        entry.set("face_index", static_cast<double>(f.lFaceIndex));
        entry.set("stage", std::string(f.eStage == SM_TS_BOUNDARY_PREPARATION ? "boundary_preparation"
                                       : f.eStage == SM_TS_FACE_TESSELLATION   ? "face_tessellation"
                                                                               : "polygon_output"));
        entry.set("status", static_cast<double>(f.eStatus));
        entry.set("status_name", std::string(sm_status_name(f.eStatus)));
        failures.call<void>("push", entry);
    }
    val r = val::object();
    r.set("failures", failures);
    r.set("lamina_edge_count", static_cast<double>(report.laminaEdges));
    r.set("spine_edge_count", static_cast<double>(report.spineEdges));
    r.set("input_manifold", bool(report.inputManifold));
    r.set("output_manifold", bool(report.outputManifold));
    r.set("has_mesh", bool(report.hasMesh));
    return r;
}

// The kernel's own tessellation (SmApiTessellate, always the grid), as SmPyLib's tessellate: the
// mesh (a new PolyBrep), [mesh, report] with return_report, [mesh, failures] with
// return_failures. A failure throws an Error named TessellationError with .report, .failures,
// .status and .status_name. Python defaults (keyword-only): SmTessellationDefaults (chord height
// 0, angles 25, no edge length, no aspect ratio), allow_partial, return_failures and return_report
// false.
val tessellate(uintptr_t b, double chord_height_tolerance, double curve_angle_tolerance_deg, double surface_angle_tolerance_deg,
               double max_edge_length, double max_aspect_ratio, bool allow_partial, bool return_failures, bool return_report)
{
    SmBrep* source = brep(b);
    if (allow_partial && !return_failures && !return_report)
        throw_range_error("allow_partial=True requires return_failures=True or return_report=True");
    SmPolyBrep* r = nullptr;
    SmTessellationReport report;
    SmPyErrorTrail::clear();
    SmTessellationParams params;
    params.dChordHeightTol = chord_height_tolerance;
    params.dCurveAngleTolDeg = curve_angle_tolerance_deg;
    params.dSurfaceAngleTolDeg = surface_angle_tolerance_deg;
    params.dMaxEdgeLength = max_edge_length;
    params.dMaxAspectRatio = max_aspect_ratio;
    const SmStatus status = SmApiTessellate(source, r, params, flag(allow_partial), nullptr, &report);
    if (status != SM_SUCCESS)
    {
        std::string message = "SmApiTessellate failed";
        try
        {
            SmPyRaise(status, "SmApiTessellate", __FILE__, __LINE__);
        }
        catch (const std::exception& e)
        {
            message = e.what();
        }
        val error = val::global("Error").new_(message);
        val dict = tessellation_report(report);
        error.set("name", std::string("TessellationError"));
        error.set("report", dict);
        error.set("failures", dict["failures"]);
        error.set("status", static_cast<double>(status));
        error.set("status_name", std::string(sm_status_name(status)));
        error.throw_();
    }
    val mesh(ptr(r));
    if (return_report)
        return tuple(mesh, tessellation_report(report));
    if (return_failures)
        return tuple(mesh, tessellation_report(report)["failures"]);
    return mesh;
}

EMSCRIPTEN_BINDINGS(smlib_kernel_tessellation)
{
    function("tessellate_boundaries", &tessellate_boundaries);
    function("tessellate", &tessellate);
}

}  // namespace
