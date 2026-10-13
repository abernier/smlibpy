// SPDX-License-Identifier: Apache-2.0
//
// Tessellation that chooses how the faces of a body are divided (`smlibpy._core.ext`):
//
//   tessellate(brep, ...)               sm.tessellate (SmApiTessellate) with the choice below
//   tessellation_algorithm(brep, ...)   "grid" or "halving" for the given tolerances
//   grid_deviation(face, ...)           how far the facets of the grid would be off a face
//
// The kernel's tessellator (SmTess) knows two ways to divide a B-spline face (any other surface
// is approximated by Bezier patches, which are always halved):
//
//   * SM_TA_FASTER_TESSELLATION, the grid. It is the SmTess default, SmBrep::ConvertToPolyBrep
//     (and so SmApiTessellate) never changes it and SmBrep::OutputGraphics hard-codes it. A face
//     is halved until the control polygon of each part turns by less than 30 degrees both ways
//     (SmSurfaceCache::m_dStartFastSubdivisionAngleDeg), then each part is cut into a grid in one
//     go (SmSurfaceCache::SubdivideByBlock). The grid lines are where the curves of constant
//     parameter along the four borders of the part need points for the chord height and the
//     angle tolerance (SmSurface::FindTessellationSplits). The blocks between the lines are never
//     tested against the chord height; only if all four borders of the part are straight are the
//     lines placed by its diagonals instead (bCheckDiagonals).
//   * SM_TA_FEWER_POLYGONS, the halving: the parts are halved until each one is flat within the
//     chord height and turns by less than the angle tolerance (TestAgainstTolerances).
//
// A face which is straight in one direction and twisted along it (the sides of a twisted bar, a
// ruled loft between different curves, the walls of a thickened free-form sheet) has straight
// borders in that direction, so its grid has no lines across it: a facet reaches from one side
// of the face to the other, and its two triangles are off the face by about width / 4 * the
// angle the straight lines turn by from one grid line to the next. No parameter prevents it: the
// max aspect ratio is not applied to a grid, and the max edge length divides every face of the
// body in both directions.
//
// So tessellate() estimates for each face how far the facets of the grid would be off
// (grid_deviation) and divides a body with a face beyond twice the chord height by halving. The
// choice is per body: SmTess::Phase1SetupBrep builds the subdivision of every face with the
// algorithm of the tessellator, and the edges are split to match it, so there is no mixing them
// without changing the kernel. A body without such a face is tessellated by SmApiTessellate as
// before, with the same facets. The halving costs more facets (a twisted face needs them in
// proportion to 1 / chord height, the other curved faces of such a body get more than the grid
// would give them) and time. Two things it needs here:
//
//   * no max edge length and no max aspect ratio: the halving with either divides faces down to
//     the smallest part it allows (a thousandth of the face each way: 0.26 to 1.6 million facets
//     and seconds for a box or a cylinder). A body is never halved when one is asked for.
//   * trim curves inside the surface's domain: SmTess::SplitFaceEdgesToUVSize splits an edge as
//     long as it is longer than the parts it borders, which CheckAgainstSurfaceCache finds by
//     their domains without a tolerance. The trim curves of a box lie 1e-14 outside the domain of
//     their faces, so such an edge finds no part and stays whole, and a fan of long triangles
//     reaches from its ends to the halved parts next to it (2.9 times the chord height off on a
//     twisted plate). The copy that is halved gets its trim curves moved onto the border.

#include "ext.h"

#include <SmApiBrep.h>
#include <SmApiTessellationParams.h>
#include <SmBSplineSurface.h>
#include <SmCopyBrepMap.h>
#include <SmGraphicsExtern.h>
#include <SmSurfaceCache.h>
#include <SmTess.h>
#include <SmTopologyTraverser.h>

#include <pybind11/numpy.h>

#include <algorithm>
#include <cmath>
#include <string>
#include <unordered_map>
#include <vector>

