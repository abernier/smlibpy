// SPDX-License-Identifier: Apache-2.0
//
// The kernel's error trace (trace.cpp): where SMLib gave up. Plain C++, shared by the Python
// extension and the JavaScript module.

#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace smlibpy {

// The failures the kernel reported since the last clear_kernel_trace() (each SER, NER, AERN, ...
// that returned an error, and its ERR messages), oldest first: the last kKernelTraceKept of them,
// as "SM_ERR_BAD_INTERSECTIONS at SmTopologyIntersector.cpp:913 (IntersectTopology)". A failed
// call ends with the chain from the deepest site that failed to the API function; what comes
// before are errors the kernel recovered from (a step it tried another way).
struct KernelTrace
{
    std::vector<std::string> entries;
    // All of them since the clear: more than entries.size() when the first ones were dropped.
    unsigned long long recorded = 0;
};

constexpr std::size_t kKernelTraceKept = 48;

// Records the kernel's failures from now on, in place of SmPyLib's trail (which kept the first
// 4 kB of them; nothing feeds it now). clear_kernel_trace() installs the callback too: on Windows
// the kernel keeps one per thread.
void install_kernel_trace();
void clear_kernel_trace();
KernelTrace kernel_trace();

}  // namespace smlibpy
