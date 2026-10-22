// SPDX-License-Identifier: Apache-2.0
//
// SmPyLib's long kernel calls again, with the GIL let go while the kernel works (Python only; see
// kernel_lock.h). The lambdas in SmPyLib call the kernel between converting their arguments and
// building their result, and pybind11 offers no way into them from outside, so the ones that can
// take long (Booleans, fillets, shells and offsets, sweeps and lofts, healing, stitching, mesh
// Booleans) are bound here again: the same names, arguments, defaults and docstrings, the same
// kernel call, with the GIL let go around it only. Each replaces SmPyLib's function in the flat
// module and in its category submodule, but only when pybind11 writes the same docstring for
// both (the signature and SmPyLib's own text): ext.nogil_mismatches() names those kept as they
// were, and tests/test_lane_WN.py fails on any. The same test holds each SmPyLib binding copied
// here to the source it was copied from, so a change upstream shows.

#ifdef SMLIBPY_PYTHON

#include "SmPyCommon.h"
#include "ext.h"
#include "kernel_lock.h"

#include <SmApiBrep.h>
#include <SmApiFillets.h>
#include <SmApiHeal.h>
#include <SmApiPolygons.h>
#include <SmApiPrimitives.h>

#include <string>
#include <vector>

namespace {

using smlibpy::without_gil;

std::vector<std::string>& rebound()
{
    static std::vector<std::string> names;
    return names;
}

std::vector<std::string>& mismatches()
{
    static std::vector<std::string> names;
    return names;
}

// Bind `name` again in the flat module and in its submodule `sub`, as `f` with `extra` and the
// docstring SmPyLib gave it, where pybind11 then writes the same docstring as for the original.
template <class F, class... Extra>
void rebind(py::module_ flat, const char* sub, const char* name, F f, const Extra&... extra)
{
    py::module_ category = flat.attr(sub).cast<py::module_>();
    py::object original = flat.attr(name);
    py::detail::function_record* rec = nullptr;
    if (py::handle fn = py::detail::get_function(original); fn && PyCFunction_Check(fn.ptr()))
        rec = py::detail::function_record_ptr_from_PyObject(PyCFunction_GET_SELF(fn.ptr()));
    if (!rec || rec->next)  // (not a pybind11 function, or one with overloads)
    {
        mismatches().push_back(name);
        return;
    }
    const std::string doc = rec->doc ? rec->doc : "";
    py::cpp_function in_flat(f, py::name(name), py::scope(flat), extra..., doc.c_str());
    py::cpp_function in_category(f, py::name(name), py::scope(category), extra..., doc.c_str());
    if (!original.attr("__doc__").equal(in_flat.attr("__doc__")) ||
        !category.attr(name).attr("__doc__").equal(in_category.attr("__doc__")))
    {
        mismatches().push_back(name);
        return;
    }
    flat.attr(name) = in_flat;
    category.attr(name) = in_category;
    rebound().push_back(name);
}

}  // namespace

