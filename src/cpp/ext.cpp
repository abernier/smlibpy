// SPDX-License-Identifier: Apache-2.0
//
// smlibpy additions to the upstream SmPyLib bindings (`smlibpy._core.ext`).
//
// The upstream bindings expose operations; smlibpy additionally needs
//   * exact geometry and topology as plain data (STEP export, geometry queries),
//   * explicit lifetime control of kernel objects (Python wrappers are non-owning),
//   * arbitrary 4x4 transforms, face extraction, body separation, topology-preserving copies.

#include "kernel.h"
#include "ext_shared.h"
#include "seams.h"
#include "analytics.h"
#include "analytic.h"

#include <SmApiGeneral.h>
#include <SmCopyBrepMap.h>
#include <SmPlane.h>
#include <SmCone.h>
#include <SmCylinder.h>
#include <SmSphere.h>
#include <SmTorus.h>
#include <SmSurfOfRevolution.h>
#include <SmSurfOfExtrusion.h>
#include <SmOffsetSurface.h>
#include <SmLine.h>
#include <SmCircle.h>
#include <SmEllipse.h>
#include <SmPrimitiveCreation.h>
#include <SmApiBrep.h>
#include <SmApiQueries.h>

#include <cmath>
#include <unordered_map>
#include <unordered_set>

namespace
{

using smlibpy::tup;
using smlibpy::Value;
template <typename T>
Value val(const T& x) { return smlibpy::v(x); }

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(status, what, __FILE__, __LINE__);
}

// SmPoint3d is an alias of SmVector3d.
Value xyz(const SmVector3d& p) { return tup(p.x, p.y, p.z); }

Value placement(const SmAxis2Placement& a)
{
    Value d = Value::dict();
    SmVector3d x = a.GetXAxisRef();
    SmVector3d y = a.GetYAxisRef();
    SmVector3d z = x * y;  // operator* is the cross product for SmVector3d
    d.set("origin", val(xyz(a.GetOriginRef())));
    d.set("x_dir", val(xyz(x)));
    d.set("y_dir", val(xyz(y)));
    d.set("z_dir", val(xyz(z)));
    return d;
}

Value knot_vector(const SmTArray<double>& unique, const SmTArray<ULONG>& mults)
{
    Value knots = Value::make_list();
    for (ULONG i = 0; i < unique.GetSize(); ++i)
        for (ULONG m = 0; m < mults[i]; ++m)
            knots.push(val(unique[i]));
    return knots;
}

template <typename T>
Value to_list(const SmTArray<T>& a)
{
    Value l = Value::make_list();
    for (ULONG i = 0; i < a.GetSize(); ++i)
        l.push(val(a[i]));
    return l;
}

Value points(const SmTArray<SmPoint3d>& a)
{
    Value l = Value::make_list();
    for (ULONG i = 0; i < a.GetSize(); ++i)
        l.push(val(xyz(a[i])));
    return l;
}

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

const char* curve_kind_name(const SmCurve* c)
{
    switch (c->GetType())
    {
    case SmLine_TYPE: return "line";
    case SmCircle_TYPE: return "circle";
    case SmEllipse_TYPE: return "ellipse";
    case SmBSplineCurve_TYPE: return "bspline";
    default: break;
    }
    if (c->IsKindOf(SmBSplineCurve_TYPE))
        return "bspline";  // parabola, hyperbola, ...: exported through their NURBS form
    return "other";
}

void add_bspline_curve(Value& d, const SmBSplineCurve* c)
{
    ULONG dim = 0, degree = 0;
    SmTArray<SmPoint3d> poles;
    SmBSplineCurveForm form;
    SmTArray<ULONG> mults;
    SmTArray<double> knots, weights;
    SmKnotType knot_type;
    check(c->GetCanonical(dim, degree, poles, form, mults, knots, knot_type, weights), "SmBSplineCurve::GetCanonical");
    d.set("degree", val(degree));
    d.set("poles", val(points(poles)));
    d.set("knots", val(knot_vector(knots, mults)));
    d.set("weights", val(weights.GetSize() ? to_list(weights) : Value()));
    d.set("dimension", val(dim));
}

