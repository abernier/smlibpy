// SPDX-License-Identifier: Apache-2.0
//
// The kernel's calls that make and change Breps: Booleans, sweeps, fillets, offsets, file input,
// NURBS conversion, stitching (SmPyBooleans.cpp, SmPySweeps.cpp, SmPyFillets.cpp, SmPyOffset.cpp,
// SmPyFileIo.cpp, SmPyBrepOps.cpp, SmPyStitching.cpp). Conventions in bind_kernel.cpp.

#include "bind_kernel.h"

#include <SmApiBrep.h>
#include <SmApiPrimitives.h>
#include <SmApiFillets.h>
#include <SmFilletSolver.h>

#include <cstdio>
#include <cstring>

using namespace emscripten;

namespace {

using namespace smjs;
using namespace smjs::kernel;

// ---------------------------------------------------------------- booleans (SmPyBooleans.cpp)
// Consumes both: on success the result is brep1, changed, and brep2 is deleted; on failure both
// stay the caller's. operation: BooleanOp (keyword-only in Python).
uintptr_t boolean_op(uintptr_t brep1, uintptr_t brep2, int operation)
{
    const SmBooleanOperationType op = one_of<SmBooleanOperationType>(
        operation, {SM_BO_UNION, SM_BO_DIFFERENCE, SM_BO_INTERSECTION, SM_BO_MERGE}, "operation (BooleanOp)");
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiBoolean(brep(brep1), brep(brep2), op, r));
    return ptr(r);
}

// As boolean, but brep2 is kept (not deleted) with keep_other_brep. Python defaults (keyword-only):
// cookie_cutter false, imprinting false, post_process true, imprint_and_classify false,
// keep_other_brep false.
uintptr_t boolean_with_options(uintptr_t brep1, uintptr_t brep2, int operation, bool cookie_cutter, bool imprinting,
                               bool post_process, bool imprint_and_classify, bool keep_other_brep)
{
    const SmBooleanOperationType op = one_of<SmBooleanOperationType>(
        operation, {SM_BO_UNION, SM_BO_DIFFERENCE, SM_BO_INTERSECTION, SM_BO_MERGE}, "operation (BooleanOp)");
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiBooleanWithOptions(brep(brep1), brep(brep2), op, flag(cookie_cutter), flag(imprinting),
                                       flag(post_process), flag(imprint_and_classify), flag(keep_other_brep), r));
    return ptr(r);
}

// Coplanar planar bodies. Consumes both as boolean; when either has no faces the kernel succeeds
// without a result (0) and both stay the caller's. operation: BooleanOp2D.
uintptr_t boolean_2d(uintptr_t brep1, uintptr_t brep2, int operation)
{
    const Sm2DBooleanOperationType op = one_of<Sm2DBooleanOperationType>(
        operation, {SM_2D_UNION, SM_2D_INTERSECTION, SM_2D_DIFFERENCE, SM_2D_EXCLUSIVE_OR, SM_2D_MERGE},
        "operation (BooleanOp2D)");
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiBoolean2d(brep(brep1), brep(brep2), op, r));
    return ptr(r);
}

// Non-manifold results allowed (cells sharing faces: Part.merge). Consumes both as boolean.
// operation: BooleanOp (keyword-only in Python).
uintptr_t non_manifold_boolean(uintptr_t brep1, uintptr_t brep2, int operation)
{
    const SmBooleanOperationType op = one_of<SmBooleanOperationType>(
        operation, {SM_BO_UNION, SM_BO_DIFFERENCE, SM_BO_INTERSECTION, SM_BO_MERGE}, "operation (BooleanOp)");
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiNonManifoldBoolean(brep(brep1), brep(brep2), op, r));
    return ptr(r);
}

EMSCRIPTEN_BINDINGS(smlib_kernel_booleans)
{
    function("boolean", &boolean_op);
    function("non_manifold_boolean", &non_manifold_boolean);
    function("boolean_with_options", &boolean_with_options);
    function("boolean_2d", &boolean_2d);
}

// ---------------------------------------------------------------- sweeps (SmPySweeps.cpp)
// The curves stay the caller's in every sweep. Python default (keyword-only): cap_ends true.
uintptr_t linear_sweep(val curves, val direction, double distance, bool cap_ends)
{
    SmTArray<SmCurve*> arr;
    fill(curves, arr);
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiCreateLinearSweep(arr, vec(direction), distance, flag(cap_ends), r));
    return ptr(r);
}

