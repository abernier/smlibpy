// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's curve operations (src/cpp/curve_ops.cpp, shared with the Python extension) for
// JavaScript, under Python's names: `ext__offset_curve` is `k.ext.offset_curve`. A curve and its
// numbers come back as [curve, deviation, tight] (curve 0: none), as Python's tuple.

#include "common.h"
#include "value_js.h"

#include "curve_ops.h"

#include <string>

using namespace emscripten;
using namespace smjs;

namespace {

val result(const smlibpy::CurveResult& r)
{
    val out = val::array();
    out.call<void>("push", ptr(r.curve));
    out.call<void>("push", r.deviation);
    out.call<void>("push", r.tight);
    return out;
}

std::vector<double> optional(const val& v) { return v.isNull() || v.isUndefined() ? std::vector<double>() : numbers(v); }

val offset_curve(uintptr_t c, val normal, double distance, double tolerance)
{
    return guard([&] { return result(smlibpy::offset_curve(smjs::curve(c), numbers(normal), distance, tolerance)); });
}
val approximate_points(val points, int degree, double tolerance, val start_tangent, val end_tangent, bool closed)
{
    return guard([&] {
        return result(smlibpy::approximate_points(numbers(points), degree, tolerance, optional(start_tangent),
                                                  optional(end_tangent), closed));
    });
}
val interpolate_tangents(val points, val tangents, int degree)
{
    return guard([&] { return result(smlibpy::interpolate_tangents(numbers(points), numbers(tangents), degree)); });
}

val approximate_tangents(val points, val tangents, double tolerance)
{
    return guard([&] { return result(smlibpy::approximate_tangents(numbers(points), numbers(tangents), tolerance)); });
}
val curve_geometry(uintptr_t c, double t)
{
    return guard([&] { return to_js(smlibpy::curve_geometry(smjs::curve(c), t)); });
}
val curve_properties(uintptr_t c, double t0, double t1, std::string kind, double value, double tolerance)
{
    return guard([&] { return to_js(smlibpy::curve_properties(smjs::curve(c), t0, t1, kind, value, tolerance)); });
}
val curve_box(uintptr_t c, double t0, double t1)
{
    return guard([&] { return to_js(smlibpy::curve_box(smjs::curve(c), t0, t1)); });
}
val lines_and_arcs(uintptr_t c, double tolerance)
{
    return guard([&] { return to_js(smlibpy::lines_and_arcs(smjs::curve(c), tolerance)); });
}

}  // namespace

EMSCRIPTEN_BINDINGS(smlib_curve_ops)
{
    function("ext__offset_curve", &offset_curve);
    function("ext__approximate_points", &approximate_points);
    function("ext__interpolate_tangents", &interpolate_tangents);
    function("ext__approximate_tangents", &approximate_tangents);
    function("ext__curve_geometry", &curve_geometry);
    function("ext__curve_properties", &curve_properties);
    function("ext__curve_box", &curve_box);
    function("ext__lines_and_arcs", &lines_and_arcs);
}
