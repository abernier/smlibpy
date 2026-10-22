// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's sheet edits, surfaces from NURBS data and distances to a surface (src/cpp/sheet_edit.cpp,
// shared with the Python extension) for JavaScript, under Python's names: `ext__match_edge` is
// `k.ext.match_edge`.

#include "common.h"

#include "sheet_edit.h"

using namespace emscripten;
using namespace smjs;

namespace {

// A copy of the body (the caller's) whose edge runs along the curve (not consumed).
uintptr_t match_edge(uintptr_t b, uintptr_t e, uintptr_t c, double extent)
{
    return guard([&] { return ptr(smlibpy::match_edge(brep(b), edge(e), smjs::curve(c), extent)); });
}
// A sheet of one face (the caller's) on one surface over both faces.
uintptr_t merge_faces(uintptr_t a, uintptr_t b) { return guard([&] { return ptr(smlibpy::merge_faces(face(a), face(b))); }); }
// A B-spline surface (the caller's) from its NURBS data.
uintptr_t nurbs_surface(int du, int dv, int nu, int nv, val poles, val u_knots, val v_knots, val weights)
{
    return guard([&] {
        return ptr(smlibpy::nurbs_surface(du, dv, nu, nv, numbers(poles), numbers(u_knots), numbers(v_knots), numbers(weights)));
    });
}
// The distance of each point (x, y, z flat) from the surface, as a Float64Array.
val surface_distances(uintptr_t s, val points)
{
    return guard([&] { return float64(smlibpy::surface_distances(smjs::surface(s), numbers(points))); });
}

}  // namespace

EMSCRIPTEN_BINDINGS(smlib_sheet_edit)
{
    function("ext__match_edge", &match_edge);
    function("ext__merge_faces", &merge_faces);
    function("ext__nurbs_surface", &nurbs_surface);
    function("ext__surface_distances", &surface_distances);
}
