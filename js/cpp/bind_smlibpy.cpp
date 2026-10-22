// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's own C++ (src/cpp, shared with the Python extension) for JavaScript. The names follow
// the Python module: a function of `k.ext` is `ext__name`, of `k.draft` `draft__name`, and so on
// (the TypeScript layer puts them back into those namespaces). Results have the shapes Python
// gets: objects for dicts, arrays for tuples and lists, null for None, typed arrays (flat, by
// rows) where Python gets numpy arrays.

#include "common.h"
#include "value_js.h"

#include "cells.h"
#include "distance.h"
#include "defeature.h"
#include "deform.h"
#include "draft.h"
#include "ext_shared.h"
#include "face_draft.h"
#include "fit.h"
#include "measure.h"
#include "occt.h"
#include "part_file.h"
#include "sheetmetal.h"
#include "step_build.h"
#include "surface_eval.h"
#include "tessellate.h"
#include "usd.h"

using namespace emscripten;
using namespace smjs;

namespace {

val owned_or_null(SmBrep* b) { return b ? val(ptr(b)) : val::null(); }

// ---------------------------------------------------------------- ext: geometry and topology
val curve_data(uintptr_t c, bool nurbs) { return guard([&] { return to_js(smlibpy::curve_data(smjs::curve(c), nurbs)); }); }
val surface_data(uintptr_t s, bool nurbs) { return guard([&] { return to_js(smlibpy::surface_data(smjs::surface(s), nurbs)); }); }
val brep_dump(uintptr_t b, bool geometry) { return guard([&] { return to_js(smlibpy::brep_dump(brep(b), geometry)); }); }

val seam_edges(uintptr_t b) { return guard([&] { return number_array(smlibpy::seam_edges(brep(b))); }); }
val face_indices(uintptr_t b, val faces) { return guard([&] { return number_array(smlibpy::face_indices(brep(b), pointers<SmFace>(faces))); }); }
val edge_indices(uintptr_t b, val edges) { return guard([&] { return number_array(smlibpy::edge_indices(brep(b), pointers<SmEdge>(edges))); }); }
val vertex_indices(uintptr_t b, val vertices) { return guard([&] { return number_array(smlibpy::vertex_indices(brep(b), pointers<SmVertex>(vertices))); }); }

// [copy, faces, edges, vertices]: the copy is the caller's; the topology belongs to it.
val copy_with_map(uintptr_t b, val faces, val edges, val vertices)
{
    return guard([&] {
        const smlibpy::CopyMap r = smlibpy::copy_with_map(brep(b), pointers<SmFace>(faces), pointers<SmEdge>(edges),
                                                          pointers<SmVertex>(vertices));
        val out = val::array();
        out.call<void>("push", ptr(r.brep));
        out.call<void>("push", pointer_array(r.faces));
        out.call<void>("push", pointer_array(r.edges));
        out.call<void>("push", pointer_array(r.vertices));
        return out;
    });
}

void transform_brep(uintptr_t b, val matrix) { guard([&] { smlibpy::transform_brep(brep(b), numbers(matrix)); }); }
// As k.boolean: on success the result is brep1, changed, and brep2 is deleted; on failure both stay
// the caller's (and the kernel's Boolean mark is cleared).
uintptr_t boolean(uintptr_t brep1, uintptr_t brep2, int operation, bool non_manifold, bool imprinting)
{
    return guard([&] { return ptr(smlibpy::boolean(brep(brep1), brep(brep2), operation, non_manifold, imprinting)); });
}
val classify_points(uintptr_t b, val points, double tolerance)
{
    return guard([&] {
        std::vector<double> flat;
        const unsigned n = points["length"].as<unsigned>();
        flat.reserve(n * 3);
        for (unsigned i = 0; i < n; ++i)
        {
            const std::vector<double> p = numbers(points[i]);
            if (p.size() != 3)
                throw std::invalid_argument("expected points with three coordinates");
            flat.insert(flat.end(), p.begin(), p.end());
        }
        return to_js(smlibpy::classify_points(brep(b), flat, tolerance));
    });
}
val edge_angles(uintptr_t b, val edges) { return guard([&] { return to_js(smlibpy::edge_angles(brep(b), pointers<SmEdge>(edges))); }); }
uintptr_t copy_faces(uintptr_t b, val faces) { return guard([&] { return ptr(smlibpy::copy_faces(brep(b), pointers<SmFace>(faces))); }); }
uintptr_t face_from_surface(uintptr_t s) { return guard([&] { return ptr(smlibpy::face_from_surface(smjs::surface(s))); }); }
uintptr_t combine(val breps) { return guard([&] { return ptr(smlibpy::combine(pointers<SmBrep>(breps))); }); }
val separate_bodies(uintptr_t b) { return guard([&] { return pointer_array(smlibpy::separate_bodies(brep(b))); }); }

void delete_brep(uintptr_t b) { smlibpy::delete_brep(reinterpret_cast<SmBrep*>(b)); }
void delete_curve(uintptr_t c) { smlibpy::delete_curve(reinterpret_cast<SmCurve*>(c)); }
void delete_surface(uintptr_t s) { smlibpy::delete_surface(reinterpret_cast<SmSurface*>(s)); }
void delete_polybrep(uintptr_t p) { smlibpy::delete_polybrep(reinterpret_cast<SmPolyBrep*>(p)); }

uintptr_t copy_curve(uintptr_t c) { return guard([&] { return ptr(smlibpy::copy_curve(smjs::curve(c))); }); }
uintptr_t join_curves(val curves) { return guard([&] { return ptr(smlibpy::join_curves(pointers<SmCurve>(curves))); }); }
uintptr_t trimmed_curve(uintptr_t c, double t0, double t1) { return guard([&] { return ptr(smlibpy::trimmed_curve(smjs::curve(c), t0, t1)); }); }
uintptr_t ellipse_arc(uintptr_t c, double start, double end) { return guard([&] { return ptr(smlibpy::ellipse_arc(smjs::curve(c), start, end)); }); }
uintptr_t edge_curve(uintptr_t e) { return guard([&] { return ptr(smlibpy::edge_curve(edge(e))); }); }
val reverse_curve(uintptr_t c)
{
    return guard([&] {
        const auto r = smlibpy::reverse_curve(smjs::curve(c));
        val out = val::array();
        out.call<void>("push", r.first);
        out.call<void>("push", r.second);
        return out;
    });
}
uintptr_t approximate_curve(uintptr_t c, double tolerance) { return guard([&] { return ptr(smlibpy::approximate_curve(smjs::curve(c), tolerance)); }); }

val face_properties(uintptr_t f, double accuracy) { return guard([&] { return to_js(smlibpy::face_properties(face(f), accuracy)); }); }
val brep_properties(uintptr_t b, double accuracy, double density) { return guard([&] { return to_js(smlibpy::brep_properties(brep(b), accuracy, density)); }); }
val curve_eval(uintptr_t c, double t, int derivatives) { return guard([&] { return to_js(smlibpy::curve_eval(smjs::curve(c), t, derivatives)); }); }

// Profile and path are copied, not consumed; scale_reference and scale_curve may be null.
uintptr_t curve_sweep(val profile, uintptr_t path, bool cap_ends, bool center, bool orient, bool translational,
                      val scale_reference, val scale_curve)
{
    return guard([&] {
        return ptr(smlibpy::curve_sweep(pointers<SmCurve>(profile), as<SmBSplineCurve>(path, "path"), cap_ends, center, orient,
                                        translational, maybe<SmBSplineCurve>(scale_reference), maybe<SmBSplineCurve>(scale_curve)));
    });
}

std::string curve_kind(uintptr_t c) { return guard([&] { return smlibpy::curve_kind(smjs::curve(c)); }); }
std::string surface_kind(uintptr_t s) { return guard([&] { return smlibpy::surface_kind(smjs::surface(s)); }); }
std::string object_class(uintptr_t o) { return guard([&] { return smlibpy::object_class(as<SmObject>(o, "object")); }); }

// faces: [{surface, same_sense, loops: [{edges: [[id, forward]]} | {vertex}]}]; edges: {id: curve}
uintptr_t build_brep(val faces, val edges, bool solid, bool reversed, bool mirrored, val voids)
{
    return guard([&] {
        return ptr(smlibpy::build_brep(from_js(faces), from_js(edges), solid, reversed, mirrored, from_js(voids)));
    });
}

// The model-space curve of a curve in a surface's parameters, approximated within tolerance
val curve_on_surface(val surface, val uv, double tolerance)
{
    return guard([&] { return to_js(smlibpy::curve_on_surface(from_js(surface), from_js(uv), tolerance)); });
}

// A Brep of one face that is the whole of a surface (a surface spec), within domain [u0, u1, v0, v1] or null
uintptr_t surface_face(val surface, val domain)
{
    return guard([&] { return ptr(smlibpy::surface_face(from_js(surface), from_js(domain))); });
}

val inverted_faces(uintptr_t b) { return guard([&] { return to_js(smlibpy::inverted_faces(brep(b))); }); }
val loop_areas(uintptr_t b) { return guard([&] { return to_js(smlibpy::loop_areas(brep(b))); }); }

val seam_problems(uintptr_t b, bool fix, val only)
{
    return guard([&] {
        if (only.isNull() || only.isUndefined())
            return to_js(smlibpy::seam_problems(brep(b), fix, nullptr));
        std::vector<long> faces;
        for (double f : numbers(only))
            faces.push_back(static_cast<long>(f));
        return to_js(smlibpy::seam_problems(brep(b), fix, &faces));
    });
}

// ---------------------------------------------------------------- ext: surfaces, measures
// uv: flat (u, v) pairs. Results: flat (x, y, z) triples.
val surface_derivatives(uintptr_t s, val uv)
{
    return guard([&] {
        const smlibpy::SurfaceDerivatives r = smlibpy::surface_derivatives(smjs::surface(s), numbers(uv));
        val out = val::object();
        out.set("point", float64(r.point)), out.set("du", float64(r.du)), out.set("dv", float64(r.dv));
        out.set("duu", float64(r.duu)), out.set("duv", float64(r.duv)), out.set("dvv", float64(r.dvv));
        return out;
    });
}

val face_curvatures(uintptr_t f, val uv)
{
    return guard([&] {
        const smlibpy::FaceCurvatures r = smlibpy::face_curvatures(face(f), numbers(uv));
        val out = val::object();
        out.set("k1", float64(r.k1)), out.set("k2", float64(r.k2)), out.set("normal", float64(r.normal));
        return out;
    });
}

val poly_curvatures(uintptr_t p)
{
    return guard([&] {
        const smlibpy::PolyCurvatures r = smlibpy::poly_curvatures(*poly(p));
        val out = val::object();
        out.set("k1", float64(r.k1)), out.set("k2", float64(r.k2)), out.set("uv", float64(r.uv));
        out.set("solved", static_cast<double>(r.solved));
        return out;
    });
}

val brep_measure(uintptr_t b, double tolerance)
{
    return guard([&] {
        const smlibpy::BrepMeasure r = smlibpy::brep_measure(brep(b), tolerance);
        auto arr = [](const double* v, int n) {
            val a = val::array();
            for (int i = 0; i < n; ++i)
                a.call<void>("push", v[i]);
            return a;
        };
        val d = val::object();
        d.set("area", r.area), d.set("volume", r.volume);
        d.set("origin", arr(r.origin, 3)), d.set("first_moments", arr(r.first_moments, 3));
        d.set("second_moments", arr(r.second_moments, 6)), d.set("closure", arr(r.closure, 3));
        d.set("field_volumes", arr(r.field_volumes, 3));
        val e = val::object();
        e.set("area", r.error.area), e.set("volume", r.error.volume);
        e.set("first_moments", arr(r.error.first_moments, 3)), e.set("second_moments", arr(r.error.second_moments, 6));
        d.set("error", e);
        d.set("relative_error", r.relative_error), d.set("size", r.size), d.set("converged", r.converged);
        d.set("panels", static_cast<double>(r.panels)), d.set("evaluations", static_cast<double>(r.evaluations));
        return d;
    });
}

val nearest_points(uintptr_t a, uintptr_t b, val near_a)
{
    return guard([&] {
        const smlibpy::NearestPoints r = smlibpy::nearest_points(brep(a), brep(b), numbers(near_a));
        val d = val::object();
        d.set("a", vec3(SmVector3d(r.a[0], r.a[1], r.a[2]))), d.set("b", vec3(SmVector3d(r.b[0], r.b[1], r.b[2])));
        d.set("distance", r.distance), d.set("converged", r.converged), d.set("gain", r.gain);
        d.set("steps", static_cast<double>(r.steps));
        return d;
    });
}

val face_measure(uintptr_t f, double tolerance)
{
    return guard([&] {
        const smlibpy::FaceMeasure r = smlibpy::face_measure(face(f), tolerance);
        val d = val::object();
        d.set("area", r.area), d.set("signed_area", r.signed_area);
        d.set("origin", vec3(SmVector3d(r.origin[0], r.origin[1], r.origin[2])));
        d.set("first_moments", vec3(SmVector3d(r.first_moments[0], r.first_moments[1], r.first_moments[2])));
        d.set("error", r.error), d.set("relative_error", r.relative_error), d.set("converged", r.converged);
        d.set("panels", static_cast<double>(r.panels)), d.set("evaluations", static_cast<double>(r.evaluations));
        return d;
    });
}

double curve_length(uintptr_t c, double t0, double t1, double tolerance)
{
    return guard([&] { return smlibpy::curve_length(smjs::curve(c), t0, t1, tolerance); });
}

val curve_parameter_at_length(uintptr_t c, double t_start, double length, double tolerance)
{
    return guard([&] {
        const auto r = smlibpy::curve_parameter_at_length(smjs::curve(c), t_start, length, tolerance);
        val out = val::array();
        out.call<void>("push", r.first);
        out.call<void>("push", r.second);
        return out;
    });
}

// ---------------------------------------------------------------- ext: tessellation
val report_js(const SmTessellationReport& report, const std::string& algorithm)
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
    r.set("algorithm", algorithm);
    return r;
}

