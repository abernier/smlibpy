// SPDX-License-Identifier: Apache-2.0
//
// The JavaScript module's spine: creates the kernel's context. The bindings are in the other
// files of js/cpp, by what they bind (see common.h for how objects, errors and arrays cross):
//   bind_kernel*.cpp   the kernel's calls, as SmPyLib binds them for Python (same names)
//   bind_topology.cpp  Breps, faces, edges, vertices: what smlibpy asks of them
//   bind_smlibpy.cpp   smlibpy's own C++ (src/cpp, shared with the Python extension)
//   mesh.cpp           meshes as arrays

#include "common.h"
#include "curve_tools.h"

#include <SmApiGeneral.h>

using namespace emscripten;

static void init()
{
    static bool done = false;
    if (!done)
    {
        SmApiCreateContext();
        install_sm_error_callback();  // the kernel's messages go to the trail errors report
        smlibpy::init_kernel_limits();  // (NLib's cap on the control points of a helix fit)
        done = true;
    }
}

EMSCRIPTEN_BINDINGS(smlib_module)
{
    function("init", &init);
}
