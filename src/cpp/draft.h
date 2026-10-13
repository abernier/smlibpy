// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's draft analysis and parting lines (draft.cpp). Plain C++, shared by the Python
// extension and the JavaScript module.

#pragma once

#include <vector>

class SmBrep;
class SmEdge;
class SmFace;

namespace smlibpy {

// The least and greatest n . d over a face (n the outward normal, d the unit direction), and
// where they are.
struct DraftRange
{
    double min = 0.0, max = 0.0;
    double min_point[3] = {}, max_point[3] = {};
};

// A copy of a Brep with faces split along their silhouettes. The caller owns `brep`; `edges` are
// the merged silhouette edges of the copy, `failed` the indices of the faces that could not be split.
struct SilhouetteSplit
{
    SmBrep* brep = nullptr;
    std::vector<SmEdge*> edges;
    std::vector<int> failed;
    int exact = 0, traced = 0;
};

DraftRange face_draft_range(const SmFace* face, const std::vector<double>& direction, int grid);
SilhouetteSplit split_at_silhouettes(const SmBrep* brep, const std::vector<double>& direction, double tolerance,
                                     const std::vector<SmFace*>& straddling);

}  // namespace smlibpy
