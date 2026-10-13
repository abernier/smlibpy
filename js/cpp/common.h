// SPDX-License-Identifier: Apache-2.0
//
// What every binding of the JavaScript module uses: kernel objects as numbers, points from
// JavaScript arrays, and kernel statuses turned into JavaScript errors.

#pragma once

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <SmBrep.h>
#include <SmCoreTypes.h>

#include <cstdint>
#include <string>

namespace smjs {

using emscripten::val;

// A kernel object as a number (wasm32: an address fits a JavaScript number exactly).
template <typename T>
inline uintptr_t ptr(T* p) { return reinterpret_cast<uintptr_t>(p); }

inline SmBrep* brep(uintptr_t p)
{
    if (!p)
        val::global("Error").new_(std::string("no Brep (null handle)")).throw_();
    return reinterpret_cast<SmBrep*>(p);
}

// A point or a vector from a JavaScript array [x, y, z].
inline SmVector3d vec(const val& a)
{
    return SmVector3d(a[0].as<double>(), a[1].as<double>(), a[2].as<double>());
}

inline val vec_to_array(const SmVector3d& v)
{
    val out = val::array();
    out.call<void>("push", v.x);
    out.call<void>("push", v.y);
    out.call<void>("push", v.z);
    return out;
}

// A kernel status that is not success throws a JavaScript Error naming the call.
inline void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        val::global("Error").new_(std::string(what) + ": the kernel returned status " + std::to_string(static_cast<long>(status))).throw_();
}

}  // namespace smjs
