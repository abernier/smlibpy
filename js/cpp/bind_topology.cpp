// SPDX-License-Identifier: Apache-2.0
//
// What smlibpy asks of Breps, faces, edges, vertices, curves and surfaces, for JavaScript:
// SmPyLib's methods of those classes (SmPyTypes.cpp) as functions named after them,
// `brep_faces(b)` for Python's `b.faces()`, `curve_evaluate(c, t)` for `c.evaluate(t)`. Faces,
// edges, vertices, and the curves and surfaces they return, belong to their Brep: they are never
// freed on their own.

#include "common.h"

#include <SmApiBrep.h>
#include <SmApiQueries.h>
#include <SmApiSurfaces.h>
#include <SmApiImportExport.h>

using namespace emscripten;

namespace {

val box(const SmPoint3d& mn, const SmPoint3d& mx)
{
    val out = val::array();
    out.call<void>("push", smjs::vec3(mn));
    out.call<void>("push", smjs::vec3(mx));
    return out;
}

// ---------------------------------------------------------------- Brep
val brep_bounding_box(uintptr_t b, bool tight)
{
    SmPoint3d mn, mx;
    SMJS_CHECK(SmApiBrepBoundingBox(smjs::brep(b), tight ? TRUE : FALSE, mn, mx));
    return box(mn, mx);
}

// A deep copy, the caller's.
uintptr_t brep_copy(uintptr_t b)
{
    SmBrep* result = nullptr;
    SMJS_CHECK(SmApiBrepCopy(smjs::brep(b), result));
    return smjs::ptr(result);
}

val brep_faces(uintptr_t b)
{
    SmTArray<SmFace*> f;
    smjs::brep(b)->GetFaces(f);
    return smjs::pointer_array(f);
}

val brep_edges(uintptr_t b)
{
    SmTArray<SmEdge*> e;
    smjs::brep(b)->GetEdges(e);
    return smjs::pointer_array(e);
}

val brep_vertices(uintptr_t b)
{
    SmTArray<SmVertex*> v;
    smjs::brep(b)->GetVertices(v);
    return smjs::pointer_array(v);
}

unsigned brep_face_count(uintptr_t b)
{
    SmTArray<SmFace*> f;
    smjs::brep(b)->GetFaces(f);
    return f.GetSize();
}

unsigned brep_edge_count(uintptr_t b)
{
    SmTArray<SmEdge*> e;
    smjs::brep(b)->GetEdges(e);
    return e.GetSize();
}

unsigned brep_vertex_count(uintptr_t b)
{
    SmTArray<SmVertex*> v;
    smjs::brep(b)->GetVertices(v);
    return v.GetSize();
}

// Every edge shared by exactly two faces, enclosing material
bool brep_is_manifold_solid(uintptr_t b)
{
    SmBoolean result = FALSE;
    SMJS_CHECK(SmApiBrepIsManifoldSolid(smjs::brep(b), result));
    return result != FALSE;
}

// {solid_count, void_count}: material regions and enclosed cavities
val brep_material_census(uintptr_t b)
{
    long solids = 0, voids = 0;
    SMJS_CHECK(SmApiBrepMaterialCensus(smjs::brep(b), solids, voids));
    val out = val::object();
    out.set("solid_count", static_cast<double>(solids));
    out.set("void_count", static_cast<double>(voids));
    return out;
}

// Into the module's file system (FS): read the file back from there.
void brep_write_to_file(uintptr_t b, std::string filename, bool ascii)
{
    SMJS_CHECK(SmApiWriteBrepToFile(smjs::brep(b), filename.c_str(), ascii ? TRUE : FALSE));
}

// ---------------------------------------------------------------- face
val face_bounding_box(uintptr_t f, bool tight)
{
    SmPoint3d mn, mx;
    SMJS_CHECK(SmApiFaceBoundingBox(smjs::face(f), tight ? TRUE : FALSE, mn, mx));
    return box(mn, mx);
}

uintptr_t face_surface(uintptr_t f) { return smjs::ptr(smjs::face(f)->GetSurface()); }

// [[u_min, v_min], [u_max, v_max]]
val face_uv_domain(uintptr_t f)
{
    const SmExtent2d d = smjs::face(f)->GetUVDomain();
    val mn = val::array(), mx = val::array();
    mn.call<void>("push", d.GetMin().x), mn.call<void>("push", d.GetMin().y);
    mx.call<void>("push", d.GetMax().x), mx.call<void>("push", d.GetMax().y);
    val out = val::array();
    out.call<void>("push", mn);
    out.call<void>("push", mx);
    return out;
}

val face_edges(uintptr_t f)
{
    SmTArray<SmEdge*> e;
    smjs::face(f)->GetEdges(e);
    return smjs::pointer_array(e);
}

val face_vertices(uintptr_t f)
{
    SmTArray<SmVertex*> v;
    smjs::face(f)->GetVertices(v);
    return smjs::pointer_array(v);
}

val face_interior_point(uintptr_t f)
{
    SmPoint3d pt;
    SMJS_CHECK(SmApiFaceInternalPoint(smjs::face(f), pt));
    return smjs::vec3(pt);
}

// [closest point, distance]
val face_closest_point(uintptr_t f, val point)
{
    SmPoint3d closest;
    double dist = 0;
    SMJS_CHECK(SmApiFaceClosestPoint(smjs::face(f), smjs::vec(point), closest, dist));
    val out = val::array();
    out.call<void>("push", smjs::vec3(closest));
    out.call<void>("push", dist);
    return out;
}

// "inside", "outside", "boundary" or "vertex"
std::string face_classify_uv(uintptr_t f, double u, double v)
{
    SmPoint2d uv(u, v);
    int cls = 0;
    SMJS_CHECK(SmApiFaceClassifyUV(smjs::face(f), uv, cls));
    switch (cls)
    {
    case SM_PC_FACE: return "inside";
    case SM_PC_UNKNOWN: return "outside";
    case SM_PC_EDGE: return "boundary";
    case SM_PC_VERTEX: return "vertex";
    default: smjs::throw_error("SmApiFaceClassifyUV returned an unknown class " + std::to_string(cls));
    }
}

val face_point_at_uv(uintptr_t f, double u, double v)
{
    SmVector2d uv(u, v);
    SmVector3d pt;
    SMJS_CHECK(SmApiEvaluateSurfacePoint(smjs::face(f)->GetSurface(), uv, pt));
    return smjs::vec3(pt);
}

// The surface's own normal, before the face's orientation.
val face_normal_at_uv(uintptr_t f, double u, double v)
{
    SmVector2d uv(u, v);
    SmVector3d n;
    SMJS_CHECK(SmApiEvaluateSurfaceNormal(smjs::face(f)->GetSurface(), uv, n));
    return smjs::vec3(n);
}

// The surface's normal, turned when the face's upward faceuse is not in the infinite region.
val face_outward_normal_at_uv(uintptr_t f, double u, double v)
{
    SmFace* self = smjs::face(f);
    SmVector2d uv(u, v);
    SmVector3d n;
    SMJS_CHECK(SmApiEvaluateSurfaceNormal(self->GetSurface(), uv, n));
    SmBrep* brep = self->GetBrep();
    SmFaceuse* upward = self->GetUpwardFaceuse();
    if (brep && upward && upward->GetShell() && brep->GetInfiniteRegion() != upward->GetShell()->GetRegion())
        n *= -1.0;
    return smjs::vec3(n);
}

// [[[edge, forward], ...], ...], the outer loop first
val face_boundary_loops(uintptr_t f)
{
    SmTArray<ULONG> counts;
    SmTArray<SmEdge*> edges;
    SmTArray<SmOrientType> orientations;
    SMJS_CHECK(SmApiFaceGetBoundaryLoops(smjs::face(f), counts, edges, orientations));
    if (orientations.GetSize() != edges.GetSize())
        smjs::throw_error("SmApiFaceGetBoundaryLoops returned inconsistent parallel arrays");
    val loops = val::array();
    ULONG k = 0;
    for (ULONG i = 0; i < counts.GetSize(); ++i)
    {
        if (k > edges.GetSize() || counts[i] > edges.GetSize() - k)
            smjs::throw_error("SmApiFaceGetBoundaryLoops returned inconsistent loop sizes");
        val loop = val::array();
        for (ULONG j = 0; j < counts[i]; ++j, ++k)
        {
            if (orientations[k] != SM_OT_SAME && orientations[k] != SM_OT_OPPOSITE)
                smjs::throw_error("SmApiFaceGetBoundaryLoops returned an unsupported edge orientation");
            val use = val::array();
            use.call<void>("push", smjs::ptr(edges[k]));
            use.call<void>("push", orientations[k] == SM_OT_SAME);
            loop.call<void>("push", use);
        }
        loops.call<void>("push", loop);
    }
    if (k != edges.GetSize())
        smjs::throw_error("SmApiFaceGetBoundaryLoops returned inconsistent parallel arrays");
    return loops;
}

// ---------------------------------------------------------------- edge
val edge_bounding_box(uintptr_t e, bool tight)
{
    SmPoint3d mn, mx;
    SMJS_CHECK(SmApiEdgeBoundingBox(smjs::edge(e), tight ? TRUE : FALSE, mn, mx));
    return box(mn, mx);
}

// The edge's own curve (the Brep's; ext__edge_curve gives a copy over the edge's interval).
uintptr_t edge_curve(uintptr_t e) { return smjs::ptr(smjs::edge(e)->GetCurve()); }

val edge_faces(uintptr_t e)
{
    SmTArray<SmFace*> f;
    smjs::edge(e)->GetFaces(f);
    return smjs::pointer_array(f);
}

// [start vertex, end vertex]
val edge_vertices(uintptr_t e)
{
    SmVertex *vs = nullptr, *ve = nullptr;
    smjs::edge(e)->GetVertices(vs, ve);
    val out = val::array();
    out.call<void>("push", vs ? val(smjs::ptr(vs)) : val::null());
    out.call<void>("push", ve ? val(smjs::ptr(ve)) : val::null());
    return out;
}

// [t_min, t_max] of the edge on its curve
val edge_parameter_range(uintptr_t e)
{
    double lo = 0, hi = 0;
    SMJS_CHECK(SmApiEdgeParameterRange(smjs::edge(e), lo, hi));
    val out = val::array();
    out.call<void>("push", lo);
    out.call<void>("push", hi);
    return out;
}

// [closest point, parameter, distance]
val edge_closest_point(uintptr_t e, val point)
{
    SmPoint3d closest;
    double param = 0, dist = 0;
    SMJS_CHECK(SmApiEdgeClosestPoint(smjs::edge(e), smjs::vec(point), closest, param, dist));
    val out = val::array();
    out.call<void>("push", smjs::vec3(closest));
    out.call<void>("push", param);
    out.call<void>("push", dist);
    return out;
}

// ---------------------------------------------------------------- vertex
val vertex_point(uintptr_t v) { return smjs::vec3(smjs::vertex(v)->GetPoint()); }

val vertex_edges(uintptr_t v)
{
    SmTArray<SmEdge*> e;
    smjs::vertex(v)->GetEdges(e);
    return smjs::pointer_array(e);
}

val vertex_faces(uintptr_t v)
{
    SmTArray<SmFace*> f;
    smjs::vertex(v)->GetFaces(f);
    return smjs::pointer_array(f);
}

// ---------------------------------------------------------------- curve
// [t_min, t_max], the natural parameter range
val curve_parameter_range(uintptr_t c)
{
    const SmExtent1d ivl = smjs::curve(c)->GetNaturalInterval();
    val out = val::array();
    out.call<void>("push", ivl.GetMin());
    out.call<void>("push", ivl.GetMax());
    return out;
}

val curve_evaluate(uintptr_t c, double t)
{
    SmPoint3d pt;
    SMJS_CHECK(smjs::curve(c)->EvaluatePoint(t, pt));
    return smjs::vec3(pt);
}

val curve_start_point(uintptr_t c)
{
    SmCurve* self = smjs::curve(c);
    SmPoint3d pt;
    SMJS_CHECK(self->EvaluatePoint(self->GetNaturalInterval().GetMin(), pt));
    return smjs::vec3(pt);
}

val curve_end_point(uintptr_t c)
{
    SmCurve* self = smjs::curve(c);
    SmPoint3d pt;
    SMJS_CHECK(self->EvaluatePoint(self->GetNaturalInterval().GetMax(), pt));
    return smjs::vec3(pt);
}

// Over the natural parameter range (Python's default desired_accuracy: 1e-6)
double curve_length(uintptr_t c, double desired_accuracy)
{
    SmCurve* self = smjs::curve(c);
    double length = 0.0;
    SMJS_CHECK(self->Length(self->GetNaturalInterval(), desired_accuracy, length));
    return length;
}

// (Python's default tolerance: 0, the kernel's)
bool curve_is_closed(uintptr_t c, double tolerance)
{
    SmCurve* self = smjs::curve(c);
    return self->IsClosed(self->GetNaturalInterval(), tolerance);
}

// (Python's default tolerance: SM_EFF_ZERO)
bool curve_is_planar(uintptr_t c, double tolerance) { return smjs::curve(c)->IsPlanar(tolerance); }

SmCircle* circle(uintptr_t c)
{
    SmCurve* self = smjs::curve(c);
    if (!self->IsKindOf(SmCircle_TYPE))
        smjs::throw_error("not a circle");
    return static_cast<SmCircle*>(self);
}

SmAxis2Placement circle_frame(uintptr_t c)
{
    SmAxis2Placement frame;
    double r = 0.0;
    SMJS_CHECK(circle(c)->GetCanonical(frame, r));
    return frame;
}

val circle_center(uintptr_t c) { return smjs::vec3(circle_frame(c).GetOrigin()); }
double circle_radius(uintptr_t c) { return circle(c)->GetRadius(); }
val circle_normal(uintptr_t c) { return smjs::vec3(circle_frame(c).GetZAxis()); }
val circle_x_axis(uintptr_t c) { return smjs::vec3(circle_frame(c).GetXAxis()); }
val circle_y_axis(uintptr_t c) { return smjs::vec3(circle_frame(c).GetYAxis()); }

// ---------------------------------------------------------------- surface
val surface_u_domain(uintptr_t s)
{
    const SmExtent2d uv = smjs::surface(s)->GetNaturalUVDomain();
    val out = val::array();
    out.call<void>("push", uv.GetMin().x);
    out.call<void>("push", uv.GetMax().x);
    return out;
}

val surface_v_domain(uintptr_t s)
{
    const SmExtent2d uv = smjs::surface(s)->GetNaturalUVDomain();
    val out = val::array();
    out.call<void>("push", uv.GetMin().y);
    out.call<void>("push", uv.GetMax().y);
    return out;
}

// [[u_min, v_min], [u_max, v_max]]
val surface_uv_domain(uintptr_t s)
{
    const SmExtent2d uv = smjs::surface(s)->GetNaturalUVDomain();
    val mn = val::array(), mx = val::array();
    mn.call<void>("push", uv.GetMin().x), mn.call<void>("push", uv.GetMin().y);
    mx.call<void>("push", uv.GetMax().x), mx.call<void>("push", uv.GetMax().y);
    val out = val::array();
    out.call<void>("push", mn);
    out.call<void>("push", mx);
    return out;
}

val surface_evaluate(uintptr_t s, double u, double v)
{
    SmVector2d uv(u, v);
    SmPoint3d pt;
    SMJS_CHECK(SmApiEvaluateSurfacePoint(smjs::surface(s), uv, pt));
    return smjs::vec3(pt);
}

val surface_normal(uintptr_t s, double u, double v)
{
    SmVector2d uv(u, v);
    SmVector3d n;
    SMJS_CHECK(SmApiEvaluateSurfaceNormal(smjs::surface(s), uv, n));
    return smjs::vec3(n);
}

// [point, d/du, d/dv]
val surface_derivatives(uintptr_t s, double u, double v)
{
    SmVector2d uv(u, v);
    SmVector3d pt, du, dv;
    SMJS_CHECK(SmApiEvaluateSurfaceDerivatives(smjs::surface(s), uv, pt, du, dv));
    val out = val::array();
    out.call<void>("push", smjs::vec3(pt));
    out.call<void>("push", smjs::vec3(du));
    out.call<void>("push", smjs::vec3(dv));
    return out;
}

// (Python's default tolerance: SM_EFF_ZERO)
bool surface_is_planar(uintptr_t s, double tolerance) { return smjs::surface(s)->IsPlanar(tolerance); }

bool surface_is_periodic_u(uintptr_t s)
{
    SmSurface* self = smjs::surface(s);
    return self->IsPeriodic(self->GetNaturalUVDomain(), SM_SP_U);
}

bool surface_is_periodic_v(uintptr_t s)
{
    SmSurface* self = smjs::surface(s);
    return self->IsPeriodic(self->GetNaturalUVDomain(), SM_SP_V);
}

}  // namespace

