// SPDX-License-Identifier: Apache-2.0
//
// The caches kernel queries leave on a body (src/cpp/caches.cpp) for JavaScript:
// `k.ext.drop_caches(brep)`, as in Python ([count, bytes] where Python has a tuple).

#include "common.h"

#include "caches.h"

using namespace emscripten;
using namespace smjs;

namespace {

val drop_caches(uintptr_t b)
{
    return guard([&] {
        const smlibpy::DroppedCaches r = smlibpy::drop_caches(brep(b));
        val out = val::array();
        out.call<void>("push", static_cast<double>(r.count));
        out.call<void>("push", r.bytes);
        return out;
    });
}

}  // namespace

EMSCRIPTEN_BINDINGS(smlib_caches)
{
    function("ext__drop_caches", &drop_caches);
}
