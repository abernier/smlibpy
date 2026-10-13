// SPDX-License-Identifier: Apache-2.0
//
// The kernel's calls as SmPyLib binds them for Python (usd-brep/source/SmPyLib/src/SmPy*.cpp) and
// smlibpy calls them (k.<name>): the same names, the arguments in the same order, the same kernel
// call and the same ownership. Python's keyword arguments are trailing parameters, in the order of
// the SmPyLib signature; JavaScript passes every argument (comments name the Python defaults).
//
//   bind_kernel_creation.cpp   primitives, curves, surfaces
//   bind_kernel_editing.cpp    Booleans, sweeps, fillets, offsets, file input, NURBS, stitching
//   bind_kernel_analysis.cpp   transforms, queries, intersections, projections, healing, meshes
//   bind_kernel.cpp            the enums (below); bind_kernel.h what the files share
//
// Values (common.h): kernel objects are numbers, 0 where the kernel returns none; points and
// vectors [x, y, z]; lists of kernel objects arrays of numbers; lists of points arrays of
// [x, y, z]; lists of numbers Float64Arrays; a Python tuple is an array, a dict a plain object.
// Enum arguments are numbers: the constants below (BooleanOp_UNION, ...).
// Ownership as in SmPyLib's docstrings: "consumes" = the kernel takes the argument over (deletes
// it, or returns it changed); "mutates" = changed in place and returned; otherwise the arguments
// stay as they were and the result is new and the caller's.

#include "bind_kernel.h"

#include <SmApiBrep.h>
#include <SmFilletSolver.h>
#include <SmPolyMerge.h>

using namespace emscripten;

// Python's enums (SmPyEnums.cpp) as numbers, <Enum>_<VALUE>, with the kernel's values. CapEnds,
// OffsetType and BSplineCurveForm are here for the trailing arguments whose Python default is
// one of their values.
EMSCRIPTEN_BINDINGS(smlib_kernel_enums)
{
    constant("BooleanOp_UNION", static_cast<int>(SM_BO_UNION));
    constant("BooleanOp_DIFFERENCE", static_cast<int>(SM_BO_DIFFERENCE));
    constant("BooleanOp_INTERSECTION", static_cast<int>(SM_BO_INTERSECTION));
    constant("BooleanOp_MERGE", static_cast<int>(SM_BO_MERGE));

    constant("BooleanOp2D_UNION", static_cast<int>(SM_2D_UNION));
    constant("BooleanOp2D_INTERSECTION", static_cast<int>(SM_2D_INTERSECTION));
    constant("BooleanOp2D_DIFFERENCE", static_cast<int>(SM_2D_DIFFERENCE));
    constant("BooleanOp2D_EXCLUSIVE_OR", static_cast<int>(SM_2D_EXCLUSIVE_OR));
    constant("BooleanOp2D_MERGE", static_cast<int>(SM_2D_MERGE));

    // (for fillet_edges_per_edge; fillet_edges and variable_radius_fillet take 0, 1, 2 instead)
    constant("FilletXSect_LINEAR", static_cast<int>(SM_FSG_LINEAR));
    constant("FilletXSect_CIRCULAR", static_cast<int>(SM_FSG_CIRCULAR));
    constant("FilletXSect_BLEND", static_cast<int>(SM_FSG_BLEND_CURVE));

    constant("PolyBooleanOp_UNION", static_cast<int>(SM_PBO_UNION));
    constant("PolyBooleanOp_INTERSECTION", static_cast<int>(SM_PBO_INTERSECTION));
    constant("PolyBooleanOp_DIFFERENCE", static_cast<int>(SM_PBO_DIFFERENCE));
    constant("PolyBooleanOp_MERGE", static_cast<int>(SM_PBO_MERGE));
    constant("PolyBooleanOp_PARTIAL_MERGE", static_cast<int>(SM_PBO_PARTIAL_MERGE));

    // SmPyLib's own selectors (SmPyCommon.h): the integers the kernel takes
    constant("OffsetType_LEFT", 1);
    constant("OffsetType_RIGHT", 2);
    constant("OffsetType_BOTH", 3);
    constant("CapEnds_NONE", 0);
    constant("CapEnds_START", 1);
    constant("CapEnds_END", 2);
    constant("CapEnds_BOTH", 3);

    constant("BSplineCurveForm_POLYLINE", static_cast<int>(SM_CF_POLYLINE_FORM));
    constant("BSplineCurveForm_CIRCULAR_ARC", static_cast<int>(SM_CF_CIRCULAR_ARC));
    constant("BSplineCurveForm_ELLIPTIC_ARC", static_cast<int>(SM_CF_ELLIPTIC_ARC));
    constant("BSplineCurveForm_PARABOLIC_ARC", static_cast<int>(SM_CF_PARABOLIC_ARC));
    constant("BSplineCurveForm_HYPERBOLIC_ARC", static_cast<int>(SM_CF_HYPERBOLIC_ARC));
    constant("BSplineCurveForm_HELICAL_ARC", static_cast<int>(SM_CF_HELICAL_ARC));
    constant("BSplineCurveForm_UNSPECIFIED", static_cast<int>(SM_CF_UNSPECIFIED));
}
