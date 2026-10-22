// SPDX-License-Identifier: Apache-2.0
//
// Extending a face's surface past its sides, and the whole surface of a face (extend.cpp). Plain
// C++, shared by the Python extension and the JavaScript module.

#pragma once

#include <vector>

class SmBrep;
class SmEdge;
class SmExtent2d;
class SmFace;
class SmPoint2d;
class SmSurface;
class SmVector3d;

namespace smlibpy {

// A sheet of one face: the face's surface over the face's parameter rectangle, grown by `distance`
// (measured along the surface, across the middle of each side) past the sides the given edges of
// the face lie on, or past every side that can grow (not a pole, not where the surface closes
// around) when there are none. `continuity` 0 continues the surface as it is (planes stay planes;
// B-splines by their own polynomials, SM_CT_CINFINITY), 1 along its tangents (G1), 2 with its
// curvature (SM_CT_G1_G2). The sheet's normal follows the face's outward normal. Owned by the caller.
SmBrep* extend_face(const SmFace* face, double distance, const std::vector<SmEdge*>& edges, int continuity);

// A sheet of one face: the face's whole surface, without its trims (holes, cut borders); a plane
// over the face's parameter rectangle (a plane's own rectangle is arbitrary). The sheet's normal
// follows the face's outward normal. Owned by the caller.
SmBrep* untrim_face(const SmFace* face);

// The rectangle in the face's surface parameters the face lies in: for a plane the smallest one around
// the face's edges (a plane's own rectangle is arbitrary), for other surfaces the face's UV domain.
SmExtent2d face_parameter_box(const SmFace* face);

// The face's outward normal at `uv` of `surface` (the face's own surface, or one with its parameters).
SmVector3d face_outward_normal(const SmFace* face, const SmSurface& surface, const SmPoint2d& uv);

// A sheet of one face over the surface's `domain`, its normal along `normal` at `uv`. Takes the
// surface (the sheet's afterwards, deleted when this fails). Owned by the caller.
SmBrep* surface_sheet(SmSurface* surface, const SmExtent2d& domain, const SmPoint2d& uv, const SmVector3d& normal);

}  // namespace smlibpy
