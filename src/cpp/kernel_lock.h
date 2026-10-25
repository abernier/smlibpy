// SPDX-License-Identifier: Apache-2.0
//
// One lock for the kernel, and the GIL let go while it works (kernel_lock.cpp; Python only).
//
// SMLib is not thread-safe: its one context holds shared state without locks (the mark counters
// of its traversals, the caches of curves, surfaces and bodies), so no two threads may run kernel
// code at once. The GIL was that lock: no kernel call let it go, and a 0.3 s Boolean froze every
// other Python thread (a GUI, a server's heartbeat, a progress bar) for 0.3 s. Now every entry
// point of smlibpy._core takes the kernel lock, and the long ones let the GIL go while the kernel
// works: the other threads run on, and those that call the kernel meanwhile wait for it.

#pragma once

#ifdef SMLIBPY_PYTHON

#include <pybind11/pybind11.h>

#include <utility>

namespace smlibpy {

// Held while a kernel entry point runs. A recursive lock: a finalizer that frees a body
// (BrepHandle.__del__ -> ext.delete_brep) can run inside another kernel call of the same thread.
// It waits for the lock with the GIL let go, since the thread that holds it may need the GIL to
// finish.
class KernelLock
{
public:
    KernelLock();
    ~KernelLock();
    KernelLock(const KernelLock&) = delete;
    KernelLock& operator=(const KernelLock&) = delete;

private:
    void* lock_;  // (the mutex taken: a fork's copy gets a new one, see kernel_lock.cpp)
};

// The GIL let go for the life of the object, where this thread holds it and Python is not
// exiting (the thread that finalizes keeps it). For pybind11's call_guard, around a binding whose
// C++ body touches no Python object (pybind11 converts the arguments before it and the result
// after it).
class NoGil
{
public:
    NoGil();
    ~NoGil();
    NoGil(const NoGil&) = delete;
    NoGil& operator=(const NoGil&) = delete;

private:
    PyThreadState* state_ = nullptr;
};

// f() with the GIL let go. For the kernel work of an entry point (which holds the kernel lock:
// every one does, see lock_kernel_entries), and only where f touches no Python object.
template <class F>
auto without_gil(F&& f) -> decltype(std::forward<F>(f)())
{
    NoGil released;
    return std::forward<F>(f)();
}

// Make every function, method and property of a module, its submodules and their classes take
// the kernel lock: each pybind11 function record's dispatcher is swapped for one that takes the
// lock and then dispatches. Called once, after everything is registered.
void lock_kernel_entries(pybind11::module_ m);

// ext.kernel_lock_waits and ext.kernel_locked (for the tests), and the hooks that hold the lock
// across os.fork (kernel_lock.cpp).
void bind_kernel_lock(pybind11::module_ m);

}  // namespace smlibpy

#endif  // SMLIBPY_PYTHON