namespace
{

constexpr double kPi = 3.14159265358979323846;

// The grid is given up if its facets are estimated to be off a face by more than this multiple
// of the chord height. The estimate assumes the largest steps the tolerances allow; the steps of
// the tessellator are usually between half of that and that. So above a factor of 2 the facets
// of the grid are off by more than the chord height, below it by less than twice the chord
// height, which is what the grid gives other curved faces as well.
constexpr double kMaxDeviationFactor = 2.0;

// The tessellator takes a border of a part for straight if it stays within a tenth of the chord
// height of its chord (FindTessellationSplits). A surface whose curves of constant parameter stay
// within this fraction of the chord height is taken for one with straight borders only.
constexpr double kMaxStraightFactor = 0.01;

// A direction of a face is checked for being straight at curves of constant parameter at these
// fractions of the extent of the face, and each curve at the points at these fractions of its
// length. The first two points are the ends of the curve. The middle curve comes first: this is
// where most faces turn out not to be straight.
constexpr double kCurveFractions[] = {0.5, 0.0, 1.0, 0.25, 0.75};
constexpr double kPointFractions[] = {0.0, 1.0, 0.5, 0.25, 0.75};
constexpr int kFractions = 5;

// Positions along a straight face at which its twist is measured.
constexpr int kTwistSamples = 16;

// A length, a speed or a bend below this is zero.
constexpr double kZero = 1.0e-12;

// Trim curve control points at most this far outside the domain of their surface (relative to
// the size of the domain) are moved onto its border before halving.
constexpr double kTrimSnap = 1.0e-9;

// Only a B-spline surface is cut into a grid. Of these, a plane, a cone or cylinder and an
// extruded curve are straight but cannot be twisted, a sphere and a torus are not straight.
bool can_be_twisted(const SmSurface* surface)
{
    return surface->IsKindOf(SmBSplineSurface_TYPE) && !surface->IsKindOf(SmPlane_TYPE)
           && !surface->IsKindOf(SmCone_TYPE) && !surface->IsKindOf(SmSphere_TYPE)
           && !surface->IsKindOf(SmTorus_TYPE) && !surface->IsKindOf(SmSurfOfExtrusion_TYPE);
}

// The parameters at the given fractions of the domain; `fraction` runs along `direction`.
SmPoint2d parameters_at(const SmExtent2d& domain, SmSurfParamType direction, double fraction, double other)
{
    return direction == SM_SP_U ? domain.Evaluate(fraction, other) : domain.Evaluate(other, fraction);
}

// The grid divides a face along a direction only where a curve of constant parameter needs a
// point. A curve which does not leave its chord by more than the chord height and does not turn
// by more than the angle tolerance needs none. True if the curves along `direction` are straight
// in that sense.
bool is_straight(const SmSurface* surface, const SmExtent2d& domain, SmSurfParamType direction, double chord_height,
                 double angle_tol)
{
    for (double curve : kCurveFractions)
    {
        SmPoint3d points[kFractions];
        for (int i = 0; i < kFractions; ++i)
        {
            if (surface->EvaluatePoint(parameters_at(domain, direction, kPointFractions[i], curve), points[i]) != SM_SUCCESS)
                return false;
            if (i < 2)
                continue;
            const SmVector3d chord = points[1] - points[0];
            const SmVector3d offset = points[i] - points[0];
            const double length = chord.Length();
            // a curve which returns to its start is closed, unless all its points are the same (a pole)
            const double sag = length < kZero ? offset.Length() : (chord * offset).Length() / length;
            if (sag > chord_height)
                return false;
            // an arc of this height turns by 8 * height / length
            if (angle_tol > 0.0 && length >= kZero && 8.0 * sag > angle_tol * length)
                return false;
        }
    }
    return true;
}

// The grid of a part whose four borders are straight is placed by the two diagonals of the part,
// which bend with its twist (bCheckDiagonals in SubdivideByBlock, for plain B-spline surfaces).
// So the grid is right for a surface which is straight in both directions: a ruled surface
// between two straight lines which are not in a plane. The whole surface has to be straight, not
// only the part of the face: a part can be cut out of either of them.
bool is_divided_by_diagonals(const SmSurface* surface, double chord_height)
{
    if (surface->GetType() != SmBSplineSurface_TYPE)
        return false;
    const SmExtent2d domain = surface->GetNaturalUVDomain();
    const double tolerance = kMaxStraightFactor * chord_height;
    return is_straight(surface, domain, SM_SP_U, tolerance, 0.0) && is_straight(surface, domain, SM_SP_V, tolerance, 0.0);
}

// The largest step of the parameter of a curve (with these first and second derivatives) the
// tolerances allow: its chord stays within the chord height and is not longer than the max edge
// length, and its tangent does not turn by more than the angle tolerance. `limit` if nothing
// limits it.
double largest_step(const SmVector3d& first, const SmVector3d& second, double chord_height, double angle_tol,
                    double max_edge_length, double limit)
{
    const double speed = first.Length();
    if (speed < kZero)
        return limit;
    double step = limit;
    if (max_edge_length > 0.0)
        step = std::min(step, max_edge_length / speed);
    const SmVector3d tangent = first * (1.0 / speed);
    // a step h leaves its chord by bend * h^2 / 8 and turns by bend * h / speed
    const double bend = (second - tangent * second.Dot(tangent)).Length();
    if (bend >= kZero)
    {
        step = std::min(step, std::sqrt(8.0 * chord_height / bend));
        if (angle_tol > 0.0)
            step = std::min(step, angle_tol * speed / bend);
    }
    return step;
}

// A facet of the grid of a face which is straight along `direction` has two of the straight
// lines as sides. With the ends A and B of a line, which move by A' and B' per unit of the
// parameter along the face, the lines turn out of the plane of the facet by
// |det(A', B - A, B')| / |(B - A) x (A' + B')| per unit. The two triangles of a facet are off the
// face by a quarter of what its corners are out of a plane, that is by half of this times the
// step between two grid lines.
double twist_deviation(const SmSurface* surface, const SmExtent2d& domain, SmSurfParamType direction,
                       double chord_height, double angle_tol, double max_edge_length)
{
    const bool along_u = direction == SM_SP_U;
    const double extent = along_u ? domain.GetVInterval().GetLength() : domain.GetUInterval().GetLength();
    double deviation = 0.0;
    for (int sample = 0; sample < kTwistSamples; ++sample)
    {
        const double along = (sample + 0.5) / kTwistSamples;
        // point, first and second derivative across the lines, at both ends of a line
        SmVector3d ends[2][3];
        bool valid = true;
        for (int side = 0; side < 2 && valid; ++side)
        {
            const SmPoint2d uv = parameters_at(domain, direction, side, along);
            // in the order D, Dv, Dvv or D, Du, Duu
            valid = surface->Evaluate(uv, along_u ? 0 : 2, along_u ? 2 : 0, side == 0, side == 0, FALSE, ends[side],
                                      FALSE)
                    == SM_SUCCESS;
        }
        if (!valid)
            continue;
        const SmVector3d line = ends[1][0] - ends[0][0];
        const double out = (line * (ends[0][1] + ends[1][1])).Length();
        if (out < kZero)
            continue;
        const double twist = std::fabs(ends[0][1].Dot(line * ends[1][1])) / (2.0 * out);
        // the grid divides the face along its length as its two borders demand, and a line only
        // by the max edge length
        const double step = std::min(largest_step(ends[0][1], ends[0][2], chord_height, angle_tol, max_edge_length, extent),
                                     largest_step(ends[1][1], ends[1][2], chord_height, angle_tol, max_edge_length, extent));
        const double parts = max_edge_length > 0.0 ? std::ceil(line.Length() / max_edge_length) : 1.0;
        deviation = std::max(deviation, twist * step / std::max(parts, 1.0));
    }
    return deviation;
}

// How far the facets of the grid are estimated to be off a face because it is twisted along a
// direction in which it is straight. 0 for a face which is not straight in either direction (the
// grid divides it both ways), for a straight face which is not twisted (a plane, a cylinder, a
// cone) and for a face of a surface which is straight in both directions (divided by its
// diagonals). `angle_tol_deg` is the angle tolerance of the faces: the one of the edges adds
// points to the borders of a face but no lines to its grid, and those points do not help where
// the two borders of a face are divided differently.
double grid_deviation(const SmFace* face, double chord_height, double angle_tol_deg, double max_edge_length)
{
    const SmSurface* surface = face ? face->GetSurface() : nullptr;
    if (!surface || !(chord_height > 0.0) || !can_be_twisted(surface))
        return 0.0;
    const SmExtent2d domain = face->GetUVDomain();
    const double angle_tol = angle_tol_deg > 0.0 ? angle_tol_deg * kPi / 180.0 : 0.0;
    const SmSurfParamType directions[] = {SM_SP_U, SM_SP_V};
    bool straight[2];
    for (int i = 0; i < 2; ++i)
        straight[i] = is_straight(surface, domain, directions[i], chord_height, angle_tol);
    if ((!straight[0] && !straight[1]) || is_divided_by_diagonals(surface, chord_height))
        return 0.0;
    double deviation = 0.0;
    for (int i = 0; i < 2; ++i)
        if (straight[i])
            deviation = std::max(deviation, twist_deviation(surface, domain, directions[i], chord_height, angle_tol,
                                                             max_edge_length > 0.0 ? max_edge_length : 0.0));
    return deviation;
}

// The halving for a body with a face whose grid would be off by more than twice the chord
// height, the grid otherwise. Without a chord height a face is divided by its angles only, which
// a twisted face does not show, so the grid is kept; with a max edge length or a max aspect ratio
// as well (the halving cannot take them, see the top).
SmTessAlgorithmType choose_algorithm(const SmBrep* brep, double chord_height, double surface_angle_tol_deg,
                                     double max_edge_length, double max_aspect_ratio)
{
    if (!brep || !(chord_height > 0.0) || max_edge_length != 0.0 || max_aspect_ratio != 0.0)
        return SM_TA_FASTER_TESSELLATION;
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    for (ULONG i = 0; i < faces.GetSize(); ++i)
        if (grid_deviation(faces[i], chord_height, surface_angle_tol_deg, 0.0) > kMaxDeviationFactor * chord_height)
            return SM_TA_FEWER_POLYGONS;
    return SM_TA_FASTER_TESSELLATION;
}

// Moves the control points of trim curves which lie a hair outside the domain of the B-spline
// surface of their face onto its border (see the top), so that the tessellator splits the edges
// along the border of the domain to the size of the parts next to them.
void move_trims_into_domains(SmBrep* brep)
{
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    for (ULONG f = 0; f < faces.GetSize(); ++f)
    {
        const SmSurface* surface = faces[f]->GetSurface();
        SmFaceuse* faceuse = faces[f]->GetUpwardFaceuse();
        if (!surface || !faceuse || !surface->IsKindOf(SmBSplineSurface_TYPE))
            continue;
        const SmExtent2d domain = surface->GetNaturalUVDomain();
        const SmPoint2d lo = domain.GetMin(), hi = domain.GetMax();
        const double snap = kTrimSnap * std::max(1.0, domain.GetSize().Length());
        SmTArray<SmEdgeuse*> edgeuses;
        faceuse->GetEdgeuses(edgeuses);
        for (ULONG i = 0; i < edgeuses.GetSize(); ++i)
        {
            SmBSplineCurve* trim = edgeuses[i]->GetUVTrimCurve();
            SmTArray<SmPoint3d> poles;
            SmTArray<double> weights;
            if (!trim || trim->GetControlPolygon(poles, weights) != SM_SUCCESS)
                continue;
            const bool rational = weights.GetSize() == poles.GetSize();
            for (ULONG k = 0; k < poles.GetSize(); ++k)
            {
                SmPoint3d pole = poles[k];
                const double u = std::min(std::max(pole.x, lo.x), hi.x);
                const double v = std::min(std::max(pole.y, lo.y), hi.y);
                if ((u == pole.x && v == pole.y) || std::fabs(u - pole.x) > snap || std::fabs(v - pole.y) > snap)
                    continue;
                pole.x = u;
                pole.y = v;
                trim->SetControlPoint(rational ? SM_CP_EUCLIDIAN_RATIONAL : SM_CP_NON_RATIONAL, k, pole,
                                      rational ? weights[k] : 1.0);
            }
        }
    }
}

// SmBrep::ConvertToPolyBrep (as SmApiTessellate calls it) with the halving: the same copy of the
// body, failure records, report, output, faces and back pointers; the kernel function always
// uses the grid.
SmStatus convert_by_halving(SmBrep* brep, SmPolyBrep*& result, double chord_height, double curve_angle_tol_deg,
                            double surface_angle_tol_deg, SmTArray<SmTessellationFailure>* failures,
                            SmTessellationReport* report)
{
    result = nullptr;
    if (report)
    {
        *report = SmTessellationReport();
        SmTArray<SmEdge*> edges;
        brep->GetEdges(edges);
        report->inputManifold = !edges.IsEmpty();
        for (SmEdge* edge : edges)
            if (!edge->IsManifold())
                report->inputManifold = FALSE;
    }
    if (report && !failures)
        failures = &report->failures;
    if (failures)
        failures->SetSize(0);

    const SmContext& context = *brep->GetContext();
    SmTemporaryChangeValue<SmBoolean> doing_boolean(SM_CONST_CAST(SmContext*, &context)->GetDoingBooleanRef(), TRUE);

    SmCurveTessDriver curve_driver(0, chord_height, curve_angle_tol_deg, 0.0, 0.0001, FALSE);
    SmSurfaceTessDriver surface_driver(chord_height, surface_angle_tol_deg, 0.0, 0.0, 0.001, 0.0);
    SmTess tess(context, curve_driver, surface_driver);
    tess.SetAdvancingFront(FALSE);
    tess.SetTessellationAlgorithm(SM_TA_FEWER_POLYGONS);

    // The tessellator splits the edges of the body it works on: it gets a copy, which it owns
    // from Phase1SetupBrep on and deletes with itself.
    SmCopyBrepMap copy_map;
    SmBrep* copy = new (context) SmBrep(*brep, &copy_map);
    move_trims_into_domains(copy);

    SmTArray<SmFace*> original_faces, copy_faces;
    brep->GetFaces(original_faces);
    copy->GetFaces(copy_faces);
    // failures name the faces by their index in the original body
    std::unordered_map<SmFace*, ULONG> source_index;
    if (failures)
    {
        std::unordered_map<SmFace*, ULONG> original_index;
        for (ULONG i = 0; i < original_faces.GetSize(); ++i)
            original_index.emplace(original_faces[i], i);
        if (original_faces.GetSize() != copy_faces.GetSize())
        {
            delete copy;
            return SM_ERR;
        }
        for (SmFace* face : copy_faces)
        {
            const auto found = original_index.find((SmFace*)copy_map.GetAt(face));
            if (found == original_index.end())
            {
                delete copy;
                return SM_ERR;
            }
            source_index.emplace(face, found->second);
            original_index.erase(found);
        }
    }
    auto record = [&](SmFace* face, SmTessellationStage stage, SmStatus status) -> SmStatus {
        if (!failures)
            return SM_SUCCESS;
        const auto found = source_index.find(face);
        if (found == source_index.end())
            return SM_ERR;
        for (const auto& failure : *failures)
            if (failure.lFaceIndex == found->second)
                return SM_SUCCESS;
        failures->Add({found->second, stage, status});
        if (report && failures != &report->failures)
            report->failures.Add({found->second, stage, status});
        return SM_SUCCESS;
    };

    // Phase 1: the edges of all faces, and the subdivision of every face
    SmBoolean some_failed = FALSE;
    SmTArray<SmStatus> boundary_status;
    SmTArray<SmFace*> failed_boundaries;
    const SmStatus setup = tess.Phase1SetupBrep(copy, some_failed, nullptr, &boundary_status);
    for (ULONG i = 0; i < boundary_status.GetSize(); ++i)
        if (boundary_status[i] != SM_SUCCESS)
        {
            failed_boundaries.Add(copy_faces[i]);
            SER(record(copy_faces[i], SM_TS_BOUNDARY_PREPARATION, boundary_status[i]));
        }
    SER(setup);

    copy->GetFaces(copy_faces);
    SmPolygonOutputCallback output;
    output.SetOutputType(SM_PO_CREATE_POLYBREP);

    if (copy_faces.GetSize() > 0)
    {
        // the facets of the faces which are connected to each other end up in one shell
        SmNewMarkAndLock mark_lock((SmContext*)copy_faces[0]->GetContext());
        const SmMarkType mark = mark_lock.GetMarkType();
        SmTopologyTraverser traverser;
        SmTArray<SmFace*> connected;
        for (ULONG i = 0; i < copy_faces.GetSize(); ++i)
        {
            SmFace* face = copy_faces[i];
#ifdef SM_INDEXING
            face->SetUserIndex1(i);
#endif
            if (face->IsMarked(mark))
                continue;
            traverser.CollectFaces(face, connected, mark);
            SmPolyShell* shell = nullptr;
            for (ULONG j = 0; j < connected.GetSize(); ++j)
            {
                if (failed_boundaries.IsIn(connected[j]))
                    continue;
                // Phase 2: the facets of the face
                SmStatus status = tess.Phase2CreateFacePolygons(connected[j]);
                if (status != SM_SUCCESS)
                {
                    SER(record(connected[j], SM_TS_FACE_TESSELLATION, status));
                    continue;
                }
                if ((status = tess.OutputFacePolygons(connected[j], output, &shell)) != SM_SUCCESS)
                {
                    SER(record(connected[j], SM_TS_POLYGON_OUTPUT, status));
                    // the output may be modified already; the tessellator discards it
                    return status;
                }
                // Phase 3: the temporary data of the face
                tess.Phase3DeleteFacePolygons(connected[j]);
            }
        }
    }
    SER(output.CompletedPolygonOutput());

    SmPolyBrep* poly = tess.Get3DPolyBrep();
    if (!poly)
        return SM_SUCCESS;  // no faces to output
    // otherwise the tessellator deletes the facets with itself
    tess.Set3DPolyBrep(nullptr);

#ifdef SM_INDEXING
    // The facets refer to the faces of the copy. They have to refer to the faces of the body
    // (and get their attributes, as SmApiTessellate asks); smlibpy reads their surfaces.
    SmTArray<SmPolyFace*> poly_faces;
    poly->GetPolyFaces(poly_faces);
    SmFace *last_copy = nullptr, *original = nullptr;
    for (ULONG i = 0; i < poly_faces.GetSize(); ++i)
    {
        SmFace* copy_face = poly_faces[i]->GetOriginalFace();
        if (copy_face != last_copy)
        {
            original = (SmFace*)copy_map.GetAt(copy_face);
            last_copy = copy_face;
        }
        poly_faces[i]->SetOriginalFace(original, TRUE);
    }
    // A vertex lists the faces it has a normal for: facets up to here, faces of the body after.
    SmTArray<SmPolyVertex*> poly_vertices;
    poly->GetPolyVertices(poly_vertices);
    for (ULONG i = 0; i < poly_vertices.GetSize(); ++i)
    {
        SmTArray<SmTopology*>& vertex_faces = poly_vertices[i]->GetFacesRef();
        for (ULONG j = 0; j < vertex_faces.GetSize(); ++j)
        {
            SmPolyFace* poly_face = SM_CAST_PTR(SmPolyFace, vertex_faces[j]);
            if (poly_face)
                vertex_faces[j] = poly_face->GetOriginalFace();
        }
    }
#endif
    // the copy the tessellator worked on is deleted with it
    poly->SetOKBackPtrs(FALSE);
    result = poly;

    if (report)
    {
        ULONG lamina = 0, spine = 0;
        SmTArray<SmPolyEdge*> edges;
        poly->GetPolyEdges(edges);
        for (SmPolyEdge* edge : edges)
        {
            if (edge->IsLamina())
                ++lamina;
            else if (edge->IsSpine())
                ++spine;
        }
        report->hasMesh = TRUE;
        report->laminaEdges = lamina;
        report->spineEdges = spine;
        report->outputManifold = !edges.IsEmpty() && lamina == 0 && spine == 0;
    }
    return SM_SUCCESS;
}

// SmApiTessellate with the halving: the same rules for partial output and failures.
SmStatus tessellate_by_halving(SmBrep* brep, SmPolyBrep*& result, const SmTessellationParams& params,
                               bool allow_partial, SmTessellationReport& report)
{
    SmTArray<SmTessellationFailure> failures;
    const SmStatus status = convert_by_halving(brep, result, params.dChordHeightTol, params.dCurveAngleTolDeg,
                                               params.dSurfaceAngleTolDeg, &failures, &report);
    if (status != SM_SUCCESS || (!failures.IsEmpty() && !allow_partial) || result == nullptr)
    {
        if (result)
        {
            result->SetOKBackPtrs(FALSE);
            delete result;
            result = nullptr;
        }
        if (status != SM_SUCCESS)
            return status;
        SER_MSG(SM_ERR, _T("Tessellation failed to produce a complete mesh"));
    }
    return SM_SUCCESS;
}

const char* algorithm_name(SmTessAlgorithmType algorithm)
{
    return algorithm == SM_TA_FEWER_POLYGONS ? "halving" : "grid";
}

py::dict report_to_dict(const SmTessellationReport& report, SmTessAlgorithmType algorithm)
{
    py::dict result;
    result["failures"] = tessellation_failures_to_list(report.failures);
    result["lamina_edge_count"] = report.laminaEdges;
    result["spine_edge_count"] = report.spineEdges;
    result["input_manifold"] = bool(report.inputManifold);
    result["output_manifold"] = bool(report.outputManifold);
    result["has_mesh"] = bool(report.hasMesh);
    result["algorithm"] = algorithm_name(algorithm);
    return result;
}

py::object tessellate(SmBrep* brep, double chord_height_tol, double curve_angle_tol_deg, double surface_angle_tol_deg,
                      double max_edge_length, double max_aspect_ratio, const std::string& algorithm, bool allow_partial,
                      bool return_failures, bool return_report)
{
    if (!brep)
        throw py::value_error("tessellate: no body");
    if (allow_partial && !return_failures && !return_report)
        throw py::value_error("allow_partial=True requires return_failures=True or return_report=True");
    if (algorithm != "auto" && algorithm != "grid" && algorithm != "halving")
        throw py::value_error("algorithm must be 'auto', 'grid' or 'halving', not '" + algorithm + "'");
    if (algorithm == "halving" && (max_edge_length != 0.0 || max_aspect_ratio != 0.0))
        throw py::value_error("the halving takes no max_edge_length or max_aspect_ratio: with them the kernel divides "
                              "the faces down to a thousandth of their size");

    SmTessellationParams params;
    params.dChordHeightTol = chord_height_tol;
    params.dCurveAngleTolDeg = curve_angle_tol_deg;
    params.dSurfaceAngleTolDeg = surface_angle_tol_deg;
    params.dMaxEdgeLength = max_edge_length;
    params.dMaxAspectRatio = max_aspect_ratio;
    const SmTessAlgorithmType chosen =
        algorithm == "grid"      ? SM_TA_FASTER_TESSELLATION
        : algorithm == "halving" ? SM_TA_FEWER_POLYGONS
                                 : choose_algorithm(brep, chord_height_tol, surface_angle_tol_deg, max_edge_length,
                                                    max_aspect_ratio);

    SmPolyBrep* mesh = nullptr;
    SmTessellationReport report;
    SmPyErrorTrail::clear();
    const SmStatus status = chosen == SM_TA_FASTER_TESSELLATION
                                ? SmApiTessellate(brep, mesh, params, allow_partial, nullptr, &report)
                                : tessellate_by_halving(brep, mesh, params, allow_partial, report);
    if (status != SM_SUCCESS)
    {
        try
        {
            SmPyRaise(status, "tessellate", __FILE__, __LINE__);
        }
        catch (const std::runtime_error& error)
        {
            py::object type = py::module_::import("_omni_solid").attr("TessellationError");
            py::object exception = type(error.what());
            exception.attr("report") = report_to_dict(report, chosen);
            exception.attr("failures") = exception.attr("report")["failures"];
            exception.attr("status") = status;
            exception.attr("status_name") = sm_status_name(status);
            PyErr_SetObject(type.ptr(), exception.ptr());
            throw py::error_already_set();
        }
    }
    py::object result = py::cast(mesh, py::return_value_policy::reference);
    if (return_report)
        return py::make_tuple(result, report_to_dict(report, chosen));
    if (return_failures)
        return py::make_tuple(result, tessellation_failures_to_list(report.failures));
    return result;
}

// For each polygon of PolyBrep.to_numpy_arrays (the polygons with an outer loop of edges,
// in the PolyBrep's order), the index of the face of `brep` it was made from, or -1.
py::array_t<int32_t> poly_face_indices(SmPolyBrep* poly, SmBrep* brep)
{
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    std::unordered_map<const SmFace*, int32_t> index;
    for (ULONG i = 0; i < faces.GetSize(); ++i)
        index[faces[i]] = static_cast<int32_t>(i);
    SmTArray<SmPolyFace*> poly_faces;
    poly->GetPolyFaces(poly_faces);
    std::vector<int32_t> out;
    out.reserve(poly_faces.GetSize());
    for (ULONG i = 0; i < poly_faces.GetSize(); ++i)
    {
        SmPolyLoop* loop = poly_faces[i]->GetOuterPolyLoop();
        if (!loop)
            continue;
        SmTArray<SmPolyEdge*> edges;
        loop->GetPolyEdges(edges);
        if (edges.GetSize() == 0)
            continue;
        auto it = index.find(poly_faces[i]->GetOriginalFace());
        out.push_back(it == index.end() ? -1 : it->second);
    }
    return py::array_t<int32_t>(static_cast<py::ssize_t>(out.size()), out.data());
}

}  // namespace

