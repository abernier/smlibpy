// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's curve editing and curves on faces (src/cpp/curve_edit.cpp and curve_project.cpp, shared
// with the Python extension) for JavaScript, under Python's names: `ext__deform_ends` is
// `k.ext.deform_ends`. A curve on a face comes back as [curve, face index], as Python's tuple.

#include "common.h"
#include "value_js.h"

#include "curve_edit.h"
#include "curve_project.h"

using namespace emscripten;
using namespace smjs;

namespace {

std::vector<double> optional(const val& v) { return v.isNull() || v.isUndefined() ? std::vector<double>() : numbers(v); }

val face_curves(const std::vector<smlibpy::FaceCurve>& r)
{
    val out = val::array();
    for (const smlibpy::FaceCurve& fc : r)
    {
        val pair = val::array();
        pair.call<void>("push", ptr(fc.curve));
        pair.call<void>("push", fc.face);
        out.call<void>("push", pair);
    }
    return out;
}

val curve_list(const std::vector<SmCurve*>& r)
{
    val out = val::array();
    for (SmCurve* c : r)
        out.call<void>("push", ptr(c));
    return out;
}

uintptr_t refine_curve(uintptr_t c, int degree, val knots)
{
    return guard([&] { return ptr(smlibpy::refine_curve(smjs::curve(c), degree, optional(knots))); });
}
val deform_ends(uintptr_t c, val start, val end, val start_tangent, val end_tangent)
{
    return guard([&] {
        smlibpy::EditedCurve r = smlibpy::deform_ends(smjs::curve(c), optional(start), optional(end), optional(start_tangent),
                                                      optional(end_tangent));
        val out = val::array();
        out.call<void>("push", ptr(r.curve));
        out.call<void>("push", r.deviation);
        return out;
    });
}
val project_curve(val faces, uintptr_t c, val direction, double tolerance, double distance)
{
    return guard([&] {
        return face_curves(smlibpy::project_curve(pointers<SmFace>(faces), smjs::curve(c), numbers(direction), tolerance, distance));
    });
}
val normal_project(val faces, uintptr_t c, double tolerance)
{
    return guard([&] { return face_curves(smlibpy::normal_project(pointers<SmFace>(faces), smjs::curve(c), tolerance)); });
}
val trim_to_face(uintptr_t f, val curves, double tolerance)
{
    return guard([&] { return curve_list(smlibpy::trim_to_face(smjs::face(f), pointers<SmCurve>(curves), tolerance)); });
}
val iso_curves(uintptr_t f, bool along_v, double value, double tolerance)
{
    return guard([&] { return curve_list(smlibpy::iso_curves(smjs::face(f), along_v, value, tolerance)); });
}

}  // namespace

EMSCRIPTEN_BINDINGS(smlib_curve_edit)
{
    function("ext__refine_curve", &refine_curve);
    function("ext__deform_ends", &deform_ends);
    function("ext__project_curve", &project_curve);
    function("ext__normal_project", &normal_project);
    function("ext__trim_to_face", &trim_to_face);
    function("ext__iso_curves", &iso_curves);
}
