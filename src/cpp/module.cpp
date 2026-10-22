// SPDX-License-Identifier: Apache-2.0
//
// Module spine of smlibpy._core.
//
// Registers the upstream SmPyLib bindings (usd-brep/source/SmPyLib, module `_omni_solid`
// there) under our module name, without the OpenUSD submodule, and adds the smlibpy
// extensions (exact geometry access, transforms, topology helpers) from ext_*.cpp.
// The binder sequence mirrors usd-brep/source/SmPyLib/src/SmPyMain.cpp.

#include "SmPyCommon.h"
#include "ext.h"
#include "curve_tools.h"
#include "kernel_lock.h"
#include "trace.h"

#include <SmApiGeneral.h>

// pybind11's type_caster instantiation references the parameterless operator new of the
// exposed kernel types although it is never called; the kernel only defines the
// SmContext-taking overload. Same shims as SmPyMain.cpp.
#if defined(__GNUC__) && !defined(_WIN32)
#define SMLIBPY_OPNEW_ATTR __attribute__((used, visibility("default")))
#else
#define SMLIBPY_OPNEW_ATTR
#endif

SMLIBPY_OPNEW_ATTR void* SmBrep::operator new(size_t sz) { return smos_Malloc(sz); }
SMLIBPY_OPNEW_ATTR void* SmPolyBrep::operator new(size_t sz) { return smos_Malloc(sz); }
SMLIBPY_OPNEW_ATTR void* SmPolyVertex::operator new(size_t sz) { return smos_Malloc(sz); }
SMLIBPY_OPNEW_ATTR void* SmPolyEdge::operator new(size_t sz) { return smos_Malloc(sz); }
SMLIBPY_OPNEW_ATTR void* SmPolyFace::operator new(size_t sz) { return smos_Malloc(sz); }

// SmPyUsd.cpp is not compiled (no OpenUSD dependency); the spine below does not call it. (smlibpy's own USD
// reading and writing is ext.usd_text / ext.usd_read, usd.cpp.)

