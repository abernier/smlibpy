// SPDX-License-Identifier: Apache-2.0
//
// One lock for the kernel, and the GIL let go while it works (see kernel_lock.h). Python only:
// the WebAssembly module runs on one thread (a Worker has a module of its own).
//
// Every entry point takes the lock: pybind11 calls a function through its record's dispatcher
// (function_record::impl), and lock_kernel_entries swaps each one of smlibpy._core for `locked`,
// which takes the lock and calls the original. That covers SmPyLib's bindings as they are, the
// methods and properties of its classes, smlibpy's own and the deletions that finalizers call.
// The kernel classes are bound with py::nodelete, so freeing a Python wrapper never reaches the
// kernel. The long entry points (Booleans, fillets, shells, sweeps, tessellation, measuring,
// deforming, the file readers; see nogil.cpp for SmPyLib's) let the GIL go around their kernel
// work, after pybind11 converted the arguments and before it converts the result.
//
// Waiting for the lock: always with the GIL let go. The thread that holds the lock may wait for
// the GIL itself (to convert its result), so waiting while holding the GIL would deadlock; a
// thread that holds both never waits for either. A thread that already holds the lock takes it
// again at once (a finalizer that frees a body inside another kernel call).
//
// os.fork: the forked copy has only the forking thread. Without care it could start with kernel
// state that another thread was changing, and with the lock held by a thread it does not have
// (its first kernel call would wait for ever). The hooks below take the lock before the fork,
// give it back in the parent, and give the copy a new lock.

#include "kernel_lock.h"

#ifdef SMLIBPY_PYTHON

#include <atomic>
#include <mutex>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>

namespace py = pybind11;

