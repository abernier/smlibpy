// SPDX-License-Identifier: Apache-2.0
//
// Distances between points, segments and triangles (Ericson, Real-Time Collision Detection 5.1),
// shared by the mesh tools (mesh_tools.cpp) and the rays (rays.cpp). Plain C++ on the kernel's point
// and vector types.

#pragma once

#include <SmVector3d.h>  // (SmPoint3d is SmVector3d)

#include <algorithm>
#include <cmath>

namespace smlibpy {

// The point of the triangle abc nearest to p (5.1.5).
inline SmPoint3d nearest_on_triangle(const SmPoint3d& p, const SmPoint3d& a, const SmPoint3d& b, const SmPoint3d& c)
{
    const SmVector3d ab = b - a, ac = c - a, ap = p - a;
    const double d1 = ab.Dot(ap), d2 = ac.Dot(ap);
    if (d1 <= 0 && d2 <= 0)
        return a;
    const SmVector3d bp = p - b;
    const double d3 = ab.Dot(bp), d4 = ac.Dot(bp);
    if (d3 >= 0 && d4 <= d3)
        return b;
    const double vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0)
        return a + ab * (d1 / (d1 - d3));
    const SmVector3d cp = p - c;
    const double d5 = ab.Dot(cp), d6 = ac.Dot(cp);
    if (d6 >= 0 && d5 <= d6)
        return c;
    const double vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0)
        return a + ac * (d2 / (d2 - d6));
    const double va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0)
        return b + (c - b) * ((d4 - d3) / ((d4 - d3) + (d5 - d6)));
    const double denominator = 1.0 / (va + vb + vc);
    return a + ab * (vb * denominator) + ac * (vc * denominator);
}

// The distance between the segments p0 p1 and q0 q1 (5.1.9).
inline double segment_segment_distance(const SmPoint3d& p0, const SmPoint3d& p1, const SmPoint3d& q0, const SmPoint3d& q1)
{
    const SmVector3d d1 = p1 - p0, d2 = q1 - q0, r = p0 - q0;
    const double a = d1.Dot(d1), e = d2.Dot(d2), f = d2.Dot(r);
    const double tiny = 1e-300;
    double s = 0.0, t = 0.0;
    if (a <= tiny && e <= tiny)
        return p0.DistanceBetween(q0);
    if (a <= tiny)
        t = std::clamp(f / e, 0.0, 1.0);
    else
    {
        const double c = d1.Dot(r);
        if (e <= tiny)
            s = std::clamp(-c / a, 0.0, 1.0);
        else
        {
            const double b = d1.Dot(d2), denominator = a * e - b * b;
            s = denominator > 0 ? std::clamp((b * f - c * e) / denominator, 0.0, 1.0) : 0.0;
            t = (b * s + f) / e;
            if (t < 0)
            {
                t = 0;
                s = std::clamp(-c / a, 0.0, 1.0);
            }
            else if (t > 1)
            {
                t = 1;
                s = std::clamp((b - c) / a, 0.0, 1.0);
            }
        }
    }
    return (p0 + d1 * s).DistanceBetween(q0 + d2 * t);
}

// Whether the segment p0 p1 passes through the triangle abc (its edges included).
inline bool segment_crosses_triangle(const SmPoint3d& p0, const SmPoint3d& p1, const SmPoint3d& a, const SmPoint3d& b,
                                     const SmPoint3d& c)
{
    const SmVector3d d = p1 - p0, e1 = b - a, e2 = c - a;
    const SmVector3d h = d * e2;  // (the cross product)
    const double det = e1.Dot(h);
    if (std::fabs(det) <= 1e-300)
        return false;  // (parallel: the edges give the distance)
    const double inv = 1.0 / det;
    const SmVector3d s = p0 - a;
    const double u = s.Dot(h) * inv;
    if (u < 0 || u > 1)
        return false;
    const SmVector3d q = s * e1;
    const double v = d.Dot(q) * inv;
    if (v < 0 || u + v > 1)
        return false;
    const double t = e2.Dot(q) * inv;
    return t >= 0 && t <= 1;
}

// The distance between the segment p0 p1 and the triangle abc.
inline double segment_triangle_distance(const SmPoint3d& p0, const SmPoint3d& p1, const SmPoint3d& a, const SmPoint3d& b,
                                        const SmPoint3d& c)
{
    if (segment_crosses_triangle(p0, p1, a, b, c))
        return 0.0;
    double d = std::min(p0.DistanceBetween(nearest_on_triangle(p0, a, b, c)),
                        p1.DistanceBetween(nearest_on_triangle(p1, a, b, c)));
    d = std::min(d, segment_segment_distance(p0, p1, a, b));
    d = std::min(d, segment_segment_distance(p0, p1, b, c));
    return std::min(d, segment_segment_distance(p0, p1, c, a));
}

}  // namespace smlibpy
