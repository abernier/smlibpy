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

}  // namespace smlibpy
