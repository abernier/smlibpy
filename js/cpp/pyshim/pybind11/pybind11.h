// SPDX-License-Identifier: Apache-2.0
//
// A stand-in for pybind11, as much of it as SmPyLib's bindings of the kernel use
// (usd-brep/source/SmPyLib/src/SmPy*.cpp), so that the WebAssembly module compiles those files as
// they are: every function and method SmPyLib binds for Python is then one the module has, with
// SmPyLib's own code, names, parameters and defaults (smpylib.cpp registers them; js/src/kernel.ts
// makes them `k.<name>` and `k.<class>_<method>`).
//
// Values cross as the module's other bindings take and give them (common.h): kernel objects as
// numbers (their address; 0 or null for none), tuples and lists as arrays, dicts as plain objects,
// lists of numbers as Float64Arrays, NumPy arrays as flat typed arrays, enums as numbers.
// py::object and its kinds hold the JavaScript value (emscripten::val).
//
// m.def(name, f, py::arg(...)...) and py::class_<T>(m, "Name").def(name, f, ...) add an entry to
// a table: the function (any callable: a lambda, a function, a member function, which then takes
// the object as its first parameter) behind one that converts its parameters from an array of
// JavaScript values and its result back, its parameters and their defaults (from the py::arg
// extras; docstrings and policies are dropped). The module calls entry i with
// smpylib__call(i, args); smpylib__table() lists the entries for kernel.ts. Constructors, Python's
// special methods (__repr__, ...) and the value classes (Vec3, Vec2, Axis2Placement: arrays and
// plain objects here) are left out.
//
// Errors: a C++ exception of the code (SmPyRaise's std::runtime_error, pybind11's value_error,
// std::bad_alloc) becomes a JavaScript error with its message (smjs::guard); a Python exception
// SmPyLib raises itself (PyErr_SetObject, then error_already_set: TessellationError) is a
// JavaScript Error of that name, with the attributes SmPyLib gives it.

#pragma once

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <initializer_list>
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <tuple>
#include <type_traits>
#include <utility>
#include <vector>

#include <SmAxis2Placement.h>
#include <SmSmlibAll.h>
#include <SmPoly.h>

#include "common.h"  // (js/cpp: smjs::guard, the conversions of the module's other bindings)

// ---------------------------------------------------------------- the few names of Python's C API
// (SmPyTessellation.cpp raises its TessellationError through them)
struct PyObject
{
    emscripten::val v;
};
inline PyObject* const PyExc_RuntimeError = nullptr;
PyObject* PyErr_NewException(const char* name, PyObject* base, PyObject* dict);
void PyErr_SetObject(PyObject* type, PyObject* value);

namespace pybind11 {

using ssize_t = std::ptrdiff_t;
using emscripten::val;

enum class return_value_policy : uint8_t
{
    automatic = 0,
    automatic_reference,
    take_ownership,
    copy,
    move,
    reference,
    reference_internal
};

class object;

namespace detail {
template <typename T, typename = void>
struct caster;
template <typename T>
val to_js(const T& x);
template <typename T>
T from_js(const val& v);
template <typename T>
std::string json(const T& x);
}  // namespace detail

// ---------------------------------------------------------------- objects
class handle
{
public:
    handle() : v_(val::undefined()) {}
    explicit handle(val v) : v_(std::move(v)) {}

    const val& js() const { return v_; }
    bool is_none() const { return v_.isNull() || v_.isUndefined(); }
    explicit operator bool() const { return !is_none(); }

    template <typename T>
    T cast() const
    {
        return detail::from_js<T>(v_);
    }

    // An item or attribute: read as an object, assigned through.
    struct accessor;
    accessor operator[](std::size_t i) const;
    accessor operator[](int i) const;
    accessor operator[](const char* key) const;
    accessor attr(const char* name) const;

    // A Python exception type of SmPyLib's (a name here) called: a JavaScript Error of that name.
    template <typename... A>
    object operator()(const A&... a) const;

