// SPDX-License-Identifier: Apache-2.0
//
// A deadline for long kernel steps (deadline.cpp). Plain C++, shared by the Python extension and
// the JavaScript module.

#pragma once

namespace smlibpy {

// Sets the deadline of this thread's kernel calls `seconds` from now: past it, the long loops of
// the kernel's surface and topology intersectors give up (SM_ERR_METHOD_FAILURE_QUITING), and the
// step fails as a failed step does. 0 (or anything but a positive finite number) clears it.
void set_deadline(double seconds);

// Whether one of those loops found the deadline passed since it was last set.
bool deadline_passed();

}  // namespace smlibpy
