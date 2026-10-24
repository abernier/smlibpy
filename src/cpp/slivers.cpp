// SPDX-License-Identifier: Apache-2.0
//
// Sliver faces (`smlibpy._core.ext.remove_slivers`).
//
// A Boolean whose operands' edges cross where their faces cross can leave faces that enclose no
// area: a few micrometres of edge, or a loop that runs along an edge and back. The fuse of the two
// halves of a tube along a loop closed with a kink (operations.sweep) is such a Boolean: the end
// caps of both halves are disks about the point where the loop closes, so their edges cross where
// the surfaces of the tubes cross too. Such a face can also be a shell of its own inside the solid:
// a void without volume, which a STEP file writes as a solid with a void and other software reads
// as an inside-out solid. The faces are removed from a copy (SmBrep::RemoveFaces), and the edges
// of the faces around them, which run along each other there, are stitched together into a solid
// again (as SmStitch::StitchIntoSolid does, but with a tolerance the caller bounds). Deleting the
// faces one by one with SmBrep::SqueezeFace, which stitches around each face, lost the solid's
// region: the face it deletes lies between the solid and the space around it, which it joins.

#include "kernel.h"
#include "slivers.h"

#include <SmApiGeneral.h>
#include <SmCopyBrepMap.h>
#include <SmStitch.h>

#include <algorithm>
#include <cmath>
#include <unordered_set>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

}  // namespace

namespace smlibpy {

SmBrep* remove_slivers(const SmBrep* brep, const std::vector<SmFace*>& faces, double tolerance)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    if (!(tolerance > 0.0))
        throw std::invalid_argument("remove_slivers: the tolerance must be positive");
    const double cap = tolerance;
    for (SmFace* f : faces)
        if (!f || f->GetBrep() != brep)
            throw std::invalid_argument("remove_slivers: a face is not one of the body's");
    SmCopyBrepMap map;  // original -> copy
    SmBrep* copy = new (ctx()) SmBrep(*brep, nullptr, &map, TRUE, FALSE);
    SmTArray<SmFace*> drop;
    for (SmFace* f : faces)
        drop.Add(static_cast<SmFace*>(map.GetAt(f)));
    SmStatus st;
    {
        SmTemporaryChangeValue<SmBoolean> editing(copy->m_bEditingEnabled, TRUE);
        st = copy->RemoveFaces(drop);
    }
    const char* what = "SmBrep::RemoveFaces";
    if (st != SM_SUCCESS)
    {
        // (a Brep that RemoveFaces failed on half way can be deleted: see copy_faces in ext.cpp)
        delete copy;
        SmPyRaise(st, what, __FILE__, __LINE__);
    }
    if (st == SM_SUCCESS)
    {
        // as SmStitch::StitchIntoSolid, but only up to `tolerance`: from a tenth of the Brep's
        // tolerance, doubled until no edge has a face on one side only
        what = "SmStitch::DoStitching";
        ULONG lamina = 1;
        for (double tol = copy->GetTolerance() / 10.0; st == SM_SUCCESS && lamina && tol <= cap; tol *= 2.0)
        {
            SmStitchCallback callback;
            SmStitch stitch(callback, tol, TRUE, FALSE);
            stitch.m_bFastEdgeCompare = TRUE;
            stitch.m_bSplitEdgesWithVertices = FALSE;
            stitch.m_bMakingManifoldSolid = TRUE;
            ULONG stitched = 0;
            double vertex_gap = 0.0, edge_gap = 0.0;
            st = stitch.DoStitching(copy, nullptr, nullptr, stitched, lamina, vertex_gap, edge_gap);
        }
        SmTArray<SmRegion*> regions;
        copy->GetRegions(regions);
        if (st == SM_SUCCESS && (lamina || regions.GetSize() < 2))
            st = SM_ERR;
    }
    if (st != SM_SUCCESS)
    {
        delete copy;
        SmPyRaise(st, what, __FILE__, __LINE__);
    }
    return copy;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_slivers(py::module_ m)
{
    m.def("remove_slivers", &smlibpy::remove_slivers, py::arg("brep"), py::arg("faces"), py::arg("tolerance"),
          py::return_value_policy::take_ownership,
          "A copy of the Brep without the given faces (faces of it that enclose no area), stitched into a solid "
          "again: the edges of the faces around them are glued together within `tolerance` at most. Raises where "
          "the kernel cannot (an edge left with a face on one side only, or no solid).");
}
#endif  // SMLIBPY_PYTHON
