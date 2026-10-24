// SPDX-License-Identifier: Apache-2.0
#pragma once

#include "SmPyCommon.h"
#include "kernel_lock.h"

// smlibpy additions to the upstream bindings, registered as `_core.ext`.
void bind_smlibpy_ext(py::module_ m);

// STEP import: Brep construction from neutral data (step_build.cpp).
void bind_step_build(py::module_& m);

// Exact surface derivatives and curvatures (surface_eval.cpp).
void bind_surface_eval(py::module_ m);
// Sheet metal: exact bending and unbending (sheetmetal.cpp), registered as `_core.sheetmetal`.
void bind_sheetmetal(py::module_ m);
// Space deformations: twist, taper, bend, lattice (deform.cpp).
void bind_deform(py::module_& m);
// Fillet and face removal (defeature.cpp), registered as `_core.defeature`.
void bind_defeature(py::module_& m);

// Draft analysis and parting lines (draft.cpp), registered as `_core.draft`.
void bind_draft(py::module_& m);
// Face drafts with SmBrep::LocalOperation (face_draft.cpp), registered as `_core.face_draft`.
void bind_face_draft(py::module_& m);
// Faces moved and offset with SmBrep::LocalOperation (face_edit.cpp), registered as `_core.face_edit`.
void bind_face_edit(py::module_& m);

// Areas, volumes, moments and curve lengths with an error bound (measure.cpp).
void bind_measure(py::module_ m);
// Tessellation that halves the faces of bodies with twisted faces (tessellate.cpp).
void bind_tessellate(py::module_ m);
// Surfaces fitted to point clouds, kernel meshes from triangles (fit.cpp).
void bind_fit(py::module_ m);
// The cells of a non-manifold body (cells.cpp).
void bind_cells(py::module_ m);
// Seams tangent to the other operand of a Boolean (seams.cpp).
void bind_seams(py::module_ m);
// The nearest points of two bodies (distance.cpp).
void bind_distance(py::module_ m);
// Plane sections within a tolerance (measuring.cpp).
void bind_measuring(py::module_ m);
// Curvature, iso-parametric curves and edge continuity of faces (face_analysis.cpp).
void bind_face_analysis(py::module_ m);
// USD files of exact bodies: BrepArray prims as .usda text (usd.cpp).
void bind_usd_files(py::module_ m);
// Where the faces and edges of a body came from: tags the kernel carries along (history.cpp).
void bind_history(py::module_ m);
// What is wrong with a body: the kernel's validity checks and gaps (check.cpp).
void bind_check(py::module_ m);
// A solid split by a sheet (slice.cpp).
void bind_slice(py::module_ m);
// Colors and names of single faces (face_attrs.cpp).
void bind_face_attrs(py::module_ m);
// Analytic faces and edges recognized in B-splines (analytics.cpp).
void bind_analytics(py::module_ m);
// The shells of a body: outside, cavities, cells (shells.cpp).
void bind_shells(py::module_ m);
// Fillets and chamfers with the fillet executive's record of a failure (fillet.cpp).
void bind_fillet(py::module_ m);
// Faces without area removed from a copy of a Brep (slivers.cpp).
void bind_slivers(py::module_ m);
// Sweeps with the profile's attitude given along the path, helix axes (oriented_sweep.cpp).
void bind_oriented_sweep(py::module_ m);
// Analytic surfaces for revolved faces (revolutions.cpp).
void bind_revolutions(py::module_ m);
// Lofts with end tangents, closed lofts (skins.cpp).
void bind_skins(py::module_ m);
// Swung bodies: profiles carried around outlines (swing.cpp).
void bind_swing(py::module_ m);
// Curve intersections with a tolerance, curve x face intersections, extended curves (curve_tools.cpp).
void bind_curve_tools(py::module_ m);
// The kernel's ellipse, parabola and hyperbola curves as classes of their own (curve_tools.cpp).
void bind_curve_types(py::module_& m);
// Curve offsets, fits, curvature queries, exact boxes, lines and arcs (curve_ops.cpp).
void bind_curve_ops(py::module_ m);
// B-splines refined and curves whose ends move (curve_edit.cpp).
void bind_curve_edit(py::module_ m);
// Curves projected onto faces, lifted from their parameter planes and iso curves (curve_project.cpp).
void bind_curve_project(py::module_ m);
// Blend surfaces between two free edges of sheets (blend.cpp).
void bind_blend(py::module_ m);
// Trimming and splitting faces with curves on them (trim.cpp).
void bind_trim(py::module_ m);
// Sewing faces, turning faces over (stitch.cpp).
void bind_stitch(py::module_ m);
// Extending a face's surface, untrimming a face (extend.cpp).
void bind_extend(py::module_ m);
// Surfaces bounded by curves: fills and curve networks (fill.cpp).
void bind_fill(py::module_ m);
// Local edits of a face's surface: push, warp, flatten (shape_edit.cpp).
void bind_shape_edit(py::module_ m);
// Matching sheet edges to curves, merging faces, surfaces from NURBS data, distances (sheet_edit.cpp).
void bind_sheet_edit(py::module_ m);
// SMLib part files (.smp): bodies and curves with names and colors (part_file.cpp).
void bind_part_files(py::module_ m);
// OpenCASCADE .brep files (occt.cpp): occt_read, occt_text
void bind_occt_files(py::module_ m);
// Meshes as arrays with double points (poly_arrays.cpp).
void bind_poly_arrays(py::module_ m);
// Many rays at once: first hits on meshes, refined onto exact faces (rays.cpp).
void bind_rays(py::module_ m);
// Drawing views with hidden lines (hidden_lines.cpp).
void bind_hidden_lines(py::module_ m);
// Triangle meshes as arrays: nearest points, corner normals, decimation, repair, faceted bodies (mesh_tools.cpp).
void bind_mesh_tools(py::module_ m);
// PolyBrep.ray_intersection with its hit polygon tied to the mesh (mesh_tools.cpp; SmPyLib's raised for every hit).
void bind_poly_ray_intersection(py::module_ m);
// The kernel's error trace: where it gave up (trace.cpp).
void bind_kernel_trace(py::module_ m);
// Freeing the caches kernel queries left on a body (caches.cpp).
void bind_caches(py::module_ m);
// SmPyLib's long kernel calls again, with the GIL let go while the kernel works (nogil.cpp).
void bind_nogil(py::module_ m);
