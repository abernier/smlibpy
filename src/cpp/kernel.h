// SPDX-License-Identifier: Apache-2.0
//
// The kernel as smlibpy's C++ sees it: all of SMLib, its meshes and file import, and SmPyRaise for
// a kernel status as a C++ exception. The same headers SmPyLib's SmPyCommon.h includes, without
// Python: the shared C++ includes this, its Python bindings ext.h.

#pragma once

#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include <SmSmlibAll.h>
#include <SmPoly.h>
#include <SmApiImportExport.h>

#include "SmPyError.h"
