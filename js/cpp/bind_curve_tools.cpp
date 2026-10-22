// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's curve tools (src/cpp/curve_tools.cpp, shared with the Python extension) for
// JavaScript, under Python's names: `ext__intersect_curves` is `k.ext.intersect_curves`.

#include "common.h"
#include "value_js.h"

#include "curve_tools.h"

using namespace emscripten;
using namespace smjs;

namespace {

val intersect_curves(uintptr_t a, double a0, double a1, uintptr_t b, double b0, double b1, double tolerance)
{
    return guard([&] { return to_js(smlibpy::intersect_curves(smjs::curve(a), a0, a1, smjs::curve(b), b0, b1, tolerance)); });
}
val self_intersections(uintptr_t c, double t0, double t1, double tolerance)
{
    return guard([&] { return to_js(smlibpy::self_intersections(smjs::curve(c), t0, t1, tolerance)); });
}
val intersect_curve_faces(uintptr_t c, double t0, double t1, val faces, double tolerance)
{
    return guard([&] { return to_js(smlibpy::intersect_curve_faces(smjs::curve(c), t0, t1, pointers<SmFace>(faces), tolerance)); });
}
uintptr_t extend_curve(uintptr_t c, double distance, bool at_start, int continuity)
{
    return guard([&] { return ptr(smlibpy::extend_curve(smjs::curve(c), distance, at_start, continuity)); });
}

}  // namespace

EMSCRIPTEN_BINDINGS(smlib_curve_tools)
{
    function("ext__intersect_curves", &intersect_curves);
    function("ext__self_intersections", &self_intersections);
    function("ext__intersect_curve_faces", &intersect_curve_faces);
    function("ext__extend_curve", &extend_curve);
}