void bind_nogil(py::module_ m)
{
    constexpr auto ref = py::return_value_policy::reference;

    // -- Booleans (SmPyBooleans.cpp) ------------------------------------------------------------
    rebind(m, "booleans", "boolean", [](SmBrep* a, SmBrep* b, SmBooleanOperationType op) {
        SmBrep* r = nullptr;
        without_gil([&] { CHECK_STATUS(SmApiBoolean(a, b, op, r)); });
        return r;
    }, ref, py::arg("brep1"), py::arg("brep2"), py::kw_only(), py::arg("operation"));

    rebind(m, "booleans", "boolean_with_options", [](SmBrep* a, SmBrep* b, SmBooleanOperationType op,
                                                     bool cookieCutter, bool imprinting, bool postProcess,
                                                     bool imprintAndClassify, bool keepOtherBrep) {
        SmBrep* r = nullptr;
        without_gil([&] {
            CHECK_STATUS(SmApiBooleanWithOptions(a, b, op, cookieCutter ? TRUE : FALSE, imprinting ? TRUE : FALSE,
                                                 postProcess ? TRUE : FALSE, imprintAndClassify ? TRUE : FALSE,
                                                 keepOtherBrep ? TRUE : FALSE, r));
        });
        return r;
    }, ref, py::arg("brep1"), py::arg("brep2"), py::kw_only(), py::arg("operation"),
       py::arg("cookie_cutter") = false, py::arg("imprinting") = false, py::arg("post_process") = true,
       py::arg("imprint_and_classify") = false, py::arg("keep_other_brep") = false);

    rebind(m, "booleans", "boolean_2d", [](SmBrep* a, SmBrep* b, Sm2DBooleanOperationType op) {
        SmBrep* r = nullptr;
        without_gil([&] { CHECK_STATUS(SmApiBoolean2d(a, b, op, r)); });
        return r;
    }, ref, py::arg("brep1"), py::arg("brep2"), py::kw_only(), py::arg("operation"));

    rebind(m, "booleans", "non_manifold_boolean", [](SmBrep* a, SmBrep* b, SmBooleanOperationType op) {
        SmBrep* r = nullptr;
        without_gil([&] { CHECK_STATUS(SmApiNonManifoldBoolean(a, b, op, r)); });
        return r;
    }, ref, py::arg("brep1"), py::arg("brep2"), py::kw_only(), py::arg("operation"));

    // -- Fillets (SmPyFillets.cpp) ---------------------------------------------------------------
    rebind(m, "fillets", "chamfer_fillet", [](SmBrep* brep, double radius) {
        without_gil([&] { CHECK_STATUS(SmApiChamferFillet(brep, radius)); });
        return brep;
    }, ref, py::arg("brep"), py::arg("radius"));

    rebind(m, "fillets", "circular_fillet", [](SmBrep* brep, double radius) {
        without_gil([&] { CHECK_STATUS(SmApiCircularFillet(brep, radius)); });
        return brep;
    }, ref, py::arg("brep"), py::arg("radius"));

    rebind(m, "fillets", "fillet_edges", [](SmBrep* brep, std::vector<SmEdge*>& edges, double radius,
                                            unsigned long xsect, unsigned long continuity, double thumbweight) {
        SmTArray<SmEdge*> arr;
        for (auto* e : edges) arr.Add(e);
        without_gil([&] { CHECK_STATUS(SmApiFilletEdges(brep, arr, radius, xsect, continuity, thumbweight)); });
        return brep;
    }, ref, py::arg("brep"), py::arg("edges"), py::kw_only(), py::arg("radius"), py::arg("xsect_type") = 1,
       py::arg("continuity") = 1, py::arg("thumbweight") = 1.0);

    rebind(m, "fillets", "variable_radius_fillet", [](SmBrep* brep, std::vector<SmEdge*>& edges, double startR,
                                                      double endR, unsigned long xsect, unsigned long continuity) {
        SmTArray<SmEdge*> arr;
        for (auto* e : edges) arr.Add(e);
        without_gil([&] { CHECK_STATUS(SmApiVariableRadiusFillet(brep, arr, startR, endR, xsect, continuity)); });
        return brep;
    }, ref, py::arg("brep"), py::arg("edges"), py::kw_only(), py::arg("start_radius"), py::arg("end_radius"),
       py::arg("xsect_type") = 1, py::arg("continuity") = 1);

    rebind(m, "fillets", "fillet_edges_per_edge", [](SmBrep* brep, std::vector<SmEdge*>& edges,
                                                     std::vector<double>& radii,
                                                     std::vector<SmFilletSurfaceGeneratorType>& xsectTypes,
                                                     unsigned long continuity, double thumbweight) {
        SmTArray<SmEdge*> earr;
        SmTArray<double> rarr;
        SmTArray<SmFilletSurfaceGeneratorType> xarr;
        for (auto* e : edges) earr.Add(e);
        for (auto r : radii) rarr.Add(r);
        for (auto x : xsectTypes) xarr.Add(x);
        without_gil([&] { CHECK_STATUS(SmApiFilletEdgesPerEdge(brep, earr, rarr, xarr, continuity, thumbweight)); });
        return brep;
    }, ref, py::arg("brep"), py::arg("edges"), py::arg("radii"), py::arg("xsect_types"), py::kw_only(),
       py::arg("continuity") = 1, py::arg("thumbweight") = 1.0);

    rebind(m, "fillets", "surface_surface_fillet", [](SmSurface* srf1, SmSurface* srf2, double r1, double r2,
                                                      double tol, unsigned long xsect, bool mirror, bool complement) {
        SmBrep* r = nullptr;
        without_gil([&] {
            CHECK_STATUS(SmApiSurfaceSurfaceFillet(srf1, srf2, r1, r2, tol, r, xsect, mirror ? TRUE : FALSE,
                                                   complement ? TRUE : FALSE));
        });
        return r;
    }, ref, py::arg("surface1"), py::arg("surface2"), py::kw_only(), py::arg("radius1"), py::arg("radius2"),
       py::arg("tolerance"), py::arg("xsect_type") = 1, py::arg("mirror") = false, py::arg("complement") = false);

    // -- Shells and offsets (SmPyOffset.cpp) -----------------------------------------------------
    rebind(m, "offset", "shell_brep", [](SmBrep* brep, double dist, bool extendedOffset, bool selfInt,
                                         bool createSolid, const std::vector<SmFace*>& facesToShell) {
        SmTArray<const SmFace*> arr;
        for (auto* f : facesToShell) arr.Add(f);
        SmBrep* r = nullptr;
        without_gil([&] {
            CHECK_STATUS(SmApiShellBrepFull(brep, dist, extendedOffset ? TRUE : FALSE, selfInt ? TRUE : FALSE,
                                            createSolid ? TRUE : FALSE, arr, r));
        });
        return r;
    }, ref, py::arg("brep"), py::arg("distance"), py::kw_only(), py::arg("extended_offset") = true,
       py::arg("self_intersection") = true, py::arg("create_solid") = true,
       py::arg("faces_to_shell") = std::vector<SmFace*>());

    rebind(m, "offset", "offset_brep", [](SmBrep* brep, double dist, bool extendedOffset, bool selfInt) {
        SmBrep* r = nullptr;
        without_gil([&] {
            CHECK_STATUS(SmApiOffsetBrepFull(brep, dist, extendedOffset ? TRUE : FALSE, selfInt ? TRUE : FALSE, r));
        });
        return r;
    }, ref, py::arg("brep"), py::arg("distance"), py::kw_only(), py::arg("extended_offset") = true,
       py::arg("self_intersection") = true);

    // -- Sweeps and lofts (SmPySweeps.cpp, SmPyPrimitives.cpp) -----------------------------------
    rebind(m, "sweeps", "linear_sweep", [](std::vector<SmCurve*>& curves, py::tuple dir, double dist, bool cap) {
        SmTArray<SmCurve*> arr;
        for (auto* c : curves) arr.Add(c);
        SmVector3d d = to_vec(dir);
        SmBrep* r = nullptr;
        without_gil([&] { CHECK_STATUS(SmApiCreateLinearSweep(arr, d, dist, cap ? TRUE : FALSE, r)); });
        return r;
    }, ref, py::arg("curves"), py::arg("direction"), py::arg("distance"), py::kw_only(), py::arg("cap_ends") = true);

    rebind(m, "sweeps", "rotational_sweep", [](std::vector<SmCurve*>& curves, py::tuple basePt, py::tuple axis,
                                               double angleDeg, bool cap) {
        SmTArray<SmCurve*> arr;
        for (auto* c : curves) arr.Add(c);
        SmPoint3d bp = to_point(basePt);
        SmVector3d ax = to_vec(axis);
        SmBrep* r = nullptr;
        without_gil([&] { CHECK_STATUS(SmApiCreateRotationalSweep(arr, bp, ax, angleDeg, cap ? TRUE : FALSE, r)); });
        return r;
    }, ref, py::arg("curves"), py::arg("base_point"), py::arg("axis"), py::arg("angle_deg"), py::kw_only(),
       py::arg("cap_ends") = true);

    rebind(m, "sweeps", "draft_sweep", [](std::vector<SmCurve*>& curves, double height, double angleDeg,
                                          bool cornerType, CapEnds capEnds) {
        SmTArray<SmCurve*> arr;
        for (auto* c : curves) arr.Add(c);
        SmBrep* r = nullptr;
        without_gil([&] {
            CHECK_STATUS(SmApiCreateDraftSweep(arr, height, angleDeg, cornerType ? TRUE : FALSE,
                                               static_cast<int>(capEnds), r));
        });
        return r;
    }, ref, py::arg("curves"), py::arg("height"), py::arg("angle_deg"), py::kw_only(),
       py::arg("fillet_corners") = false, py::arg("cap_ends") = CapEnds::BOTH);

    rebind(m, "sweeps", "pipe_sweep", [](SmCurve* path, double radius, bool cap) {
        SmBSplineCurve* bsp = dynamic_cast<SmBSplineCurve*>(path);
        if (!bsp) throw std::invalid_argument("path must be a B-spline curve");
        SmBrep* r = nullptr;
        without_gil([&] { CHECK_STATUS(SmApiCreatePipeSweep(radius, bsp, cap ? TRUE : FALSE, r)); });
        return r;
    }, ref, py::arg("path"), py::kw_only(), py::arg("radius"), py::arg("cap_ends") = true);

    rebind(m, "sweeps", "sweep_along_planar_path", [](std::vector<SmCurve*>& profileCurves,
                                                      std::vector<SmCurve*>& pathCurves, bool moveProfile,
                                                      CapEnds capEnds) {
        SmTArray<SmCurve*> prof, path;
        for (auto* c : profileCurves) prof.Add(c);
        for (auto* c : pathCurves) path.Add(c);
        SmBrep* r = nullptr;
        without_gil([&] {
            CHECK_STATUS(SmApiCreateSweepAlongPlanarPath(prof, path, moveProfile ? TRUE : FALSE,
                                                         static_cast<int>(capEnds), r));
        });
        return r;
    }, ref, py::arg("profile_curves"), py::arg("path_curves"), py::kw_only(), py::arg("move_profile") = true,
       py::arg("cap_ends") = CapEnds::BOTH);

    rebind(m, "primitives", "create_skin_primitive", [](const std::vector<unsigned long>& curves_per_profile,
                                                        const std::vector<SmCurve*>& curves3d, unsigned long degree,
                                                        bool cap_ends) {
        SmTArray<ULONG> counts;
        for (auto c : curves_per_profile) counts.Add(static_cast<ULONG>(c));
        SmTArray<const SmCurve*> arr;
        for (auto* c : curves3d) arr.Add(c);
        SmBrep* r = nullptr;
        without_gil([&] {
            CHECK_STATUS(SmApiCreateSkinPrimitive(counts, arr, static_cast<ULONG>(degree), cap_ends ? TRUE : FALSE, r,
                                                  nullptr, nullptr, nullptr));
        });
        return r;
    }, ref, py::arg("curves_per_profile"), py::arg("curves"), py::arg("degree") = 1, py::arg("cap_ends") = true);

    // -- Healing and stitching (SmPyHeal.cpp, SmPyStitching.cpp) ---------------------------------
    rebind(m, "heal", "heal_brep", [](SmBrep* brep) {
        without_gil([&] { CHECK_STATUS(SmApiHealBrep(brep)); });
        return brep;
    }, ref, py::arg("brep"));

    rebind(m, "stitching", "stitch_into_solid", [](SmBrep* brep) {
        SmBoolean bSolid = FALSE;
        ULONG stitchedEdges = 0;
        double maxVertGap = 0, maxEdgeGap = 0;
        without_gil([&] { CHECK_STATUS(SmApiStitchIntoSolid(brep, bSolid, stitchedEdges, maxVertGap, maxEdgeGap)); });
        return py::make_tuple(brep, (bool)bSolid, stitchedEdges, maxVertGap, maxEdgeGap);
    }, ref, py::arg("brep"));

    rebind(m, "stitching", "stitch_into_shell", [](SmBrep* brep, double maxRatio, bool shellIsWellFormed) {
        SmBoolean bWellFormed = shellIsWellFormed ? TRUE : FALSE;
        ULONG stitchedEdges = 0;
        double maxVertGap = 0, maxEdgeGap = 0;
        without_gil([&] {
            CHECK_STATUS(SmApiStitchIntoShell(brep, bWellFormed, maxRatio, stitchedEdges, maxVertGap, maxEdgeGap));
        });
        return py::make_tuple(brep, shellIsWellFormed, stitchedEdges, maxVertGap, maxEdgeGap);
    }, ref, py::arg("brep"), py::arg("max_stitching_ratio") = 1.0, py::kw_only(),
       py::arg("shell_is_well_formed") = false);

    // -- Mesh Booleans (SmPyPolyOps.cpp) ---------------------------------------------------------
    rebind(m, "poly", "poly_boolean", [](SmPolyBrep* a, SmPolyBrep* b, SmPolyBooleanOperationType op) {
        SmPolyBrep* r = nullptr;
        without_gil([&] { CHECK_STATUS(SmApiPolyBoolean(a, b, op, r)); });
        return r;
    }, ref, py::arg("poly_brep1"), py::arg("poly_brep2"), py::arg("operation"));

    py::module_ ext = m.attr("ext").cast<py::module_>();
    ext.def("nogil_mismatches", [] { return mismatches(); },
            "The SmPyLib functions bound again with the GIL let go (nogil.cpp) whose docstring came out "
            "different from SmPyLib's, and which therefore stay as SmPyLib made them. Empty.");
    ext.def("nogil_rebound", [] { return rebound(); },
            "The SmPyLib functions bound again with the GIL let go around their kernel call (nogil.cpp).");
}

#endif  // SMLIBPY_PYTHON