    // (iterated as an array of JavaScript values)
    std::size_t size() const { return is_none() ? 0 : v_["length"].as<std::size_t>(); }
    bool empty() const { return size() == 0; }
    struct iterator;
    iterator begin() const;
    iterator end() const;

    // The value as Python's C API sees it (for PyErr_SetObject)
    PyObject* ptr() const
    {
        if (!py_)
            py_ = std::make_shared<PyObject>(PyObject{v_});
        return py_.get();
    }

protected:
    val v_;
    mutable std::shared_ptr<PyObject> py_;
};

class object : public handle
{
public:
    object() : handle(val::null()) {}
    explicit object(val v) : handle(std::move(v)) {}
};

struct handle::accessor
{
    val target;
    val key;

    operator object() const { return object(target[key]); }
    object get() const { return object(target[key]); }
    template <typename T>
    T cast() const
    {
        return detail::from_js<T>(target[key]);
    }
    template <typename T>
    accessor& operator=(const T& x)
    {
        target.set(key, detail::to_js(x));
        return *this;
    }
    accessor& operator=(const accessor& other)
    {
        target.set(key, other.target[other.key]);
        return *this;
    }
    accessor operator[](const char* k) const { return {target[key], val(k)}; }
    accessor operator[](std::size_t i) const { return {target[key], val(static_cast<unsigned>(i))}; }
    accessor attr(const char* k) const { return {target[key], val(k)}; }
    bool is_none() const { return target[key].isNull() || target[key].isUndefined(); }
    PyObject* ptr() const { return get().ptr(); }
};

inline handle::accessor handle::operator[](std::size_t i) const { return {v_, val(static_cast<unsigned>(i))}; }
inline handle::accessor handle::operator[](int i) const { return {v_, val(i)}; }
inline handle::accessor handle::operator[](const char* key) const { return {v_, val(key)}; }
inline handle::accessor handle::attr(const char* name) const { return {v_, val(name)}; }

template <typename... A>
object handle::operator()(const A&... a) const
{
    if (!v_.isString())
        throw std::runtime_error("only SmPyLib's exception types can be called here");
    val error = val::global("Error").new_(detail::to_js(a)...);
    error.set("name", v_);
    return object(error);
}

struct handle::iterator
{
    val array;
    std::size_t i;
    object operator*() const { return object(array[static_cast<unsigned>(i)]); }
    iterator& operator++()
    {
        ++i;
        return *this;
    }
    bool operator!=(const iterator& o) const { return i != o.i; }
    bool operator==(const iterator& o) const { return i == o.i; }
};
inline handle::iterator handle::begin() const { return {v_, 0}; }
inline handle::iterator handle::end() const { return {v_, size()}; }

class none : public object
{
public:
    none() : object(val::null()) {}
};

class tuple : public object
{
public:
    tuple() : object(val::array()) {}
    explicit tuple(val v) : object(std::move(v)) {}
};

class list : public object
{
public:
    list() : object(val::array()) {}
    explicit list(val v) : object(std::move(v)) {}