// A failed tessellation: an Error named TessellationError with .report, .failures, .status and
// .status_name, as Python's TessellationError carries them.
[[noreturn]] void throw_tessellation_error(SmStatus status, val report)
{
    std::string message = "tessellate failed";
    try
    {
        SmPyRaise(status, "tessellate", __FILE__, __LINE__);
    }
    catch (const std::exception& e)
    {
        message = e.what();
    }
    val error = val::global("Error").new_(message);
    error.set("name", std::string("TessellationError"));
    error.set("report", report);
    error.set("failures", report["failures"]);
    error.set("status", static_cast<double>(status));
    error.set("status_name", std::string(sm_status_name(status)));
    error.throw_();
    __builtin_unreachable();
}

// As Python's: the mesh (a new PolyBrep), [mesh, report] with return_report, [mesh, failures]
// with return_failures.
val tessellate(uintptr_t b, double chord, double curve_angle, double surface_angle, double max_edge_length,
               double max_aspect_ratio, std::string algorithm, bool allow_partial, bool return_failures,
               bool return_report)
{
    if (!b)
        throw_range_error("tessellate: no body");
    if (allow_partial && !return_failures && !return_report)
        throw_range_error("allow_partial=True requires return_failures=True or return_report=True");
    smlibpy::Tessellation t = guard([&] {
        smlibpy::TessellateOptions o;
        o.chord_height_tolerance = chord;
        o.curve_angle_tolerance_deg = curve_angle;
        o.surface_angle_tolerance_deg = surface_angle;
        o.max_edge_length = max_edge_length;
        o.max_aspect_ratio = max_aspect_ratio;
        o.algorithm = algorithm;
        o.allow_partial = allow_partial;
        return smlibpy::tessellate(brep(b), o);
    });
    val report = report_js(t.report, t.algorithm);
    if (t.status != SM_SUCCESS)
        throw_tessellation_error(t.status, report);
    val mesh(ptr(t.mesh));
    if (return_report || return_failures)
    {
        val out = val::array();
        out.call<void>("push", mesh);
        out.call<void>("push", return_report ? report : report["failures"]);
        return out;
    }
    return mesh;
}

