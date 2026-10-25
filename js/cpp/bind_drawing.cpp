// SPDX-License-Identifier: Apache-2.0
//
// Drawing views with hidden lines (src/cpp/hidden_lines.cpp) for JavaScript: Python's
// ext.hidden_lines as ext__hidden_lines.

#include "common.h"
#include "hidden_lines.h"

using namespace emscripten;

namespace {

// [visible, hidden]: arrays of new standalone curves (numbers), the caller's.
val hidden_lines(uintptr_t b, val plane_point, val plane_normal, bool seams, bool smooth_edges)
{
    const smlibpy::HiddenLines r = smjs::guard([&] {
        return smlibpy::hidden_lines(smjs::brep(b), smjs::numbers(plane_point), smjs::numbers(plane_normal), seams,
                                     smooth_edges);
    });
    val out = val::array();
    out.call<void>("push", smjs::pointer_array(r.visible));
    out.call<void>("push", smjs::pointer_array(r.hidden));
    return out;
}

}  // namespace

EMSCRIPTEN_BINDINGS(smlib_drawing)
{
    function("ext__hidden_lines", &hidden_lines);
}
