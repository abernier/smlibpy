// SPDX-License-Identifier: Apache-2.0
//
// The module itself, for js/src/kernel.ts (k.runtime):
//
//   memory_usage()      what the module's memory holds: the bytes the allocator has handed out
//                       (used, less the reserve below), the size of the module's memory (heap,
//                       which grows and never shrinks) and the size it can grow to (limit:
//                       MAXIMUM_MEMORY less 64 kB), and whether an allocation failed since the
//                       last look (failed: malloc sets errno to ENOMEM when the memory cannot grow
//                       any further).
//   reserve()           whether the reserve is held, taken again first where it was given away
//                       (kernelCall asks before each kernel step, and fails the step with
//                       SM_ERR_OUT_OF_MEMORY where it cannot be taken).
//
// The reserve: 8 MB of the module's memory that malloc, calloc, realloc and the aligned allocations
// give up to the allocation that finds the memory used up, and then try that again. Without it the
// kernel throws std::bad_alloc in the middle of its work (smos_Calloc, SM_USE_EXCEPTIONS), and the
// destructors that run while it unwinds read the half-made objects: an allocation of a sphere's
// surface cache (SmSurfaceCache::SubdivideNode) left a tree node half split, ~SmCone's cache
// deletion read past the memory, and the allocator's own lists were broken from then on, so the
// next Box crashed too (the test of a real out-of-memory, js/test/closeout_W.test.ts, depending on
// memory layout). With the reserve the step that finds the memory used up finishes, and the next
// one fails at once, before the kernel runs, until enough is freed to take the reserve again.
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

constexpr size_t RESERVE = size_t(8) << 20;
void* reserve_block = nullptr;

/** Gives up the reserve, where it is held, so that the allocation that failed can try again. */
bool give_up_reserve()
{
    if (reserve_block == nullptr)
        return false;
    emscripten_builtin_free(reserve_block);
    reserve_block = nullptr;
    return true;
}

}  // namespace

// The allocator's entry points (dlmalloc's are weak aliases, emscripten/heap.h): each tries once
// more after giving up the reserve, with errno as it was before the failed try.
extern "C" {

void* malloc(size_t size)
{
    const int was = errno;
    void* p = emscripten_builtin_malloc(size);
    if (p == nullptr && give_up_reserve())
    {
        p = emscripten_builtin_malloc(size);
        if (p != nullptr)
            errno = was;
    }
    return p;
}

void* calloc(size_t count, size_t size)
{
    const int was = errno;
    void* p = emscripten_builtin_calloc(count, size);
    if (p == nullptr && give_up_reserve())
    {
        p = emscripten_builtin_calloc(count, size);
        if (p != nullptr)
            errno = was;
    }
    return p;
}

void* realloc(void* old, size_t size)
{
    const int was = errno;
    void* p = emscripten_builtin_realloc(old, size);
    if (p == nullptr && size != 0 && give_up_reserve())
    {
        p = emscripten_builtin_realloc(old, size);
        if (p != nullptr)
            errno = was;
    }
    return p;
}

void* memalign(size_t alignment, size_t size)
{
    const int was = errno;
    void* p = emscripten_builtin_memalign(alignment, size);
    if (p == nullptr && give_up_reserve())
    {
        p = emscripten_builtin_memalign(alignment, size);
        if (p != nullptr)
            errno = was;
    }
    return p;
}

int posix_memalign(void** out, size_t alignment, size_t size)
{
    if (alignment < sizeof(void*) || (alignment & (alignment - 1)) != 0)
        return EINVAL;
    void* p = memalign(alignment, size);
    if (p == nullptr && size != 0)
        return ENOMEM;
    *out = p;
    return 0;
}

void* aligned_alloc(size_t alignment, size_t size)
{
    return memalign(alignment, size);
}

}  // extern "C"

namespace {

bool reserve()
{
    if (reserve_block == nullptr)
    {
        const int was = errno;
        reserve_block = emscripten_builtin_malloc(RESERVE);
        errno = was;  // (memory that cannot hold the reserve yet is no failed allocation of a step)
    }
    return reserve_block != nullptr;
}

val memory_usage()
{
    const struct mallinfo info = mallinfo();
    const bool failed = errno == ENOMEM;
    if (failed)
        errno = 0;
    const double held = reserve_block != nullptr ? static_cast<double>(malloc_usable_size(reserve_block)) : 0.0;
    val out = val::object();
    out.set("used", static_cast<double>(info.uordblks) - held);
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
    function("runtime__reserve", &reserve);
    function("runtime__exception_info", &exception_info);
}
