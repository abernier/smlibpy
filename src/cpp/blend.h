// SPDX-License-Identifier: Apache-2.0
//
// Blend surfaces between two free edges of sheets (blend.cpp). Plain C++, shared by the Python
// extension and the JavaScript module.

#pragma once

class SmBrep;
class SmEdge;
class SmFace;

namespace smlibpy {

// A sheet of one face that bridges two edges of faces: it leaves face1 across edge1, arrives at
// face2 across edge2 and meets each face with `continuity` 1 (tangent, G1), 2 (curvature, G2) or 3
// (G3). `tension1` and `tension2` scale the take-off at each edge (1: as long as the gap). The
// edges' nearest ends are joined; closed edges are refused. Owned by the caller.
SmBrep* edge_blend(const SmFace* face1, const SmEdge* edge1, const SmFace* face2, const SmEdge* edge2,
                   int continuity, double tension1, double tension2);

}  // namespace smlibpy
