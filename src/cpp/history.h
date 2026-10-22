// SPDX-License-Identifier: Apache-2.0
//
// Where the faces and edges of a body came from (history.cpp, kernel plan T3). Plain C++, shared by
// the Python extension and the JavaScript module.

#pragma once

#include <vector>

class SmBrep;
class SmEdge;
class SmFace;

namespace smlibpy {

// Gives every face and edge of a Brep that carries no tag a tag of its own: a number no other face
// or edge was given in this process. With `fresh`, every face and edge gets a new one, in place of
// the ones it had. The kernel carries the tags along through its operations (an attribute,
// SmAttribute.h section 5): a copy keeps them, both halves of a split face or edge keep the
// parent's, a face or edge merged from two (or found coincident with one of another body in a
// Boolean) carries the tags of both; faces and edges an operation makes anew (a fillet's round, the
// curve along which two bodies meet) carry none. Returns how many it tagged.
long tag_topology(SmBrep* brep, bool fresh = false);

// The tags of each face and each edge of a Brep, in the Brep's order (ascending; empty for one
// that carries none).
struct TopologyTags
{
    std::vector<std::vector<long>> faces, edges;
};
TopologyTags topology_tags(const SmBrep* brep);

// Puts tags on each face and edge of a Brep, in its order, in place of those they carry (tags read
// with topology_tags from a Brep the same as this one: written to a file and read back). False,
// and nothing changed, where the counts of faces or edges differ.
bool set_topology_tags(SmBrep* brep, const std::vector<std::vector<long>>& faces,
                       const std::vector<std::vector<long>>& edges);

// Adds tags to the given faces of a Brep (to those they carry).
void add_face_tags(SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<long>& tags);

// Takes the tags off every face and edge of a Brep.
void untag_topology(SmBrep* brep);

}  // namespace smlibpy
