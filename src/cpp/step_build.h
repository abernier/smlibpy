// SPDX-License-Identifier: Apache-2.0
//
// Building kernel Breps from neutral B-rep data (step_build.cpp, used by the STEP importer). Plain
// C++, shared by the Python extension and the JavaScript module.

#pragma once

#include "value.h"

class SmBrep;

namespace smlibpy {

// faces: [{"surface": spec, "same_sense": bool, "loops": [{"edges": [(edge_id, forward)]} | {"vertex": point}]}]
// edges: {edge_id: curve spec running from the edge's start to its end vertex}
// The caller owns the result.
SmBrep* build_brep(const Value& faces, const Value& edges, bool solid, bool reversed, bool mirrored);

}  // namespace smlibpy
