// SPDX-License-Identifier: Apache-2.0
//
// A deadline for long kernel steps (`smlibpy._core.ext`):
//
//   set_deadline(seconds)   past `seconds` from now, the kernel's long loops give up; 0: none
//   deadline_passed()       whether one of them gave up since
//
// The kernel cannot be stopped from outside: a call runs until it returns. Where a step that may
// run too long cannot go to another process or thread (a browser's main thread; Python where no
// other process can be started), smlibpy sets a deadline around it. The loops that such steps were
// found spending minutes in (the surface intersector's search for start points and its trace, the
// topology intersector's pairs of faces and of ProtoEdges) test it at the top of each pass and fail
// once it has passed, through the error paths they already have
// (third_party/patches/SMLib/inc/SmMessages.h: SMLIBPY_DEADLINE_ER). A step that spends its time
// elsewhere is not stopped.

#include "deadline.h"

#include <SmMessages.h>

#ifndef SMLIBPY_SMMESSAGES_PATCHED
#error "the kernel's SmMessages.h is not third_party/patches/SMLib/inc/SmMessages.h (CMakeLists.txt puts it first)"
#endif

#include <cmath>

namespace smlibpy {

void set_deadline(double seconds)
{
    smlibpy_deadline::Passed() = false;
    smlibpy_deadline::At() = std::isfinite(seconds) && seconds > 0 ? smlibpy_deadline::Now() + seconds : 0.0;
}

bool deadline_passed() { return smlibpy_deadline::Passed(); }

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_deadline(py::module_ m)
{
    m.def("set_deadline", &smlibpy::set_deadline, py::arg("seconds"),
          "Give the kernel calls of this thread a deadline `seconds` from now: past it, the long loops of the "
          "kernel's surface and topology intersectors give up (SM_ERR_METHOD_FAILURE_QUITING), and the step "
          "fails as a failed step does. 0 clears it. For steps that cannot run in another process "
          "(smlibpy._guard); a step that spends its time elsewhere is not stopped.");
    m.def("deadline_passed", &smlibpy::deadline_passed,
          "Whether one of the kernel's loops found the deadline of set_deadline passed since it was set.");
}
#endif  // SMLIBPY_PYTHON