Value make_curve_data(const SmCurve* curve, bool nurbs = true)
{
    if (!curve)
        throw std::invalid_argument("curve is None");
    Value d = Value::dict();
    const char* kind = curve_kind_name(curve);
    d.set("kind", val(kind));
    d.set("class", val(std::string(curve->GetClassString())));
    SmExtent1d ivl = curve->GetNaturalInterval();
    d.set("interval", val(tup(ivl.GetMin(), ivl.GetMax())));

    if (curve->GetType() == SmLine_TYPE)
    {
        auto line = static_cast<const SmLine*>(curve);
        SmPoint3d p;
        SmVector3d v;
        SmExtent1d dom;
        SmBoolean inside_out = FALSE;
        check(line->GetCanonical(p, v, &dom, &inside_out), "SmLine::GetCanonical");
        d.set("origin", val(xyz(p)));
        d.set("direction", val(xyz(v)));
    }
    else if (curve->GetType() == SmCircle_TYPE)
    {
        auto circle = static_cast<const SmCircle*>(curve);
        SmAxis2Placement a;
        double r = 0.0;
        SmBoolean inside_out = FALSE;
        check(circle->GetCanonical(a, r, &inside_out), "SmCircle::GetCanonical");
        d.set("placement", val(placement(a)));
        d.set("radius", val(r));
    }
    else if (curve->GetType() == SmEllipse_TYPE)
    {
        auto ellipse = static_cast<const SmEllipse*>(curve);
        SmAxis2Placement a;
        double r1 = 0.0, r2 = 0.0;
        SmExtent1d dom;
        SmBoolean inside_out = FALSE;
        check(ellipse->GetCanonical(a, r1, r2, &dom, &inside_out), "SmEllipse::GetCanonical");
        d.set("placement", val(placement(a)));
        d.set("radius1", val(r1));
        d.set("radius2", val(r2));
    }

    if (!nurbs)
        return d;
    if (curve->IsKindOf(SmBSplineCurve_TYPE))
    {
        add_bspline_curve(d, static_cast<const SmBSplineCurve*>(curve));
        d.set("approximated", val(false));
    }
    else
    {
        // Composite, offset, projected, curve-on-surface, ...: approximate with a NURBS that
        // keeps the parameterisation, so edge intervals stay valid on the approximation.
        SmTArray<double> breaks;
        breaks.Add(ivl.GetMin());
        breaks.Add(ivl.GetMax());
        double gap = 0.0;
        SmBSplineCurve* approx = nullptr;
        check(curve->ApproximateCurve(ctx(), breaks, 1e-7, gap, approx, FALSE, TRUE),
              "SmCurve::ApproximateCurve");
        add_bspline_curve(d, approx);
        d.set("approximated", val(true));
        d.set("approximation_gap", val(gap));
        delete approx;
    }
    return d;
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

const char* surface_kind_name(const SmSurface* s)
{
    switch (s->GetType())
    {
    case SmPlane_TYPE: return "plane";
    case SmCylinder_TYPE: return "cylinder";
    case SmCone_TYPE: return "cone";
    case SmSphere_TYPE: return "sphere";
    case SmTorus_TYPE: return "torus";
    case SmSurfOfRevolution_TYPE: return "revolution";
    case SmSurfOfExtrusion_TYPE: return "extrusion";
    case SmBSplineSurface_TYPE: return "bspline";
    case SmOffsetSurface_TYPE: return "offset";
    default: break;
    }
    if (s->IsKindOf(SmBSplineSurface_TYPE))
        return "bspline";
    return "other";
}

void add_bspline_surface(Value& d, const SmBSplineSurface* s)
{
    ULONG udeg = 0, vdeg = 0;
    SmTArray<SmPoint3d> poles;
    SmBSplineSurfaceForm form;
    SmTArray<ULONG> umults, vmults;
    SmTArray<double> uknots, vknots, weights;
    SmKnotType knot_type;
    check(s->GetCanonical(udeg, vdeg, poles, form, umults, vmults, uknots, vknots, knot_type, weights),
          "SmBSplineSurface::GetCanonical");
    d.set("u_degree", val(udeg));
    d.set("v_degree", val(vdeg));
    d.set("poles", val(points(poles)));
    d.set("u_knots", val(knot_vector(uknots, umults)));
    d.set("v_knots", val(knot_vector(vknots, vmults)));
    d.set("weights", val(weights.GetSize() ? to_list(weights) : Value()));
}

Value make_surface_data(const SmSurface* surface, bool nurbs = true)
{
    if (!surface)
        throw std::invalid_argument("surface is None");
    Value d = Value::dict();
    d.set("kind", val(surface_kind_name(surface)));
    d.set("class", val(std::string(surface->GetClassString())));
    SmExtent2d dom = surface->GetNaturalUVDomain();
    d.set("uv_domain", tup(tup(dom.GetMin().x, dom.GetMin().y), tup(dom.GetMax().x, dom.GetMax().y)));
    SmBoolean inside_out = FALSE, swap_uv = FALSE;
    switch (surface->GetType())
    {
    case SmPlane_TYPE:
    {
        SmAxis2Placement a;
        check(static_cast<const SmPlane*>(surface)->GetCanonical(a), "SmPlane::GetCanonical");
        d.set("placement", val(placement(a)));
        break;
    }
    case SmCylinder_TYPE:
    {
        SmAxis2Placement a;
        double r = 0.0;
        check(static_cast<const SmCylinder*>(surface)->GetCanonical(a, r), "SmCylinder::GetCanonical");
        d.set("placement", val(placement(a)));
        d.set("radius", val(r));
        d.set("inside_out", val(static_cast<bool>(static_cast<const SmCylinder*>(surface)->GetInsideOut())));
        break;
    }
    case SmCone_TYPE:
    {
        SmAxis2Placement a;
        double r = 0.0, semi = 0.0;
        check(static_cast<const SmCone*>(surface)->GetCanonical(a, r, semi, &swap_uv, &inside_out),
              "SmCone::GetCanonical");
        d.set("placement", val(placement(a)));
        d.set("radius", val(r));
        d.set("semi_angle_deg", val(semi));
        d.set("inside_out", val(static_cast<bool>(inside_out)));
        break;
    }
    case SmSphere_TYPE:
    {
        SmAxis2Placement a;
        double r = 0.0;
        check(static_cast<const SmSphere*>(surface)->GetCanonical(a, r, &swap_uv, &inside_out),
              "SmSphere::GetCanonical");
        d.set("placement", val(placement(a)));
        d.set("radius", val(r));
        d.set("inside_out", val(static_cast<bool>(inside_out)));
        break;
    }
    case SmTorus_TYPE:
    {
        SmAxis2Placement a;
        double R = 0.0, r = 0.0;
        check(static_cast<const SmTorus*>(surface)->GetCanonical(a, R, r, &swap_uv, &inside_out),
              "SmTorus::GetCanonical");
        d.set("placement", val(placement(a)));
        d.set("major_radius", val(R));
        d.set("minor_radius", val(r));
        d.set("inside_out", val(static_cast<bool>(inside_out)));
        break;
    }
    case SmSurfOfRevolution_TYPE:
        // (its axis: the frame's z axis through its origin; x points to where the angle starts)
        d.set("placement", val(placement(static_cast<const SmSurfOfRevolution*>(surface)->GetPosition())));
        break;
    case SmOffsetSurface_TYPE:
    {
        // The surface the kernel evaluates: the basis moved by `distance` along its natural
        // normal (a nested offset's distances add up on its basis, as SmOffsetSurface evaluates
        // it), and the basis extended past its domain where the kernel has made one (fillets
        // evaluate there).
        auto off = static_cast<const SmOffsetSurface*>(surface);
        double dist = off->GetOffsetDistance();
        const SmSurface* basis = off->GetBaseSurface();
        if (basis && basis->GetType() == SmOffsetSurface_TYPE)
        {
            dist += static_cast<const SmOffsetSurface*>(basis)->GetOffsetDistance();
            basis = static_cast<const SmOffsetSurface*>(basis)->GetBaseSurface();
        }
        d.set("distance", val(dist));
        if (basis)
            d.set("basis", val(make_surface_data(basis, nurbs)));
        if (const SmSurface* extended = off->GetExtendedBaseSurface())
            d.set("extended", val(make_surface_data(extended, nurbs)));
        break;
    }
    default: break;
    }
    if (nurbs && surface->IsKindOf(SmBSplineSurface_TYPE))
        add_bspline_surface(d, static_cast<const SmBSplineSurface*>(surface));
    return d;
}

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

template <typename T>
std::unordered_map<const T*, size_t> index_of(const SmTArray<T*>& items)
{
    std::unordered_map<const T*, size_t> m;
    m.reserve(items.GetSize());
    for (ULONG i = 0; i < items.GetSize(); ++i)
        m[items[i]] = i;
    return m;
}

// Full structural description of a Brep as plain Python data. Geometry is included when
// `geometry` is true (STEP export); otherwise only the graph (cheap queries).
Value make_brep_dump(const SmBrep* brep, bool geometry)
{
    if (!brep)
        throw std::invalid_argument("brep is None");

    SmTArray<SmVertex*> vertices;
    SmTArray<SmEdge*> edges;
    SmTArray<SmFace*> faces;
    SmTArray<SmRegion*> regions;
    brep->GetVertices(vertices);
    brep->GetEdges(edges);
    brep->GetFaces(faces);
    brep->GetRegions(regions);

    auto vidx = index_of(vertices);
    auto eidx = index_of(edges);
    auto fidx = index_of(faces);

    Value vlist = Value::make_list();
    for (ULONG i = 0; i < vertices.GetSize(); ++i)
        vlist.push(val(xyz(vertices[i]->GetPoint())));

    Value elist = Value::make_list();
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        SmEdge* e = edges[i];
        Value ed = Value::dict();
        SmExtent1d ivl = e->GetInterval();
        ed.set("interval", val(tup(ivl.GetMin(), ivl.GetMax())));
        SmVertex* v0 = e->GetStartVertex();
        SmVertex* v1 = e->GetEndVertex();
        ed.set("v0", val(v0 ? val(vidx.at(v0)) : Value()));
        ed.set("v1", val(v1 ? val(vidx.at(v1)) : Value()));
        if (geometry)
            ed.set("curve", val(make_curve_data(e->GetCurve(), true)));
        else
            ed.set("kind", val(curve_kind_name(e->GetCurve())));
        elist.push(val(ed));
    }

    // Shells are reached through regions; number them in region order.
    std::unordered_map<const SmShell*, size_t> sidx;
    Value rlist = Value::make_list(), slist = Value::make_list();
    for (ULONG r = 0; r < regions.GetSize(); ++r)
    {
        SmRegion* region = regions[r];
        SmTArray<SmShell*> shells;
        region->GetShells(shells);
        Value shell_ids = Value::make_list();
        for (ULONG s = 0; s < shells.GetSize(); ++s)
        {
            size_t id = sidx.size();
            sidx[shells[s]] = id;
            shell_ids.push(val(id));
            Value sd = Value::dict();
            sd.set("region", val(r));
            sd.set("closed", val(static_cast<bool>(shells[s]->IsClosed())));
            slist.push(val(sd));
        }
        Value rd = Value::dict();
        rd.set("infinite", val(region == brep->GetInfiniteRegion()));
        rd.set("void", val(region->IsVoid() == TRUE));
        rd.set("shells", val(shell_ids));
        rlist.push(val(rd));
    }

    auto loops_of = [&](const SmFaceuse* fu) {
        Value loops = Value::make_list();
        SmTArray<SmLoopuse*> lus;
        fu->GetLoopuses(lus);
        for (ULONG l = 0; l < lus.GetSize(); ++l)
        {
            SmLoopuse* lu = lus[l];
            Value ld = Value::dict();
            if (lu->IsVertexLoopuse())
            {
                SmVertexuse* vu = lu->GetVertexuse();
                ld.set("vertex", val(vu ? val(vidx.at(vu->GetVertex())) : Value()));
                ld.set("edges", Value::make_list());
            }
            else
            {
                SmTArray<SmEdgeuse*> eus;
                lu->GetEdgeuses(eus);
                Value items = Value::make_list();
                for (ULONG k = 0; k < eus.GetSize(); ++k)
                    items.push(val(tup(eidx.at(eus[k]->GetEdge()), eus[k]->GetOrientation() == SM_OT_SAME)));
                ld.set("edges", val(items));
                ld.set("vertex", Value());
            }
            ld.set("outer", val(l == 0));
            loops.push(val(ld));
        }
        return loops;
    };

    Value flist = Value::make_list();
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        SmFace* f = faces[i];
        SmFaceuse* up = f->GetUpwardFaceuse();
        SmFaceuse* down = up ? up->GetMate() : nullptr;
        Value fd = Value::dict();
        SmExtent2d dom = f->GetUVDomain();
        fd.set("uv_domain", tup(tup(dom.GetMin().x, dom.GetMin().y), tup(dom.GetMax().x, dom.GetMax().y)));
        if (geometry)
            fd.set("surface", val(make_surface_data(f->GetSurface(), true)));
        else
            fd.set("kind", val(surface_kind_name(f->GetSurface())));
        Value uses = Value::make_list();
        for (SmFaceuse* fu : {up, down})
        {
            Value ud = Value::dict();
            if (!fu)
            {
                uses.push(Value());
                continue;
            }
            ud.set("same", val(fu->GetOrientation() == SM_OT_SAME));
            auto it = sidx.find(fu->GetShell());
            ud.set("shell", val(it == sidx.end() ? Value() : val(it->second)));
            ud.set("loops", val(loops_of(fu)));
            uses.push(val(ud));
        }
        fd.set("uses", val(uses));  // [upward (SAME) faceuse, its mate]
        flist.push(val(fd));
    }

    Value out = Value::dict();
    out.set("vertices", val(vlist));
    out.set("edges", val(elist));
    out.set("faces", val(flist));
    out.set("shells", val(slist));
    out.set("regions", val(rlist));
    return out;
}

