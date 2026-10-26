// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's swung bodies (swing.cpp). Plain C++, shared by the Python extension and the JavaScript
// module.

#pragma once

#include <vector>

class SmBrep;
class SmCurve;

namespace smlibpy {

// The faces of a swung body: each profile curve (in the XZ plane: x the distance from the Z axis,
// z the height; its y is not read) carried around each outline curve (in the XY plane; its z is not
// read), S(u, v) = (scale Px(u) Tx(v), scale Px(u) Ty(v), Pz(u)), one face for each pair, in a new
// Brep, not stitched. The curves are B-splines (lines and arcs are), copied, not consumed. The caller
// owns the result; throws where the kernel cannot make a surface or its faces.
SmBrep* swung(const std::vector<SmCurve*>& profile, const std::vector<SmCurve*>& outline, double scale);

}  // namespace smlibpy
