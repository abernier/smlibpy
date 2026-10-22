// SPDX-License-Identifier: Apache-2.0
//
// Local edits of a face's surface (shape_edit.cpp): a point pushed, a region warped or flattened.
// Plain C++, shared by the Python extension and the JavaScript module.

#pragma once

#include <vector>

class SmBrep;
class SmFace;

namespace smlibpy {

// A copy of the body (owned by the caller) whose face's point `at` (on the face) has moved by `by`,
// the face changing only within `radius` of it along each of the surface's directions (a rectangle of
// the surface's parameters, blended in smoothly: C2), its normal there `normal` (empty: as before).
// The face's edges stay where they are, held with `continuity` 0 (G0: in place), 1 (G1: with their
// tangent planes) or 2 (G2: also their curvature) where the edit reaches the sides of the face's
// surface rectangle. An edit that would move another edge (a hole, a border across the surface) is
// refused, or with `shrink` tried again with half the radius (up to five times).
SmBrep* push_face(const SmBrep* brep, const SmFace* face, const std::vector<double>& at, const std::vector<double>& by,
                  const std::vector<double>& normal, double radius, int continuity, bool shrink);

// A copy of the body whose face is raised by `by` (a vector: direction and height at the highest point)
// over a region: `region` holds points x, y, z, x, y, z, ... of a closed polygon on the face. The face
// changes only near the region, within the rectangle around it along the surface's directions, meeting
// the rest of it with `continuity` 0 (a crease), 1 (G1) or 2 (G2). Refused where the change would move an
// edge of the face.
SmBrep* warp_face(const SmBrep* brep, const SmFace* face, const std::vector<double>& region, const std::vector<double>& by,
                  int continuity);

// A copy of the body whose face is pressed onto the plane through `origin` with normal `normal` inside the
// region (as for warp_face), moving along the normal: in the plane inside the region but for a border of
// 3/16 of its width (2/16, 1/16 for `continuity` 1, 0) where it blends into the rest, unchanged outside
// the rectangle around the region. Refused where the change would move an edge of the face, or where
// nothing moves.
SmBrep* flatten_face(const SmBrep* brep, const SmFace* face, const std::vector<double>& region,
                     const std::vector<double>& origin, const std::vector<double>& normal, int continuity);

}  // namespace smlibpy
