// SPDX-License-Identifier: Apache-2.0
#pragma once

#include "SmPyCommon.h"

// smlibpy additions to the upstream bindings, registered as `_core.ext`.
void bind_smlibpy_ext(py::module_ m);

// STEP import: Brep construction from neutral data (step_build.cpp).
void bind_step_build(py::module_& m);