// Index of every face / edge / vertex handle in the Brep's own lists, so Python can map
// pybind wrappers (Face, Edge, Vertex) to dump indices.
template <typename T>
std::vector<long> indices_in(const SmTArray<T*>& all, const std::vector<T*>& wanted)
{
    auto idx = index_of(all);
    std::vector<long> out;
    out.reserve(wanted.size());
    for (T* w : wanted)
    {
        auto it = idx.find(w);
        out.push_back(it == idx.end() ? -1 : static_cast<long>(it->second));
    }
    return out;
}

}  // namespace

namespace smlibpy {

Value curve_data(const SmCurve* curve, bool nurbs) { return make_curve_data(curve, nurbs); }
Value surface_data(const SmSurface* surface, bool nurbs) { return make_surface_data(surface, nurbs); }
Value brep_dump(const SmBrep* brep, bool geometry) { return make_brep_dump(brep, geometry); }

std::vector<long> seam_edges(const SmBrep* brep)
{
    // Edges that one face uses twice: the seams of periodic surfaces.
    SmTArray<SmEdge*> edges;
    brep->GetEdges(edges);
    std::vector<long> out;
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        SmTArray<SmFace*> faces;
        edges[i]->GetFaces(faces);
        if (faces.GetSize() != 1)
            continue;
        SmTArray<SmLoopuse*> lus;
        faces[0]->GetUpwardLoopuses(lus);
        int uses = 0;
        for (ULONG l = 0; l < lus.GetSize(); ++l)
        {
            SmTArray<SmEdgeuse*> eus;
            lus[l]->GetEdgeuses(eus);
            for (ULONG j = 0; j < eus.GetSize(); ++j)
                uses += eus[j]->GetEdge() == edges[i] ? 1 : 0;
        }
        if (uses > 1)
            out.push_back(static_cast<long>(i));
    }
    return out;
}

std::vector<long> face_indices(const SmBrep* brep, const std::vector<SmFace*>& faces)
{
    SmTArray<SmFace*> all;
    brep->GetFaces(all);
    return indices_in(all, faces);
}

std::vector<long> edge_indices(const SmBrep* brep, const std::vector<SmEdge*>& edges)
{
    SmTArray<SmEdge*> all;
    brep->GetEdges(all);
    return indices_in(all, edges);
}

std::vector<long> vertex_indices(const SmBrep* brep, const std::vector<SmVertex*>& vertices)
{
    SmTArray<SmVertex*> all;
    brep->GetVertices(all);
    return indices_in(all, vertices);
}

// Copy a Brep and map the given topology of the original onto the copy.
CopyMap copy_with_map(const SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<SmEdge*>& edges,
                      const std::vector<SmVertex*>& vertices)
{
    SmCopyBrepMap reverse;  // original -> copy
    CopyMap out;
    out.brep = new (ctx()) SmBrep(*brep, nullptr, &reverse, TRUE, FALSE);
    for (SmFace* x : faces)
        out.faces.push_back(static_cast<SmFace*>(reverse.GetAt(x)));
    for (SmEdge* x : edges)
        out.edges.push_back(static_cast<SmEdge*>(reverse.GetAt(x)));
    for (SmVertex* x : vertices)
        out.vertices.push_back(static_cast<SmVertex*>(reverse.GetAt(x)));
    return out;
}

// Give a scaled body the tolerances SmBrep::Transform gives one (the zone tolerance of its size
// on every vertex, edge and face), with the size taken from its whole bounding box. The kernel
// takes it from the vertices alone: a torus (one vertex) gets tolerance 0, a thin disk 1e-6.
static void scale_tolerances(SmBrep* brep)
{
    SmExtent3d box;
    check(brep->CalculateBoundingBox(box, FALSE, FALSE, FALSE), "SmBrep::CalculateBoundingBox");
    SmZoneTol3d tol = SmTol::SetModelSizeEstimate(*brep, box.GetSize().Length());
    SmTArray<SmVertex*> vertices;
    brep->GetVertices(vertices);
    for (ULONG i = 0; i < vertices.GetSize(); ++i)
        vertices[i]->SetTolerance(tol, FALSE, FALSE);
    SmTArray<SmEdge*> edges;
    brep->GetEdges(edges);
    for (ULONG i = 0; i < edges.GetSize(); ++i)
        edges[i]->SetTolerance(tol, FALSE, FALSE);
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    for (ULONG i = 0; i < faces.GetSize(); ++i)
        faces[i]->SetTolerance(tol, FALSE, FALSE);
}

// SmBrep::Mirror turns every surface over (a reflection reverses Su x Sv) and moves the two sides of
// each face to each other's shell. The regions stay right, but every face's surface normal then
// points to the other side than in the body mirrored. The kernel's display faceting and SmPyLib's
// outward normal take the side of a face from whether its upward faceuse lies in the infinite region,
// which is no longer right for faces with both sides inside (cavity walls, the faces between cells)
// or both outside (sheets): (Box(20, 20, 20) - Box(10, 10, 10)).mirror(Plane.YZ) meshed to 9000 for
// 7000, its cavity walls' normals pointed into the material and its edges there read convex; and the
// offset code, which builds cavity walls from the surfaces, made shells of mirrored parts with their
// cavity inside out. Every face is turned back over (SmBrep::SwapUV: each surface and which side of
// each face is up; the faceuses stay in their shells), so a mirrored body is laid out as the body was.
// Mirror also gives every edge a B-spline curve; lines and circles get their exact curve back (a
// mirrored part's straight edges were no lines, its circles no circles).
static void finish_mirror(SmBrep* brep)
{
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    for (ULONG i = 0; i < faces.GetSize(); ++i)
        check(faces[i]->SwapUV(), "SmFace::SwapUV");
    smlibpy::restore_analytic_curves(brep, false);
}

