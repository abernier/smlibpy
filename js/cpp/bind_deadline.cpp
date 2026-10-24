// SPDX-License-Identifier: Apache-2.0
//
// The deadline for long kernel steps (src/cpp/deadline.cpp) for JavaScript:
// `k.ext.set_deadline(seconds)` and `k.ext.deadline_passed()`, as in Python.

#include "common.h"

#include "deadline.h"

using namespace emscripten;

namespace {

void set_deadline(double seconds) { smlibpy::set_deadline(seconds); }

bool deadline_passed() { return smlibpy::deadline_passed(); }

}  // namespace

EMSCRIPTEN_BINDINGS(smlib_deadline)
{
    function("ext__set_deadline", &set_deadline);
    function("ext__deadline_passed", &deadline_passed);
}
