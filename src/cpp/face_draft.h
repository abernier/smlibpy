// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's face drafts (face_draft.cpp, SmBrep::LocalOperation). Plain C++, shared by the Python
// extension and the JavaScript module.

#pragma once

#include <string>
#include <vector>

class SmBrep;
class SmFace;

namespace smlibpy {

// The result of draft_faces: the drafted copy (owned by the caller) or why not.
struct FaceDraft
{
    SmBrep* brep = nullptr;        // the drafted copy, or null
    std::string error;             // empty, or why not: 'in_plane', 'parallel', 'axis', 'apex', 'tip',
                                   // 'too_steep', 'unsupported', 'invalid', 'copy', 'tangent', 'kernel', 'open'
    long face = -1;                // the index of the face it is about
    SmFace* other = nullptr;       // for 'tangent': the face that meets it tangentially
    std::vector<double> before;    // the draft angle of each face before (radians, against the normal)
    double tolerance = 0.0;        // the Brep's tolerance
    bool has_gaps_before = false;  // (largest vertex-edge gap, largest vertex-face gap) of the given Brep
    double gaps_before[2] = {};
    bool has_gaps = false;         // the same of the result
    double gaps[2] = {};
    bool has_restored = false;     // the number of B-spline edges that became lines and circles
    long restored = 0;
};

FaceDraft draft_faces(const SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<double>& origin,
                      const std::vector<double>& normal, double angle, double tangency_deg);

}  // namespace smlibpy