void transform_brep(SmBrep* brep, const std::vector<double>& m)
{
    if (m.size() != 16)
        throw std::invalid_argument("expected a row-major 4x4 matrix (16 values)");
    double t[4][4];
    for (int r = 0; r < 4; ++r)
        for (int c = 0; c < 4; ++c)
            t[r][c] = m[r * 4 + c];
    // Rows 0-2 are the images of the axes, row 3 the translation. SmBrep::Transform(matrix)
    // passes even a rotation on with a scale of 1, and any scale makes it set the tolerances of
    // the body, and the model size of the shared context, from the box of the vertices: a move
    // took the tolerance of a torus to 0 and that of a part over 500 across to 1e-4, and
    // Booleans with the moved body went wrong. A rotation, a reflection or a uniform scale is
    // applied here with a placement, as SM_API's SmApiTransform applies one: the tolerances
    // stay, and a scale sets them from the whole box.
    SmVector3d x(t[0][0], t[0][1], t[0][2]), y(t[1][0], t[1][1], t[1][2]), z(t[2][0], t[2][1], t[2][2]);
    SmPoint3d shift(t[3][0], t[3][1], t[3][2]);
    double s = (x.Length() + y.Length() + z.Length()) / 3.0;
    const double eps = 1e-10;
    bool conformal = s > 0 && std::isfinite(s);
    for (const SmVector3d* a : {&x, &y, &z})
        conformal = conformal && std::fabs(a->Length() - s) <= eps * s;
    conformal = conformal && std::fabs(x.Dot(y)) <= eps * s * s && std::fabs(y.Dot(z)) <= eps * s * s &&
                std::fabs(z.Dot(x)) <= eps * s * s;
    if (!conformal)
    {
        // Shear, or a scale that differs between the axes: the kernel's way (it turns the
        // geometry into NURBS), then the tolerances from the whole box; the context keeps its
        // model size.
        SmContext& context = *SmApiGetOrCreateContext();
        double size = SmTol::GetModelSizeEstimate(context);
        SmStatus st = brep->Transform(t, TRUE);
        SmTol::SetModelSizeEstimate(context, size);
        check(st, "SmBrep::Transform");
        scale_tolerances(brep);
        return;
    }
    if ((x * y).Dot(z) < 0)  // a reflection (z is not x * y): mirror in XY first, then place as a rotation
    {
        check(brep->Mirror(SmAxis2Placement()), "SmBrep::Mirror");
        finish_mirror(brep);
    }
    SmAxis2Placement placement(shift, x / s, y / s);
    if (std::fabs(s - 1.0) <= eps)
    {
        check(brep->Transform(placement, nullptr, FALSE), "SmBrep::Transform");
        return;
    }
    SmVector3d scale(s, s, s);
    check(brep->Transform(placement, &scale, FALSE), "SmBrep::Transform");
    scale_tolerances(brep);
}

// The region a point off the boundary lies in, by vote. SmBrep::Point3DClassify takes the region
// from one ray (along +X, the other axes only if that fails), on the near side of the nearest face
// the ray meets. A ray can miss a face it crosses: once a tight bounding box had been computed, the
// solver found no face along +X from a point inside a cylinder fused with a torus, and the point
// came out outside. So two rays in directions off the axes vote too, and two more when the three
// disagree.
static const SmRegion* voted_region(const SmBrep* brep, const SmPoint3d& point, SmZoneTol3d tol, const SmRegion* first)
{
    static const SmVector3d directions[] = {SmVector3d(0.3189, 0.5296, 0.7860), SmVector3d(-0.6122, 0.2899, 0.7356),
                                            SmVector3d(0.5774, -0.8018, 0.1547), SmVector3d(-0.2673, -0.5345, -0.8018)};
    std::vector<std::pair<const SmRegion*, int>> votes{{first, 1}};
    auto vote = [&](const SmVector3d& d) {
        SmVector3d u = d;
        u.Unitize();
        SmRegion* region = nullptr;
        SmPointClassification hit(tol, brep->GetContext());
        if (brep->RayFire(point, u, tol, region, hit) != SM_SUCCESS || !region)
            return;  // the ray starts on a face (within the solver's zero): no vote
        for (auto& v : votes)
            if (v.first == region)
                return void(++v.second);
        votes.emplace_back(region, 1);
    };
    vote(directions[0]);
    vote(directions[1]);
    if (votes.size() > 1)
    {
        vote(directions[2]);
        vote(directions[3]);
    }
    auto best = votes.begin();
    for (auto v = votes.begin(); v != votes.end(); ++v)
        if (v->second > best->second)
            best = v;
    return best->first;
}

// The diagonal of a body's loose box (1 where it has none).
static double brep_size(const SmBrep* brep)
{
    SmExtent3d box;
    return brep->CalculateBoundingBox(box) == SM_SUCCESS ? box.GetSize().Length() : 1.0;
}

// The kernel's coarse volume of a body (SmBrep::ComputePreciseProperties to 1e-4), NaN where that
// fails.
static double coarse_volume(const SmBrep* brep)
{
    SmExtent3d box;
    if (brep->CalculateBoundingBox(box) != SM_SUCCESS)
        return std::nan("");
    SmMassPropertyBehavior behavior(1.0);
    double area = 0.0, volume = 0.0, mass = 0.0;
    SmTArray<SmVector3d> moments;
    if (const_cast<SmBrep*>(brep)->ComputePreciseProperties(1e-4, box.GetMid(), behavior, area, volume, mass,
                                                            moments) != SM_SUCCESS)
        return std::nan("");
    return volume;
}

// Whether the result of a Boolean of bodies of volumes va and vb can be right: a closed, manifold
// solid (any body for a merge) with a volume (more than 1e-6 of the larger body's: the kernel can
// return a closed body of two faces and no volume for an intersection of a turned or re-seamed
// body) that lies within the bounds theirs set, within 1e-3 of the
// larger body (a union), the smaller (an intersection) or the first (a difference): a union, or a
// merge, holds the larger body and no more than both; an intersection no more than the smaller; a
// difference no more than the first body and no less than what the second can take of it.
static bool plausible(SmBrep* result, double va, double vb, SmBooleanOperationType op, bool non_manifold)
{
    if (result->GetNumFaces() == 0 || (!non_manifold && !result->IsManifoldSolid()))
        return false;
    const double v = coarse_volume(result);
    if (!(v > 1e-6 * std::max(va, vb)))  // (also NaN; a closed body of no volume is no result either)
        return false;
    switch (op)
    {
    case SM_BO_UNION:
    case SM_BO_MERGE:
    {
        const double e = 1e-3 * std::max(va, vb);
        return v >= std::max(va, vb) - e && v <= va + vb + e;
    }
    case SM_BO_INTERSECTION: return v <= std::min(va, vb) * (1 + 1e-3);
    case SM_BO_DIFFERENCE: return v <= va * (1 + 1e-3) && v >= va - vb - 1e-3 * va;
    default: return false;
    }
}

