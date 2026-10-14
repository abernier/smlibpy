// SPDX-License-Identifier: Apache-2.0
//
// The cells of a non-manifold body (`smlibpy._core.ext`):
//
//   region_shells(brep)   per closed region that is not a cavity, the solids inside its shells
//
// A merged part (Part.merge, the kernel's non-manifold Boolean) keeps its cells as regions of one
// body: a face between two cells is used from both sides, by a shell of each region. A region's
// first shell is its outer boundary, the others bound its cavities. Each shell's faces, copied into
// a body of their own and stitched, are the solid inside that shell; the cell is the outer one less
// the cavities (Part.cells does that Boolean). A face that a shell uses from both sides (a sheet
// inside the cell) bounds no volume and is left out.

#include "kernel.h"
#include "cells.h"

#include <SmApiBrep.h>
#include <SmApiGeneral.h>

#include <stdexcept>
#include <unordered_map>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(status, what, __FILE__, __LINE__);
}

SmBrep* shell_solid(SmBrep* body, SmShell* shell)
{
    SmTArray<SmFaceuse*> fus;
    shell->GetFaceuses(fus);
    std::unordered_map<SmFace*, int> uses;
    std::vector<SmFace*> order;
    for (ULONG i = 0; i < fus.GetSize(); ++i)
        if (uses[fus[i]->GetFace()]++ == 0)
            order.push_back(fus[i]->GetFace());
    SmTArray<SmFace*> faces;
    for (SmFace* f : order)
        if (uses[f] == 1)
            faces.Add(f);
    if (faces.GetSize() == 0)
        throw std::runtime_error("cells: a shell of a cell has no faces");
    SmBrep* out = new (ctx()) SmBrep();
    try
    {
        check(body->CopyFaces(faces, out, nullptr, FALSE), "SmBrep::CopyFaces");
        SmBoolean solid = FALSE;
        ULONG stitched = 0;
        double vertex_gap = 0.0, edge_gap = 0.0;
        check(SmApiStitchIntoSolid(out, solid, stitched, vertex_gap, edge_gap), "SmApiStitchIntoSolid");
        if (!solid)
            throw std::runtime_error("cells: the faces of a shell of a cell do not close");
    }
    catch (...)
    {
        delete out;
        throw;
    }
    return out;
}

}  // namespace

namespace smlibpy {

std::vector<std::vector<SmBrep*>> region_shells(const SmBrep* brep)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    SmBrep* body = const_cast<SmBrep*>(brep);
    SmTArray<SmRegion*> regions;
    body->GetRegions(regions);
    std::vector<std::vector<SmBrep*>> out;
    try
    {
        for (ULONG r = 0; r < regions.GetSize(); ++r)
        {
            if (regions[r] == body->GetInfiniteRegion() || regions[r]->IsVoid() == TRUE)
                continue;
            SmTArray<SmShell*> shells;
            regions[r]->GetShells(shells);
            out.emplace_back();
            for (ULONG s = 0; s < shells.GetSize(); ++s)
                out.back().push_back(shell_solid(body, shells[s]));
        }
    }
    catch (...)
    {
        for (auto& cell : out)
            for (SmBrep* b : cell)
                delete b;
        throw;
    }
    return out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_cells(py::module_ m)
{
    m.def("region_shells", &smlibpy::region_shells, py::arg("brep"), py::return_value_policy::take_ownership,
          "Per closed region of a body that is not a cavity (the cells of a merged part), the solids inside its "
          "shells: the outer shell's first, then its cavities' (the caller's).");
}
#endif  // SMLIBPY_PYTHON