EMSCRIPTEN_BINDINGS(smlib_topology)
{
    function("brep_bounding_box", &brep_bounding_box);
    function("brep_copy", &brep_copy);
    function("brep_faces", &brep_faces);
    function("brep_edges", &brep_edges);
    function("brep_vertices", &brep_vertices);
    function("brep_face_count", &brep_face_count);
    function("brep_edge_count", &brep_edge_count);
    function("brep_vertex_count", &brep_vertex_count);
    function("brep_write_to_file", &brep_write_to_file);
    function("brep_is_manifold_solid", &brep_is_manifold_solid);
    function("brep_material_census", &brep_material_census);

    function("face_bounding_box", &face_bounding_box);
    function("face_surface", &face_surface);
    function("face_uv_domain", &face_uv_domain);
    function("face_edges", &face_edges);
    function("face_vertices", &face_vertices);
    function("face_interior_point", &face_interior_point);
    function("face_closest_point", &face_closest_point);
    function("face_classify_uv", &face_classify_uv);
    function("face_point_at_uv", &face_point_at_uv);
    function("face_normal_at_uv", &face_normal_at_uv);
    function("face_outward_normal_at_uv", &face_outward_normal_at_uv);
    function("face_boundary_loops", &face_boundary_loops);

    function("edge_bounding_box", &edge_bounding_box);
    function("edge_curve", &edge_curve);
    function("edge_faces", &edge_faces);
    function("edge_vertices", &edge_vertices);
    function("edge_parameter_range", &edge_parameter_range);
    function("edge_closest_point", &edge_closest_point);

    function("vertex_point", &vertex_point);
    function("vertex_edges", &vertex_edges);
    function("vertex_faces", &vertex_faces);

    function("curve_parameter_range", &curve_parameter_range);
    function("curve_evaluate", &curve_evaluate);
    function("curve_start_point", &curve_start_point);
    function("curve_end_point", &curve_end_point);
    function("curve_length", &curve_length);
    function("curve_is_closed", &curve_is_closed);
    function("curve_is_planar", &curve_is_planar);
    constant("SM_EFF_ZERO", static_cast<double>(SM_EFF_ZERO));
    function("circle_center", &circle_center);
    function("circle_radius", &circle_radius);
    function("circle_normal", &circle_normal);
    function("circle_x_axis", &circle_x_axis);
    function("circle_y_axis", &circle_y_axis);

    function("surface_u_domain", &surface_u_domain);
    function("surface_v_domain", &surface_v_domain);
    function("surface_uv_domain", &surface_uv_domain);
    function("surface_evaluate", &surface_evaluate);
    function("surface_normal", &surface_normal);
    function("surface_derivatives", &surface_derivatives);
    function("surface_is_planar", &surface_is_planar);
    function("surface_is_periodic_u", &surface_is_periodic_u);
    function("surface_is_periodic_v", &surface_is_periodic_v);
}