    template <typename T>
    void append(const T& x)
    {
        v_.call<void>("push", detail::to_js(x));
    }
};

class dict : public object
{
public:
    dict() : object(val::object()) {}
    explicit dict(val v) : object(std::move(v)) {}
    bool contains(const char* key) const { return v_.hasOwnProperty(key); }
};

class str : public object
{
public:
    explicit str(const std::string& s) : object(val(s)) {}
    explicit str(val v) : object(std::move(v)) {}
    operator std::string() const { return v_.as<std::string>(); }
};

// The owner of memory a NumPy array shows; here the arrays are copies, so it frees the memory
// with its last copy.
class capsule : public object
{
public:
    capsule(const void* value, void (*destructor)(void*))
        : object(val::undefined()), owner_(const_cast<void*>(value), [destructor](void* p) {
              if (destructor)
                  destructor(p);
          })
    {
    }

private:
    std::shared_ptr<void> owner_;
};

// A NumPy array: here a flat typed array (Float32Array, Int32Array, ...) of a copy of the data.
template <typename T, int Flags = 0>
class array_t : public object
{
public:
    array_t(std::initializer_list<ssize_t> shape, std::initializer_list<ssize_t>, const T* data, handle = handle())
        : object(copy(shape, data))
    {
    }
    array_t(std::vector<ssize_t> shape, std::vector<ssize_t>, const T* data, handle = handle())
        : object(copy(shape, data))
    {
    }

private:
    template <typename Shape>
    static val copy(const Shape& shape, const T* data)
    {
        std::size_t n = 1;
        for (ssize_t d : shape)
            n *= static_cast<std::size_t>(d);
        const char* type = std::is_same_v<T, float>      ? "Float32Array"
                           : std::is_same_v<T, double>   ? "Float64Array"
                           : std::is_same_v<T, int32_t>  ? "Int32Array"
                           : std::is_same_v<T, uint32_t> ? "Uint32Array"
                           : std::is_same_v<T, int16_t>  ? "Int16Array"
                           : std::is_same_v<T, uint16_t> ? "Uint16Array"
                           : std::is_same_v<T, int8_t>   ? "Int8Array"
                                                         : "Uint8Array";
        return val::global(type).new_(emscripten::typed_memory_view(n, data));
    }
};

template <typename... A>
tuple make_tuple(const A&... a)
{
    val out = val::array();
    (out.call<void>("push", detail::to_js(a)), ...);
    return tuple(out);
}

template <typename T>
object cast(const T& x, return_value_policy = return_value_policy::automatic, handle = handle())
{
    return object(detail::to_js(x));
}

template <typename T>
T reinterpret_steal(PyObject* p)
{
    return T(p ? p->v : val::null());
}
template <typename T>
T reinterpret_borrow(PyObject* p)
{
    return T(p ? p->v : val::null());
}

inline std::size_t len(const handle& h) { return h.js()["length"].as<std::size_t>(); }

// Whether a kernel object (a number) is of class T (the cases SmPyLib asks: a Brep).
template <typename T>
bool isinstance(const handle& h);

template <>
inline bool isinstance<SmBrep>(const handle& h)
{
    if (!h.js().isNumber())
        return false;
    const uintptr_t n = h.js().as<uintptr_t>();
    return n && reinterpret_cast<const SmObject*>(n)->IsKindOf(SmBrep_TYPE);
}

template <typename From, typename To>
void implicitly_convertible()
{
}

// ---------------------------------------------------------------- exceptions
struct value_error : std::invalid_argument  // (Python's ValueError: a RangeError here)
{
    using std::invalid_argument::invalid_argument;
};
struct type_error : std::invalid_argument
{
    using std::invalid_argument::invalid_argument;
};
struct index_error : std::out_of_range
{
    using std::out_of_range::out_of_range;
};
// The Python exception PyErr_SetObject set, thrown: the JavaScript error it is (smpylib.cpp).
struct error_already_set : std::runtime_error
{
    error_already_set() : std::runtime_error("a Python exception") {}
};

// ---------------------------------------------------------------- the extras of def
struct arg
{
    const char* name;
    std::string fallback;  // the default as JSON ("" for none)

    explicit arg(const char* n) : name(n) {}

