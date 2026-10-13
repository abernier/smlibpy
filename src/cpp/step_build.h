// SPDX-License-Identifier: Apache-2.0
//
// Building kernel Breps from neutral B-rep data (step_build.cpp, used by the STEP importer). Plain
// C++, shared by the Python extension and the JavaScript module.

#pragma once

#include "value.h"

#include <vector>

class SmBrep;

namespace smlibpy {

// faces: [{"surface": spec, "same_sense": bool, "loops": [{"edges": [(edge_id, forward)]} | {"vertex": point}]}]
// edges: {edge_id: curve spec running from the edge's start to its end vertex}
// The caller owns the result.
SmBrep* build_brep(const Value& faces, const Value& edges, bool solid, bool reversed, bool mirrored);

// Faces on periodic surfaces that no edge runs along the seam of, or that edges cross the seam of:
// [{"face", "missing", "crossed"}] ("u", "v", "both" or ""). STEP writers leave seams out (NX writes a
// cylinder band as its two end loops), and the kernel's tessellation and integration need them.
// With fix, the kernel adds the seam edges and splits the edges that cross it (SmFace::SplitAtSeam),
// in place. only (null: all) limits both to these face indices.
Value seam_problems(SmBrep* brep, bool fix, const std::vector<long>* only);

}  // namespace smlibpy
