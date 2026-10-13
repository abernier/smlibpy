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

#include <SmApiGeneral.h>
#include <SmCopyBrepMap.h>
#include <SmPlane.h>
#include <SmCone.h>
#include <SmCylinder.h>
#include <SmSphere.h>
#include <SmTorus.h>
#include <SmSurfOfRevolution.h>
#include <SmSurfOfExtrusion.h>
#include <SmLine.h>
#include <SmCircle.h>
#include <SmEllipse.h>
#include <SmPrimitiveCreation.h>
#include <SmApiBrep.h>

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

void transform_brep(SmBrep* brep, const std::vector<double>& m)
{
    if (m.size() != 16)
        throw std::invalid_argument("expected a row-major 4x4 matrix (16 values)");
    double t[4][4];
    for (int r = 0; r < 4; ++r)
        for (int c = 0; c < 4; ++c)
            t[r][c] = m[r * 4 + c];
    check(brep->Transform(t, TRUE), "SmBrep::Transform");
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
    delete out;
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
        delete copy;
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
            delete out;
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
        return smlibpy::to_python(smlibpy::brep_dump(brep, geometry));
    }, py::arg("brep"), py::arg("geometry") = true,
          "Topology (regions, shells, faces with both faceuses and their loops, edges, vertices) "
          "and optionally exact geometry of a Brep as plain Python data.");

    m.def("seam_edges", &smlibpy::seam_edges, py::arg("brep"), "Indices (in edge order) of the seam edges of a Brep.");
    m.def("face_indices", &smlibpy::face_indices);
    m.def("edge_indices", &smlibpy::edge_indices);
    m.def("vertex_indices", &smlibpy::vertex_indices);

    m.def("copy_with_map", [](const SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<SmEdge*>& edges,
                              const std::vector<SmVertex*>& vertices) {
        const smlibpy::CopyMap r = smlibpy::copy_with_map(brep, faces, edges, vertices);
        const auto ref = py::return_value_policy::reference;
        return py::make_tuple(py::cast(r.brep, py::return_value_policy::take_ownership), owned_list(r.faces, ref),
                              owned_list(r.edges, ref), owned_list(r.vertices, ref));
    }, py::arg("brep"), py::arg("faces") = std::vector<SmFace*>(),
          py::arg("edges") = std::vector<SmEdge*>(), py::arg("vertices") = std::vector<SmVertex*>(),
          "Copy a Brep and return (copy, faces, edges, vertices) with the given topology of the original "
          "mapped onto the copy.");

    m.def("transform_brep", &smlibpy::transform_brep, py::arg("brep"), py::arg("matrix"),
          "Apply a row-major 4x4 matrix to a Brep in place (rigid, scaling and mirroring).");

    m.def("copy_faces", &smlibpy::copy_faces, py::arg("brep"), py::arg("faces"), py::return_value_policy::take_ownership,
          "Copy faces of a Brep into a new Brep (no merge, no stitching).");
    m.def("face_from_surface", &smlibpy::face_from_surface, py::arg("surface"), py::return_value_policy::take_ownership,
          "A sheet Brep with one face covering the whole (copied) surface.");
    m.def("combine", &smlibpy::combine, py::arg("breps"), py::return_value_policy::take_ownership,
          "Copy all faces of several Breps into one new Brep without Booleans (for disjoint bodies).");
    m.def("separate_bodies", [](const SmBrep* brep) {
        return owned_list(smlibpy::separate_bodies(brep), py::return_value_policy::take_ownership);
    }, py::arg("brep"), "Split a copy of a Brep into one Brep per connected body.");

    m.def("delete_brep", &smlibpy::delete_brep, py::arg("brep"), "Free a Brep. Every handle into it becomes invalid.");
    m.def("delete_curve", &smlibpy::delete_curve, py::arg("curve"),
          "Free a standalone curve (curves owned by a Brep are left alone).");
    m.def("delete_surface", &smlibpy::delete_surface, py::arg("surface"),
          "Free a standalone surface (surfaces owned by a Brep are left alone).");
    m.def("delete_polybrep", &smlibpy::delete_polybrep, py::arg("poly"));

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
    m.def("approximate_curve", &smlibpy::approximate_curve, py::arg("curve"), py::arg("tolerance") = 1e-7,
          py::return_value_policy::take_ownership, "NURBS approximation of any curve that keeps its parameterisation.");

    m.def("face_properties", [](const SmFace* face, double accuracy) {
        return smlibpy::to_python(smlibpy::face_properties(face, accuracy));
    }, py::arg("face"), py::arg("accuracy") = 1e-8);
    m.def("brep_properties", [](const SmBrep* brep, double accuracy, double density) {
        return smlibpy::to_python(smlibpy::brep_properties(brep, accuracy, density));
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
          "Sweep profile curves along a path with all SmSweepOptions. Profile and path are copied, not consumed. "
          "With `center` the bounding-box centre of all profile curves travels along the path; otherwise the "
          "start point of the first curve does.");

    m.def("curve_kind", &smlibpy::curve_kind);
    m.def("surface_kind", &smlibpy::surface_kind);
    m.def("object_class", &smlibpy::object_class);
}
#endif  // SMLIBPY_PYTHON
