// SPDX-License-Identifier: Apache-2.0
//
// Colors and names of single faces, as kernel attributes (face_attrs.cpp, kernel plan T5). Plain C++,
// shared by the Python extension and the JavaScript module.

#pragma once

#include <string>
#include <vector>

#include "value.h"

class SmBrep;
class SmFace;

namespace smlibpy {

// Gives faces of a Brep a color each (r, g, b from 0 to 1; an empty one takes the face's color off):
// the kernel's own color attribute (SM_AI_COLOR, an SmColorAttribute), which it carries along through
// copies, splits, merges and Booleans with the face. `colors` holds one color for every face, or one
// for all of them.
void set_face_colors(SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<std::vector<double>>& colors);

// Gives faces of a Brep a name each (an empty one takes the face's name off), carried along as the
// colors are. `names` holds one name for every face, or one for all of them.
void set_face_names(SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<std::string>& names);

// The color and the name of one face: ((r, g, b) or none, a string or none).
Value face_attr(const SmFace* face);

// The colors and names of every face of a Brep, in its order: ([color or none, ...], [name or none,
// ...]).
Value face_attrs(const SmBrep* brep);

}  // namespace smlibpy
