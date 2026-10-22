// SPDX-License-Identifier: Apache-2.0
#pragma once

#include "SmPyCommon.h"

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

// Areas, volumes, moments and curve lengths with an error bound (measure.cpp).
void bind_measure(py::module_ m);
// Tessellation that halves the faces of bodies with twisted faces (tessellate.cpp).
void bind_tessellate(py::module_ m);
// Surfaces fitted to point clouds, kernel meshes from triangles (fit.cpp).
void bind_fit(py::module_ m);
// The cells of a non-manifold body (cells.cpp).
void bind_cells(py::module_ m);
// The nearest points of two bodies (distance.cpp).
void bind_distance(py::module_ m);
// USD files of exact bodies: BrepArray prims as .usda text (usd.cpp).
void bind_usd_files(py::module_ m);
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
