// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's analytic surfaces for revolved faces (revolutions.cpp). Plain C++, shared by the Python
// extension and the JavaScript module.

#pragma once

class SmBrep;

namespace smlibpy {

// A copy of `brep` whose surfaces of revolution are cylinders, cones, spheres and tori wherever they
// are one (the trimming curves of their faces made again), or null where none of its faces has such a
// surface. The caller owns the copy; throws where the kernel cannot replace a surface.
SmBrep* analytic_revolutions(const SmBrep* brep);

}  // namespace smlibpy
