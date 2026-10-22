// SPDX-License-Identifier: Apache-2.0
//
// The kernel's error trace. SMLib reports a failure to its error callback where it returns one
// (with third_party/patches/SMLib/inc/SmMessages.h also in release builds): the status, the file,
// the line and the function. The callback keeps the last kKernelTraceKept of them per thread, in a
// ring of fixed entries (no allocation, no formatting: the kernel recovers from many errors, and
// each runs the callback); kernel_trace() formats them. smlibpy reads it when a kernel call failed
// (KernelError.trace, Python and JavaScript).

#include "trace.h"

#include <SmMessages.h>
#include <SmPyError.h>

#ifndef SMLIBPY_SMMESSAGES_PATCHED
#error "the kernel's SmMessages.h is not third_party/patches/SMLib/inc/SmMessages.h (CMakeLists.txt puts it first)"
#endif

#include <cstring>

namespace smlibpy {

namespace {

struct Entry
{
    SmStatus status;
    unsigned long line;
    char file[40];
    char where[72];
};

thread_local Entry t_ring[kKernelTraceKept];
thread_local unsigned long long t_recorded = 0;

// A TCHAR string as plain chars (file and function names are ASCII), cut to the buffer.
template <typename C>
void copy(char* out, std::size_t size, const C* text)
{
    std::size_t i = 0;
    if (text)
        for (; text[i] && i + 1 < size; ++i)
            out[i] = (text[i] > 0 && text[i] < 128) ? static_cast<char>(text[i]) : '?';
    out[i] = '\0';
}

template <typename C>
const C* basename(const C* path)
{
    if (!path)
        return path;
    const C* name = path;
    for (const C* p = path; *p; ++p)
        if (*p == '/' || *p == '\\')
            name = p + 1;
    return name;
}

void record(SmStatus status, const TCHAR* const file, ULONG line, const TCHAR* const message)
{
    // (warnings and messages are no failures)
    if (status == SM_SUCCESS || status == SM_ERR_WARNING || status == SM_ERR_MESSAGE)
        return;
    Entry& e = t_ring[t_recorded % kKernelTraceKept];
    ++t_recorded;
    e.status = status;
    e.line = line;
    copy(e.file, sizeof e.file, basename(file));
    copy(e.where, sizeof e.where, message);
}

}  // namespace

void install_kernel_trace()
{
    smos_SetErrorCallback(record);
}

void clear_kernel_trace()
{
    smos_SetErrorCallback(record);  // (for this thread, where the kernel keeps one per thread)
    t_recorded = 0;
}

KernelTrace kernel_trace()
{
    KernelTrace t;
    t.recorded = t_recorded;
    const unsigned long long first = t_recorded > kKernelTraceKept ? t_recorded - kKernelTraceKept : 0;
    for (unsigned long long i = first; i < t_recorded; ++i)
    {
        const Entry& e = t_ring[i % kKernelTraceKept];
        std::string s = sm_status_name(e.status);
        if (e.file[0])
            s += std::string(" at ") + e.file + ":" + std::to_string(e.line);
        if (e.where[0])
            s += std::string(" (") + e.where + ")";
        t.entries.push_back(std::move(s));
    }
    return t;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_kernel_trace(py::module_ m)
{
    m.def("clear_kernel_trace", &smlibpy::clear_kernel_trace,
          "Forget the failures the kernel reported so far (see kernel_trace).");
    m.def(
        "kernel_trace",
        []
        {
            const smlibpy::KernelTrace t = smlibpy::kernel_trace();
            return py::make_tuple(t.entries, t.recorded);
        },
        "The failures the kernel reported since clear_kernel_trace(), oldest first: the last 48 of them "
        "('SM_ERR at SmFilletExecutive.cpp:1234 (CreateFilletCorners)'), and how many there were.");
}
#endif  // SMLIBPY_PYTHON
