// SPDX-License-Identifier: Apache-2.0
//
// Seams that run tangent to the other operand of a Boolean (seams.cpp). Plain C++, shared by the
// Python extension and the JavaScript module.

#pragma once

#include <cstddef>
#include <vector>

class SmBrep;

namespace smlibpy {

// A point where a seam of one body touches a face of another tangentially.
struct SeamContact
{
    long edge = -1;  // the seam, in the first body's edge order
    long face = -1;  // the face it touches, in the second body's face order
    double point[3] = {0.0, 0.0, 0.0};
    bool along = false;  // the seam lies on the face's surface on both sides of the point too
};

// The points where a seam of body a (an edge that one face uses twice: the seam of a cylinder, cone,
// sphere or torus) touches a face of body b tangentially while the two faces cross there, so that
// the curve along which they cross runs tangent to the seam; within `tolerance` (0: ten times the
// larger zone tolerance of the two bodies, at least 1e-4). Faces of b that are not planes,
// cylinders, cones, spheres or tori are not looked at.
std::vector<SeamContact> seam_contacts(const SmBrep* a, const SmBrep* b, double tolerance);

// The turns of body a about its axis of revolution (every face a plane across the axis or a
// cylinder, cone, sphere or torus about it, so that its shape stays) that leave no seam of it
// touching a face of b as seam_contacts finds them: at most `count` angles in degrees, in the order
// tried. None where no seam of a touches b, or a is no body of revolution.
struct SeamTurns
{
    double origin[3] = {0.0, 0.0, 0.0}, axis[3] = {0.0, 0.0, 1.0};
    std::vector<double> angles;
};
SeamTurns seam_turns(const SmBrep* a, const SmBrep* b, double tolerance, size_t count);

// A Brep turned in place about the axis of `turns` by `degrees`.
void turn_brep(SmBrep* brep, const SeamTurns& turns, double degrees);

// A copy of body a (owned by the caller) in which every seam that touches b as seam_contacts finds
// them lies elsewhere on its face: for a body that is no body of revolution (a part with a hole),
// whose seams no turn of the whole moves. The face's surface solid (a cylinder or frustum over the
// face's extent along its axis, or the sphere) is added and taken away again turned about the
// axis where it is the wall of a hole, or taken away and added again turned where it is a boss's;
// the copy must keep a's volume. Null where no seam of a touches b, or one could not be moved so
// (a torus' seams, a face whose surface solid reaches into other material).
SmBrep* reseamed(const SmBrep* a, const SmBrep* b, double tolerance);

// Whether a seam of a closed face of body a that is no cylinder, cone, sphere or torus (a B-spline
// face: a NURBS copy, an imported part) touches a face of b as seam_contacts finds them. Such a seam
// is moved only on a copy whose faces are recognized as analytic (analytics.h).
bool freeform_seam_touches(const SmBrep* a, const SmBrep* b, double tolerance);

// The points where a seam of a closed face of body a, of any kind (a cylinder, cone, sphere or torus,
// or a B-spline face), touches a face of b at a point, as seam_contacts finds them: not where the seam
// lies on the face's surface on both sides of the point too (a cylinder's seam in a plane through its
// axis, which gives the kernel no trouble). The places where a Boolean of a and b can come out wrong
// (kernel plan B6) and smlibpy checks the result.
std::vector<SeamContact> seam_touches(const SmBrep* a, const SmBrep* b, double tolerance);

}  // namespace smlibpy