void bind_tessellate(py::module_ m)
{
    m.def("tessellate", &tessellate, py::return_value_policy::reference, py::arg("brep"), py::kw_only(),
          py::arg("chord_height_tolerance") = SmTessellationDefaults::kChordHeightTol,
          py::arg("curve_angle_tolerance_deg") = SmTessellationDefaults::kCurveAngleTolDeg,
          py::arg("surface_angle_tolerance_deg") = SmTessellationDefaults::kSurfaceAngleTolDeg,
          py::arg("max_edge_length") = SmTessellationDefaults::kMaxEdgeLength,
          py::arg("max_aspect_ratio") = SmTessellationDefaults::kMaxAspectRatio, py::arg("algorithm") = "auto",
          py::arg("allow_partial") = false, py::arg("return_failures") = false, py::arg("return_report") = false,
          "Tessellate a Brep into a PolyBrep like the top-level tessellate (same arguments, results and "
          "TessellationError), choosing how its faces are divided. algorithm: 'grid' is the kernel's own way, which "
          "cuts each face into a grid placed by its borders and leaves a face that is straight in one direction and "
          "twisted along it far coarser than the chord height; 'halving' halves the faces until each part is flat "
          "within the chord height (more facets, slower; no max_edge_length or max_aspect_ratio); 'auto' (default) "
          "halves a body with a face whose grid would be off by more than twice the chord height (see "
          "grid_deviation) unless a max edge length or aspect ratio is given, and takes the grid otherwise. The "
          "report (return_report=True) names the algorithm used.");
    m.def("poly_face_indices", &poly_face_indices, py::arg("poly"), py::arg("brep"),
          "For each polygon of poly.to_numpy_arrays(), the index of the face of brep (in brep.get_faces() order) "
          "it was made from, -1 where it has none.");
    m.def(
        "tessellation_algorithm",
        [](SmBrep* brep, double chord_height_tol, double surface_angle_tol_deg, double max_edge_length,
           double max_aspect_ratio) {
            return std::string(algorithm_name(choose_algorithm(brep, chord_height_tol, surface_angle_tol_deg,
                                                               max_edge_length, max_aspect_ratio)));
        },
        py::arg("brep"), py::kw_only(), py::arg("chord_height_tolerance"),
        py::arg("surface_angle_tolerance_deg") = SmTessellationDefaults::kSurfaceAngleTolDeg,
        py::arg("max_edge_length") = SmTessellationDefaults::kMaxEdgeLength,
        py::arg("max_aspect_ratio") = SmTessellationDefaults::kMaxAspectRatio,
        "'halving' if tessellate(algorithm='auto') halves the faces of the Brep for these tolerances, 'grid' "
        "otherwise.");
    m.def("grid_deviation", &grid_deviation, py::arg("face"), py::kw_only(), py::arg("chord_height_tolerance"),
          py::arg("surface_angle_tolerance_deg") = SmTessellationDefaults::kSurfaceAngleTolDeg,
          py::arg("max_edge_length") = SmTessellationDefaults::kMaxEdgeLength,
          "Estimated distance between the facets of the kernel's grid and a face which is straight in one "
          "direction and twisted along it, for these tolerances (the largest steps they allow; the grid's own "
          "steps are usually between half of that and that). 0 for a face the grid divides both ways, a face that "
          "is not twisted, and a face of a surface that is straight both ways (the grid follows its diagonals).");
}
