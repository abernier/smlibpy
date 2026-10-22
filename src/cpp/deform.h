// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's space deformations of whole Breps (deform.cpp): twist, taper, bend, lattice. Plain C++,
// shared by the Python extension and the JavaScript module. Breps in the results are copies the
// caller owns.

#pragma once

#include <cstddef>
#include <string>
#include <vector>

class SmBrep;

namespace smlibpy {

// One piece of a deformation: a kernel volume map over a range along the deformation's axis.
struct DeformPiece
{
    std::string kind;              // identity, affine, rigid, twist, bend, unbend or lattice
    bool has_lo = false, has_hi = false;
    double lo = 0.0, hi = 0.0;     // the range along the axis (unbounded where not given)
    std::vector<double> matrix;    // affine, rigid: 3x4 row-major; unbend: a rigid motion after it
    std::vector<double> origin, axis, mid, center;  // twist, bend, unbend (and the lattice's origin): x, y, z
    double period = 0.0;           // twist
    double neutral = 0.0;          // bend, unbend
    std::vector<int> counts;       // lattice: points per direction
    std::vector<double> size, x, y, z, points;  // lattice: box size, its axes, control points (flat)
};

struct DeformSpec
{
    bool has_axis = false;
    std::vector<double> axis;      // origin and direction (6 values)
    std::vector<DeformPiece> pieces;
    // The piece of every face (in the Brep's order), where the caller decides: edges and vertices
    // follow their faces. Without it, a face goes to the piece its interior point lies in.
    std::vector<int> faces;
    bool has_tolerance = false;
    double tolerance = 0.0;
    bool has_max_degree = false;
    int max_degree = 0;
    bool has_max_exact_points = false;
    size_t max_exact_points = 0;
    bool has_approx_degree = false;
    int approx_degree = 0;
    bool has_analytic = false;
    bool analytic = true;          // analytic images where the exact image is analytic
};

struct DeformStats
{
    int faces_kept = 0, faces_exact = 0, faces_approximated = 0;
    int edges_kept = 0, edges_exact = 0, edges_approximated = 0;
    int faces_analytic = 0, edges_analytic = 0;  // of the exact ones: planes, cylinders, cones, lines, circles, ...
    double max_error = 0.0;
    int max_degree = 0;
};

struct Deformed
{
    SmBrep* brep = nullptr;
    DeformStats stats;
};

struct Deviation
{
    double faces = 0.0, edges = 0.0, vertices = 0.0;
};

// A copy of a Brep sent through the deformation, every face and edge converted to NURBS (exact
// where the composition is polynomial, within the spec's tolerance elsewhere), or to analytic
// geometry where the exact image is a plane, cylinder, cone, line, circle or a moved copy.
Deformed deform_brep(const SmBrep* brep, const DeformSpec& spec);
// The kernel's exact procedural composition of a copy with the deformation, for checks.
SmBrep* composite_brep(const SmBrep* brep, const DeformSpec& spec);
// The largest distance between a deformed Brep and the exact deformation of its source.
Deviation deviation(const SmBrep* source, const SmBrep* result, const DeformSpec& spec, int samples);
// Points (flat x, y, z) mapped through the deformation.
std::vector<double> map_points(const DeformSpec& spec, const std::vector<double>& points);

}  // namespace smlibpy