    template <typename T>
    arg operator=(const T& value) const
    {
        arg out(name);
        out.fallback = detail::json(value);
        return out;
    }
};
struct kw_only
{
};
struct pos_only
{
};
template <std::size_t, std::size_t>
struct keep_alive
{
};
struct nodelete
{
    template <typename T>
    void operator()(T*) const
    {
    }
};

namespace detail {
template <typename... A>
struct constructor
{
};
template <typename F>
struct factory
{
};
}  // namespace detail

// (constructors are left out: the module makes kernel objects with its functions)
template <typename... A>
detail::constructor<A...> init()
{
    return {};
}
template <typename F>
detail::factory<F> init(F&&)
{
    return {};
}

namespace detail {

// ---------------------------------------------------------------- the table of the module's calls
// A callable behind a function of JavaScript values (its arguments as an array), and how many
// parameters it takes (a method: its object first).
struct call_info
{
    val (*thunk)(const void* callable, const val& args);  // calls the callable (one per its type)
    std::shared_ptr<const void> callable;
    std::size_t arity;
};

struct entry
{
    std::string name;    // "create_box", or "Brep.faces" for a method
    std::string params;  // JSON: ["name", ["name", default], ...]
    call_info call;
};

inline std::vector<entry>& table()
{
    static std::vector<entry> entries;
    return entries;
}

inline std::map<std::string, std::vector<std::pair<std::string, long>>>& enums()
{
    static std::map<std::string, std::vector<std::pair<std::string, long>>> table;
    return table;
}

inline std::string quoted(const std::string& s)
{
    std::string out = "\"";
    for (char c : s)
    {
        if (c == '"' || c == '\\')
            out += '\\';
        out += c;
    }
    return out + "\"";
}

// The parameters among def's extras (the others, docstrings and policies, are dropped: inlined
// into def, which is inlined too, they are never used and not in the module).
__attribute__((always_inline)) inline const arg* as_arg(const arg& a) { return &a; }
template <typename E>
__attribute__((always_inline)) inline const arg* as_arg(const E&)
{
    return nullptr;
}

// Adds an entry: its parameters from the py::arg extras among `args` (a method's object first,
// named `self`; parameters without a py::arg are arg0, arg1, ...).
void add(std::string name, bool method, const arg* const* args, std::size_t n, call_info call);

// A parameter's value while the call runs: a reference to a kernel object (`SmBrep& self`) holds
// its pointer, anything else the value itself.
template <typename T>
constexpr bool is_kernel_class = std::is_class_v<T> && !std::is_base_of_v<handle, T> &&
                                 !std::is_same_v<T, std::string> && !std::is_same_v<T, SmVector3d> &&
                                 !std::is_same_v<T, SmPoint3d> && !std::is_same_v<T, SmVector2d> &&
                                 !std::is_same_v<T, SmPoint2d> && !std::is_same_v<T, SmAxis2Placement>;

template <typename T>
struct reference
{
    T* p;
    operator T&() const { return *p; }
};

template <typename A>
using holder = std::conditional_t<std::is_reference_v<A> && is_kernel_class<std::remove_cv_t<std::remove_reference_t<A>>>,
                                  reference<std::remove_reference_t<A>>, std::remove_cv_t<std::remove_reference_t<A>>>;

template <typename A>
holder<A> argument(const val& v)
{
    using H = holder<A>;
    if constexpr (std::is_same_v<H, reference<std::remove_reference_t<A>>>)
    {
        using T = std::remove_cv_t<std::remove_reference_t<A>>;
        T* p = from_js<T*>(v);
        if (!p)
            throw std::invalid_argument("a kernel object was expected, not none");
        return H{p};
    }
    else
        return from_js<H>(v);
}

template <typename R, typename... A, typename F, std::size_t... I>
val invoke(const F& f, const val& args, std::index_sequence<I...>)
{
    const unsigned n = args["length"].as<unsigned>();
    if (n != sizeof...(A))
        throw std::invalid_argument("takes " + std::to_string(sizeof...(A)) + " arguments, " + std::to_string(n) +
                                    " were given");
    std::tuple<holder<A>...> values{argument<A>(args[static_cast<unsigned>(I)])...};
    if constexpr (std::is_void_v<R>)
    {
        std::apply(f, values);
        return val::undefined();
    }
    else
        return to_js(std::apply(f, values));
}

template <typename R, typename F, typename... A>
val thunk(const void* f, const val& args)
{
    return invoke<R, A...>(*static_cast<const F*>(f), args, std::index_sequence_for<A...>{});
}

template <typename R, typename... A, typename F>
call_info callable(F f)
{
    return {&thunk<R, F, A...>, std::make_shared<const F>(std::move(f)), sizeof...(A)};
}

// A callable of any kind as the call of an entry (a member function takes its object first).
template <typename R, typename... A>
call_info function(R (*f)(A...))
{
    return callable<R, A...>([f](A... a) -> R { return f(std::forward<A>(a)...); });
}
template <typename R, typename... A>
call_info function(R (*f)(A...) noexcept)
{
    return callable<R, A...>([f](A... a) -> R { return f(std::forward<A>(a)...); });
}
template <typename R, typename C, typename... A>
call_info member(R (C::*f)(A...))
{
    return callable<R, C&, A...>([f](C& self, A... a) -> R { return (self.*f)(std::forward<A>(a)...); });
}
template <typename R, typename C, typename... A>
call_info member(R (C::*f)(A...) const)
{
    return callable<R, const C&, A...>([f](const C& self, A... a) -> R { return (self.*f)(std::forward<A>(a)...); });
}
template <typename R, typename C, typename... A>
call_info member(R (C::*f)(A...) noexcept)
{
    return callable<R, C&, A...>([f](C& self, A... a) -> R { return (self.*f)(std::forward<A>(a)...); });
}
template <typename R, typename C, typename... A>
call_info member(R (C::*f)(A...) const noexcept)
{
    return callable<R, const C&, A...>([f](const C& self, A... a) -> R { return (self.*f)(std::forward<A>(a)...); });
}

template <typename Fn>
struct lambda_traits : lambda_traits<decltype(&Fn::operator())>
{
};
template <typename C, typename R, typename... A>
struct lambda_traits<R (C::*)(A...) const>
{
    template <typename F>
    static call_info make(F f)
    {
        return callable<R, A...>(std::move(f));
    }
};

template <typename F>
call_info make_call(F f)
{
    using U = std::decay_t<F>;
    if constexpr (std::is_member_function_pointer_v<U>)
        return member(f);
    else if constexpr (std::is_function_v<std::remove_pointer_t<U>>)
        return function(f);
    else
        return lambda_traits<U>::make(std::move(f));
}

}  // namespace detail

// ---------------------------------------------------------------- modules, classes and enums
class module_
{
public:
    // A module that adds its functions to the table; an inactive one (the category submodule of
    // SmPyLib's BoundModule, which registers every function twice) adds none.
    explicit module_(bool active = true) : active_(active) {}

