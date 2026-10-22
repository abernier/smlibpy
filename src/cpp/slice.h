// SPDX-License-Identifier: Apache-2.0
//
// A solid split by a sheet (slice.cpp, kernel plan B12). Plain C++, shared by the Python extension
// and the JavaScript module.

#pragma once

class SmBrep;
class SmFace;

namespace smlibpy {

// The part of a solid on the side a sheet's normals point to (the kernel's SM_BO_SLICE), or with
// `below` on the other side (the sheet's faces turned first). As ext.boolean: on success the result
// is `brep`, changed, and `sheet` is deleted; on failure both stay the caller's (the sheet turned
// where `below`). Where the sheet does not cut through the solid, the kernel takes out the part of
// the solid behind it as a DIFFERENCE would (an open body, or the solid less a dent); the caller
// checks the result.
SmBrep* slice(SmBrep* brep, SmBrep* sheet, bool below);

// A sheet of one face: the B-spline surface of `face` extended by `distance` beyond each of its
// four sides (SmBSplineSurface::CreateExtendedSurface, tangentially: G1), whole (the face's trim
// is not kept). Its normals point as the surface's do. invalid_argument for a face whose surface
// is not a B-spline.
SmBrep* extended_sheet(const SmFace* face, double distance);

}  // namespace smlibpy
