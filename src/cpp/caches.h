// SPDX-License-Identifier: Apache-2.0
//
// The caches kernel queries leave on a body (caches.cpp). Plain C++, shared by the Python
// extension and the JavaScript module.

#pragma once

class SmBrep;

namespace smlibpy {

struct DroppedCaches
{
    unsigned long count = 0;  // caches freed
    double bytes = 0.0;       // the memory they held, as the kernel counts it
};

// Free the caches the kernel built on a body's curves, surfaces and the body itself (evaluation
// grids, trimmed-surface data, the spatial trees of its boxes). The kernel builds them again
// where a later call needs them; the body itself does not change.
DroppedCaches drop_caches(const SmBrep* brep);

}  // namespace smlibpy