    template <typename F, typename... Extra>
    __attribute__((always_inline)) module_& def(const char* name, F&& f, const Extra&... extra)
    {
        if (!active_)
            return *this;
        const arg* args[] = {nullptr, detail::as_arg(extra)...};
        detail::add(name, false, args + 1, sizeof...(Extra), detail::make_call(std::forward<F>(f)));
        return *this;
    }

    module_ def_submodule(const char*, const char* = nullptr) const { return module_(false); }

    handle::accessor attr(const char* name) const { return handle(val::object()).attr(name); }

    // (SmPyTessellation.cpp looks its own module up to raise its TessellationError: that is a
    // name here, and calling it makes the JavaScript Error)
    static object import(const char*)
    {
        val module = val::object();
        module.set("TessellationError", val("TessellationError"));
        return object(module);
    }

    bool active() const { return active_; }

private:
    bool active_;
};

using module = module_;

template <typename T, typename... Options>
class class_
{
public:
    class_(const module_& m, const char* name, const char* = nullptr)
        : name_(name), active_(m.active() && detail::is_kernel_class<T>)
    {
    }

    template <typename F, typename... Extra>
    __attribute__((always_inline)) class_& def(const char* name, F&& f, const Extra&... extra)
    {
        if (!active_ || (name[0] == '_' && name[1] == '_'))  // (Python's special methods)
            return *this;
        const arg* args[] = {nullptr, detail::as_arg(extra)...};
        detail::add(name_ + "." + name, true, args + 1, sizeof...(Extra), detail::make_call(std::forward<F>(f)));
        return *this;
    }

