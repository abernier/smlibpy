// SPDX-License-Identifier: Apache-2.0
//
// The kernel's error trace (src/cpp/trace.cpp) for JavaScript: `k.ext.kernel_trace()` and
// `k.ext.clear_kernel_trace()`, as in Python (an array where Python has a tuple).

#include "common.h"

#include "trace.h"

using namespace emscripten;

namespace {

void clear_kernel_trace() { smlibpy::clear_kernel_trace(); }

val kernel_trace()
{
    const smlibpy::KernelTrace t = smlibpy::kernel_trace();
    val entries = val::array();
    for (const std::string& s : t.entries)
        entries.call<void>("push", s);
    val out = val::array();
    out.call<void>("push", entries);
    out.call<void>("push", static_cast<double>(t.recorded));
    return out;
}

}  // namespace

EMSCRIPTEN_BINDINGS(smlib_trace)
{
    function("ext__clear_kernel_trace", &clear_kernel_trace);
    function("ext__kernel_trace", &kernel_trace);
}
