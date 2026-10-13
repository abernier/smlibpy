// SPDX-License-Identifier: Apache-2.0
//
// The kernel's calls that create geometry: primitives, curves, surfaces (SmPyPrimitives.cpp,
// SmPyCurves.cpp, SmPySurfaces.cpp). Conventions in bind_kernel.cpp.

#include "bind_kernel.h"

#include <SmApiCurves.h>
#include <SmApiPrimitives.h>
#include <SmApiSurfaces.h>
#include <SmApiTrimmedSurfaces.h>
#include <SmEllipse.h>

using namespace emscripten;

namespace {

using namespace smjs;
using namespace smjs::kernel;

// ---------------------------------------------------------------- primitives (SmPyPrimitives.cpp)
uintptr_t create_box(val origin, double length, double width, double height)
{
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiCreateBox(vec(origin), length, width, height, r));
    return ptr(r);
}

uintptr_t create_sphere(val origin, double radius)
{
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiCreateSphere(vec(origin), radius, r));
    return ptr(r);
}

uintptr_t create_cone(val origin, double radius_base, double radius_top, double height)
{
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiCreateCone(vec(origin), radius_base, radius_top, height, r));
    return ptr(r);
}

uintptr_t create_cylinder(val origin, double radius, double height)
{
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiCreateCylinder(vec(origin), radius, height, r));
    return ptr(r);
}

uintptr_t create_torus(val origin, double radius_major, double radius_minor)
{
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiCreateTorus(vec(origin), radius_major, radius_minor, r));
    return ptr(r);
}

// Loft through profiles (curves concatenated, curves_per_profile of each); the curves stay the
// caller's. Python defaults: degree 1, cap_ends true.
uintptr_t create_skin_primitive(val curves_per_profile, val curves, unsigned long degree, bool cap_ends)
{
    SmTArray<ULONG> n;
    for (ULONG c : ulongs(curves_per_profile, "curves_per_profile"))
        n.Add(c);
    SmTArray<const SmCurve*> arr;
    fill(curves, arr);
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiCreateSkinPrimitive(n, arr, degree, flag(cap_ends), r, nullptr, nullptr, nullptr));
    return ptr(r);
}

EMSCRIPTEN_BINDINGS(smlib_kernel_primitives)
{
    function("create_box", &create_box);
    function("create_sphere", &create_sphere);
    function("create_cone", &create_cone);
    function("create_cylinder", &create_cylinder);
    function("create_torus", &create_torus);
    function("create_skin_primitive", &create_skin_primitive);
}

// ---------------------------------------------------------------- curves (SmPyCurves.cpp)
uintptr_t create_line_segment(val start, val end)
{
    SmLine* r = nullptr;
    SMJS_CHECK(SmApiCreateLineSegment(vec(start), vec(end), r));
    return curve_ptr(r);
}

// An analytic circle in the plane z = center.z.
uintptr_t create_circle(val center, double radius)
{
    SmCircle* r = nullptr;
    SMJS_CHECK(SmApiCreateCircle(vec(center), radius, r));
    return curve_ptr(r);
}

uintptr_t create_ellipse(val origin, double radius1, double radius2)
{
    SmEllipse* r = nullptr;
    SMJS_CHECK(SmApiCreateEllipse(vec(origin), radius1, radius2, r));
    return curve_ptr(r);
}

// A B-spline helix about +Z. Python defaults (keyword-only): right_handed true, tolerance 1e-4.
uintptr_t create_helix(val origin, double height, double radius_start, double radius_end, double turns,
                       bool right_handed, double tolerance)
{
    SmBSplineCurve* r = nullptr;
    SMJS_CHECK(SmApiCreateHelix(vec(origin), height, radius_start, radius_end, turns, flag(right_handed), tolerance,
                                r));
    return curve_ptr(r);
}

// Four line segments, head to tail.
val create_rectangle(val center, double length, double width)
{
    SmTArray<SmBSplineCurve*> r;
    SMJS_CHECK(SmApiCreateRectangle(vec(center), length, width, r));
    return curve_array(r);
}

