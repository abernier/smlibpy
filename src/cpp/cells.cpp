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
//
// An insert that touches the outer boundary at a point or along a line joins its shell to the
// outer one, which the kernel then keeps as one shell. Its faces fall apart into the outer
// boundary and the insert's again when they are grouped across the edges the shell uses exactly
// twice: the line of contact is used four times, and at a point of contact no edge joins the two.
// The group with the largest box is the outer boundary, the others are cavities.
#include "kernel.h"
#include "cells.h"

#include <SmApiBrep.h>
#include <SmApiGeneral.h>

#include <stdexcept>
#include <unordered_map>
#include <utility>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(status, what, __FILE__, __LINE__);
}

// The faces a shell uses once, in groups joined across edges the group's faces use exactly twice.
std::vector<std::vector<SmFace*>> shell_groups(SmShell* shell)
{
    SmTArray<SmFaceuse*> fus;
    shell->GetFaceuses(fus);
    std::unordered_map<SmFace*, int> uses;
    std::vector<SmFace*> order;
    for (ULONG i = 0; i < fus.GetSize(); ++i)
        if (uses[fus[i]->GetFace()]++ == 0)
            order.push_back(fus[i]->GetFace());
    std::vector<SmFace*> faces;
    std::unordered_map<SmFace*, size_t> index;
    for (SmFace* f : order)
        if (uses[f] == 1)
        {
            index[f] = faces.size();
            faces.push_back(f);
        }
    if (faces.empty())
        throw std::runtime_error("cells: a shell of a cell has no faces");

    // the faces that use each edge, once per use
    std::unordered_map<SmEdge*, std::vector<size_t>> edge_faces;
    SmTArray<SmEdgeuse*> eus;
    for (ULONG i = 0; i < fus.GetSize(); ++i)
    {
        auto it = index.find(fus[i]->GetFace());
        if (it == index.end())
            continue;
        fus[i]->GetEdgeuses(eus);
        for (ULONG j = 0; j < eus.GetSize(); ++j)
            edge_faces[eus[j]->GetEdge()].push_back(it->second);
    }
    std::vector<size_t> root(faces.size());
    for (size_t i = 0; i < root.size(); ++i)
        root[i] = i;
    auto find = [&](size_t i) {
        while (root[i] != i)
            i = root[i] = root[root[i]];
        return i;
    };
    for (const auto& entry : edge_faces)
        if (entry.second.size() == 2)
            root[find(entry.second[0])] = find(entry.second[1]);

    std::vector<std::vector<SmFace*>> groups;
    std::unordered_map<size_t, size_t> group_of;
    for (size_t i = 0; i < faces.size(); ++i)
    {
        auto it = group_of.emplace(find(i), groups.size()).first;
        if (it->second == groups.size())
            groups.emplace_back();
        groups[it->second].push_back(faces[i]);
    }
    return groups;
}

SmBrep* faces_solid(SmBrep* body, const std::vector<SmFace*>& group)
{
    SmTArray<SmFace*> faces;
    for (SmFace* f : group)
        faces.Add(f);
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

double box_diagonal(SmBrep* brep)
{
    SmExtent3d box;
    check(brep->CalculateBoundingBox(box), "SmBrep::CalculateBoundingBox");
    return box.GetSize().Length();
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
            std::vector<SmBrep*>& cell = out.back();
            size_t first = 0;  // the solids of the first shell
            for (ULONG s = 0; s < shells.GetSize(); ++s)
            {
                for (const auto& group : shell_groups(shells[s]))
                    cell.push_back(faces_solid(body, group));
                if (s == 0)
                    first = cell.size();
            }
            // the outer boundary first: of the first shell's solids, the one with the largest box
            if (first > 1)
            {
                size_t outer = 0;
                double largest = -1.0;
                for (size_t i = 0; i < first; ++i)
                {
                    double d = box_diagonal(cell[i]);
                    if (d > largest)
                    {
                        largest = d;
                        outer = i;
                    }
                }
                std::swap(cell[0], cell[outer]);
            }
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
