// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's face edits (face_edit.cpp, SmBrep::LocalOperation): faces of a solid moved or offset,
// the faces around them extended or trimmed to meet them. Plain C++, shared by the Python extension
// and the JavaScript module.

#pragma once

#include <string>
#include <vector>

class SmBrep;
class SmFace;

namespace smlibpy {

// The result of edit_faces: the edited copy (owned by the caller) or why not.
struct FaceEdit
{
    SmBrep* brep = nullptr;        // the edited copy, or null
    std::string error;             // empty, or why not: 'void', 'tangent', 'conflict', 'alone', 'collapse',
                                   // 'offset', 'invalid', 'copy', 'kernel', 'open'
    long face = -1;                // the index of the face it is about (in `faces`, then on in `added`)
    SmFace* other = nullptr;       // for 'tangent' and 'conflict': the face that meets it tangentially
    std::vector<SmFace*> added;    // with `grow`: the faces edited with the given ones (of the given Brep)
    double tolerance = 0.0;        // the Brep's tolerance
    bool has_gaps_before = false;  // (largest vertex-edge gap, largest vertex-face gap) of the given Brep
    double gaps_before[2] = {};
    bool has_gaps = false;         // the same of the result
    double gaps[2] = {};
    bool has_restored = false;     // the number of B-spline edges that became lines and circles
    long restored = 0;
};

// Gives each of `faces` a new surface: its own moved by a rigid motion (`matrices`: 16 numbers per
// face, or 16 for all, or none for no move; a matrix for row vectors as transform_brep takes it:
// rows 0-2 the images of the axes, row 3 the translation) and then offset along the face's outward
// normal (`distances`: one per face, or one for all, or none). SmBrep::LocalOperation rebuilds a copy
// of the Brep from them and the extended or trimmed surfaces of the faces around them. A face that
// meets an edited face tangentially (their normals differ by less than `tangency_deg` along an edge)
// is edited with it, with its move and distance, when `grow` is true, and refused ('tangent')
// otherwise; two faces that meet tangentially with different edits are refused ('conflict').
FaceEdit edit_faces(const SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<double>& matrices,
                    const std::vector<double>& distances, bool grow, double tangency_deg);

}  // namespace smlibpy
