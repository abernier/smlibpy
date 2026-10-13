// SPDX-License-Identifier: Apache-2.0
//
// The JavaScript module's spine: creates the kernel's context and binds the kernel for the
// TypeScript layer in js/src. Kernel objects (Breps, faces, edges, curves, surfaces) cross as
// numbers, their address in the module's memory; the TypeScript layer owns the Breps and frees
// them with delete_brep. A kernel call that fails throws a JavaScript Error naming the call.

#include "common.h"

#include <SmApiGeneral.h>
#include <SmApiPrimitives.h>
#include <SmApiBrep.h>

using namespace emscripten;

// The kernel's types allocate through its own operator new (taking a context); embind's class
// machinery is not used for them, so no parameterless overloads are needed here.

static void init()
{
    static bool done = false;
    if (!done) {
        SmApiCreateContext();
        done = true;
    }
}

static uintptr_t create_box(val origin, double length, double width, double height)
{
    SmBrep* r = nullptr;
    smjs::check(SmApiCreateBox(smjs::vec(origin), length, width, height, r), "create_box");
    return smjs::ptr(r);
}

static uintptr_t create_cylinder(val origin, double radius, double height)
{
    SmBrep* r = nullptr;
    smjs::check(SmApiCreateCylinder(smjs::vec(origin), radius, height, r), "create_cylinder");
    return smjs::ptr(r);
}

// Consumes both operands; the result aliases the first.
static uintptr_t boolean_op(uintptr_t a, uintptr_t b, int operation)
{
    SmBrep* r = nullptr;
    smjs::check(SmApiBoolean(smjs::brep(a), smjs::brep(b), static_cast<SmBooleanOperationType>(operation), r), "boolean");
    return smjs::ptr(r);
}

static void delete_brep(uintptr_t b) { delete smjs::brep(b); }

static val brep_counts(uintptr_t b)
{
    SmBrep* brep = smjs::brep(b);
    SmTArray<SmFace*> f;
    SmTArray<SmEdge*> e;
    SmTArray<SmVertex*> v;
    brep->GetFaces(f);
    brep->GetEdges(e);
    brep->GetVertices(v);
    val out = val::array();
    out.call<void>("push", static_cast<double>(f.GetSize()));
    out.call<void>("push", static_cast<double>(e.GetSize()));
    out.call<void>("push", static_cast<double>(v.GetSize()));
    return out;
}

EMSCRIPTEN_BINDINGS(smlib_core)
{
    function("init", &init);
    function("create_box", &create_box);
    function("create_cylinder", &create_cylinder);
    function("boolean", &boolean_op);
    function("delete_brep", &delete_brep);
    function("brep_counts", &brep_counts);
    constant("BO_UNION", static_cast<int>(SM_BO_UNION));
    constant("BO_INTERSECTION", static_cast<int>(SM_BO_INTERSECTION));
    constant("BO_DIFFERENCE", static_cast<int>(SM_BO_DIFFERENCE));
}
