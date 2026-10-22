// SPDX-License-Identifier: Apache-2.0
//
// The module itself, for js/src/kernel.ts (k.runtime):
//
//   memory_usage()      what the module's memory holds: the bytes the allocator has handed out
//                       (used), the size of the module's memory (heap, which grows and never
//                       shrinks) and the size it can grow to (limit: MAXIMUM_MEMORY less 64 kB),
//                       and whether an allocation failed since the last look (failed: malloc sets
//                       errno to ENOMEM when the memory cannot grow any further).
//   exception_info(f)   what a C++ exception that left a binding is: `f` throws it back into
//                       this C++ frame, which catches it by type without allocating (the memory
//                       may be used up), and so also frees it. The bindings of smlibpy's own C++
//                       catch theirs (guard in common.h); the kernel's bindings leave them to
//                       kernel.ts, which asks here.

#include "common.h"

#include <emscripten/heap.h>
#include <malloc.h>

#include <cerrno>
#include <new>
#include <stdexcept>

using namespace emscripten;

namespace {

val memory_usage()
{
    const struct mallinfo info = mallinfo();
    const bool failed = errno == ENOMEM;
    if (failed)
        errno = 0;
    val out = val::object();
    out.set("used", static_cast<double>(info.uordblks));
    out.set("heap", static_cast<double>(emscripten_get_heap_size()));
    out.set("limit", static_cast<double>(emscripten_get_heap_max()));
    out.set("failed", failed);
    return out;
}

// [kind, message]: "memory" (std::bad_alloc), "value" (where guard makes a RangeError), "error"
// (any other std::exception), "unknown"; null when `rethrow` returned. A JavaScript exception is
// no C++ exception and passes through (catch (...) does not take it).
val exception_info(val rethrow)
{
    const auto info = [](const char* kind, const char* message) {
        val out = val::array();
        out.call<void>("push", val(kind));
        out.call<void>("push", val(message));
        return out;
    };
    try
    {
        rethrow();
    }
    catch (const std::bad_alloc& e)
    {
        return info("memory", e.what());
    }
    catch (const std::invalid_argument& e)
    {
        return info("value", e.what());
    }
    catch (const std::domain_error& e)
    {
        return info("value", e.what());
    }
    catch (const std::length_error& e)
    {
        return info("value", e.what());
    }
    catch (const std::out_of_range& e)
    {
        return info("value", e.what());
    }
    catch (const std::range_error& e)
    {
        return info("value", e.what());
    }
    catch (const std::overflow_error& e)
    {
        return info("value", e.what());
    }
    catch (const std::exception& e)
    {
        return info("error", e.what());
    }
    catch (...)
    {
        return info("unknown", "unknown C++ exception");
    }
    return val::null();
}

}  // namespace

EMSCRIPTEN_BINDINGS(smlib_runtime)
{
    function("runtime__memory_usage", &memory_usage);
    function("runtime__exception_info", &exception_info);
}
