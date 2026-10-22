// SPDX-License-Identifier: Apache-2.0
//
// A solid split by a sheet (`smlibpy._core.ext`, kernel plan B12):
//
//   slice(brep, sheet, below)      the part of a solid above (or below) a sheet: SM_BO_SLICE
//   extended_sheet(face, distance) a face's B-spline surface extended beyond its sides
//
// SmApiBoolean takes SM_BO_SLICE (value 10, "slice a solid with a sheet and keep the upper half")
// although neither SmPyLib nor the WebAssembly bindings name it: it splits a box by a wavy sheet
// exactly (4800 and 3200 of 8000) and caps the cut with the sheet's own face. It keeps the side the
// sheet's normals point to; for the other side the sheet's faces are turned first. A sheet that does
// not reach through the solid acts as a DIFFERENCE (an open body, or the solid less a dent), which
// the caller (Part.split) refuses or answers by extending a sheet of one B-spline face.

#include "kernel.h"
#include "slice.h"

#include <SmApiBrep.h>
#include <SmApiGeneral.h>

#include <stdexcept>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(status, what, __FILE__, __LINE__);
}

}  // namespace

namespace smlibpy {

SmBrep* slice(SmBrep* brep, SmBrep* sheet, bool below)
{
    if (!brep || !sheet)
        throw std::invalid_argument("brep is None");
    if (below)
    {
        SmTArray<SmFace*> faces;
        sheet->GetFaces(faces);
        for (ULONG i = 0; i < faces.GetSize(); ++i)
        {
            if (!faces[i]->GetSurface() || !faces[i]->GetSurface()->IsKindOf(SmBSplineSurface_TYPE))
                throw std::invalid_argument("slice below: the sheet's faces must be B-spline faces (turn_to_nurbs)");
            check(faces[i]->SwapUV(), "SmFace::SwapUV");
        }
    }
    SmBrep* result = nullptr;
    const SmStatus st = SmApiBoolean(brep, sheet, SM_BO_SLICE, result);
    if (st != SM_SUCCESS)  // SmMerge clears the mark only on its way out of a success
        SmApiGetOrCreateContext()->SetDoingBoolean(FALSE);
    check(st, "SmApiBoolean(SM_BO_SLICE)");
    return result;
}

SmBrep* extended_sheet(const SmFace* face, double distance)
{
    if (!face)
        throw std::invalid_argument("face is None");
    if (!(distance > 0))
        throw std::invalid_argument("the distance must be positive");
    SmSurface* surface = face->GetSurface();
    if (!surface || !surface->IsKindOf(SmBSplineSurface_TYPE))
        throw std::invalid_argument("only a B-spline surface can be extended");
    SmSurface* extended = nullptr;
    check(static_cast<SmBSplineSurface*>(surface)->CreateExtendedSurface(ctx(), distance, SM_CT_G1, extended),
          "SmBSplineSurface::CreateExtendedSurface");
    SmBrep* out = new (ctx()) SmBrep();
    SmFace* made = nullptr;
    const SmStatus st = out->CreateFaceFromSurface(extended, extended->GetNaturalUVDomain(), made);
    if (st != SM_SUCCESS)
    {
        if (extended->GetOwner() == nullptr)
            delete extended;
        delete out;
        check(st, "SmBrep::CreateFaceFromSurface");
    }
    return out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_slice(py::module_ m)
{
    m.def("slice", &smlibpy::slice, py::arg("brep"), py::arg("sheet"), py::arg("below") = false,
          py::return_value_policy::reference,
          "The part of a solid on the side a sheet's normals point to (SM_BO_SLICE), with `below` the other. As "
          "ext.boolean: on success the result is brep, changed, and the sheet is deleted; on failure both stay the "
          "caller's.");
    m.def("extended_sheet", &smlibpy::extended_sheet, py::arg("face"), py::arg("distance"),
          py::return_value_policy::take_ownership,
          "A sheet of one face: the face's B-spline surface extended by `distance` beyond its sides (G1), untrimmed.");
}
#endif  // SMLIBPY_PYTHON