std::string tessellation_algorithm(uintptr_t b, double chord, double surface_angle, double max_edge_length,
                                   double max_aspect_ratio)
{
    return guard([&] { return smlibpy::tessellation_algorithm(brep(b), chord, surface_angle, max_edge_length, max_aspect_ratio); });
}

val poly_face_indices(uintptr_t p, uintptr_t b)
{
    return guard([&] { return int32(smlibpy::poly_face_indices(poly(p), brep(b))); });
}

double grid_deviation(uintptr_t f, double chord, double surface_angle, double max_edge_length)
{
    return guard([&] { return smlibpy::grid_deviation(face(f), chord, surface_angle, max_edge_length); });
}

// ---------------------------------------------------------------- sheetmetal
// Both change the Brep in place.
val bend(uintptr_t b, double angle, double radius, double k_factor, double thickness, val axis_point, val axis,
         val direction, double length)
{
    return guard([&] {
        const smlibpy::BendFaces f = smlibpy::sheet_bend(brep(b), angle, radius, k_factor, thickness, numbers(axis_point),
                                                         numbers(axis), numbers(direction), length);
        val out = val::array();
        out.call<void>("push", static_cast<double>(f.in));
        out.call<void>("push", static_cast<double>(f.before));
        out.call<void>("push", static_cast<double>(f.after));
        return out;
    });
}

