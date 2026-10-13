// SPDX-License-Identifier: Apache-2.0
//
// Building kernel Breps from neutral B-rep data (step_build.cpp, used by the STEP importer). Plain
// C++, shared by the Python extension and the JavaScript module.

#pragma once

#include "value.h"

#include <vector>

class SmBrep;

namespace smlibpy {

// faces: [{"surface": spec, "same_sense": bool, "free_seam": bool, "loops": [{"edges": [(edge_id, forward)]} |
// {"vertex": point}]}] ("free_seam": the face, on a B-spline surface closed on itself, has no seam edge of its own
// and may lie across the surface's seam, which is then moved off it)
// edges: {edge_id: curve spec running from the edge's start to its end vertex}
// voids: [(faces, reversed)]: cavities of a solid (STEP BREP_WITH_VOIDS), each a void region inside the solid's
// region ("reversed" as for the solid's faces); none or empty for none.
// The caller owns the result.
SmBrep* build_brep(const Value& faces, const Value& edges, bool solid, bool reversed, bool mirrored,
                   const Value& voids = Value());

// Indices of faces whose loops run the wrong way round for their orientation: their oriented trim curves
// enclose a negative area in the parameter plane. A STEP face whose same_sense flag disagrees with the
// direction of its loops (as the loops of its neighbours have it) comes out so; the kernel then takes it
// for the rest of its surface, or integrates it with the wrong sign.
Value inverted_faces(SmBrep* brep);

// Faces on periodic surfaces that no edge runs along the seam of, or that edges cross the seam of:
// [{"face", "missing", "crossed"}] ("u", "v", "both" or ""). STEP writers leave seams out (NX writes a
// cylinder band as its two end loops), and the kernel's tessellation and integration need them.
// With fix, the kernel adds the seam edges and splits the edges that cross it (SmFace::SplitAtSeam),
// in place. only (null: all) limits both to these face indices.
Value seam_problems(SmBrep* brep, bool fix, const std::vector<long>* only);

}  // namespace smlibpy