SmBrep* boolean(SmBrep* brep1, SmBrep* brep2, int operation, bool non_manifold, bool imprinting)
{
    if (!brep1 || !brep2)
        throw std::invalid_argument("brep is None");
    if (operation != SM_BO_UNION && operation != SM_BO_DIFFERENCE && operation != SM_BO_INTERSECTION &&
        operation != SM_BO_MERGE)
        throw std::invalid_argument("operation: expected UNION, DIFFERENCE, INTERSECTION or MERGE (BooleanOp)");
    if (non_manifold && imprinting)
        throw std::invalid_argument("non_manifold and imprinting: one or the other");
    const auto op = static_cast<SmBooleanOperationType>(operation);
    auto run = [&](SmBrep* b1, SmBrep* b2, SmBrep*& result) {
        // (the imprint as k.boolean_with_options takes it by default: post-processed, brep2 deleted)
        const SmStatus st = non_manifold ? SmApiNonManifoldBoolean(b1, b2, op, result)
                            : imprinting ? SmApiBooleanWithOptions(b1, b2, op, FALSE, TRUE, TRUE, FALSE, FALSE, result)
                                         : SmApiBoolean(b1, b2, op, result);
        if (st != SM_SUCCESS)  // SmMerge clears the mark only on its way out of a success
            SmApiGetOrCreateContext()->SetDoingBoolean(FALSE);
        return st;
    };
    const bool solid1 = brep1->IsManifoldSolid(), solid2 = brep2->IsManifoldSolid();
    // (a merge of a part into an earlier merge: the part's seams against the merged cells)
    const bool merging = non_manifold && op == SM_BO_MERGE;
    if (!imprinting && solid2 && (solid1 || merging))
    {
        // Where the faces cross along a curve tangent to a seam of either body, the kernel's Boolean
        // goes wrong (a valid body of the wrong volume, or an error; seams.cpp, kernel plan B6). The
        // body that seam belongs to is turned about its axis first where that keeps its shape (a
        // body of revolution): on copies, at up to three angles that clear the seam. A body of
        // another shape (a part with a hole) goes in with the seams moved on their faces instead
        // (seams.h, reseamed). A result that cannot be right (a union smaller than one of the
        // bodies: the turned one taken for inside the other) is passed over too; where the kernel
        // fails with each, the bodies go in as they are.
        SeamTurns turns1, turns2;
        SmBrep *moved1 = nullptr, *moved2 = nullptr;  // (copies with seams moved on their faces)
        SmBrep *seen1 = nullptr, *seen2 = nullptr;    // (copies with B-spline faces recognized as analytic)
        try
        {
            // A seam of a B-spline face (a NURBS copy, an imported part) is turned or moved on a copy
            // whose faces are recognized as cylinders, cones, spheres or tori, where they are such.
            if (solid1 && freeform_seam_touches(brep1, brep2, 0.0))
                seen1 = recognize_analytics(brep1, 1e-9 * std::max(1.0, brep_size(brep1)));
            const SmBrep* base1 = seen1 ? seen1 : brep1;
            if (freeform_seam_touches(brep2, base1, 0.0))
                seen2 = recognize_analytics(brep2, 1e-9 * std::max(1.0, brep_size(brep2)));
            const SmBrep* base2 = seen2 ? seen2 : brep2;
            turns2 = seam_turns(base2, base1, 0.0, 3);
            if (solid1)
                turns1 = seam_turns(base1, base2, 0.0, 3);
            if (solid1 && turns1.angles.empty())
                moved1 = reseamed(base1, base2, 0.0);
            if (turns2.angles.empty())
                moved2 = reseamed(base2, moved1 ? moved1 : base1, 0.0);
        }
        catch (const std::exception&)  // (a seam that cannot be evaluated: the bodies as they are)
        {
            turns1 = turns2 = SeamTurns();
            delete moved1, delete moved2, delete seen1, delete seen2;
            moved1 = moved2 = seen1 = seen2 = nullptr;
        }
        const SmBrep* from1 = moved1 ? moved1 : seen1 ? seen1 : brep1;
        const SmBrep* from2 = moved2 ? moved2 : seen2 ? seen2 : brep2;
        const size_t tries =
            std::max({turns1.angles.size(), turns2.angles.size(), size_t(moved1 || moved2 || seen1 || seen2 ? 1 : 0)});
        const double va = tries ? coarse_volume(brep1) : 0.0, vb = tries ? coarse_volume(brep2) : 0.0;
        for (size_t i = 0; i < tries; ++i)
        {
            SmBrep *c1 = nullptr, *c2 = nullptr;
            if (SmApiBrepCopy(from1, c1) != SM_SUCCESS)
            {
                delete moved1, delete moved2, delete seen1, delete seen2;
                check(SM_ERR, "SmApiBrepCopy");
            }
            if (SmApiBrepCopy(from2, c2) != SM_SUCCESS)
            {
                delete c1;
                delete moved1, delete moved2, delete seen1, delete seen2;
                check(SM_ERR, "SmApiBrepCopy");
            }
            SmBrep* result = nullptr;
            SmStatus st = SM_ERR;
            try
            {
                if (!turns1.angles.empty())
                    turn_brep(c1, turns1, turns1.angles[std::min(i, turns1.angles.size() - 1)]);
                if (!turns2.angles.empty())
                    turn_brep(c2, turns2, turns2.angles[std::min(i, turns2.angles.size() - 1)]);
                st = run(c1, c2, result);
            }
            catch (...)
            {
                delete c1;
                delete c2;
                delete moved1, delete moved2, delete seen1, delete seen2;
                throw;
            }
            if (st == SM_SUCCESS)  // the result is c1, changed; c2 is deleted
            {
                if (plausible(result, va, vb, op, non_manifold))
                {
                    delete brep1;
                    delete brep2;
                    delete moved1, delete moved2, delete seen1, delete seen2;
                    return result;
                }
                delete result;
                continue;
            }
            delete c1;
            delete c2;
        }
        delete moved1, delete moved2, delete seen1, delete seen2;
    }
    SmBrep* result = nullptr;
    const SmStatus st = run(brep1, brep2, result);
    check(st, non_manifold ? "SmApiNonManifoldBoolean" : imprinting ? "SmApiBooleanWithOptions" : "SmApiBoolean");
    return result;
}

Value classify_points(const SmBrep* brep, const std::vector<double>& points, double tolerance)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    if (points.size() % 3)
        throw std::invalid_argument("expected points with three coordinates");
    // The cells: closed regions that are not cavities, numbered as region_shells numbers them.
    SmTArray<SmRegion*> regions;
    brep->GetRegions(regions);
    std::unordered_map<const SmRegion*, long> cells;
    for (ULONG r = 0; r < regions.GetSize(); ++r)
        if (regions[r] != brep->GetInfiniteRegion() && regions[r]->IsVoid() != TRUE)
            cells.emplace(regions[r], static_cast<long>(cells.size()));
    SmTArray<SmFace*> faces;
    SmTArray<SmEdge*> edges;
    SmTArray<SmVertex*> vertices;
    brep->GetFaces(faces);
    brep->GetEdges(edges);
    brep->GetVertices(vertices);
    const auto fidx = index_of(faces);
    const auto eidx = index_of(edges);
    const auto vidx = index_of(vertices);
    const SmZoneTol3d tol = tolerance > 0 ? SmZoneTol3d(tolerance) : SmTol::GetZoneTol3d(brep);
    Value out = Value::make_list();
    for (size_t i = 0; i < points.size(); i += 3)
    {
        const SmPoint3d point(points[i], points[i + 1], points[i + 2]);
        SmPointClassification pc(tol, brep->GetContext());
        check(brep->Point3DClassify(point, tol, TRUE, pc), "SmBrep::Point3DClassify");
        const SmObject* object = pc.GetObject();
        switch (pc.GetPointClass())
        {
        case SM_PC_FACE:
            out.push(tup("face", static_cast<long>(fidx.at(static_cast<const SmFace*>(object))), -1L));
            break;
        case SM_PC_EDGE:
            out.push(tup("edge", static_cast<long>(eidx.at(static_cast<const SmEdge*>(object))), -1L));
            break;
        case SM_PC_VERTEX:
            out.push(tup("vertex", static_cast<long>(vidx.at(static_cast<const SmVertex*>(object))), -1L));
            break;
        case SM_PC_REGION:
        {
            auto cell = cells.find(voted_region(brep, point, tol, static_cast<const SmRegion*>(object)));
            if (cell == cells.end())
                out.push(tup("outside", -1L, -1L));
            else
                out.push(tup("inside", -1L, cell->second));
            break;
        }
        default:
            throw std::runtime_error("SmBrep::Point3DClassify gave no region, face, edge or vertex");
        }
    }
    return out;
}

std::pair<SmBrep*, std::vector<SmEdge*>> boolean_with_curves(SmBrep* brep1, SmBrep* brep2, int operation)
{
    if (!brep1 || !brep2)
        throw std::invalid_argument("brep is None");
    // (the operands as they were, to test the result's edges against: on success boolean() takes both)
    SmBrep *first = nullptr, *second = nullptr;
    check(SmApiBrepCopy(brep1, first), "SmApiBrepCopy");
    if (SmApiBrepCopy(brep2, second) != SM_SUCCESS)
    {
        delete first;
        check(SM_ERR, "SmApiBrepCopy");
    }
    SmBrep* result = nullptr;
    try
    {
        result = boolean(brep1, brep2, operation, false);
    }
    catch (...)
    {
        delete first, delete second;
        throw;
    }
    // An edge joins the two bodies where it lies on the surface of both: at a quarter, half and three
    // quarters of the way along it, each classified on the boundary of each body (within the edge's
    // tolerance, at least 1e-6 of the bodies' size), as ShapeList.joining tests them.
    std::vector<SmEdge*> out;
    try
    {
        const double size = std::max(brep_size(first), brep_size(second));
        SmTArray<SmEdge*> edges;
        result->GetEdges(edges);
        for (ULONG i = 0; i < edges.GetSize(); ++i)
        {
            const SmCurve* curve = edges[i]->GetCurve();
            const SmExtent1d ivl = edges[i]->GetInterval();
            if (!curve)
                continue;
            std::vector<double> points;
            for (double t : {0.25, 0.5, 0.75})
            {
                SmPoint3d p;
                check(curve->EvaluatePoint(ivl.GetMin() + t * (ivl.GetMax() - ivl.GetMin()), p), "SmCurve::EvaluatePoint");
                points.insert(points.end(), {p.x, p.y, p.z});
            }
            const double tol = std::max(SmTol::GetZoneTol3d(edges[i]).val, 1e-6 * size);
            bool on_both = true;
            for (const SmBrep* body : {static_cast<const SmBrep*>(first), static_cast<const SmBrep*>(second)})
            {
                const Value where = classify_points(body, points, tol);
                for (size_t j = 0; j < 3 && on_both; ++j)
                {
                    const std::string& w = where.at(j).at(0).str();
                    on_both = w == "face" || w == "edge" || w == "vertex";
                }
            }
            if (on_both)
                out.push_back(edges[i]);
        }
    }
    catch (...)
    {
        delete first, delete second;
        delete result;
        throw;
    }
    delete first, delete second;
    return {result, out};
}