// weights: null for a non-rational curve. Python defaults: weights None, degree 3,
// form BSplineCurveForm_UNSPECIFIED.
uintptr_t create_canonical_curve(val points, val knots, val knot_multiplicities, val weights, unsigned long degree,
                                 int form)
{
    SmTArray<SmPoint3d> pts;
    fill_points(points, pts);
    SmTArray<double> kv;
    for (double k : numbers(knots))
        kv.Add(k);
    SmTArray<ULONG> km;
    for (ULONG m : ulongs(knot_multiplicities, "knot_multiplicities"))
        km.Add(m);
    SmTArray<double> w;
    if (!absent(weights))
        for (double x : numbers(weights))
            w.Add(x);
    const SmBSplineCurveForm f = one_of<SmBSplineCurveForm>(
        form,
        {SM_CF_POLYLINE_FORM, SM_CF_CIRCULAR_ARC, SM_CF_ELLIPTIC_ARC, SM_CF_PARABOLIC_ARC, SM_CF_HYPERBOLIC_ARC,
         SM_CF_HELICAL_ARC, SM_CF_UNSPECIFIED},
        "form (BSplineCurveForm)");
    SmBSplineCurve* r = nullptr;
    SMJS_CHECK(SmApiCreateCanonicalCurve(pts, kv, km, absent(weights) ? nullptr : &w, degree, f, r));
    return curve_ptr(r);
}

EMSCRIPTEN_BINDINGS(smlib_kernel_curves)
{
    function("create_line_segment", &create_line_segment);
    function("create_circle", &create_circle);
    function("create_ellipse", &create_ellipse);
    function("create_helix", &create_helix);
    function("create_rectangle", &create_rectangle);
    function("create_canonical_curve", &create_canonical_curve);
}

// ---------------------------------------------------------------- surfaces (SmPySurfaces.cpp)
// control_points: rows * cols points, row-major.
uintptr_t create_surface_from_points(val control_points, unsigned long rows, unsigned long cols)
{
    SmTArray<SmPoint3d> pts;
    fill_points(control_points, pts);
    SmSurface* r = nullptr;
    SMJS_CHECK(SmApiCreateSurface(pts, rows, cols, r));
    return ptr(r);
}

// Interpolates rows * cols points, row-major.
uintptr_t create_surface_from_ordered_points(val points, unsigned long rows, unsigned long cols)
{
    SmTArray<SmPoint3d> pts;
    fill_points(points, pts);
    SmSurface* r = nullptr;
    SMJS_CHECK(SmApiCreateSurfaceFromOrderedPoints(pts, rows, cols, r));
    return ptr(r);
}

// The curves (B-splines) stay the caller's.
uintptr_t create_ruled_surface(uintptr_t curve1, uintptr_t curve2)
{
    SmBSplineCurve* c1 = bspline(curve1, "curve1");
    SmBSplineCurve* c2 = bspline(curve2, "curve2");
    SmSurface* r = nullptr;
    SMJS_CHECK(SmApiCreateRuledSurface(c1, c2, r));
    return ptr(r);
}

// profiles: two or more B-spline curves; they stay the caller's.
uintptr_t create_skin_surface(val profiles)
{
    SmTArray<SmBSplineCurve*> arr;
    const unsigned n = profiles["length"].as<unsigned>();
    for (unsigned i = 0; i < n; ++i)
        arr.Add(bspline(profiles[i].as<uintptr_t>(), "profiles"));
    SmSurface* r = nullptr;
    SMJS_CHECK(SmApiCreateSkin(arr, r));
    return ptr(r);
}

// A sheet of planar faces bounded by closed loops. Consumes the curves on success (the faces use
// them); on failure they stay the caller's.
uintptr_t create_planar_faces(val curves)
{
    SmTArray<SmCurve*> arr;
    fill(curves, arr);
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiCreatePlanarFaces(arr, r));
    return ptr(r);
}

EMSCRIPTEN_BINDINGS(smlib_kernel_surfaces)
{
    function("create_surface_from_points", &create_surface_from_points);
    function("create_surface_from_ordered_points", &create_surface_from_ordered_points);
    function("create_ruled_surface", &create_ruled_surface);
    function("create_skin_surface", &create_skin_surface);
    function("create_planar_faces", &create_planar_faces);
}

}  // namespace