int unbend(uintptr_t b, double angle, double radius, double k_factor, double thickness, val axis_point, val axis,
           val direction, double length, val anchor)
{
    return guard([&] {
        return smlibpy::sheet_unbend(brep(b), angle, radius, k_factor, thickness, numbers(axis_point), numbers(axis),
                                     numbers(direction), length, maybe<SmFace>(anchor));
    });
}

// ---------------------------------------------------------------- deform
// The spec as smlibpy builds it: {axis?, pieces: [{kind, lo?, hi?, matrix?, origin?, ...}], tolerance?, ...}
smlibpy::DeformSpec deform_spec(const val& d)
{
    auto has = [](const val& o, const char* key) {
        return o.call<bool>("hasOwnProperty", std::string(key)) && !o[key].isNull() && !o[key].isUndefined();
    };
    smlibpy::DeformSpec spec;
    if (has(d, "axis"))
        spec.has_axis = true, spec.axis = numbers(d["axis"]);
    const val pieces = d["pieces"];
    const unsigned n = pieces["length"].as<unsigned>();
    for (unsigned i = 0; i < n; ++i)
    {
        const val p = pieces[i];
        smlibpy::DeformPiece piece;
        piece.kind = p["kind"].as<std::string>();
        if (has(p, "lo"))
            piece.has_lo = true, piece.lo = p["lo"].as<double>();
        if (has(p, "hi"))
            piece.has_hi = true, piece.hi = p["hi"].as<double>();
        auto nums = [&](const char* key, std::vector<double>& out) {
            if (has(p, key))
                out = numbers(p[key]);
        };
        nums("matrix", piece.matrix), nums("origin", piece.origin), nums("axis", piece.axis), nums("mid", piece.mid);
        nums("center", piece.center), nums("size", piece.size), nums("x", piece.x), nums("y", piece.y);
        nums("z", piece.z), nums("points", piece.points);
        if (has(p, "counts"))
            for (double c : numbers(p["counts"]))
                piece.counts.push_back(static_cast<int>(c));
        if (has(p, "period"))
            piece.period = p["period"].as<double>();
        if (has(p, "neutral"))
            piece.neutral = p["neutral"].as<double>();
        spec.pieces.push_back(std::move(piece));
    }
    if (has(d, "tolerance"))
        spec.has_tolerance = true, spec.tolerance = d["tolerance"].as<double>();
    if (has(d, "max_degree"))
        spec.has_max_degree = true, spec.max_degree = d["max_degree"].as<int>();
    if (has(d, "max_exact_points"))
        spec.has_max_exact_points = true, spec.max_exact_points = static_cast<size_t>(d["max_exact_points"].as<double>());
    if (has(d, "approx_degree"))
        spec.has_approx_degree = true, spec.approx_degree = d["approx_degree"].as<int>();
    return spec;
}