Value edge_angles(const SmBrep* brep, const std::vector<SmEdge*>& edges)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    Value out = Value::make_list();
    for (SmEdge* e : edges)
    {
        if (!e || e->GetBrep() != brep)
            throw std::invalid_argument("edge_angles: an edge is not one of the body's");
        SmTArray<SmFace*> faces;
        e->GetFaces(faces);
        const SmExtent1d ivl = e->GetInterval();
        double angle = 0.0;
        // CalcOuterAngle answers SM_ERR_WARNING (and an obtuse angle) where both sides of the edge
        // face the same kind of region: the edges of a sheet, the inner edges of a merged part.
        if (faces.GetSize() == 2 && faces[0] != faces[1] && e->IsManifold() &&
            e->CalcOuterAngle(0.5 * (ivl.GetMin() + ivl.GetMax()), angle) == SM_SUCCESS && std::isfinite(angle))
            out.push(val(angle * 180.0 / SM_PI));
        else
            out.push(Value());
    }
    return out;
}

// Breps that are never freed: SmBrep::RemoveFaces can fail half way and leave a body whose
// destructor reads through a null pointer (the faces of an imported body that share no edges, with
// vertex points up to 1e-3 off: AddressSanitizer, SmBrep::~SmBrep). A body that CopyFaces or
// RemoveFaces failed on is put here instead of deleted; it lives as long as the process.
static void keep_forever(SmBrep* brep)
{
    static std::vector<SmBrep*> kept;
    kept.push_back(brep);
}

SmBrep* copy_faces(const SmBrep* brep, const std::vector<SmFace*>& faces)
{
    SmTArray<SmFace*> list;
    for (SmFace* f : faces)
        list.Add(f);
    SmBrep* out = new (ctx()) SmBrep();
    SmStatus st = const_cast<SmBrep*>(brep)->CopyFaces(list, out, nullptr, FALSE);
    if (st == SM_SUCCESS)
        return out;
    keep_forever(out);
    // CopyFaces builds each face again from its trimming curves, which fails for some
    // imported faces (bounded by B-spline edges that meet within the file's tolerance):
    // copy the whole body and delete the other faces, which keeps the edges as they are.
    SmCopyBrepMap map;  // original -> copy
    SmBrep* copy = new (ctx()) SmBrep(*brep, nullptr, &map, TRUE, FALSE);
    std::unordered_set<SmFace*> keep;
    for (SmFace* f : faces)
        keep.insert(static_cast<SmFace*>(map.GetAt(f)));
    SmTArray<SmFace*> all, drop;
    copy->GetFaces(all);
    for (ULONG i = 0; i < all.GetSize(); ++i)
        if (!keep.count(all[i]))
            drop.Add(all[i]);
    SmStatus removed;
    {
        SmTemporaryChangeValue<SmBoolean> editing(copy->m_bEditingEnabled, TRUE);
        removed = copy->RemoveFaces(drop);
    }
    if (removed != SM_SUCCESS)
    {
        keep_forever(copy);
        check(st, "SmBrep::CopyFaces");
    }
    return copy;
}

SmBrep* face_from_surface(const SmSurface* surface)
{
    SmSurface* copy = nullptr;
    check(surface->Copy(ctx(), copy), "SmSurface::Copy");
    SmBrep* out = new (ctx()) SmBrep();
    SmFace* face = nullptr;
    SmStatus st = out->CreateFaceFromSurface(copy, copy->GetNaturalUVDomain(), face);
    if (st != SM_SUCCESS)
    {
        if (copy->GetOwner() == nullptr)
            delete copy;
        delete out;
        check(st, "SmBrep::CreateFaceFromSurface");
    }
    return out;
}

SmBrep* combine(const std::vector<SmBrep*>& breps)
{
    SmBrep* out = new (ctx()) SmBrep();
    for (SmBrep* b : breps)
    {
        SmTArray<SmFace*> faces;
        b->GetFaces(faces);
        SmStatus st = b->CopyFaces(faces, out, nullptr, FALSE);
        // faces CopyFaces cannot build again (see copy_faces) go in as they are
        if (st != SM_SUCCESS && out->MergeBrep(*b, nullptr, nullptr, FALSE) == SM_SUCCESS)
            st = SM_SUCCESS;
        if (st != SM_SUCCESS)
        {
            keep_forever(out);
            check(st, "SmBrep::CopyFaces");
        }
    }
    return out;
}

std::vector<SmBrep*> separate_bodies(const SmBrep* brep)
{
    SmBrep* copy = new (ctx()) SmBrep(*brep, nullptr, nullptr, TRUE, FALSE);
    SmTArray<SmBrep*> parts;
    SmStatus st = SmBrep::CreateOneBrepPerBody(copy, parts, FALSE);
    if (st != SM_SUCCESS)
    {
        bool in_parts = false;
        for (ULONG i = 0; i < parts.GetSize(); ++i)
        {
            in_parts = in_parts || parts[i] == copy;
            delete parts[i];
        }
        if (copy && !in_parts)
            delete copy;
        check(st, "SmBrep::CreateOneBrepPerBody");
    }
    std::vector<SmBrep*> out;
    for (ULONG i = 0; i < parts.GetSize(); ++i)
        out.push_back(parts[i]);
    return out;
}

void delete_brep(SmBrep* brep) { delete brep; }

void delete_curve(SmCurve* curve)
{
    if (curve && curve->GetOwner() == nullptr)
        delete curve;
}

void delete_surface(SmSurface* surface)
{
    if (surface && surface->GetOwner() == nullptr)
        delete surface;
}

void delete_polybrep(SmPolyBrep* poly) { delete poly; }

SmCurve* copy_curve(const SmCurve* curve)
{
    SmCurve* out = nullptr;
    check(curve->Copy(ctx(), out), "SmCurve::Copy");
    return out;
}

SmCurve* trimmed_curve(const SmCurve* curve, double t0, double t1)
{
    SmCurve* out = nullptr;
    check(curve->Copy(ctx(), out), "SmCurve::Copy");
    SmExtent1d ivl(t0, t1);
    SmStatus st = out->Trim(ivl);
    if (st != SM_SUCCESS)
    {
        delete out;
        check(st, "SmCurve::Trim");
    }
    return out;
}

SmCurve* ellipse_arc(const SmCurve* curve, double start, double end)
{
    if (!curve || curve->GetType() != SmEllipse_TYPE)
        throw std::invalid_argument("expected an ellipse");
    if (!(start >= -360.0 && start < end && end <= 360.0 && end - start <= 360.0))
        throw std::invalid_argument("the angles must run upwards within [-360, 360], at most 360 apart");
    SmAxis2Placement a;
    double r1 = 0.0, r2 = 0.0;
    check(static_cast<const SmEllipse*>(curve)->GetCanonical(a, r1, r2), "SmEllipse::GetCanonical");
    // An ellipse's angles may run from -360 to 360, so an arc across angle 0 is one curve
    // (a trim of the whole ellipse cannot cross its start).
    SmExtent1d ivl(start, end);
    SmEllipse* out = nullptr;
    check(SmEllipse::CreateCanonical(ctx(), a, r1, r2, out, &ivl), "SmEllipse::CreateCanonical");
    return out;
}

