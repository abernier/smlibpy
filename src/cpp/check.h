// SPDX-License-Identifier: Apache-2.0
//
// What is wrong with a body, as the kernel's own validity checks name it (check.cpp, kernel plan
// T4). Plain C++, shared by the Python extension and the JavaScript module.

#pragma once

#include "value.h"

class SmBrep;
class SmEdge;
class SmVertex;

namespace smlibpy {

// The checks of SmBrep::AssertValid at `level` (0: structure and pointers; 1: also geometry; 2:
// all, the slow ones too): its pointer checks, the gaps between vertices, edges and faces against
// their tolerances (ValidateAndUpdateTolerances, which only checks here), and the tests of each
// face, loop, edge and vertex. Per failed test a dict: "category" (the kernel's kind of test,
// "gap", "topological", "geometric", ...), "test" (its short name), "message" (with the value and
// tolerance where there are), "kind" and "index" (the face, edge or vertex it is about, in the
// Brep's own order: "face", "edge", "vertex"; "body" with -1 for the body as a whole), "other_kind"
// and "other_index" (a second one, or None and -1), "value" and "tolerance" (None where the test
// has none).
Value check_brep(const SmBrep* brep, int level);

// The largest gaps between the parts of a body (ValidateAndUpdateTolerances, check only): between
// an edge and its faces ("edge_face", at "edge_face_edge"), between a vertex and its edges
// ("vertex_edge", at "vertex_edge_vertex") and its faces ("vertex_face", at
// "vertex_face_vertex"), with "violated" (some gap is larger than the tolerance of what it lies
// between) and the body's "tolerance". The indices are in the Brep's order (-1: none).
Value tolerance_gaps(const SmBrep* brep);

// The same with the gaps repaired (ValidateAndUpdateTolerances, updating): the tolerance of each
// vertex and edge farther from what it meets than its tolerance grows to the gap (or the edge's trim
// curve is made again); the geometry does not change. "updated": whether anything changed; the gaps
// are those found before.
Value update_tolerances(SmBrep* brep);

// The tolerance of an edge or a vertex: how far its geometry and that of what meets there may
// lie apart.
double edge_tolerance(const SmEdge* edge);
double vertex_tolerance(const SmVertex* vertex);

}  // namespace smlibpy
