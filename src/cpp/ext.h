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
