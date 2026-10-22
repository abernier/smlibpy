// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's curves on faces (curve_project.cpp): curves projected onto faces along a direction or
// along the faces' normals, a face's iso-parameter curves and curves on a face trimmed to it, every
// one fitted with the caller's tolerance. Plain C++, shared by
// the Python extension and the JavaScript module.

#pragma once

#include <vector>

class SmCurve;
class SmFace;

namespace smlibpy {

// A curve on a face: `face` is its index into the faces given. `curve` is the caller's.
struct FaceCurve
{
    SmCurve* curve = nullptr;
    int face = -1;
};

// The curve projected along `direction` onto the faces (of one body): SmBrep::
// CreateParallelProjectionCurves with an approximation tolerance of `tolerance` and, for a `distance`
// above 0, only as far as that from the curve. The pieces on each face, trimmed to it.
std::vector<FaceCurve> project_curve(const std::vector<SmFace*>& faces, const SmCurve* curve,
                                     const std::vector<double>& direction, double tolerance, double distance);

// The curve projected onto the faces along their normals (each point to its nearest point of the
// surface): SmBrep::CreateNormalProjectionCurves with `tolerance`, trimmed to the faces.
std::vector<FaceCurve> normal_project(const std::vector<SmFace*>& faces, const SmCurve* curve, double tolerance);

// The parts of curves that lie on the face (within `tolerance` of its surface) inside its boundary
// (SmFace::CreateCurvesByTrimming, classified in 3D): new B-splines, the input kept.
std::vector<SmCurve*> trim_to_face(const SmFace* face, const std::vector<SmCurve*>& curves, double tolerance);

// The face's curve of constant u (`along_v`: true, the curve runs along v) or constant v at `value`
// (SmSurface::CreateIsoParametricCurve within `tolerance`), trimmed to the face.
std::vector<SmCurve*> iso_curves(const SmFace* face, bool along_v, double value, double tolerance);

}  // namespace smlibpy
