// SPDX-License-Identifier: Apache-2.0
//
// Drawing views with hidden lines (hidden_lines.cpp). Plain C++, shared by the Python extension
// and the JavaScript module.

#pragma once

#include <vector>

class SmBrep;
class SmCurve;

namespace smlibpy {

// The lines of a view of a body, projected onto the view's plane: the visible ones and the hidden
// ones, each line once. The curves are the caller's.
struct HiddenLines
{
    std::vector<SmCurve*> visible;
    std::vector<SmCurve*> hidden;
};

// The view of `brep` seen from the side `plane_normal` points to, projected onto the plane through
// `plane_point`: its edges and the contours of its curved faces, split where they pass behind the
// body. Edges seen end-on are left out, and so are the hidden pieces that lie under visible lines
// (or under other hidden ones). `seams`: also the seams of closed faces; `smooth_edges`: also the
// edges between faces that meet tangentially (the tangent lines of fillets).
HiddenLines hidden_lines(const SmBrep* brep, const std::vector<double>& plane_point,
                         const std::vector<double>& plane_normal, bool seams, bool smooth_edges);

}  // namespace smlibpy