namespace smlibpy {

namespace {

// (a pointer: a fork's copy gets a new mutex, and the old one, held by a thread the copy does not
// have, stays where it is)
std::recursive_mutex* g_lock = new std::recursive_mutex();
std::atomic<unsigned long long> g_waits{0};

bool finalizing()
{
#if PY_VERSION_HEX >= 0x030D0000
    return Py_IsFinalizing() != 0;
#else
    return _Py_IsFinalizing() != 0;
#endif
}

std::recursive_mutex* acquire()
{
    std::recursive_mutex* m = g_lock;
    if (m->try_lock())
        return m;
    g_waits.fetch_add(1, std::memory_order_relaxed);
    if (!PyGILState_Check())
    {
        m->lock();
        return m;
    }
    // A thread that still holds the lock while Python exits (a daemon thread in a long kernel
    // call) never gives it back: fail instead of waiting for ever (the finalizers that free
    // kernel objects swallow the error).
    if (finalizing())
        throw std::runtime_error("the kernel is busy in another thread while Python exits");
    PyThreadState* state = PyEval_SaveThread();
    m->lock();
    PyEval_RestoreThread(state);
    return m;
}

using Impl = py::handle (*)(py::detail::function_call&);

// The original dispatcher of each record that `locked` stands in for. Filled once, while the
// module is made; read only after that. (Leaked: the records live as long as the process.)
std::unordered_map<const py::detail::function_record*, Impl>& originals()
{
    static auto* map = new std::unordered_map<const py::detail::function_record*, Impl>();
    return *map;
}

py::handle locked(py::detail::function_call& call)
{
    KernelLock lock;
    return originals().find(&call.func)->second(call);
}

void lock_record(py::detail::function_record* rec)
{
    for (; rec; rec = rec->next)  // (all overloads of the name)
    {
        if (rec->impl == &locked || !rec->impl)
            continue;
        originals().emplace(rec, rec->impl);
        rec->impl = &locked;
    }
}

// The pybind11 record of a function or method (null for anything else).
py::detail::function_record* record_of(py::handle h)
{
    if (!h)
        return nullptr;
    py::handle f = py::detail::get_function(h);  // (a method: its function)
    if (!f || !PyCFunction_Check(f.ptr()))
        return nullptr;
    PyObject* self = PyCFunction_GET_SELF(f.ptr());
    return self ? py::detail::function_record_ptr_from_PyObject(self) : nullptr;
}

void lock_callable(py::handle h)
{
    if (py::detail::function_record* rec = record_of(h))
        lock_record(rec);
}

bool from_module(py::handle h, const std::string& prefix)
{
    if (!py::hasattr(h, "__module__"))
        return false;
    py::object name = h.attr("__module__");
    if (!py::isinstance<py::str>(name))
        return false;
    const std::string s = name.cast<std::string>();
    return s == prefix || s.rfind(prefix + ".", 0) == 0;
}

void lock_class(py::handle type, const std::string& prefix, std::unordered_set<PyObject*>& seen)
{
    if (!seen.insert(type.ptr()).second)
        return;
    PyObject* dict = reinterpret_cast<PyTypeObject*>(type.ptr())->tp_dict;
    if (!dict)
        return;
    const py::handle property = reinterpret_cast<PyObject*>(&PyProperty_Type);
    const py::handle staticmethod = reinterpret_cast<PyObject*>(&PyStaticMethod_Type);
    const py::handle classmethod = reinterpret_cast<PyObject*>(&PyClassMethod_Type);
    for (auto item : py::reinterpret_borrow<py::dict>(dict))
    {
        py::handle v = item.second;
        if (PyType_Check(v.ptr()))
        {
            if (from_module(v, prefix))
                lock_class(v, prefix, seen);
        }
        else if (py::isinstance(v, property))
        {
            for (const char* part : {"fget", "fset", "fdel"})
                lock_callable(v.attr(part));
        }
        else if (py::isinstance(v, staticmethod) || py::isinstance(v, classmethod))
            lock_callable(v.attr("__func__"));
        else
            lock_callable(v);
    }
}

void lock_module(py::module_ m, const std::string& prefix, std::unordered_set<PyObject*>& seen)
{
    if (!seen.insert(m.ptr()).second)
        return;
    for (auto item : py::reinterpret_borrow<py::dict>(PyModule_GetDict(m.ptr())))
    {
        py::handle v = item.second;
        if (PyModule_Check(v.ptr()))
        {
            const std::string name = py::str(v.attr("__name__")).cast<std::string>();
            if (name.rfind(prefix + ".", 0) == 0)
                lock_module(py::reinterpret_borrow<py::module_>(v), prefix, seen);
        }
        else if (PyType_Check(v.ptr()))
        {
            if (from_module(v, prefix))
                lock_class(v, prefix, seen);
        }
        else
            lock_callable(v);
    }
}

}  // namespace

KernelLock::KernelLock() : lock_(acquire()) {}

KernelLock::~KernelLock() { static_cast<std::recursive_mutex*>(lock_)->unlock(); }

NoGil::NoGil()
{
    if (PyGILState_Check() && !finalizing())
        state_ = PyEval_SaveThread();
}

NoGil::~NoGil()
{
    if (state_)
        PyEval_RestoreThread(state_);
}

void lock_kernel_entries(py::module_ m)
{
    std::unordered_set<PyObject*> seen;
    lock_module(m, py::str(m.attr("__name__")).cast<std::string>(), seen);
}

void bind_kernel_lock(py::module_ m)
{
    m.def("kernel_lock_waits", [] { return g_waits.load(); },
          "How often a kernel entry point found the kernel lock taken by another thread and waited "
          "(every entry point of this module takes it; the long ones let the GIL go while the "
          "kernel works).");
    m.def(
        "kernel_locked",
        [](py::handle fn) -> py::object
        {
            py::detail::function_record* rec = record_of(fn);
            if (!rec)
                return py::none();
            for (; rec; rec = rec->next)
                if (rec->impl != &locked)
                    return py::bool_(false);
            return py::bool_(true);
        },
        py::arg("function"),
        "Whether a function or method of this module takes the kernel lock (all overloads); None for "
        "what pybind11 did not make.");

    // Not functions of the module: lock_kernel_entries must not wrap them (the copy's hook cannot
    // take the old lock).
    py::module_ os = py::module_::import("os");
    if (py::hasattr(os, "register_at_fork"))
    {
        py::cpp_function before([] { acquire(); });
        py::cpp_function parent([] { g_lock->unlock(); });
        py::cpp_function child([] { g_lock = new std::recursive_mutex(); });
        os.attr("register_at_fork")(py::arg("before") = before, py::arg("after_in_parent") = parent,
                                    py::arg("after_in_child") = child);
    }
}

}  // namespace smlibpy

#endif  // SMLIBPY_PYTHON