    template <typename... A, typename... Extra>
    class_& def(const detail::constructor<A...>&, const Extra&...)
    {
        return *this;
    }
    template <typename F, typename... Extra>
    class_& def(const detail::factory<F>&, const Extra&...)
    {
        return *this;
    }

    template <typename F, typename... Extra>
    __attribute__((always_inline)) class_& def_static(const char* name, F&& f, const Extra&... extra)
    {
        if (!active_)
            return *this;
        const arg* args[] = {nullptr, detail::as_arg(extra)...};
        detail::add(name_ + "." + name, false, args + 1, sizeof...(Extra), detail::make_call(std::forward<F>(f)));
        return *this;
    }

    template <typename C, typename D, typename... Extra>
    class_& def_readwrite(const char*, D C::*, const Extra&...)
    {
        return *this;
    }
    template <typename C, typename D, typename... Extra>
    class_& def_readonly(const char*, const D C::*, const Extra&...)
    {
        return *this;
    }

private:
    std::string name_;
    bool active_;
};

template <typename E>
class enum_
{
public:
    enum_(const module_&, const char* name, const char* = nullptr) : name_(name) { detail::enums()[name_]; }

    enum_& value(const char* name, E v, const char* = nullptr)
    {
        detail::enums()[name_].emplace_back(name, static_cast<long>(v));
        return *this;
    }

