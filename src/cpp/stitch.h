// SPDX-License-Identifier: Apache-2.0
//
// Sewing faces along their edges, and turning faces over (stitch.cpp). Plain C++, shared by the
// Python extension and the JavaScript module.

#pragma once

#include "value.h"

class SmBrep;

namespace smlibpy {

// Sews the faces of a Brep in place along edges that lie within `tolerance` of each other
// (SmApiStitchAdvanced): from the Brep's own tolerance (at least 1e-7) up, doubling, to `tolerance`,
// until no free edge is left, so that edges that meet closely are sewn before looser ones. Where free
// edges are left, the faces of each connected piece are turned to agree with the piece's first face
// (SmStitch::UnifyNormals along the sewn edges). A dictionary: "sewn" (edges sewn), "open" (free
// edges left), "vertex_gap" and "edge_gap" (the largest gaps closed), "tolerance" (the last one
// tried), "turned" (faces turned over).
Value stitch_faces(SmBrep* brep, double tolerance);

// A copy of a Brep with every face turned over (SmFace::SwapUV: its surface's u and v swapped, so
// its normal points the other way). Owned by the caller.
SmBrep* flip_faces(const SmBrep* brep);

}  // namespace smlibpy