// [brep, report]
val deform_brep(uintptr_t b, val spec)
{
    return guard([&] {
        const smlibpy::Deformed r = smlibpy::deform_brep(brep(b), deform_spec(spec));
        val report = val::object();
        report.set("faces_kept", r.stats.faces_kept), report.set("faces_exact", r.stats.faces_exact);
        report.set("faces_approximated", r.stats.faces_approximated), report.set("edges_kept", r.stats.edges_kept);
        report.set("edges_exact", r.stats.edges_exact), report.set("edges_approximated", r.stats.edges_approximated);
        report.set("max_error", r.stats.max_error), report.set("max_degree", r.stats.max_degree);
        val out = val::array();
        out.call<void>("push", ptr(r.brep));
        out.call<void>("push", report);
        return out;
    });
}

uintptr_t composite_brep(uintptr_t b, val spec) { return guard([&] { return ptr(smlibpy::composite_brep(brep(b), deform_spec(spec))); }); }

val deviation(uintptr_t source, uintptr_t result, val spec, int samples)
{
    return guard([&] {
        const smlibpy::Deviation r = smlibpy::deviation(brep(source), brep(result), deform_spec(spec), samples);
        val d = val::object();
        d.set("faces", r.faces), d.set("edges", r.edges), d.set("vertices", r.vertices);
        return d;
    });
}

// points: [[x, y, z], ...] -> the same, mapped
val map_points(val spec, val points)
{
    return guard([&] {
        std::vector<double> flat;
        const unsigned n = points["length"].as<unsigned>();
        flat.reserve(n * 3);
        for (unsigned i = 0; i < n; ++i)
        {
            const std::vector<double> p = numbers(points[i]);
            if (p.size() != 3)
                throw std::invalid_argument("expected points with three coordinates");
            flat.insert(flat.end(), p.begin(), p.end());
        }
        const std::vector<double> mapped = smlibpy::map_points(deform_spec(spec), flat);
        val out = val::array();
        for (size_t i = 0; i < mapped.size(); i += 3)
            out.call<void>("push", vec3(SmVector3d(mapped[i], mapped[i + 1], mapped[i + 2])));
        return out;
    });
}

// ---------------------------------------------------------------- defeature
val blend_info(uintptr_t f, double tangency_deg)
{
    return guard([&]() -> val {
        const smlibpy::BlendInfo r = smlibpy::blend_info(face(f), tangency_deg);
        if (!r.is_blend)
            return val::null();
        val d = val::object();
        d.set("radius", r.radius), d.set("convex", r.convex);
        d.set("smooth", pointer_array(r.smooth)), d.set("rails", pointer_array(r.rails)), d.set("sharp", pointer_array(r.sharp));
        d.set("edges", r.edges);
        return d;
    });
}

val remove_fillet_faces(uintptr_t b, val faces, double tolerance)
{
    return guard([&] {
        smlibpy::FilletsRemoved r = smlibpy::remove_fillet_faces(brep(b), pointers<SmFace>(faces), tolerance);
        val removed = val::array();
        for (bool x : r.removed)
            removed.call<void>("push", x);
        val d = val::object();
        d.set("brep", owned_or_null(r.brep));
        d.set("removed", removed);
        return d;
    });
}