PYBIND11_MODULE(_core, m)
{
    m.doc() = "SMLib kernel bindings for smlibpy (upstream SmPyLib + smlibpy extensions).";

    SmApiCreateContext();
    install_sm_error_callback();
    smlibpy::init_kernel_limits();
    smlibpy::install_kernel_trace();  // (in place of SmPyLib's trail: KernelError.trace)

    // The upstream bindings look themselves up by their own module name (for example to
    // raise TessellationError), so make that name resolve to this module.
    py::module_::import("sys").attr("modules")["_omni_solid"] = m;

    bind_enums(m);
    bind_types(m);
    bind_curve_types(m);
    bind_polybrep(m);

    auto sub = [&](const char* name, const char* doc) { return BoundModule{m, m.def_submodule(name, doc)}; };

    BoundModule bm_primitives = sub("primitives", "Solid primitives.");
    BoundModule bm_curves = sub("curves", "Curve creation, evaluation, offset, projection.");
    BoundModule bm_surfaces = sub("surfaces", "Surface creation.");
    BoundModule bm_booleans = sub("booleans", "Boolean operations on Breps.");
    BoundModule bm_sweeps = sub("sweeps", "Sweep operations.");
    BoundModule bm_fillets = sub("fillets", "Edge fillets and chamfers.");
    BoundModule bm_offset = sub("offset", "Shell, offset Brep, offset profile.");
    BoundModule bm_io = sub("io", "Native SMLib file I/O.");
    BoundModule bm_brep_ops = sub("brep_ops", "NURBS conversion.");
    BoundModule bm_stitching = sub("stitching", "Face / shell / solid stitching.");
    BoundModule bm_intersect = sub("intersect", "Geometric intersections.");
    BoundModule bm_transforms = sub("transforms", "Translate, rotate, scale, placement transforms.");
    BoundModule bm_queries = sub("queries", "Closest point, volume, topology lookups.");
    BoundModule bm_cut = sub("cutting", "Cut, project, trim operations.");
    BoundModule bm_heal = sub("heal", "BRep healing.");
    BoundModule bm_poly = sub("poly", "PolyBrep (mesh) operations.");

    bind_primitives(bm_primitives);
    bind_curves(bm_curves);
    bind_surfaces(bm_surfaces);
    bind_booleans(bm_booleans);
    bind_sweeps(bm_sweeps);
    bind_fillets(bm_fillets);
    bind_offset(bm_offset);
    bind_file_io(bm_io);
    bind_brep_ops(bm_brep_ops);
    bind_stitching(bm_stitching);
    bind_intersectors(bm_intersect);
    bind_transforms(bm_transforms);
    bind_queries(bm_queries);
    bind_cut_project_trim(bm_cut);
    bind_heal(bm_heal);
    bind_poly_ops(bm_poly);
    bind_tessellation(m);

    bind_smlibpy_ext(m.def_submodule("ext", "smlibpy extensions: exact geometry access, transforms."));
    bind_surface_eval(m.attr("ext").cast<py::module_>());
    bind_tessellate(m.attr("ext").cast<py::module_>());
    bind_sheetmetal(m.def_submodule("sheetmetal", "Sheet metal: exact bending and unbending."));
    bind_deform(m);
    bind_defeature(m);
    bind_draft(m);
    bind_face_draft(m);
    bind_face_edit(m);
    bind_measure(m.attr("ext").cast<py::module_>());
    bind_fit(m.attr("ext").cast<py::module_>());
    bind_cells(m.attr("ext").cast<py::module_>());
    bind_seams(m.attr("ext").cast<py::module_>());
    bind_distance(m.attr("ext").cast<py::module_>());
    bind_history(m.attr("ext").cast<py::module_>());
    bind_check(m.attr("ext").cast<py::module_>());
    bind_slice(m.attr("ext").cast<py::module_>());
    bind_face_attrs(m.attr("ext").cast<py::module_>());
    bind_analytics(m.attr("ext").cast<py::module_>());
    bind_shells(m.attr("ext").cast<py::module_>());
    bind_face_analysis(m.attr("ext").cast<py::module_>());
    bind_usd_files(m.attr("ext").cast<py::module_>());
    bind_fillet(m.attr("ext").cast<py::module_>());
    bind_slivers(m.attr("ext").cast<py::module_>());
    bind_oriented_sweep(m.attr("ext").cast<py::module_>());
    bind_revolutions(m.attr("ext").cast<py::module_>());
    bind_skins(m.attr("ext").cast<py::module_>());
    bind_swing(m.attr("ext").cast<py::module_>());
    bind_curve_tools(m.attr("ext").cast<py::module_>());
    bind_curve_ops(m.attr("ext").cast<py::module_>());
    bind_curve_edit(m.attr("ext").cast<py::module_>());
    bind_curve_project(m.attr("ext").cast<py::module_>());
    bind_blend(m.attr("ext").cast<py::module_>());
    bind_trim(m.attr("ext").cast<py::module_>());
    bind_stitch(m.attr("ext").cast<py::module_>());
    bind_extend(m.attr("ext").cast<py::module_>());
    bind_fill(m.attr("ext").cast<py::module_>());
    bind_shape_edit(m.attr("ext").cast<py::module_>());
    bind_sheet_edit(m.attr("ext").cast<py::module_>());
    bind_part_files(m.attr("ext").cast<py::module_>());
    bind_occt_files(m.attr("ext").cast<py::module_>());
    bind_poly_arrays(m.attr("ext").cast<py::module_>());
    bind_rays(m.attr("ext").cast<py::module_>());
    bind_hidden_lines(m.attr("ext").cast<py::module_>());
    bind_mesh_tools(m.attr("ext").cast<py::module_>());
    bind_poly_ray_intersection(m);
    bind_kernel_trace(m.attr("ext").cast<py::module_>());
    bind_caches(m.attr("ext").cast<py::module_>());

    // Threads: every entry point takes one kernel lock, and the long ones let the GIL go while the
    // kernel works (kernel_lock.cpp; SmPyLib's long calls are bound again for that, nogil.cpp).
    bind_nogil(m);
    smlibpy::lock_kernel_entries(m);
    smlibpy::bind_kernel_lock(m.attr("ext").cast<py::module_>());
}
