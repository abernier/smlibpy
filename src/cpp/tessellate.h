// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's tessellation (tessellate.cpp): the kernel's grid, or halving for bodies with faces the
// grid leaves too coarse. Plain C++, shared by the Python extension and the JavaScript module.

#pragma once

#include <SmBrep.h>  // SmTessellationReport

#include <string>

class SmFace;
class SmPolyBrep;

namespace smlibpy {

struct TessellateOptions
{
    double chord_height_tolerance = 0.0;
    double curve_angle_tolerance_deg = 0.0;
    double surface_angle_tolerance_deg = 0.0;
    double max_edge_length = 0.0;
    double max_aspect_ratio = 0.0;
    std::string algorithm = "auto";  // auto, grid or halving
    bool allow_partial = false;
};

// The mesh (owned by the caller; null when the kernel failed), the kernel's status and report, and
// the algorithm used ("grid" or "halving").
struct Tessellation
{
    SmPolyBrep* mesh = nullptr;
    SmStatus status = SM_SUCCESS;
    SmTessellationReport report;
    std::string algorithm;
};

// Wrong options throw std::invalid_argument; a kernel failure is in the result's status.
Tessellation tessellate(SmBrep* brep, const TessellateOptions& options);
// "halving" if tessellate with algorithm "auto" halves the faces for these tolerances, else "grid".
std::string tessellation_algorithm(SmBrep* brep, double chord_height_tolerance, double surface_angle_tolerance_deg,
                                   double max_edge_length, double max_aspect_ratio);
// The estimated distance between the kernel's grid and a face twisted along a straight direction.
double grid_deviation(const SmFace* face, double chord_height_tolerance, double surface_angle_tolerance_deg,
                      double max_edge_length);

}  // namespace smlibpy