val defeature(uintptr_t b, val groups, std::string rebuild)
{
    return guard([&] {
        std::vector<std::vector<SmFace*>> g;
        const unsigned n = groups["length"].as<unsigned>();
        for (unsigned i = 0; i < n; ++i)
            g.push_back(pointers<SmFace>(groups[i]));
        const smlibpy::Defeatured r = smlibpy::defeature(brep(b), g, rebuild);
        val d = val::object();
        d.set("added", r.added), d.set("applied", r.applied), d.set("brep", owned_or_null(r.brep));
        return d;
    });
}

// ---------------------------------------------------------------- draft, face_draft
val face_draft_range(uintptr_t f, val direction, int grid)
{
    return guard([&] {
        const smlibpy::DraftRange r = smlibpy::face_draft_range(face(f), numbers(direction), grid);
        val d = val::object();
        d.set("min", r.min), d.set("max", r.max);
        d.set("min_point", vec3(SmVector3d(r.min_point[0], r.min_point[1], r.min_point[2])));
        d.set("max_point", vec3(SmVector3d(r.max_point[0], r.max_point[1], r.max_point[2])));
        return d;
    });
}

val split_at_silhouettes(uintptr_t b, val direction, double tolerance, val faces)
{
    return guard([&] {
        const smlibpy::SilhouetteSplit r = smlibpy::split_at_silhouettes(brep(b), numbers(direction), tolerance, pointers<SmFace>(faces));
        val d = val::object();
        d.set("brep", ptr(r.brep)), d.set("edges", pointer_array(r.edges)), d.set("failed", number_array(r.failed));
        d.set("exact", r.exact), d.set("traced", r.traced);
        return d;
    });
}

val draft_faces(uintptr_t b, val faces, val origin, val normal, double angle, double tangency_deg)
{
    return guard([&] {
        const smlibpy::FaceDraft r = smlibpy::draft_faces(brep(b), pointers<SmFace>(faces), numbers(origin), numbers(normal), angle, tangency_deg);
        auto pair = [](const double* v) {
            val a = val::array();
            a.call<void>("push", v[0]);
            a.call<void>("push", v[1]);
            return a;
        };
        val d = val::object();
        d.set("brep", owned_or_null(r.brep));
        d.set("error", r.error.empty() ? val::null() : val(r.error));
        d.set("face", static_cast<double>(r.face));
        d.set("other", r.other ? val(ptr(r.other)) : val::null());
        d.set("gaps", r.has_gaps ? pair(r.gaps) : val::null());
        d.set("gaps_before", r.has_gaps_before ? pair(r.gaps_before) : val::null());
        d.set("before", number_array(r.before));
        d.set("tolerance", r.tolerance);
        if (r.has_restored)
            d.set("restored", static_cast<double>(r.restored));
        return d;
    });
}

}  // namespace

// ---------------------------------------------------------------- ext: clouds, meshes, cells, USD
template <typename... T>
val items(const T&... values)
{
    val out = val::array();
    (out.call<void>("push", val(values)), ...);
    return out;
}

bool none(const val& v) { return v.isNull() || v.isUndefined(); }

// [surface, max_error, rms_error, nu, nv]: the surface is the caller's. nu, nv 0: chosen here.
val fit_surface(val points, int nu, int nv, double smoothing)
{
    return guard([&] {
        const smlibpy::SurfaceFit r = smlibpy::fit_surface(numbers(points), nu, nv, smoothing);
        return items(ptr(r.surface), r.max_error, r.rms_error, r.nu, r.nv);
    });
}

uintptr_t poly_from_triangles(val vertices, val triangles)
{
    return guard([&] {
        std::vector<long> t;
        for (double x : numbers(triangles))
            t.push_back(static_cast<long>(x));
        return ptr(smlibpy::poly_from_triangles(numbers(vertices), t));
    });
}

void triangulate_poly(uintptr_t p) { guard([&] { smlibpy::triangulate_poly(poly(p)); }); }

// Per cell, the solids inside its shells (outer first), each the caller's.
val region_shells(uintptr_t b)
{
    return guard([&] {
        val out = val::array();
        for (const auto& cell : smlibpy::region_shells(brep(b)))
            out.call<void>("push", pointer_array(cell));
        return out;
    });
}

// items: [brep or null, name, [r, g, b] or null, points or null, triangles or null, normals or null]
std::string usd_text(val shapes, std::string up_axis, double meters_per_unit, bool materials)
{
    return guard([&] {
        std::vector<smlibpy::UsdItem> in;
        const unsigned n = shapes["length"].as<unsigned>();
        for (unsigned i = 0; i < n; ++i)
        {
            val it = shapes[i];
            smlibpy::UsdItem item;
            item.brep = maybe<SmBrep>(it[0]);
            item.name = it[1].as<std::string>();
            if (!none(it[2]))
                item.color = numbers(it[2]);
            if (!none(it[3]))
                item.points = numbers(it[3]);
            if (!none(it[4]))
                for (double x : numbers(it[4]))
                    item.triangles.push_back(static_cast<long>(x));
            if (it["length"].as<unsigned>() > 5 && !none(it[5]))
                item.normals = numbers(it[5]);
            in.push_back(std::move(item));
        }
        return smlibpy::usd_text(in, up_axis, meters_per_unit, materials);
    });
}

