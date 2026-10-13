// SPDX-License-Identifier: Apache-2.0
//
// Surfaces fitted to point clouds, and kernel meshes from indexed triangles (fit.cpp). Plain C++,
// shared by the Python extension and the JavaScript module.

#pragma once

#include <vector>

class SmPolyBrep;
class SmSurface;

namespace smlibpy {

// A bicubic B-spline surface approximating scattered points (see fit.cpp), owned by the caller,
// and how far the points are from it.
struct SurfaceFit
{
    SmSurface* surface = nullptr;
    double max_error = 0.0;  // the largest distance of a point from the surface
    double rms_error = 0.0;  // the root mean square of the distances
    int nu = 0, nv = 0;      // control points in u and v
};

// points: x, y, z of each point. nu, nv: control points in the two directions (4 to 64; the
// u direction runs along the cloud's longest extent), or 0 and 0: about one per 8 points, 16 to
// 1024 in all, shaped like the cloud. smoothing: weight of the bending energy of the control net
// against the distances (0: none; 1e-3 is gentle, 1 strong), relative to the number and spread of
// the points.
SurfaceFit fit_surface(const std::vector<double>& points, int nu, int nv, double smoothing);

// A kernel mesh of an indexed triangle mesh (vertices: x, y, z of each vertex; triangles: three
// vertex indices each, counterclockwise seen from outside), its triangles stitched along the
// edges they share. Owned by the caller (ext.delete_polybrep).
SmPolyBrep* poly_from_triangles(const std::vector<double>& vertices, const std::vector<long>& triangles);

// Splits every polygon of a kernel mesh that is not a triangle into triangles, polygons with holes
// too (the kernel's mesh Booleans leave such polygons; mesh arrays take only their outer loops).
void triangulate_poly(SmPolyBrep* poly);

}  // namespace smlibpy
