// SPDX-License-Identifier: Apache-2.0
//
// The shells of a body (`smlibpy._core.ext`, kernel plan T7):
//
//   brep_shells(brep)   per shell of each region: its kind, region, cell and faces
//
// The kernel keeps a body's faces in shells and its shells in regions (SmRegion, SmShell): the
// region around the body (the infinite region) has a shell for each body's outside, a cavity is a
// region of its own (IsVoid) whose first shell is its wall (and further shells the outsides of
// bodies floating in it), and each closed region that is not a cavity is a cell of the material,
// bounded by its own shells (a part has one cell; a merged part one per closed region, with a face
// between two cells in a shell of each). Each faceuse lies in the shell on its side of the face.
// Part.shells, Part.voids, Face.cells, ShapeList.shared and Part.info read this.

#include "kernel.h"
#include "shells.h"

#include <set>
#include <stdexcept>
#include <unordered_map>

namespace smlibpy {

Value brep_shells(const SmBrep* brep)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    SmTArray<SmFace*> faces;
    SmTArray<SmRegion*> regions;
    brep->GetFaces(faces);
    brep->GetRegions(regions);
    std::unordered_map<const SmFace*, long> index;
    for (ULONG i = 0; i < faces.GetSize(); ++i)
        index[faces[i]] = static_cast<long>(i);
    const SmRegion* infinite = brep->GetInfiniteRegion();
    Value out = Value::make_list();
    long cells = 0;
    for (ULONG r = 0; r < regions.GetSize(); ++r)
    {
        const SmRegion* region = regions[r];
        const bool outside = region == infinite;
        const bool cavity = !outside && region->IsVoid() == TRUE;
        const long cell = outside || cavity ? -1 : cells++;
        SmTArray<SmShell*> shells;
        region->GetShells(shells);
        for (ULONG s = 0; s < shells.GetSize(); ++s)
        {
            SmTArray<SmFaceuse*> uses;
            shells[s]->GetFaceuses(uses);
            std::set<long> used;
            for (ULONG u = 0; u < uses.GetSize(); ++u)
            {
                auto it = index.find(uses[u]->GetFace());
                if (it != index.end())
                    used.insert(it->second);
            }
            Value ids = Value::make_list();
            for (long f : used)
                ids.push(Value::integer(f));
            out.push(Value::dict({{"kind", Value::of(std::string(outside ? "outside" : cavity ? "void" : "cell"))},
                                  {"region", Value::integer(static_cast<long long>(r))},
                                  {"cell", Value::integer(cell)},
                                  {"closed", Value::of(shells[s]->IsClosed() == TRUE)},
                                  {"faces", ids}}));
        }
    }
    return out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"
#include "py_value.h"

void bind_shells(py::module_ m)
{
    m.def("brep_shells", [](const SmBrep* brep) { return smlibpy::to_python(smlibpy::brep_shells(brep)); },
          py::arg("brep"),
          "Per shell of each region of a body: a dict with 'kind' ('outside', 'void' or 'cell'), 'region', 'cell' "
          "(the index among the cells, -1 for the others), 'closed' and 'faces' (the face indices it uses).");
}
#endif  // SMLIBPY_PYTHON