// [[brep, name, [r, g, b] or null]] of the BrepArray prims; the Breps are the caller's.
val usd_read(std::string text, bool heal)
{
    return guard([&] {
        val out = val::array();
        for (auto& item : smlibpy::usd_read(text, heal))
            out.call<void>("push", items(ptr(item.brep), item.name, item.color.empty() ? val::null() : float64(item.color)));
        return out;
    });
}

// The assets a .usda text names (subLayers, references, payloads), each once, as written.
val usd_assets(std::string text)
{
    return guard([&] {
        val out = val::array();
        for (const std::string& a : smlibpy::usd_assets(text))
            out.call<void>("push", a);
        return out;
    });
}

// {bodies: [[brep, name, [r, g, b] or null]], warnings, unresolved, skipped} of a stage whose layers are
// [[id, text, {asset: id}, {asset: why not read}]], the root first; the Breps are the caller's.
val usd_stage(val layers, bool heal, bool check, bool placement, double units, bool partial)
{
    return guard([&] {
        auto strings = [](val o) {
            std::map<std::string, std::string> out;
            val keys = val::global("Object").call<val>("keys", o);
            const unsigned n = keys["length"].as<unsigned>();
            for (unsigned i = 0; i < n; ++i)
            {
                const std::string k = keys[i].as<std::string>();
                out[k] = o[k].as<std::string>();
            }
            return out;
        };
        std::vector<smlibpy::UsdLayer> in;
        const unsigned n = layers["length"].as<unsigned>();
        for (unsigned i = 0; i < n; ++i)
        {
            val l = layers[i];
            in.push_back(smlibpy::UsdLayer{l[0].as<std::string>(), l[1].as<std::string>(), strings(l[2]), strings(l[3])});
        }
        smlibpy::UsdReadOptions options;
        options.heal = heal, options.check = check, options.placement = placement, options.units = units;
        options.partial = partial;
        smlibpy::UsdStage stage = smlibpy::usd_stage(in, options);
        val bodies = val::array(), warnings = val::array(), unresolved = val::array(), skipped = val::array();
        for (auto& item : stage.items)
            bodies.call<void>("push", items(ptr(item.brep), item.name, item.color.empty() ? val::null() : float64(item.color)));
        for (const std::string& w : stage.warnings)
            warnings.call<void>("push", w);
        for (const std::string& u : stage.unresolved)
            unresolved.call<void>("push", u);
        for (const std::string& u : stage.skipped)
            skipped.call<void>("push", u);
        val out = val::object();
        out.set("bodies", bodies);
        out.set("warnings", warnings);
        out.set("unresolved", unresolved);
        out.set("skipped", skipped);
        return out;
    });
}

// The contents of a part file (.smp, a Uint8Array) of items [brep or null, curve or null, name or null,
// [r, g, b] or null, wire]: bodies and curves, each with its name and color.
val part_bytes(val list, bool ascii)
{
    return guard([&] {
        std::vector<smlibpy::PartItem> in;
        const unsigned n = list["length"].as<unsigned>();
        for (unsigned i = 0; i < n; ++i)
        {
            val it = list[i];
            smlibpy::PartItem item;
            item.brep = maybe<SmBrep>(it[0]);
            item.curve = maybe<SmCurve>(it[1]);
            if (!none(it[2]))
                item.name = it[2].as<std::string>();
            if (!none(it[3]))
                item.color = numbers(it[3]);
            item.wire = static_cast<long>(it[4].as<double>());
            in.push_back(std::move(item));
        }
        const std::string out = smlibpy::part_bytes(in, ascii);
        return val::global("Uint8Array").new_(
            typed_memory_view(out.size(), reinterpret_cast<const unsigned char*>(out.data())));
    });
}

// [[brep or null, curve or null, name, [r, g, b] or null, wire]] of a part file's contents (a Uint8Array):
// its bodies and curves, the caller's.
val part_items(std::string data)
{
    return guard([&] {
        val out = val::array();
        for (auto& item : smlibpy::part_items(data))
            out.call<void>("push", items(item.brep ? val(ptr(item.brep)) : val::null(),
                                         item.curve ? val(ptr(item.curve)) : val::null(), item.name,
                                         item.color.empty() ? val::null() : float64(item.color),
                                         static_cast<double>(item.wire)));
        return out;
    });
}

