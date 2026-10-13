// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's fillet and face removal (defeature.cpp). Plain C++, shared by the Python extension and
// the JavaScript module. Breps in the results are copies the caller owns.

#pragma once

#include <string>
#include <vector>

class SmBrep;
class SmEdge;
class SmFace;

namespace smlibpy {

// What makes a face a fillet: nothing for a planar or flat face (is_blend false), else its radius
// (in the more curved direction, inside the face), whether it is convex, the edges where it meets
// its neighbours tangentially (smooth), those of them that run across its curvature (rails), the
// others (sharp), and the number of edges without seams.
struct BlendInfo
{
    bool is_blend = false;
    double radius = 0.0;
    bool convex = false;
    std::vector<SmEdge*> smooth, rails, sharp;
    int edges = 0;
};

// A copy with fillets removed (null if none was), and one flag per face.
struct FilletsRemoved
{
    SmBrep* brep = nullptr;
    std::vector<bool> removed;
};

// A copy with groups of faces cut out and the holes patched, or null; whether every group was
// accepted as a feature, and whether every patch was applied.
struct Defeatured
{
    SmBrep* brep = nullptr;
    bool added = false, applied = false;
};

BlendInfo blend_info(SmFace* face, double tangency_deg);
FilletsRemoved remove_fillet_faces(const SmBrep* brep, const std::vector<SmFace*>& faces, double tolerance);
Defeatured defeature(const SmBrep* brep, const std::vector<std::vector<SmFace*>>& groups, const std::string& rebuild);

}  // namespace smlibpy
