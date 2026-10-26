// SPDX-License-Identifier: Apache-2.0
//
// What every binding of the JavaScript module uses.
//
//  * Kernel objects (Breps, faces, edges, vertices, curves, surfaces, meshes) cross as numbers:
//    their address in the module's memory (wasm32: exact in a JavaScript number). The TypeScript
//    layer owns what it is given and frees it (delete_brep, delete_curve, ...); faces, edges and
//    vertices belong to their Brep.
//  * A kernel call that fails throws a JavaScript Error with the message Python's KernelError
//    carries (SMJS_CHECK, as SmPyLib's CHECK_STATUS: the call, the status and the kernel's trace).
//  * A C++ exception from the shared code becomes a JavaScript error with its message (guard):
//    a RangeError where Python gets a ValueError (std::invalid_argument and the like), an Error
//    saying SM_ERR_OUT_OF_MEMORY when the memory is used up (std::bad_alloc, Python's
//    MemoryError), an Error otherwise. The kernel's bindings do not catch theirs: js/src/kernel.ts
//    turns them into the same errors (bind_runtime.cpp).
//  * Points and vectors are arrays [x, y, z]; lists of numbers come back as Float64Arrays,
//    lists of kernel objects as arrays of numbers.

#pragma once

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "kernel.h"  // smlibpy's: the kernel's headers and SmPyRaise

#include <cstdint>
#include <exception>
#include <new>
#include <stdexcept>
#include <string>
#include <vector>

namespace smjs {

using emscripten::val;

[[noreturn]] inline void throw_error(const std::string& message)
{
    val::global("Error").new_(message).throw_();
    __builtin_unreachable();
}

// A kernel status that is not success: SmPyRaise formats it (the call, the status, the kernel's
// trace) into a C++ exception, which becomes a JavaScript Error.
inline void raise_status(SmStatus status, const char* what, const char* file, int line)
{
    try
    {
        SmPyRaise(status, what, file, line);
    }
    catch (const std::exception& e)
    {
        throw_error(e.what());
    }
    throw_error(std::string(what) + " failed");
}

#define SMJS_CHECK(expr)                                                 \
    do {                                                                 \
        SmPyErrorTrail::clear();                                         \
        SmStatus smjs_status_ = (expr);                                  \
        if (smjs_status_ != SM_SUCCESS)                                  \
            ::smjs::raise_status(smjs_status_, #expr, __FILE__, __LINE__); \
    } while (0)

// A RangeError: where Python raises ValueError (or IndexError).
[[noreturn]] inline void throw_range_error(const std::string& message)
{
    val::global("RangeError").new_(message).throw_();
    __builtin_unreachable();
}

// The error for memory that is used up (std::bad_alloc): made without allocating in the module.
[[noreturn]] inline void throw_out_of_memory()
{
    val::global("Error").new_(val("SM_ERR_OUT_OF_MEMORY: the kernel ran out of memory (std::bad_alloc)")).throw_();
    __builtin_unreachable();
}

// Runs f; a C++ exception becomes a JavaScript error with its message: a RangeError where
// pybind11 makes it a ValueError, IndexError or OverflowError (invalid_argument, domain_error,
// length_error, out_of_range, range_error, overflow_error), the out-of-memory Error for
// bad_alloc (Python's MemoryError), an Error (Python's RuntimeError) otherwise.
template <typename F>
auto guard(F&& f) -> decltype(f())
{
    try
    {
        return f();
    }
    catch (const std::bad_alloc&)
    {
        throw_out_of_memory();
    }
    catch (const std::invalid_argument& e)
    {
        throw_range_error(e.what());
    }
    catch (const std::domain_error& e)
    {
        throw_range_error(e.what());
    }
    catch (const std::length_error& e)
    {
        throw_range_error(e.what());
    }
    catch (const std::out_of_range& e)
    {
        throw_range_error(e.what());
    }
    catch (const std::range_error& e)
    {
        throw_range_error(e.what());
    }
    catch (const std::overflow_error& e)
    {
        throw_range_error(e.what());
    }
    catch (const std::exception& e)
    {
        throw_error(e.what());
    }
}

// ---------------------------------------------------------------- kernel objects as numbers
template <typename T>
inline uintptr_t ptr(T* p) { return reinterpret_cast<uintptr_t>(p); }

template <typename T>
inline T* as(uintptr_t p, const char* what)
{
    if (!p)
        throw_error(std::string("no ") + what + " (null handle)");
    return reinterpret_cast<T*>(p);
}

inline SmBrep* brep(uintptr_t p) { return as<SmBrep>(p, "Brep"); }
inline SmFace* face(uintptr_t p) { return as<SmFace>(p, "face"); }
inline SmEdge* edge(uintptr_t p) { return as<SmEdge>(p, "edge"); }
inline SmVertex* vertex(uintptr_t p) { return as<SmVertex>(p, "vertex"); }
inline SmCurve* curve(uintptr_t p) { return as<SmCurve>(p, "curve"); }
inline SmSurface* surface(uintptr_t p) { return as<SmSurface>(p, "surface"); }
inline SmPolyBrep* poly(uintptr_t p) { return as<SmPolyBrep>(p, "PolyBrep"); }
// (a handle that may be absent: 0, null or undefined)
template <typename T>
inline T* maybe(const val& v) { return v.isNull() || v.isUndefined() ? nullptr : reinterpret_cast<T*>(v.as<uintptr_t>()); }

// An array of kernel objects (numbers) as pointers, and back.
template <typename T>
inline std::vector<T*> pointers(const val& a)
{
    const unsigned n = a["length"].as<unsigned>();
    std::vector<T*> out(n);
    for (unsigned i = 0; i < n; ++i)
        out[i] = reinterpret_cast<T*>(a[i].as<uintptr_t>());
    return out;
}

template <typename T>
inline val pointer_array(const std::vector<T*>& items)
{
    val out = val::array();
    for (T* p : items)
        out.call<void>("push", ptr(p));
    return out;
}

template <typename T>
inline val pointer_array(const SmTArray<T*>& items)
{
    val out = val::array();
    for (ULONG i = 0; i < items.GetSize(); ++i)
        out.call<void>("push", ptr(items[i]));
    return out;
}

// ---------------------------------------------------------------- numbers, points
inline std::vector<double> numbers(const val& a) { return emscripten::convertJSArrayToNumberVector<double>(a); }

inline SmVector3d vec(const val& a)
{
    const std::vector<double> v = numbers(a);
    if (v.size() < 3)
        throw_error("expected three coordinates");
    return SmVector3d(v[0], v[1], v[2]);
}

inline val vec3(const SmVector3d& v)
{
    val out = val::array();
    out.call<void>("push", v.x);
    out.call<void>("push", v.y);
    out.call<void>("push", v.z);
    return out;
}

// A copy of numbers as a Float64Array (the memory view is only valid during the call).
inline val float64(const std::vector<double>& v)
{
    return val::global("Float64Array").new_(emscripten::typed_memory_view(v.size(), v.data()));
}

inline val float32(const std::vector<float>& v)
{
    return val::global("Float32Array").new_(emscripten::typed_memory_view(v.size(), v.data()));
}

inline val int32(const std::vector<int32_t>& v)
{
    return val::global("Int32Array").new_(emscripten::typed_memory_view(v.size(), v.data()));
}

template <typename T>
inline val number_array(const std::vector<T>& v)
{
    val out = val::array();
    for (const T& x : v)
        out.call<void>("push", static_cast<double>(x));
    return out;
}

}  // namespace smjs