// Python default (keyword-only): cap_ends true.
uintptr_t rotational_sweep(val curves, val base_point, val axis, double angle_deg, bool cap_ends)
{
    SmTArray<SmCurve*> arr;
    fill(curves, arr);
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiCreateRotationalSweep(arr, vec(base_point), vec(axis), angle_deg, flag(cap_ends), r));
    return ptr(r);
}

// Python defaults (keyword-only): fillet_corners false, cap_ends CapEnds_BOTH.
uintptr_t draft_sweep(val curves, double height, double angle_deg, bool fillet_corners, int cap_ends)
{
    const int caps = one_of<int>(cap_ends, {0, 1, 2, 3}, "cap_ends (CapEnds)");
    SmTArray<SmCurve*> arr;
    fill(curves, arr);
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiCreateDraftSweep(arr, height, angle_deg, flag(fillet_corners), caps, r));
    return ptr(r);
}

// Python defaults (keyword-only): move_profile true, cap_ends CapEnds_BOTH.
uintptr_t sweep_along_planar_path(val profile_curves, val path_curves, bool move_profile, int cap_ends)
{
    const int caps = one_of<int>(cap_ends, {0, 1, 2, 3}, "cap_ends (CapEnds)");
    SmTArray<SmCurve*> profile, path;
    fill(profile_curves, profile);
    fill(path_curves, path);
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiCreateSweepAlongPlanarPath(profile, path, flag(move_profile), caps, r));
    return ptr(r);
}

// A selection of faces, edges or vertices: null (none given) or an array without null entries.
void fill_selection(const val& a, const char* name, std::vector<uintptr_t>& out)
{
    const unsigned n = a["length"].as<unsigned>();
    for (unsigned i = 0; i < n; ++i)
    {
        const val item = a[i];
        if (absent(item) || item.as<uintptr_t>() == 0)
            throw_error(std::string("non-manifold sweep selection '") + name +
                        "' contains null; every entry must be topology of brep_to_sweep");
        out.push_back(item.as<uintptr_t>());
    }
}

template <typename T>
SmTArray<T*>* selection(const val& a, const char* name, SmTArray<T*>& store)
{
    if (absent(a))
        return nullptr;
    std::vector<uintptr_t> items;
    fill_selection(a, name, items);
    for (uintptr_t p : items)
        store.Add(reinterpret_cast<T*>(p));
    return &store;
}

// Mutates brep_to_sweep (the swept topology grows in place); returns it. faces, edges, vertices:
// all null sweeps the whole Brep, otherwise only what they list. region_brep: null or
// brep_to_sweep. Python defaults (keyword-only): region_brep None, do_stitching true,
// do_merge false, faces / edges / vertices None.
uintptr_t non_manifold_linear_sweep(uintptr_t brep_to_sweep, val direction, double distance, val region_brep,
                                    bool do_stitching, bool do_merge, val faces, val edges, val vertices)
{
    SmBrep* b = brep(brep_to_sweep);
    if (!absent(faces) || !absent(edges) || !absent(vertices))
    {
        auto selects = [](const val& o) { return !absent(o) && o["length"].as<unsigned>() > 0; };
        if (!selects(faces) && !selects(edges) && !selects(vertices))
            throw_error("non-manifold sweep has an empty selection: pass null for faces, edges and vertices "
                        "to sweep the whole Brep, or give at least one non-empty array");
    }
    SmTArray<SmFace*> fs;
    SmTArray<SmEdge*> es;
    SmTArray<SmVertex*> vs;
    SmTArray<SmFace*>* pf = selection(faces, "faces", fs);
    SmTArray<SmEdge*>* pe = selection(edges, "edges", es);
    SmTArray<SmVertex*>* pv = selection(vertices, "vertices", vs);
    SmBrep* region = maybe<SmBrep>(region_brep);
    if (region && region != b)
        throw_error("non-manifold sweep region_brep must be null or brep_to_sweep itself: a different Brep would "
                    "receive the swept topology while brep_to_sweep is what gets stitched and returned");
    SMJS_CHECK(SmApiNonManifoldSweep(b, region, vec(direction), distance, flag(do_stitching), flag(do_merge), pf, pe,
                                     pv));
    return brep_to_sweep;
}