// {bodies: [brep, ...], warnings: [...]} of an OpenCASCADE .brep file's contents (a Uint8Array or the
// text of an ASCII file); the Breps are the caller's.
val occt_read(std::string data, bool heal, bool check)
{
    return guard([&] {
        smlibpy::OcctReadOptions options;
        options.heal = heal, options.check = check;
        smlibpy::OcctRead got = smlibpy::occt_read(data, options);
        val bodies = val::array(), warnings = val::array();
        for (SmBrep* b : got.bodies)
            bodies.call<void>("push", ptr(b));
        for (const std::string& w : got.warnings)
            warnings.call<void>("push", w);
        val out = val::object();
        out.set("bodies", bodies);
        out.set("warnings", warnings);
        return out;
    });
}

// The ASCII OpenCASCADE .brep text of bodies (a compound when there are several).
std::string occt_text(val breps)
{
    return guard([&] { return smlibpy::occt_text(pointers<SmBrep>(breps)); });
}

EMSCRIPTEN_BINDINGS(smlib_smlibpy)
{
    function("ext__curve_data", &curve_data);
    function("ext__surface_data", &surface_data);
    function("ext__brep_dump", &brep_dump);
    function("ext__seam_edges", &seam_edges);
    function("ext__face_indices", &face_indices);
    function("ext__edge_indices", &edge_indices);
    function("ext__vertex_indices", &vertex_indices);
    function("ext__copy_with_map", &copy_with_map);
    function("ext__transform_brep", &transform_brep);
    function("ext__boolean", &boolean);
    function("ext__classify_points", &classify_points);
    function("ext__edge_angles", &edge_angles);
    function("ext__copy_faces", &copy_faces);
    function("ext__face_from_surface", &face_from_surface);
    function("ext__combine", &combine);
    function("ext__separate_bodies", &separate_bodies);
    function("ext__delete_brep", &delete_brep);
    function("ext__delete_curve", &delete_curve);
    function("ext__delete_surface", &delete_surface);
    function("ext__delete_polybrep", &delete_polybrep);
    function("ext__copy_curve", &copy_curve);
    function("ext__trimmed_curve", &trimmed_curve);
    function("ext__join_curves", &join_curves);
    function("ext__ellipse_arc", &ellipse_arc);
    function("ext__edge_curve", &edge_curve);
    function("ext__reverse_curve", &reverse_curve);
    function("ext__approximate_curve", &approximate_curve);
    function("ext__face_properties", &face_properties);
    function("ext__brep_properties", &brep_properties);
    function("ext__curve_eval", &curve_eval);
    function("ext__curve_sweep", &curve_sweep);
    function("ext__curve_kind", &curve_kind);
    function("ext__surface_kind", &surface_kind);
    function("ext__object_class", &object_class);
    function("ext__build_brep", &build_brep);
    function("ext__surface_face", &surface_face);
    function("ext__curve_on_surface", &curve_on_surface);
    function("ext__inverted_faces", &inverted_faces);
    function("ext__loop_areas", &loop_areas);
    function("ext__seam_problems", &seam_problems);
    function("ext__surface_derivatives", &surface_derivatives);
    function("ext__face_curvatures", &face_curvatures);
    function("ext__poly_curvatures", &poly_curvatures);
    function("ext__brep_measure", &brep_measure);
    function("ext__fit_surface", &fit_surface);
    function("ext__poly_from_triangles", &poly_from_triangles);
    function("ext__triangulate_poly", &triangulate_poly);
    function("ext__region_shells", &region_shells);
    function("ext__usd_text", &usd_text);
    function("ext__usd_read", &usd_read);
    function("ext__usd_assets", &usd_assets);
    function("ext__usd_stage", &usd_stage);
    function("ext__part_bytes", &part_bytes);
    function("ext__part_items", &part_items);
    function("ext__occt_read", &occt_read);
    function("ext__occt_text", &occt_text);
    function("ext__face_measure", &face_measure);
    function("ext__nearest_points", &nearest_points);
    function("ext__curve_length", &curve_length);
    function("ext__curve_parameter_at_length", &curve_parameter_at_length);
    function("ext__tessellate", &tessellate);
    function("ext__tessellation_algorithm", &tessellation_algorithm);
    function("ext__poly_face_indices", &poly_face_indices);
    function("ext__grid_deviation", &grid_deviation);

    function("sheetmetal__bend", &bend);
    function("sheetmetal__unbend", &unbend);

    function("deform__deform_brep", &deform_brep);
    function("deform__composite_brep", &composite_brep);
    function("deform__deviation", &deviation);
    function("deform__map_points", &map_points);

    function("defeature__blend_info", &blend_info);
    function("defeature__remove_fillet_faces", &remove_fillet_faces);
    function("defeature__defeature", &defeature);

    function("draft__face_draft_range", &face_draft_range);
    function("draft__split_at_silhouettes", &split_at_silhouettes);
    function("face_draft__draft_faces", &draft_faces);
}
