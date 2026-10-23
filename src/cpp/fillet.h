// SPDX-License-Identifier: Apache-2.0
//
// smlibpy's fillets and chamfers (fillet.cpp). Plain C++, shared by the Python extension and the
// JavaScript module.

#pragma once

#include <string>
#include <vector>

class SmBrep;
class SmEdge;
class SmFace;

namespace smlibpy {

// What to round, and how. The lists of numbers hold one value per edge, or one for all edges.
struct RoundSpec
{
    std::vector<SmEdge*> edges;
    std::vector<double> radii;     // the radius (a chamfer: the offset of its first face)
    std::vector<int> sections;     // 0 linear (a chamfer), 1 circular, 2 a blend curve
    std::vector<double> radii2;    // empty, or the offset of the second face (linear sections only)
    std::vector<SmFace*> faces;    // with radii2: the first face of each edge (null: the face of
                                   // the edge's blend edgeuse)
    bool law = false;              // a radius running linearly from start_radius to end_radius
    double start_radius = 0.0, end_radius = 0.0;
    std::vector<std::vector<long>> chains;  // with a law: the edges (indices into `edges`) of each chain of
                                   // edges that meet tangentially, in order along it, each edge in one
                                   // chain: the law runs along each chain, in proportion to arc length
                                   // (SmFilletExecutive::CreateSequenceOfLaws). Empty: along each edge.
    std::vector<double> law_at, law_radii;  // with chains: radii at positions along each chain (0 its
                                   // start, 1 its end; both given, rising), joined smoothly without
                                   // overshooting (SmBSplineFilletLaw, flat at the ends and at each
                                   // largest and smallest radius). Empty: start_radius to end_radius.
    int continuity = 1;            // 1, 2 or 3 for blend curves
    double thumbweight = 1.0;      // fullness of blend curves
    double tolerance_factor = 4.0; // how close the rounds' edges follow the faces, in edge tolerances
                                   // (SM_API's 4; 1 builds rounds close to the largest radius that fits)
    bool mitre = false;            // mitre the corners where three rounded convex edges meet and no other
                                   // edge (SmFilletCorner::SetBevel: the rounds run on until they meet)
};

// The outcome of round_edges: success, or what the kernel's fillet executive recorded about the
// failure (SM_API keeps only the status). Empty strings and -1 where it recorded nothing.
struct Rounded
{
    long status = 0;               // SmStatus (0: success)
    std::string error;             // 'input', 'corner', 'edge', 'intersection', 'trim', 'merge', 'setup'
    std::string stage;             // the step that failed: 'surface_intersection', 'end_point', 'squeeze',
                                   // 'rail_interpolation', 'rail_edge', 'solver', 'deleted', 'tracing',
                                   // 'self_intersection', 'skinning', 'failure' (the executive's SmFilStatus)
    long edge = -1;                // the index of the edge it names
    bool has_vertex = false;       // the corner (an end of one of the edges) it names
    double vertex[3] = {};
    bool has_location = false;     // where it happened
    double location[3] = {};
    std::string corner;            // the kind of corner: '1x1', '2x2', '3x2_mixed', 'Nx1', ...
    std::string comment;           // the executive's own words
    long mitred = 0;               // how many corners were mitred (spec.mitre)
};

// Rounds (or bevels) the edges of `brep` in place, as SM_API's SmApiFilletEdges,
// SmApiFilletEdgesPerEdge and SmApiVariableRadiusFillet do (the same solvers, cross-sections and
// tolerances as SmFilletExecutive::SetFilletParameters makes them; with tolerance_factor 4 the same
// bodies), with two offsets per edge (radii2) where SM_API has none, with mitred corners (SM_API
// mitres only circular rounds of one radius), and with radius laws along chains of edges (SM_API's
// law runs along each edge). A failure can leave the Brep half changed: round a copy.
Rounded round_edges(SmBrep* brep, const RoundSpec& spec);

}  // namespace smlibpy