EMSCRIPTEN_BINDINGS(smlib_kernel_sweeps)
{
    function("linear_sweep", &linear_sweep);
    function("rotational_sweep", &rotational_sweep);
    function("draft_sweep", &draft_sweep);
    function("sweep_along_planar_path", &sweep_along_planar_path);
    function("non_manifold_linear_sweep", &non_manifold_linear_sweep);
}

// ---------------------------------------------------------------- fillets (SmPyFillets.cpp)
// All mutate brep and return it; edges are its edges. xsect_type is an integer, not a
// FilletXSect: 0 linear, 1 circular, 2 blend. continuity (blend): 1 G1, 2 G2, 3 G3.

// Python defaults (keyword-only): xsect_type 1, continuity 1, thumbweight 1.0.
uintptr_t fillet_edges(uintptr_t b, val edges, double radius, unsigned long xsect_type, unsigned long continuity,
                       double thumbweight)
{
    SmTArray<SmEdge*> arr;
    fill(edges, arr);
    SMJS_CHECK(SmApiFilletEdges(brep(b), arr, radius, xsect_type, continuity, thumbweight));
    return b;
}

// The radius runs linearly from start_radius to end_radius along each edge. Python defaults
// (keyword-only): xsect_type 1, continuity 1.
uintptr_t variable_radius_fillet(uintptr_t b, val edges, double start_radius, double end_radius,
                                 unsigned long xsect_type, unsigned long continuity)
{
    SmTArray<SmEdge*> arr;
    fill(edges, arr);
    SMJS_CHECK(SmApiVariableRadiusFillet(brep(b), arr, start_radius, end_radius, xsect_type, continuity));
    return b;
}

// A radius and a FilletXSect per edge. Python defaults (keyword-only): continuity 1, thumbweight 1.0.
uintptr_t fillet_edges_per_edge(uintptr_t b, val edges, val radii, val xsect_types, unsigned long continuity,
                                double thumbweight)
{
    SmTArray<SmEdge*> earr;
    fill(edges, earr);
    SmTArray<double> rarr;
    for (double r : numbers(radii))
        rarr.Add(r);
    SmTArray<SmFilletSurfaceGeneratorType> xarr;
    for (double x : numbers(xsect_types))
        xarr.Add(one_of<SmFilletSurfaceGeneratorType>(static_cast<int>(x),
                                                      {SM_FSG_LINEAR, SM_FSG_CIRCULAR, SM_FSG_BLEND_CURVE},
                                                      "xsect_types (FilletXSect)"));
    SMJS_CHECK(SmApiFilletEdgesPerEdge(brep(b), earr, rarr, xarr, continuity, thumbweight));
    return b;
}

// The kernel's own fillet removal (defeaturing): removes the fillet faces it recognises; changes
// brep in place and returns it.
uintptr_t remove_fillet(uintptr_t b)
{
    SMJS_CHECK(SmApiRemoveFillet(brep(b)));
    return b;
}

// A new sheet Brep: the fillet between two surfaces (the caller's; the surfaces stay the caller's,
// though the kernel changes them). Python defaults (keyword-only): xsect_type 1, mirror false,
// complement false.
uintptr_t surface_surface_fillet(uintptr_t surface1, uintptr_t surface2, double radius1, double radius2,
                                 double tolerance, unsigned long xsect_type, bool mirror, bool complement)
{
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiSurfaceSurfaceFillet(smjs::surface(surface1), smjs::surface(surface2), radius1, radius2, tolerance,
                                         r, xsect_type, flag(mirror), flag(complement)));
    return ptr(r);
}

EMSCRIPTEN_BINDINGS(smlib_kernel_fillets)
{
    function("surface_surface_fillet", &surface_surface_fillet);
    function("remove_fillet", &remove_fillet);
    function("fillet_edges", &fillet_edges);
    function("variable_radius_fillet", &variable_radius_fillet);
    function("fillet_edges_per_edge", &fillet_edges_per_edge);
}

// ---------------------------------------------------------------- offset (SmPyOffset.cpp)
// A new hollow body; brep unchanged. faces_to_shell: faces of brep left open ([]: a closed wall).
// Python defaults (keyword-only): extended_offset true, self_intersection true, create_solid true,
// faces_to_shell [].
uintptr_t shell_brep(uintptr_t b, double distance, bool extended_offset, bool self_intersection, bool create_solid,
                     val faces_to_shell)
{
    SmTArray<const SmFace*> faces;
    fill(faces_to_shell, faces);
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiShellBrepFull(brep(b), distance, flag(extended_offset), flag(self_intersection),
                                  flag(create_solid), faces, r));
    return ptr(r);
}

