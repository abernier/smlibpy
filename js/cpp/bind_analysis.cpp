// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's face and edge analysis (src/cpp/face_analysis.cpp) and the nearest points of a body
// and a curve (src/cpp/distance.cpp) for JavaScript, as `ext__name` like bind_smlibpy.cpp: the
// results have the shapes Python gets (objects for dicts, arrays for tuples, null for None).

#include "common.h"

#include "distance.h"
#include "face_analysis.h"

using namespace emscripten;
using namespace smjs;

namespace {

val triple(const double* x) { return vec3(SmVector3d(x[0], x[1], x[2])); }

val nearest_curve_points(uintptr_t body, uintptr_t c, double t0, double t1, double near_t)
{
    return guard([&] {
        const smlibpy::NearestPoints r = smlibpy::nearest_curve_points(brep(body), smjs::curve(c), t0, t1, near_t);
        val d = val::object();
        d.set("a", triple(r.a)), d.set("b", triple(r.b));
        d.set("distance", r.distance), d.set("converged", r.converged), d.set("gain", r.gain);
        d.set("steps", static_cast<double>(r.steps)), d.set("t", r.t);
        d.set("face_a", r.face_a ? val(ptr(r.face_a)) : val::null());
        return d;
    });
}

val face_curvature(uintptr_t f, double u, double v)
{
    return guard([&] {
        const smlibpy::FaceCurvature r = smlibpy::face_curvature(face(f), u, v);
        val d = val::object();
        d.set("point", triple(r.point)), d.set("normal", triple(r.normal));
        d.set("k1", r.k1), d.set("k2", r.k2);
        d.set("d1", triple(r.d1)), d.set("d2", triple(r.d2));
        return d;
    });
}

val face_min_radius(uintptr_t f, int grid)
{
    return guard([&] {
        const smlibpy::MinRadius r = smlibpy::face_min_radius(face(f), grid);
        val d = val::object();
        d.set("radius", r.radius), d.set("point", triple(r.point));
        val uv = val::array();
        uv.call<void>("push", r.uv[0]);
        uv.call<void>("push", r.uv[1]);
        d.set("uv", uv);
        d.set("evaluations", static_cast<double>(r.evaluations));
        return d;
    });
}

// The curves are the caller's.
val face_iso_curves(uintptr_t f, bool constant_u, double value)
{
    return guard([&] { return pointer_array(smlibpy::face_iso_curves(face(f), constant_u, value)); });
}

val edge_continuity(uintptr_t e, int samples)
{
    return guard([&] {
        const smlibpy::EdgeContinuity r = smlibpy::edge_continuity(edge(e), samples);
        val d = val::object();
        d.set("samples", r.samples), d.set("gap", r.gap), d.set("angle", r.angle), d.set("jump", r.jump);
        d.set("curvature", r.curvature), d.set("tolerance", r.tolerance), d.set("length", r.length);
        d.set("gap_at", triple(r.gap_at)), d.set("angle_at", triple(r.angle_at)), d.set("jump_at", triple(r.jump_at));
        return d;
    });
}

val edge_outer_angles(uintptr_t b, val edges, int samples)
{
    return guard([&] {
        val out = val::array();
        for (const std::vector<double>& angles : smlibpy::edge_outer_angles(brep(b), pointers<SmEdge>(edges), samples))
        {
            val a = val::array();
            for (double x : angles)
                a.call<void>("push", x);
            out.call<void>("push", a);
        }
        return out;
    });
}

}  // namespace

EMSCRIPTEN_BINDINGS(smlib_analysis)
{
    function("ext__nearest_curve_points", &nearest_curve_points);
    function("ext__face_curvature", &face_curvature);
    function("ext__face_min_radius", &face_min_radius);
    function("ext__face_iso_curves", &face_iso_curves);
    function("ext__edge_continuity", &edge_continuity);
    function("ext__edge_outer_angles", &edge_outer_angles);
}
