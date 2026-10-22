// SPDX-License-Identifier: Apache-2.0
//
// The JavaScript module's spine: creates the kernel's context. The bindings are in the other
// files of js/cpp, by what they bind (see common.h for how objects, errors and arrays cross):
//   bind_kernel*.cpp   the kernel's calls, as SmPyLib binds them for Python (same names)
//   bind_topology.cpp  Breps, faces, edges, vertices: what smlibpy asks of them
//   bind_smlibpy.cpp   smlibpy's own C++ (src/cpp, shared with the Python extension)
//   mesh.cpp           meshes as arrays

#include "common.h"
#include "trace.h"

#include <SmApiGeneral.h>

using namespace emscripten;

static void init()
{
    static bool done = false;
    if (!done)
    {
        SmApiCreateContext();
        install_sm_error_callback();       // SmPyLib's trail, which the next line takes the place of:
        smlibpy::install_kernel_trace();  // the kernel's failures (KernelError.trace)
        done = true;
    }
}

EMSCRIPTEN_BINDINGS(smlib_module)
{
    function("init", &init);
}