// A new body; brep unchanged. Python defaults (keyword-only): extended_offset true,
// self_intersection true.
uintptr_t offset_brep(uintptr_t b, double distance, bool extended_offset, bool self_intersection)
{
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiOffsetBrepFull(brep(b), distance, flag(extended_offset), flag(self_intersection), r));
    return ptr(r);
}

// A sheet: the region inside the closed loop of curves moved by distance to one side (LEFT,
// RIGHT), or the band around the loop (BOTH); the curves stay the caller's. Python defaults
// (keyword-only): offset_type OffsetType_BOTH, round_corners true, shell_result false.
uintptr_t create_offset_profile(val curves, double distance, int offset_type, bool round_corners, bool shell_result)
{
    const int side = one_of<int>(offset_type, {1, 2, 3}, "offset_type (OffsetType)");
    SmTArray<SmCurve*> arr;
    fill(curves, arr);
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiCreateOffsetProfile(arr, distance, static_cast<ULONG>(side), flag(round_corners),
                                        flag(shell_result), r));
    return ptr(r);
}

EMSCRIPTEN_BINDINGS(smlib_kernel_offset)
{
    function("shell_brep", &shell_brep);
    function("offset_brep", &offset_brep);
    function("create_offset_profile", &create_offset_profile);
}

// ---------------------------------------------------------------- io (SmPyFileIo.cpp, SmPyTypes.cpp)
// The file format as SmPyLib detects it from the first bytes; part containers are refused there.
enum class Format { ascii, binary, unknown };
enum class Container { single_brep, part, unrecognized_part_version, unknown };
struct FileInfo
{
    Format format = Format::unknown;
    Container container = Container::unknown;
    uint64_t version = 0;
};

uint64_t little_endian_u64(const unsigned char* b)
{
    uint64_t v = 0;
    for (int i = 0; i < 8; ++i)
        v |= static_cast<uint64_t>(b[i]) << (8 * i);
    return v;
}

// A binary part file starts with its database version (40, or 42 with the healer version).
FileInfo binary_part_info(const unsigned char* h, size_t n)
{
    if (n < 16)
        return {};
    const uint64_t db = little_endian_u64(h) / 1000000, healer = little_endian_u64(h + 8) / 1000000;
    if ((db == 40 && healer == 0) || (db == 42 && healer > 0 && healer <= 999))
        return {Format::binary, Container::part, db};
    if ((db >= 40 && db < 42 && healer == 0) || (db >= 42 && db <= 999 && healer > 0 && healer <= 999))
        return {Format::binary, Container::unrecognized_part_version, db};
    return {};
}

FileInfo file_info(const std::string& filename)
{
    FILE* f = std::fopen(filename.c_str(), "rb");
    if (!f)
        throw_error("Could not open native SMLib Brep file: " + filename);
    unsigned char h[32] = {};
    const size_t n = std::fread(h, 1, sizeof h, f);
    std::fclose(f);
    if ((n >= 8 && !std::memcmp(h, "Version ", 8)) || (n >= 13 && !std::memcmp(h, "//Brep Starts", 13)))
        return {Format::ascii, Container::single_brep};
    if (n >= 18 && !std::memcmp(h, "//[Output Summary]", 18))
        return {Format::ascii, Container::part};
    const FileInfo part = binary_part_info(h, n);
    if (part.container != Container::unknown)
        return part;
    if (n >= 2 && h[0] == 'V')
        return {Format::binary, Container::single_brep};
    return {};
}

bool read_as_ascii(const std::string& filename, const val& ascii)
{
    const FileInfo info = file_info(filename);
    if (info.container == Container::unrecognized_part_version)
        throw_error("File appears to have a native SMLib binary part header with unrecognized database version " +
                    std::to_string(info.version) + "; refusing to read it as a single Brep: " + filename);
    if (info.container == Container::part)
        throw_error("Native SMLib part container cannot be read as a single Brep: " + filename);
    if (absent(ascii))
    {
        if (info.format == Format::unknown)
            throw_error("Could not determine native SMLib Brep file format: " + filename);
        return info.format == Format::ascii;
    }
    const bool requested = ascii.as<bool>();
    if (info.format != Format::unknown && requested != (info.format == Format::ascii))
        throw_error(std::string("Native SMLib Brep file appears to be ") +
                    (info.format == Format::ascii ? "ASCII" : "binary") + "; refusing to read it with ascii=" +
                    (requested ? "true" : "false") + ": " + filename);
    return requested;
}