    enum_& export_values() { return *this; }

private:
    std::string name_;
};

// ---------------------------------------------------------------- conversions
namespace detail {

template <typename T>
struct is_vector : std::false_type
{
};
template <typename T, typename A>
struct is_vector<std::vector<T, A>> : std::true_type
{
};

template <typename T>
struct is_pair_or_tuple : std::false_type
{
};
template <typename A, typename B>
struct is_pair_or_tuple<std::pair<A, B>> : std::true_type
{
};
template <typename... A>
struct is_pair_or_tuple<std::tuple<A...>> : std::true_type
{
};

template <typename T>
struct is_optional : std::false_type
{
};
template <typename T>
struct is_optional<std::optional<T>> : std::true_type
{
};

[[noreturn]] inline void type_error_js(const std::string& message)
{
    val::global("TypeError").new_(message).throw_();
    __builtin_unreachable();
}

// Python's Axis2Placement(origin, x_axis, y_axis) is the plain object {origin, x, y} here, as the
// module's Axis2Placement function gives it (bind_kernel_analysis.cpp).
template <>
struct caster<SmAxis2Placement>
{
    static SmAxis2Placement from(const val& p)
    {
        if (p.isNull() || p.isUndefined() || p["origin"].isUndefined() || p["x"].isUndefined() || p["y"].isUndefined())
            type_error_js("placement must be {origin, x, y} (Axis2Placement)");
        return SmAxis2Placement(smjs::vec(p["origin"]), smjs::vec(p["x"]), smjs::vec(p["y"]));
    }
    static val to(const SmAxis2Placement& p)
    {
        val out = val::object();
        out.set("origin", smjs::vec3(p.GetOrigin()));
        out.set("x", smjs::vec3(p.GetXAxis()));
        out.set("y", smjs::vec3(p.GetYAxis()));
        return out;
    }
};

// A kernel object's number, as the module's other bindings give it (curves as their SmCurve,
// surfaces as their SmSurface).
template <typename T>
val pointer_to_js(T* p)
{
    if (!p)
        return val(0);
    if constexpr (std::is_base_of_v<SmCurve, T>)
        return val(static_cast<double>(reinterpret_cast<uintptr_t>(static_cast<const SmCurve*>(p))));
    else if constexpr (std::is_base_of_v<SmSurface, T>)
        return val(static_cast<double>(reinterpret_cast<uintptr_t>(static_cast<const SmSurface*>(p))));
    else
        return val(static_cast<double>(reinterpret_cast<uintptr_t>(p)));
}

template <typename P>
P pointer_from_js(const val& v)
{
    using T = std::remove_cv_t<std::remove_pointer_t<P>>;
    if (v.isNull() || v.isUndefined())
        return nullptr;
    if (!v.isNumber())
        type_error_js("a kernel object (a number) was expected, not " + v.typeOf().as<std::string>());
    const uintptr_t n = v.as<uintptr_t>();
    if (!n)
        return nullptr;
    if constexpr (std::is_same_v<T, SmBSplineCurve>)
    {
        SmCurve* c = reinterpret_cast<SmCurve*>(n);
        if (!c->IsKindOf(SmBSplineCurve_TYPE))
            type_error_js("a B-spline curve was expected");
        return static_cast<P>(c);
    }
    else if constexpr (std::is_same_v<T, SmCircle> || std::is_same_v<T, SmLine>)
    {
        SmCurve* c = reinterpret_cast<SmCurve*>(n);
        if (c->GetType() != (std::is_same_v<T, SmCircle> ? SmCircle_TYPE : SmLine_TYPE))
            type_error_js(std::is_same_v<T, SmCircle> ? "a circle was expected" : "a line was expected");
        return static_cast<P>(c);
    }
    else if constexpr (std::is_base_of_v<SmCurve, T>)
        return static_cast<P>(reinterpret_cast<SmCurve*>(n));
    else if constexpr (std::is_base_of_v<SmSurface, T>)
        return static_cast<P>(reinterpret_cast<SmSurface*>(n));
    else
        return reinterpret_cast<P>(n);
}

template <typename T>
val to_js(const T& x)
{
    using U = std::decay_t<T>;
    if constexpr (std::is_base_of_v<handle, U>)
        return x.js();
    else if constexpr (std::is_same_v<U, handle::accessor>)
        return x.get().js();
    else if constexpr (std::is_same_v<U, bool>)
        return val(x);
    else if constexpr (std::is_enum_v<U>)
        return val(static_cast<int>(x));
    else if constexpr (std::is_arithmetic_v<U>)
        return val(static_cast<double>(x));
    else if constexpr (std::is_same_v<U, std::string>)
        return val(x);
    else if constexpr (std::is_same_v<U, const char*> || std::is_same_v<U, char*>)
        return val(std::string(x ? x : ""));
    else if constexpr (std::is_null_pointer_v<U>)
        return val::null();
    else if constexpr (std::is_pointer_v<U>)
        return pointer_to_js(x);
    else if constexpr (std::is_same_v<U, SmVector3d> || std::is_same_v<U, SmPoint3d>)
        return smjs::vec3(x);
    else if constexpr (std::is_same_v<U, SmVector2d> || std::is_same_v<U, SmPoint2d>)
    {
        val out = val::array();
        out.call<void>("push", x.x);
        out.call<void>("push", x.y);
        return out;
    }
    else if constexpr (is_optional<U>::value)
        return x ? to_js(*x) : val::null();
    else if constexpr (is_vector<U>::value)
    {
        using E = typename U::value_type;
        if constexpr (std::is_floating_point_v<E>)
        {
            const std::vector<double> d(x.begin(), x.end());
            return val::global("Float64Array").new_(emscripten::typed_memory_view(d.size(), d.data()));
        }
        else
        {
            val out = val::array();
            for (const auto& e : x)
                out.call<void>("push", to_js(e));
            return out;
        }
    }
    else if constexpr (is_pair_or_tuple<U>::value)
    {
        val out = val::array();
        std::apply([&](const auto&... e) { (out.call<void>("push", to_js(e)), ...); }, x);
        return out;
    }
    else if constexpr (std::is_convertible_v<U, double>)  // (a tolerance: SmZoneTol3d)
        return val(static_cast<double>(x));
    else
        return caster<U>::to(x);
}

template <typename T>
T from_js(const val& v)
{
    using U = std::decay_t<T>;
    if constexpr (std::is_base_of_v<handle, U>)
        return U(v);
    else if constexpr (std::is_same_v<U, bool>)
    {
        if (!(v.isTrue() || v.isFalse() || v.isNumber()))
            type_error_js("a boolean was expected");
        return v.as<bool>();
    }
    else if constexpr (std::is_enum_v<U>)
    {
        if (!v.isNumber())
            type_error_js("an enum value (a number) was expected");
        return static_cast<U>(v.as<int>());
    }
    else if constexpr (std::is_arithmetic_v<U>)
    {
        if (!v.isNumber())
            type_error_js("a number was expected, not " + v.typeOf().as<std::string>());
        const double d = v.as<double>();
        if constexpr (std::is_integral_v<U>)
        {
            if (d != std::floor(d))
                type_error_js("an integer was expected");
            if constexpr (std::is_unsigned_v<U>)
                if (d < 0)
                    throw std::overflow_error("can't convert negative int to unsigned");
        }
        return static_cast<U>(d);
    }
    else if constexpr (std::is_same_v<U, std::string>)
    {
        if (!v.isString())
            type_error_js("a string was expected");
        return v.as<std::string>();
    }
    else if constexpr (std::is_pointer_v<U>)
        return pointer_from_js<U>(v);
    else if constexpr (std::is_same_v<U, SmVector3d> || std::is_same_v<U, SmPoint3d>)
        return U(smjs::vec(v));
    else if constexpr (std::is_same_v<U, SmVector2d> || std::is_same_v<U, SmPoint2d>)
    {
        const std::vector<double> xy = smjs::numbers(v);
        if (xy.size() < 2)
            type_error_js("expected two coordinates");
        return U(xy[0], xy[1]);
    }
    else if constexpr (is_optional<U>::value)
    {
        if (v.isNull() || v.isUndefined())
            return std::nullopt;
        return from_js<typename U::value_type>(v);
    }
    else if constexpr (is_vector<U>::value)
    {
        using E = typename U::value_type;
        if (v.isNull() || v.isUndefined() || !v["length"].isNumber())
            type_error_js("a list (an array) was expected");
        const unsigned n = v["length"].as<unsigned>();
        U out;
        out.reserve(n);
        for (unsigned i = 0; i < n; ++i)
            out.push_back(from_js<E>(v[i]));
        return out;
    }
    else
        return caster<U>::from(v);
}

// A default value of a parameter as JSON.
template <typename T>
std::string json(const T& x)
{
    using U = std::decay_t<T>;
    if constexpr (std::is_base_of_v<handle, U>)
        return x.is_none() ? "null" : val::global("JSON").call<std::string>("stringify", x.js());
    else if constexpr (std::is_same_v<U, bool>)
        return x ? "true" : "false";
    else if constexpr (std::is_enum_v<U>)
        return std::to_string(static_cast<long>(x));
    else if constexpr (std::is_integral_v<U>)
        return std::to_string(x);
    else if constexpr (std::is_floating_point_v<U>)
    {
        char buf[32];
        std::snprintf(buf, sizeof buf, "%.17g", static_cast<double>(x));
        return buf;
    }
    else if constexpr (std::is_null_pointer_v<U> || std::is_pointer_v<U>)
        return "null";
    else if constexpr (std::is_same_v<U, std::string>)
        return quoted(x);
    else if constexpr (is_vector<U>::value)
    {
        std::string out = "[";
        for (const auto& e : x)
            out += (out.size() > 1 ? "," : "") + json(e);
        return out + "]";
    }
    else
        static_assert(sizeof(U) == 0, "a default value smpylib.cpp cannot write as JSON");
}

}  // namespace detail
}  // namespace pybind11
