// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's distance between bodies (distance.cpp): the nearest points of two bodies, refined from
// a point near one of them. Plain C++, shared by the Python extension and the JavaScript module.

#pragma once

#include <vector>

class SmBrep;

namespace smlibpy {

struct NearestPoints
{
    double a[3] = {}, b[3] = {};  // on the first body and on the second
    double distance = 0.0;
    double gain = 0.0;  // how much the last step still gained (0 once the points settle)
    bool converged = false;
    long steps = 0;
};

// The nearest points of two bodies from a point near the first (x, y, z): a local minimum of the
// distance between their surfaces.
NearestPoints nearest_points(const SmBrep* a, const SmBrep* b, const std::vector<double>& near_a);

}  // namespace smlibpy