SmCurve* edge_curve(const SmEdge* edge)
{
    SmCurve* out = nullptr;
    check(edge->GetCurve()->Copy(ctx(), out), "SmCurve::Copy");
    SmExtent1d ivl = edge->GetInterval();
    SmExtent1d nat = out->GetNaturalInterval();
    if (std::abs(ivl.GetMin() - nat.GetMin()) > 1e-12 || std::abs(ivl.GetMax() - nat.GetMax()) > 1e-12)
    {
        SmStatus st = out->Trim(ivl);
        if (st != SM_SUCCESS)
        {
            delete out;
            check(st, "SmCurve::Trim");
        }
    }
    return out;
}

std::pair<double, double> reverse_curve(SmCurve* curve)
{
    SmExtent1d reversed;
    check(curve->ReverseParameterization(curve->GetNaturalInterval(), reversed), "SmCurve::ReverseParameterization");
    return {reversed.GetMin(), reversed.GetMax()};
}

SmBSplineCurve* approximate_curve(const SmCurve* curve, double tolerance)
{
    SmTArray<double> breaks;
    SmExtent1d ivl = curve->GetNaturalInterval();
    breaks.Add(ivl.GetMin());
    breaks.Add(ivl.GetMax());
    double gap = 0.0;
    SmBSplineCurve* out = nullptr;
    check(curve->ApproximateCurve(ctx(), breaks, tolerance, gap, out, FALSE, TRUE), "SmCurve::ApproximateCurve");
    return out;
}

SmBSplineCurve* join_curves(const std::vector<SmCurve*>& curves)
{
    if (curves.empty())
        throw std::invalid_argument("join_curves: no curves");
    std::vector<std::unique_ptr<SmBSplineCurve>> approximated;
    SmTArray<SmBSplineCurve*> parts;
    for (SmCurve* c : curves)
    {
        if (!c)
            throw std::invalid_argument("curve is None");
        SmBSplineCurve* b = SM_CAST_PTR(SmBSplineCurve, c);
        if (!b)
        {
            approximated.emplace_back(approximate_curve(c, 1e-7));
            b = approximated.back().get();
        }
        parts.Add(b);
    }
    SmBSplineCurve* joined = nullptr;
    check(SmBSplineCurve::CreateByJoining(ctx(), parts, nullptr, joined), "SmBSplineCurve::CreateByJoining");
    return joined;
}

// Precise integration without the SM_API accuracy clamp ([1e-4, 1e-1] for faces): the kernel's
// error falls as the accuracy is tightened (usd-brep KNOWN_ISSUES, "Area, volume and mass
// properties of faces bounded by circles").
Value face_properties(const SmFace* face, double accuracy)
{
    SmExtent3d box;
    check(face->CalculateBoundingBox(box), "SmFace::CalculateBoundingBox");
    SmPoint3d origin = box.GetMid();
    SmVector3d size = box.GetSize();
    double extent = std::max(size.z, std::max(size.x, size.y));
    double area = 0.0, delta_volume = 0.0;
    SmTArray<SmVector3d> moments;
    check(face->ComputePreciseProperties(SM_OT_SAME, accuracy, origin, extent * extent / 100.0, 0.0, area,
                                         delta_volume, moments, SM_PPF_AREA | SM_PPF_AREA_FIRST_MOMENTS),
          "SmFace::ComputePreciseProperties");
    Value d = Value::dict();
    d.set("area", val(std::abs(area)));
    d.set("origin", xyz(origin));
    d.set("first_moments", xyz(moments[0]));
    d.set("signed_area", val(area));
    return d;
}

Value brep_properties(const SmBrep* brep, double accuracy, double density)
{
    SmExtent3d box;
    check(brep->CalculateBoundingBox(box), "SmBrep::CalculateBoundingBox");
    SmPoint3d origin = box.GetMid();
    SmMassPropertyBehavior behavior(density);
    double area = 0.0, volume = 0.0, mass = 0.0;
    SmTArray<SmVector3d> moments;
    check(brep->ComputePreciseProperties(accuracy, origin, behavior, area, volume, mass, moments),
          "SmBrep::ComputePreciseProperties");
    Value d = Value::dict();
    d.set("area", val(area));
    d.set("volume", val(volume));
    d.set("mass", val(mass));
    d.set("origin", xyz(origin));
    Value m8 = Value::make_list();
    for (ULONG i = 0; i < moments.GetSize(); ++i)
        m8.push(xyz(moments[i]));
    d.set("moments", m8);
    return d;
}

Value curve_eval(const SmCurve* curve, double t, int derivatives)
{
    if (derivatives < 0 || derivatives > 3)
        throw std::invalid_argument("derivatives must be 0..3");
    SmVector3d out[4];
    check(curve->Evaluate(t, static_cast<ULONG>(derivatives), TRUE, out, FALSE), "SmCurve::Evaluate");
    Value l = Value::make_list();
    for (int i = 0; i <= derivatives; ++i)
        l.push(xyz(out[i]));
    return l;
}

SmBrep* curve_sweep(const std::vector<SmCurve*>& profile, SmBSplineCurve* path, bool cap_ends, bool center,
                    bool orient, bool translational, SmBSplineCurve* scale_reference, SmBSplineCurve* scale_curve)
{
    SmTArray<SmCurve*> curves;
    for (SmCurve* c : profile)
        curves.Add(c);
    SmSweepOptions options;
    options.bCapEndsArg = cap_ends ? TRUE : FALSE;
    options.bMoveProfileCenterToPath = center ? TRUE : FALSE;
    options.bOrientProfilePerpendicularToPath = orient ? TRUE : FALSE;
    options.bTranslationalSweep = translational ? TRUE : FALSE;
    options.bMoveToProfile = FALSE;
    SmBrep* out = nullptr;
    check(SmApiCreateCurveSweep(curves, path, scale_reference, scale_curve, &options, out, nullptr, nullptr, nullptr),
          "SmApiCreateCurveSweep");
    return out;
}

std::string curve_kind(const SmCurve* curve) { return curve_kind_name(curve); }
std::string surface_kind(const SmSurface* surface) { return surface_kind_name(surface); }
std::string object_class(const SmObject* object) { return std::string(object->GetClassString()); }

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "py_value.h"

namespace {

template <typename T>
py::list owned_list(const std::vector<T*>& items, py::return_value_policy policy)
{
    py::list out;
    for (T* item : items)
        out.append(py::cast(item, policy));
    return out;
}

}  // namespace

