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

// SmPyUsd.cpp is not compiled (no OpenUSD dependency); the spine below does not call it.
void bind_usd(py::module_&) {}

PYBIND11_MODULE(_core, m)
{
    m.doc() = "SMLib kernel bindings for smlibpy (upstream SmPyLib + smlibpy extensions).";

    SmApiCreateContext();
    install_sm_error_callback();

    // The upstream bindings look themselves up by their own module name (for example to
    // raise TessellationError), so make that name resolve to this module.
    py::module_::import("sys").attr("modules")["_omni_solid"] = m;

    bind_enums(m);
    bind_types(m);
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
    bind_sheetmetal(m.def_submodule("sheetmetal", "Sheet metal: exact bending and unbending."));
}
