// SPDX-License-Identifier: Apache-2.0
//
// SmPyLib's own bindings of the kernel (usd-brep/source/SmPyLib/src/SmPy*.cpp), compiled as they
// are against the stand-in for pybind11 (pyshim/pybind11/pybind11.h): every function SmPyLib binds
// for Python's smlibpy._core, and every method of its classes, is an entry of a table that the
// module calls with smpylib__call(entry, args); smpylib__table() lists the entries (name and
// parameters, from SmPyLib's py::arg lists) and smpylib__enums() SmPyLib's enums. js/src/kernel.ts
// makes them `k.<name>` and `k.<class>_<method>` where the module's own bindings
// (bind_kernel*.cpp, bind_topology.cpp) have none, and holds the parameters of those to SmPyLib's.
//
// The files compiled are listed in js/CMakeLists.txt: all of SmPyLib's binders but those of USD
// (SmPyUsd.cpp) and of the borrowed-geometry check (SmPyBorrowedGeometry.cpp, which looks into
// Python's registry of live objects; here nothing tracks the curves and surfaces read from a Brep,
// as in the module's own bindings: those that an operation replaces are invalid afterwards).

#include "SmPyCommon.h"

#include <emscripten/bind.h>

#include <string>
#include <utility>

using emscripten::val;

// ---------------------------------------------------------------- what SmPyBorrowedGeometry.cpp gives
bool smpy_scale_requires_brep_nurbs_conversion(const SmVector3d& scale)
{
    if (scale.IsUndef() || scale.GetMinDimension() <= SM_EFF_ZERO)
        return false;
    return !SM_ARE_SAME(scale.x, scale.y) || !SM_ARE_SAME(scale.x, scale.z) || scale.x < SM_EFF_ZERO;
}

void smpy_preflight_brep_nurbs_conversion(SmBrep*, const char*) {}

// ---------------------------------------------------------------- Python's exceptions
namespace {
val& pending_error()
{
    static val error = val::undefined();
    return error;
}
}  // namespace

// An exception type of SmPyLib's: its name (calling it makes a JavaScript Error of that name).
PyObject* PyErr_NewException(const char* name, PyObject*, PyObject*)
{
    std::string short_name = name;
    const auto dot = short_name.rfind('.');
    if (dot != std::string::npos)
        short_name = short_name.substr(dot + 1);
    static PyObject type{val::undefined()};
    type.v = val(short_name);
    return &type;
}

void PyErr_SetObject(PyObject*, PyObject* value) { pending_error() = value ? value->v : val::undefined(); }

// ---------------------------------------------------------------- the table
void pybind11::detail::add(std::string name, bool method, const arg* const* args, std::size_t n, call_info call)
{
    std::string params = "[";
    std::size_t named = 0;
    if (method)
        params += quoted("self");
    for (std::size_t i = 0; i < n; ++i)
    {
        const arg* a = args[i];
        if (!a)
            continue;
        if (params.size() > 1)
            params += ",";
        params += a->fallback.empty() ? quoted(a->name) : "[" + quoted(a->name) + "," + a->fallback + "]";
        ++named;
    }
    for (std::size_t i = named + (method ? 1 : 0); i < call.arity; ++i)
        params += (params.size() > 1 ? "," : "") + quoted("arg" + std::to_string(i));
    table().push_back({std::move(name), params + "]", std::move(call)});
}

namespace {

// Entry `id` called with the array `args`; a Python exception SmPyLib raised is the JavaScript
// error it made, a C++ exception one with its message (smjs::guard).
val call(unsigned id, val args)
{
    auto& entries = pybind11::detail::table();
    if (id >= entries.size())
        smjs::throw_error("no such kernel call");
    bool raised = false;
    val result = smjs::guard([&]() -> val {
        try
        {
            const auto& c = entries[id].call;
            return c.thunk(c.callable.get(), args);
        }
        catch (const pybind11::error_already_set&)
        {
            raised = true;
            return val::undefined();
        }
    });
    if (raised)
    {
        val error = pending_error();
        pending_error() = val::undefined();
        error.throw_();
    }
    return result;
}

// [[name, [parameter, ...]], ...] of the entries, in order (a parameter "name" or ["name", default])
std::string table_json()
{
    std::string out = "[";
    for (const auto& e : pybind11::detail::table())
        out += (out.size() > 1 ? "," : "") + std::string("[") + pybind11::detail::quoted(e.name) + "," + e.params + "]";
    return out + "]";
}

// {Enum: {VALUE: number}} of SmPyLib's enums
std::string enums_json()
{
    std::string out = "{";
    for (const auto& [name, values] : pybind11::detail::enums())
    {
        std::string members = "{";
        for (const auto& [value, number] : values)
            members += (members.size() > 1 ? "," : "") + pybind11::detail::quoted(value) + ":" + std::to_string(number);
        out += (out.size() > 1 ? "," : "") + pybind11::detail::quoted(name) + ":" + members + "}";
    }
    return out + "}";
}

}  // namespace

// The binders in the order of SmPyMain.cpp (smlibpy's module.cpp), without USD.
EMSCRIPTEN_BINDINGS(smpylib)
{
    py::module_ flat;
    BoundModule m{flat, flat.def_submodule("category")};
    bind_enums(flat);
    bind_types(flat);
    bind_polybrep(flat);
    bind_primitives(m);
    bind_curves(m);
    bind_surfaces(m);
    bind_booleans(m);
    bind_sweeps(m);
    bind_fillets(m);
    bind_offset(m);
    bind_file_io(m);
    bind_brep_ops(m);
    bind_stitching(m);
    bind_intersectors(m);
    bind_transforms(m);
    bind_queries(m);
    bind_cut_project_trim(m);
    bind_heal(m);
    bind_poly_ops(m);
    bind_tessellation(flat);
    emscripten::function("smpylib__call", &call);
    emscripten::function("smpylib__table", &table_json);
    emscripten::function("smpylib__enums", &enums_json);
}
