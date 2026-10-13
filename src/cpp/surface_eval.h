// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's surface evaluation (surface_eval.cpp): derivatives and principal curvatures of exact
// surfaces. Plain C++, shared by the Python extension and the JavaScript module. Points, vectors
// and parameters are flat: (u, v) pairs, (x, y, z) triples.

#pragma once

#include <vector>

class SmSurface;
class SmFace;
class SmPolyBrep;

namespace smlibpy {

struct SurfaceDerivatives
{
    std::vector<double> point, du, dv, duu, duv, dvv;
};

struct FaceCurvatures
{
    std::vector<double> k1, k2, normal;  // NaN where the surface has no curvature
};

struct PolyCurvatures
{
    std::vector<double> k1, k2, uv;
    unsigned long solved = 0;
};

SurfaceDerivatives surface_derivatives(const SmSurface* surface, const std::vector<double>& uv);
FaceCurvatures face_curvatures(const SmFace* face, const std::vector<double>& uv);
PolyCurvatures poly_curvatures(SmPolyBrep& poly);

}  // namespace smlibpy
