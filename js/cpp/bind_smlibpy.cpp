// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's own C++ (src/cpp, shared with the Python extension) for JavaScript. The names follow
// the Python module: a function of `k.ext` is `ext__name`, of `k.draft` `draft__name`, and so on
// (the TypeScript layer puts them back into those namespaces). Results have the shapes Python
// gets: objects for dicts, arrays for tuples and lists, null for None, typed arrays (flat, by
// rows) where Python gets numpy arrays.

#include "common.h"
#include "value_js.h"

#include "defeature.h"
#include "deform.h"
#include "draft.h"
#include "ext_shared.h"
#include "face_draft.h"
#include "measure.h"
#include "sheetmetal.h"
#include "step_build.h"
#include "surface_eval.h"
#include "tessellate.h"

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
uintptr_t copy_faces(uintptr_t b, val faces) { return guard([&] { return ptr(smlibpy::copy_faces(brep(b), pointers<SmFace>(faces))); }); }
uintptr_t face_from_surface(uintptr_t s) { return guard([&] { return ptr(smlibpy::face_from_surface(smjs::surface(s))); }); }
uintptr_t combine(val breps) { return guard([&] { return ptr(smlibpy::combine(pointers<SmBrep>(breps))); }); }
val separate_bodies(uintptr_t b) { return guard([&] { return pointer_array(smlibpy::separate_bodies(brep(b))); }); }

void delete_brep(uintptr_t b) { smlibpy::delete_brep(reinterpret_cast<SmBrep*>(b)); }
void delete_curve(uintptr_t c) { smlibpy::delete_curve(reinterpret_cast<SmCurve*>(c)); }
void delete_surface(uintptr_t s) { smlibpy::delete_surface(reinterpret_cast<SmSurface*>(s)); }
void delete_polybrep(uintptr_t p) { smlibpy::delete_polybrep(reinterpret_cast<SmPolyBrep*>(p)); }

uintptr_t copy_curve(uintptr_t c) { return guard([&] { return ptr(smlibpy::copy_curve(smjs::curve(c))); }); }
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

val inverted_faces(uintptr_t b) { return guard([&] { return to_js(smlibpy::inverted_faces(brep(b))); }); }

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
    function("ext__inverted_faces", &inverted_faces);
    function("ext__seam_problems", &seam_problems);
    function("ext__surface_derivatives", &surface_derivatives);
    function("ext__face_curvatures", &face_curvatures);
    function("ext__poly_curvatures", &poly_curvatures);
    function("ext__brep_measure", &brep_measure);
    function("ext__face_measure", &face_measure);
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
