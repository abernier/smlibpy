// SPDX-License-Identifier: Apache-2.0
//
// What the bindings of the kernel's calls (bind_kernel*.cpp) share: arguments as the kernel takes
// them, results as JavaScript gets them. Conventions in bind_kernel.cpp and common.h.

#pragma once

#include "common.h"

#include <cmath>
#include <initializer_list>
#include <string>
#include <type_traits>
#include <vector>

namespace smjs::kernel {

inline bool absent(const val& v) { return v.isNull() || v.isUndefined(); }

inline SmBoolean flag(bool b) { return b ? TRUE : FALSE; }

// An enum argument: one of the values the Python enum has (Python rejects others too).
template <typename E>
E one_of(int v, std::initializer_list<E> values, const char* what)
{
    for (E e : values)
        if (static_cast<int>(e) == v)
            return e;
    throw_error(std::string(what) + ": " + std::to_string(v) + " is not one of its values");
}

// Counts and multiplicities (Python: a list of unsigned ints).
inline std::vector<ULONG> ulongs(const val& a, const char* what)
{
    std::vector<ULONG> out;
    for (double x : numbers(a))
    {
        if (!(x >= 0 && x <= 4294967295.0) || x != std::floor(x))
            throw_error(std::string(what) + " must be non-negative integers");
        out.push_back(static_cast<ULONG>(x));
    }
    return out;
}

// [[x, y, z], ...] into the kernel's array.
inline void fill_points(const val& a, SmTArray<SmPoint3d>& out)
{
    const unsigned n = a["length"].as<unsigned>();
    for (unsigned i = 0; i < n; ++i)
        out.Add(vec(a[i]));
}

// Kernel objects (an array of numbers) into the kernel's array; T may be const.
template <typename T>
void fill(const val& a, SmTArray<T*>& out)
{
    for (auto* p : pointers<std::remove_const_t<T>>(a))
        out.Add(p);
}

// Curves cross as their SmCurve. Lines, circles and ellipses derive from SmBSplineCurve, and that
// from SmCurve, along single inheritance: the number is the same whichever type it is taken as.
template <typename T>
uintptr_t curve_ptr(T* c) { return ptr(static_cast<SmCurve*>(c)); }

template <typename T>
val curve_array(const SmTArray<T*>& curves)
{
    val out = val::array();
    for (ULONG i = 0; i < curves.GetSize(); ++i)
        out.call<void>("push", curve_ptr(curves[i]));
    return out;
}

// A curve the kernel takes as a B-spline (Python: a BSplineCurve argument).
inline SmBSplineCurve* bspline(uintptr_t p, const char* what)
{
    SmCurve* c = smjs::curve(p);  // (qualified: the kernel declares a global class curve)
    if (!c->IsKindOf(SmBSplineCurve_TYPE))
        throw_error(std::string(what) + " must be a B-spline curve");
    return static_cast<SmBSplineCurve*>(c);
}

// Breps, PolyBreps, curves and surfaces derive from SmObject along single inheritance, so their
// number is their SmObject's address too (Python casts the target to SmObject*).
inline SmObject* object(uintptr_t p) { return as<SmObject>(p, "kernel object"); }

inline val point_array(const SmTArray<SmPoint3d>& points)
{
    val out = val::array();
    for (ULONG i = 0; i < points.GetSize(); ++i)
        out.call<void>("push", vec3(points[i]));
    return out;
}

// (SmTArray's iterator has no traits, so no range constructors)
template <typename T>
std::vector<double> doubles(const SmTArray<T>& a)
{
    std::vector<double> out;
    out.reserve(a.GetSize());
    for (const T& x : a)
        out.push_back(static_cast<double>(x));
    return out;
}

// A Python tuple: an array of the values.
template <typename... T>
val tuple(const T&... items)
{
    val out = val::array();
    (out.call<void>("push", items), ...);
    return out;
}

}  // namespace smjs::kernel