// A native .smb file of the module's file system (FS). ascii: null detects the format, true/false
// asserts it. Python defaults: ascii None, rebuild_uv_trim_curves false.
uintptr_t read_brep_from_file(std::string filename, val ascii, bool rebuild_uv_trim_curves)
{
    const bool as_ascii = read_as_ascii(filename, ascii);
    SmBrep* r = nullptr;
    SMJS_CHECK(SmApiReadBrepFromFile(filename.c_str(), flag(as_ascii), flag(rebuild_uv_trim_curves), r));
    return ptr(r);
}

EMSCRIPTEN_BINDINGS(smlib_kernel_io)
{
    function("read_brep_from_file", &read_brep_from_file);
}

// ---------------------------------------------------------------- brep_ops (SmPyBrepOps.cpp)
// Mutates brep; returns it. Python first refuses while it holds a curve or surface of the Brep
// that the conversion replaces; here nothing tracks those numbers: curves and surfaces read from
// the Brep before are invalid afterwards.
uintptr_t turn_to_nurbs(uintptr_t b)
{
    SMJS_CHECK(SmApiTurnToNurbs(brep(b)));
    return b;
}

EMSCRIPTEN_BINDINGS(smlib_kernel_brep_ops)
{
    function("turn_to_nurbs", &turn_to_nurbs);
}

// ---------------------------------------------------------------- stitching (SmPyStitching.cpp)
// Mutates brep; returns [brep, is_solid, stitched_edges, max_vertex_gap, max_edge_gap].
val stitch_into_solid(uintptr_t b)
{
    SmBoolean solid = FALSE;
    ULONG stitched = 0;
    double vertex_gap = 0, edge_gap = 0;
    SMJS_CHECK(SmApiStitchIntoSolid(brep(b), solid, stitched, vertex_gap, edge_gap));
    return tuple(b, solid != FALSE, static_cast<double>(stitched), vertex_gap, edge_gap);
}

// Mutates brep; returns [brep, shell_is_well_formed (the argument, echoed), stitched_edges,
// max_vertex_gap, max_edge_gap]. max_stitching_ratio is the largest gap closed, a distance.
// Python defaults: max_stitching_ratio 1.0, shell_is_well_formed false (keyword-only).
val stitch_into_shell(uintptr_t b, double max_stitching_ratio, bool shell_is_well_formed)
{
    SmBoolean well_formed = flag(shell_is_well_formed);
    ULONG stitched = 0;
    double vertex_gap = 0, edge_gap = 0;
    SMJS_CHECK(SmApiStitchIntoShell(brep(b), well_formed, max_stitching_ratio, stitched, vertex_gap, edge_gap));
    return tuple(b, shell_is_well_formed, static_cast<double>(stitched), vertex_gap, edge_gap);
}

// Mutates brep; returns [brep, stitched_edges, lamina_edges, max_vertex_gap, max_edge_gap].
// Python defaults: squeeze_small_edges true, split_edges_with_vertices true, making_manifold_solid
// true, remove_laminar_slivers false.
val stitch_advanced(uintptr_t b, double tolerance_3d, bool squeeze_small_edges, bool split_edges_with_vertices,
                    bool making_manifold_solid, bool remove_laminar_slivers)
{
    ULONG stitched = 0, lamina = 0;
    double vertex_gap = 0, edge_gap = 0;
    SMJS_CHECK(SmApiStitchAdvanced(brep(b), tolerance_3d, flag(squeeze_small_edges), flag(split_edges_with_vertices),
                                   flag(making_manifold_solid), flag(remove_laminar_slivers), stitched, lamina, vertex_gap,
                                   edge_gap));
    return tuple(b, static_cast<double>(stitched), static_cast<double>(lamina), vertex_gap, edge_gap);
}

EMSCRIPTEN_BINDINGS(smlib_kernel_stitching)
{
    function("stitch_into_solid", &stitch_into_solid);
    function("stitch_into_shell", &stitch_into_shell);
    function("stitch_advanced", &stitch_advanced);
}

}  // namespace
