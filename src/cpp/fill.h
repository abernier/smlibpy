// SPDX-License-Identifier: Apache-2.0
//
// Surfaces bounded by curves: patches that fill a closed loop of curves, tangent to the sheets the
// curves are edges of or not, and surfaces through a network of crossing curves (fill.cpp). Plain
// C++, shared by the Python extension and the JavaScript module.

#pragma once

#include <utility>
#include <vector>

class SmBrep;
class SmCurve;
class SmEdge;
class SmFace;

namespace smlibpy {

// A Brep of the patches (one face each, not sewn) that fill the closed loop the curves form, in any
// order and direction (one closed curve, or two, is split into four sides). `faces[i]` and `edges[i]`:
// the face curve i is a border edge of, for a patch tangent to that face along it; null for a free
// curve. Either every curve has a face (tangent: SmBSplineSurface::CreateCornerBlend, a Coons patch
// with cross tangents for 3 and 4 sides, an N-sided fill of one patch per side for more), or none
// (a bilinear Coons patch for 4 sides, an N-sided fill for 3 and more). `tolerance`: how far apart
// the ends of consecutive curves may be. The patches are checked: they run through the curves and
// lie across each edge from its face, tangent to it. Their normals follow the faces (tangent), or
// run by the right-hand rule around the loop in the direction of the first curve. Owned by the caller;
// the curves are not consumed.
SmBrep* fill_loop(const std::vector<SmCurve*>& curves, const std::vector<SmFace*>& faces,
                  const std::vector<SmEdge*>& edges, double tolerance);

// A surface through a network of curves (a Gordon surface, N_CreateGordonSrf): `u` curves that each
// cross every `v` curve, at least two of each, in any order and direction, each ending on the outer
// curves of the other set. The curves are made compatible first (each sampled so that its crossings
// fall at parameters common to its set, and interpolated), and the surface is measured against the
// curves given: the largest distance of a curve from it is returned with it. `tolerance`: how close
// curves must pass to cross. Its normal is the first u curve's direction crossed with the first v
// curve's. The Brep (one face) is the caller's; the curves are not consumed.
std::pair<SmBrep*, double> network_surface(const std::vector<SmCurve*>& u, const std::vector<SmCurve*>& v,
                                           double tolerance);

}  // namespace smlibpy
