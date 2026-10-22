// SPDX-License-Identifier: Apache-2.0
//
// The caches kernel queries leave on a body (`smlibpy._core.ext`):
//
//   drop_caches(brep)   free them: (count, bytes)
//
// The kernel keeps what it computes for a curve, a surface or a body on that object (SmAObject's
// m_pCacheObj; the shipped build has no global cache queue, SM_USE_GLOBAL_CACHE is off), and
// frees it only with the object or when the object changes. smlibpy's bodies do not change once
// made, so a one-off query (a tight bounding box, a distance) keeps its caches for the body's
// whole life. Part.compact() calls this.

#include "caches.h"

#include "kernel.h"

#include <SmCacheMgr.h>
#include <SmEdgeuse.h>

#include <unordered_set>

namespace smlibpy {

namespace {

struct Dropper
{
    DroppedCaches out;
    std::unordered_set<const SmAObject*> seen;

    void drop(const SmAObject* o)
    {
        if (!o || !seen.insert(o).second)
            return;
        SmCacheObj* cache = o->GetCacheObj();
        if (!cache)
            return;
        ULONG allocated = 0;
        const ULONG used = cache->GetMemoryUsed(allocated);
        out.bytes += static_cast<double>(allocated > used ? allocated : used);
        out.count += 1;
        SmCacheMgr::DeleteObjectsCache(o);  // (a cache in use is freed when it is given back)
    }
};

}  // namespace

DroppedCaches drop_caches(const SmBrep* brep)
{
    Dropper d;
    if (!brep)
        return d.out;
    d.drop(brep);  // (SmBrepCache: the spatial trees of its vertices, curves and surfaces)
    SmBrep* b = const_cast<SmBrep*>(brep);
    SmTArray<SmFace*> faces;
    b->GetFaces(faces);
    for (ULONG i = 0; i < faces.GetSize(); ++i)
        d.drop(faces[i]->GetSurface());
    SmTArray<SmEdge*> edges;
    b->GetEdges(edges);
    SmTArray<SmEdgeuse*> uses;
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        d.drop(edges[i]->GetCurve());
        uses.SetSize(0);
        edges[i]->GetEdgeuses(uses);
        for (ULONG j = 0; j < uses.GetSize(); ++j)
            d.drop(uses[j]->GetUVTrimCurve());
    }
    return d.out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_caches(py::module_ m)
{
    m.def(
        "drop_caches",
        [](const SmBrep* brep)
        {
            const smlibpy::DroppedCaches r = smlibpy::drop_caches(brep);
            return py::make_tuple(r.count, r.bytes);
        },
        py::arg("brep"),
        "Free the caches kernel queries left on a body's curves, surfaces and the body itself; the kernel "
        "builds them again where a later call needs them. (count, bytes) of what was freed.");
}
#endif  // SMLIBPY_PYTHON