void bind_smlibpy_ext(py::module_ m)
{
    bind_step_build(m);

    m.def("curve_data", [](const SmCurve* curve, bool nurbs) {
        return smlibpy::to_python(smlibpy::curve_data(curve, nurbs));
    }, py::arg("curve"), py::arg("nurbs") = true,
          "Exact definition of a curve: kind, NURBS data (degree, poles, knots, weights) and analytic "
          "parameters for lines, circles and ellipses.");
    m.def("surface_data", [](const SmSurface* surface, bool nurbs) {
        return smlibpy::to_python(smlibpy::surface_data(surface, nurbs));
    }, py::arg("surface"), py::arg("nurbs") = true,
          "Exact definition of a surface: kind, NURBS data and analytic parameters for planes, "
          "cylinders, cones, spheres and tori.");
    m.def("brep_dump", [](const SmBrep* brep, bool geometry) {
        return smlibpy::to_python(smlibpy::without_gil([&] { return smlibpy::brep_dump(brep, geometry); }));
    }, py::arg("brep"), py::arg("geometry") = true,
          "Topology (regions, shells, faces with both faceuses and their loops, edges, vertices) "
          "and optionally exact geometry of a Brep as plain Python data.");

    m.def("seam_edges", &smlibpy::seam_edges, py::arg("brep"), "Indices (in edge order) of the seam edges of a Brep.");
    m.def("face_indices", &smlibpy::face_indices);
    m.def("edge_indices", &smlibpy::edge_indices);
    m.def("vertex_indices", &smlibpy::vertex_indices);

    m.def("copy_with_map", [](const SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<SmEdge*>& edges,
                              const std::vector<SmVertex*>& vertices) {
        const smlibpy::CopyMap r = smlibpy::without_gil([&] { return smlibpy::copy_with_map(brep, faces, edges, vertices); });
        const auto ref = py::return_value_policy::reference;
        return py::make_tuple(py::cast(r.brep, py::return_value_policy::take_ownership), owned_list(r.faces, ref),
                              owned_list(r.edges, ref), owned_list(r.vertices, ref));
    }, py::arg("brep"), py::arg("faces") = std::vector<SmFace*>(),
          py::arg("edges") = std::vector<SmEdge*>(), py::arg("vertices") = std::vector<SmVertex*>(),
          "Copy a Brep and return (copy, faces, edges, vertices) with the given topology of the original "
          "mapped onto the copy.");

    m.def("transform_brep", &smlibpy::transform_brep, py::arg("brep"), py::arg("matrix"),
          "Apply a row-major 4x4 matrix to a Brep in place (rigid, scaling and mirroring).");
    m.def("boolean", [](SmBrep* brep1, SmBrep* brep2, SmBooleanOperationType operation, bool non_manifold,
                        bool imprinting) {
        return smlibpy::without_gil(
            [&] { return smlibpy::boolean(brep1, brep2, static_cast<int>(operation), non_manifold, imprinting); });
    }, py::arg("brep1"), py::arg("brep2"), py::arg("operation"), py::arg("non_manifold") = false,
          py::arg("imprinting") = false, py::return_value_policy::reference,
          "k.boolean (k.non_manifold_boolean with `non_manifold`, k.boolean_with_options(imprinting=True) with "
          "`imprinting`) that leaves the kernel as it was when it fails: on success the result is brep1, "
          "changed, and brep2 is deleted; on failure both stay the caller's. Where the faces cross along a curve "
          "tangent to a seam of a body of revolution, that body is turned about its axis first, on copies: then "
          "the result is a Brep of its own, and brep1 and brep2 are deleted.");
    m.def("classify_points", [](const SmBrep* brep, const std::vector<std::vector<double>>& points, double tolerance) {
        std::vector<double> flat;
        flat.reserve(points.size() * 3);
        for (const auto& p : points)
        {
            if (p.size() != 3)
                throw std::invalid_argument("expected points with three coordinates");
            flat.insert(flat.end(), p.begin(), p.end());
        }
        return smlibpy::to_python(smlibpy::without_gil([&] { return smlibpy::classify_points(brep, flat, tolerance); }));
    }, py::arg("brep"), py::arg("points"), py::arg("tolerance") = 0.0,
          "Where each point lies relative to a body (SmBrep::Point3DClassify), within `tolerance` (0: the "
          "body's own): per point (where, index, cell), `where` one of 'inside', 'outside', 'face', 'edge', "
          "'vertex'; `index` the face, edge or vertex in the Brep's order (-1 off the boundary); `cell` the "
          "closed region that is not a cavity holding the point, in region_shells order (-1 if none).");
    m.def("edge_angles", [](const SmBrep* brep, const std::vector<SmEdge*>& edges) {
        return smlibpy::to_python(smlibpy::edge_angles(brep, edges));
    }, py::arg("brep"), py::arg("edges"),
          "The outer angle of each edge of a body in degrees (SmEdge::CalcOuterAngle at the middle of the edge): "
          "above 180 at a convex edge, below at a concave one, 180 where the faces meet tangentially; None "
          "where the edge does not lie between two faces of a solid (a seam, an edge of a sheet, an inner edge "
          "of a merged part).");

    m.def("copy_faces", &smlibpy::copy_faces, py::arg("brep"), py::arg("faces"), py::return_value_policy::take_ownership,
          "Copy faces of a Brep into a new Brep (no merge, no stitching).");
    m.def("face_from_surface", &smlibpy::face_from_surface, py::arg("surface"), py::return_value_policy::take_ownership,
          "A sheet Brep with one face covering the whole (copied) surface.");
    m.def("combine", &smlibpy::combine, py::arg("breps"), py::return_value_policy::take_ownership,
          py::call_guard<smlibpy::NoGil>(),
          "Copy all faces of several Breps into one new Brep without Booleans (for disjoint bodies).");
    m.def("separate_bodies", [](const SmBrep* brep) {
        return owned_list(smlibpy::without_gil([&] { return smlibpy::separate_bodies(brep); }),
                          py::return_value_policy::take_ownership);
    }, py::arg("brep"), "Split a copy of a Brep into one Brep per connected body.");

    m.def("delete_brep", &smlibpy::delete_brep, py::arg("brep"), "Free a Brep. Every handle into it becomes invalid.");
    m.def("delete_curve", &smlibpy::delete_curve, py::arg("curve"),
          "Free a standalone curve (curves owned by a Brep are left alone).");
    m.def("delete_surface", &smlibpy::delete_surface, py::arg("surface"),
          "Free a standalone surface (surfaces owned by a Brep are left alone).");
    m.def("delete_polybrep", &smlibpy::delete_polybrep, py::arg("poly"), py::call_guard<smlibpy::NoGil>());

    m.def("copy_curve", &smlibpy::copy_curve, py::arg("curve"), py::return_value_policy::take_ownership,
          "Standalone copy of a curve (also of a curve owned by an edge).");
    m.def("trimmed_curve", &smlibpy::trimmed_curve, py::arg("curve"), py::arg("t0"), py::arg("t1"),
          py::return_value_policy::take_ownership, "Standalone copy of a curve restricted to [t0, t1].");
    m.def("ellipse_arc", &smlibpy::ellipse_arc, py::arg("ellipse"), py::arg("start"), py::arg("end"),
          py::return_value_policy::take_ownership,
          "Standalone copy of an ellipse over the ellipse angles [start, end] in degrees "
          "(-360 <= start < end <= 360, at most 360 apart).");
    m.def("edge_curve", &smlibpy::edge_curve, py::arg("edge"), py::return_value_policy::take_ownership,
          "Standalone copy of an edge's curve over the edge's interval.");
    m.def("reverse_curve", [](SmCurve* curve) {
        const auto r = smlibpy::reverse_curve(curve);
        return py::make_tuple(r.first, r.second);
    }, py::arg("curve"), "Reverse the direction of a standalone curve in place; returns the new interval.");
    m.def("join_curves", &smlibpy::join_curves, py::arg("curves"), py::return_value_policy::take_ownership,
          "Curves that each start where the one before ends, as one standalone B-spline curve "
          "(SmBSplineCurve::CreateByJoining); one that is not a B-spline (an ellipse) is approximated to 1e-7.");
    m.def("approximate_curve", &smlibpy::approximate_curve, py::arg("curve"), py::arg("tolerance") = 1e-7,
          py::return_value_policy::take_ownership, "NURBS approximation of any curve that keeps its parameterisation.");

    m.def("face_properties", [](const SmFace* face, double accuracy) {
        return smlibpy::to_python(smlibpy::face_properties(face, accuracy));
    }, py::arg("face"), py::arg("accuracy") = 1e-8);
    m.def("brep_properties", [](const SmBrep* brep, double accuracy, double density) {
        return smlibpy::to_python(smlibpy::without_gil([&] { return smlibpy::brep_properties(brep, accuracy, density); }));
    }, py::arg("brep"), py::arg("accuracy") = 1e-8, py::arg("density") = 1.0,
       "Area, volume, mass and moments (about the bounding box centre, see 'origin').");

    // curve_length and curve_parameter_at_length: measure.cpp (SmCurve::Length counts a span
    // whose curve starts with a zero tangent as 0).

    m.def("curve_eval", [](const SmCurve* curve, double t, int derivatives) {
        return smlibpy::to_python(smlibpy::curve_eval(curve, t, derivatives));
    }, py::arg("curve"), py::arg("t"), py::arg("derivatives") = 1,
       "Point and derivatives [p, dp/dt, d2p/dt2, ...] at parameter t.");

    m.def("curve_sweep", &smlibpy::curve_sweep, py::arg("profile"), py::arg("path"), py::arg("cap_ends") = true,
          py::arg("center") = true, py::arg("orient") = false, py::arg("translational") = false,
          py::arg("scale_reference") = nullptr, py::arg("scale_curve") = nullptr, py::return_value_policy::take_ownership,
          py::call_guard<smlibpy::NoGil>(),
          "Sweep profile curves along a path with all SmSweepOptions. Profile and path are copied, not consumed. "
          "With `center` the bounding-box centre of all profile curves travels along the path; otherwise the "
          "start point of the first curve does.");

    m.def("curve_kind", &smlibpy::curve_kind);
    m.def("surface_kind", &smlibpy::surface_kind);
    m.def("object_class", &smlibpy::object_class);
}
#endif  // SMLIBPY_PYTHON
