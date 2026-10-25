// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's sweeps with the profile's attitude given along the path, and the axis of a helical path
// (oriented_sweep.cpp). Plain C++, shared by the Python extension and the JavaScript module.

#pragma once

#include <vector>

class SmBrep;
class SmCurve;
class SmBSplineCurve;

namespace smlibpy {

// The profile curves swept along `path` with the profile's x axis given along the path: at the
// path's parameters `params` (increasing, from the start of its interval to its end) the x axis is
// `x_axes` (x, y, z each, perpendicular to the path's tangent there; interpolated in between). The
// profile is drawn in the XY plane with its anchor at the origin: at each point of the path its x
// axis goes along the given one, its y axis along the tangent crossed with that, its z axis along the
// tangent. With `cap_ends` the ends are closed with planar faces (a solid), otherwise the result is a
// sheet. `scales` (empty, or one for each parameter, positive): the profile's scale about its anchor
// there, interpolated cubically in between (the profile is drawn at the scale of the first). The caller
// owns the result; throws where the kernel cannot sweep.
SmBrep* oriented_sweep(const std::vector<SmCurve*>& profile, const SmBSplineCurve* path,
                       const std::vector<double>& params, const std::vector<double>& x_axes, bool cap_ends,
                       const std::vector<double>& scales = {});

// The axis of a path of curves that winds about one at a constant pitch (a helix, also one whose
// radius changes evenly with the angle: a conical helix), as {x, y, z of a point on it, x, y, z of its
// direction}; empty when the curves are not such a helix within `tolerance` times their size, or turn
// less than about a quarter turn about it.
std::vector<double> helix_axis(const std::vector<SmCurve*>& curves, double tolerance);

}  // namespace smlibpy
