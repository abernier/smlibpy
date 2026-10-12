// SPDX-License-Identifier: Apache-2.0
//
// smlibpy additions to the upstream SmPyLib bindings (`smlibpy._core.ext`).
//
// The upstream bindings expose operations; smlibpy additionally needs
//   * exact geometry and topology as plain data (STEP export, geometry queries),
//   * explicit lifetime control of kernel objects (Python wrappers are non-owning),
//   * arbitrary 4x4 transforms, face extraction, body separation, topology-preserving copies.

#include "ext.h"

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

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(status, what, __FILE__, __LINE__);
}

// SmPoint3d is an alias of SmVector3d.
py::tuple xyz(const SmVector3d& v) { return py::make_tuple(v.x, v.y, v.z); }

py::dict placement(const SmAxis2Placement& a)
{
    py::dict d;
    SmVector3d x = a.GetXAxisRef();
    SmVector3d y = a.GetYAxisRef();
    SmVector3d z = x * y;  // operator* is the cross product for SmVector3d
    d["origin"] = xyz(a.GetOriginRef());
    d["x_dir"] = xyz(x);
    d["y_dir"] = xyz(y);
    d["z_dir"] = xyz(z);
    return d;
}

py::list knot_vector(const SmTArray<double>& unique, const SmTArray<ULONG>& mults)
{
    py::list knots;
    for (ULONG i = 0; i < unique.GetSize(); ++i)
        for (ULONG m = 0; m < mults[i]; ++m)
            knots.append(unique[i]);
    return knots;
}

template <typename T>
py::list to_list(const SmTArray<T>& a)
{
    py::list l;
    for (ULONG i = 0; i < a.GetSize(); ++i)
        l.append(a[i]);
    return l;
}

py::list points(const SmTArray<SmPoint3d>& a)
{
    py::list l;
    for (ULONG i = 0; i < a.GetSize(); ++i)
        l.append(xyz(a[i]));
    return l;
}

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

const char* curve_kind(const SmCurve* c)
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

void add_bspline_curve(py::dict& d, const SmBSplineCurve* c)
{
    ULONG dim = 0, degree = 0;
    SmTArray<SmPoint3d> poles;
    SmBSplineCurveForm form;
    SmTArray<ULONG> mults;
    SmTArray<double> knots, weights;
    SmKnotType knot_type;
    check(c->GetCanonical(dim, degree, poles, form, mults, knots, knot_type, weights), "SmBSplineCurve::GetCanonical");
    d["degree"] = degree;
    d["poles"] = points(poles);
    d["knots"] = knot_vector(knots, mults);
    d["weights"] = weights.GetSize() ? py::object(to_list(weights)) : py::object(py::none());
    d["dimension"] = dim;
}

py::dict curve_data(const SmCurve* curve, bool nurbs = true)
{
    if (!curve)
        throw std::invalid_argument("curve is None");
    py::dict d;
    const char* kind = curve_kind(curve);
    d["kind"] = kind;
    d["class"] = std::string(curve->GetClassString());
    SmExtent1d ivl = curve->GetNaturalInterval();
    d["interval"] = py::make_tuple(ivl.GetMin(), ivl.GetMax());

    if (curve->GetType() == SmLine_TYPE)
    {
        auto line = static_cast<const SmLine*>(curve);
        SmPoint3d p;
        SmVector3d v;
        SmExtent1d dom;
        SmBoolean inside_out = FALSE;
        check(line->GetCanonical(p, v, &dom, &inside_out), "SmLine::GetCanonical");
        d["origin"] = xyz(p);
        d["direction"] = xyz(v);
    }
    else if (curve->GetType() == SmCircle_TYPE)
    {
        auto circle = static_cast<const SmCircle*>(curve);
        SmAxis2Placement a;
        double r = 0.0;
        SmBoolean inside_out = FALSE;
        check(circle->GetCanonical(a, r, &inside_out), "SmCircle::GetCanonical");
        d["placement"] = placement(a);
        d["radius"] = r;
    }
    else if (curve->GetType() == SmEllipse_TYPE)
    {
        auto ellipse = static_cast<const SmEllipse*>(curve);
        SmAxis2Placement a;
        double r1 = 0.0, r2 = 0.0;
        SmExtent1d dom;
        SmBoolean inside_out = FALSE;
        check(ellipse->GetCanonical(a, r1, r2, &dom, &inside_out), "SmEllipse::GetCanonical");
        d["placement"] = placement(a);
        d["radius1"] = r1;
        d["radius2"] = r2;
    }

    if (!nurbs)
        return d;
    if (curve->IsKindOf(SmBSplineCurve_TYPE))
    {
        add_bspline_curve(d, static_cast<const SmBSplineCurve*>(curve));
        d["approximated"] = false;
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
        d["approximated"] = true;
        d["approximation_gap"] = gap;
        delete approx;
    }
    return d;
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

const char* surface_kind(const SmSurface* s)
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

void add_bspline_surface(py::dict& d, const SmBSplineSurface* s)
{
    ULONG udeg = 0, vdeg = 0;
    SmTArray<SmPoint3d> poles;
    SmBSplineSurfaceForm form;
    SmTArray<ULONG> umults, vmults;
    SmTArray<double> uknots, vknots, weights;
    SmKnotType knot_type;
    check(s->GetCanonical(udeg, vdeg, poles, form, umults, vmults, uknots, vknots, knot_type, weights),
          "SmBSplineSurface::GetCanonical");
    d["u_degree"] = udeg;
    d["v_degree"] = vdeg;
    d["poles"] = points(poles);
    d["u_knots"] = knot_vector(uknots, umults);
    d["v_knots"] = knot_vector(vknots, vmults);
    d["weights"] = weights.GetSize() ? py::object(to_list(weights)) : py::object(py::none());
}

py::dict surface_data(const SmSurface* surface, bool nurbs = true)
{
    if (!surface)
        throw std::invalid_argument("surface is None");
    py::dict d;
    d["kind"] = surface_kind(surface);
    d["class"] = std::string(surface->GetClassString());
    SmExtent2d dom = surface->GetNaturalUVDomain();
    d["uv_domain"] = py::make_tuple(py::make_tuple(dom.GetMin().x, dom.GetMin().y),
                                    py::make_tuple(dom.GetMax().x, dom.GetMax().y));
    SmBoolean inside_out = FALSE, swap_uv = FALSE;
    switch (surface->GetType())
    {
    case SmPlane_TYPE:
    {
        SmAxis2Placement a;
        check(static_cast<const SmPlane*>(surface)->GetCanonical(a), "SmPlane::GetCanonical");
        d["placement"] = placement(a);
        break;
    }
    case SmCylinder_TYPE:
    {
        SmAxis2Placement a;
        double r = 0.0;
        check(static_cast<const SmCylinder*>(surface)->GetCanonical(a, r), "SmCylinder::GetCanonical");
        d["placement"] = placement(a);
        d["radius"] = r;
        d["inside_out"] = static_cast<bool>(static_cast<const SmCylinder*>(surface)->GetInsideOut());
        break;
    }
    case SmCone_TYPE:
    {
        SmAxis2Placement a;
        double r = 0.0, semi = 0.0;
        check(static_cast<const SmCone*>(surface)->GetCanonical(a, r, semi, &swap_uv, &inside_out),
              "SmCone::GetCanonical");
        d["placement"] = placement(a);
        d["radius"] = r;
        d["semi_angle_deg"] = semi;
        d["inside_out"] = static_cast<bool>(inside_out);
        break;
    }
    case SmSphere_TYPE:
    {
        SmAxis2Placement a;
        double r = 0.0;
        check(static_cast<const SmSphere*>(surface)->GetCanonical(a, r, &swap_uv, &inside_out),
              "SmSphere::GetCanonical");
        d["placement"] = placement(a);
        d["radius"] = r;
        d["inside_out"] = static_cast<bool>(inside_out);
        break;
    }
    case SmTorus_TYPE:
    {
        SmAxis2Placement a;
        double R = 0.0, r = 0.0;
        check(static_cast<const SmTorus*>(surface)->GetCanonical(a, R, r, &swap_uv, &inside_out),
              "SmTorus::GetCanonical");
        d["placement"] = placement(a);
        d["major_radius"] = R;
        d["minor_radius"] = r;
        d["inside_out"] = static_cast<bool>(inside_out);
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
py::dict brep_dump(const SmBrep* brep, bool geometry)
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

    py::list vlist;
    for (ULONG i = 0; i < vertices.GetSize(); ++i)
        vlist.append(xyz(vertices[i]->GetPoint()));

    py::list elist;
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        SmEdge* e = edges[i];
        py::dict ed;
        SmExtent1d ivl = e->GetInterval();
        ed["interval"] = py::make_tuple(ivl.GetMin(), ivl.GetMax());
        SmVertex* v0 = e->GetStartVertex();
        SmVertex* v1 = e->GetEndVertex();
        ed["v0"] = v0 ? py::object(py::int_(vidx.at(v0))) : py::object(py::none());
        ed["v1"] = v1 ? py::object(py::int_(vidx.at(v1))) : py::object(py::none());
        if (geometry)
            ed["curve"] = curve_data(e->GetCurve(), true);
        else
            ed["kind"] = curve_kind(e->GetCurve());
        elist.append(ed);
    }

    // Shells are reached through regions; number them in region order.
    std::unordered_map<const SmShell*, size_t> sidx;
    py::list rlist, slist;
    for (ULONG r = 0; r < regions.GetSize(); ++r)
    {
        SmRegion* region = regions[r];
        SmTArray<SmShell*> shells;
        region->GetShells(shells);
        py::list shell_ids;
        for (ULONG s = 0; s < shells.GetSize(); ++s)
        {
            size_t id = sidx.size();
            sidx[shells[s]] = id;
            shell_ids.append(id);
            py::dict sd;
            sd["region"] = r;
            sd["closed"] = static_cast<bool>(shells[s]->IsClosed());
            slist.append(sd);
        }
        py::dict rd;
        rd["infinite"] = region == brep->GetInfiniteRegion();
        rd["void"] = region->IsVoid() == TRUE;
        rd["shells"] = shell_ids;
        rlist.append(rd);
    }

    auto loops_of = [&](const SmFaceuse* fu) {
        py::list loops;
        SmTArray<SmLoopuse*> lus;
        fu->GetLoopuses(lus);
        for (ULONG l = 0; l < lus.GetSize(); ++l)
        {
            SmLoopuse* lu = lus[l];
            py::dict ld;
            if (lu->IsVertexLoopuse())
            {
                SmVertexuse* vu = lu->GetVertexuse();
                ld["vertex"] = vu ? py::object(py::int_(vidx.at(vu->GetVertex()))) : py::object(py::none());
                ld["edges"] = py::list();
            }
            else
            {
                SmTArray<SmEdgeuse*> eus;
                lu->GetEdgeuses(eus);
                py::list items;
                for (ULONG k = 0; k < eus.GetSize(); ++k)
                    items.append(py::make_tuple(eidx.at(eus[k]->GetEdge()), eus[k]->GetOrientation() == SM_OT_SAME));
                ld["edges"] = items;
                ld["vertex"] = py::none();
            }
            ld["outer"] = l == 0;
            loops.append(ld);
        }
        return loops;
    };

    py::list flist;
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        SmFace* f = faces[i];
        SmFaceuse* up = f->GetUpwardFaceuse();
        SmFaceuse* down = up ? up->GetMate() : nullptr;
        py::dict fd;
        SmExtent2d dom = f->GetUVDomain();
        fd["uv_domain"] = py::make_tuple(py::make_tuple(dom.GetMin().x, dom.GetMin().y),
                                         py::make_tuple(dom.GetMax().x, dom.GetMax().y));
        if (geometry)
            fd["surface"] = surface_data(f->GetSurface(), true);
        else
            fd["kind"] = surface_kind(f->GetSurface());
        py::list uses;
        for (SmFaceuse* fu : {up, down})
        {
            py::dict ud;
            if (!fu)
            {
                uses.append(py::none());
                continue;
            }
            ud["same"] = fu->GetOrientation() == SM_OT_SAME;
            auto it = sidx.find(fu->GetShell());
            ud["shell"] = it == sidx.end() ? py::object(py::none()) : py::object(py::int_(it->second));
            ud["loops"] = loops_of(fu);
            uses.append(ud);
        }
        fd["uses"] = uses;  // [upward (SAME) faceuse, its mate]
        flist.append(fd);
    }

    py::dict out;
    out["vertices"] = vlist;
    out["edges"] = elist;
    out["faces"] = flist;
    out["shells"] = slist;
    out["regions"] = rlist;
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

// Copy a Brep and map the given topology of the original onto the copy.
py::tuple copy_with_map(const SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<SmEdge*>& edges,
                        const std::vector<SmVertex*>& vertices)
{
    SmCopyBrepMap reverse;  // original -> copy
    SmBrep* copy = new (ctx()) SmBrep(*brep, nullptr, &reverse, TRUE, FALSE);
    py::list f, e, v;
    for (SmFace* x : faces)
        f.append(py::cast(static_cast<SmFace*>(reverse.GetAt(x)), py::return_value_policy::reference));
    for (SmEdge* x : edges)
        e.append(py::cast(static_cast<SmEdge*>(reverse.GetAt(x)), py::return_value_policy::reference));
    for (SmVertex* x : vertices)
        v.append(py::cast(static_cast<SmVertex*>(reverse.GetAt(x)), py::return_value_policy::reference));
    return py::make_tuple(py::cast(copy, py::return_value_policy::take_ownership), f, e, v);
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

}  // namespace

void bind_smlibpy_ext(py::module_ m)
{
    bind_step_build(m);

    m.def("curve_data", &curve_data, py::arg("curve"), py::arg("nurbs") = true,
          "Exact definition of a curve: kind, NURBS data (degree, poles, knots, weights) and analytic "
          "parameters for lines, circles and ellipses.");
    m.def("surface_data", &surface_data, py::arg("surface"), py::arg("nurbs") = true,
          "Exact definition of a surface: kind, NURBS data and analytic parameters for planes, "
          "cylinders, cones, spheres and tori.");
    m.def("brep_dump", &brep_dump, py::arg("brep"), py::arg("geometry") = true,
          "Topology (regions, shells, faces with both faceuses and their loops, edges, vertices) "
          "and optionally exact geometry of a Brep as plain Python data.");

    m.def("seam_edges", [](const SmBrep* brep) {
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
    }, py::arg("brep"), "Indices (in edge order) of the seam edges of a Brep.");

    m.def("face_indices", [](const SmBrep* brep, const std::vector<SmFace*>& faces) {
        SmTArray<SmFace*> all;
        brep->GetFaces(all);
        return indices_in(all, faces);
    });
    m.def("edge_indices", [](const SmBrep* brep, const std::vector<SmEdge*>& edges) {
        SmTArray<SmEdge*> all;
        brep->GetEdges(all);
        return indices_in(all, edges);
    });
    m.def("vertex_indices", [](const SmBrep* brep, const std::vector<SmVertex*>& vertices) {
        SmTArray<SmVertex*> all;
        brep->GetVertices(all);
        return indices_in(all, vertices);
    });

    m.def("copy_with_map", &copy_with_map, py::arg("brep"), py::arg("faces") = std::vector<SmFace*>(),
          py::arg("edges") = std::vector<SmEdge*>(), py::arg("vertices") = std::vector<SmVertex*>(),
          "Copy a Brep and return (copy, faces, edges, vertices) with the given topology of the original "
          "mapped onto the copy.");

    m.def("transform_brep", &transform_brep, py::arg("brep"), py::arg("matrix"),
          "Apply a row-major 4x4 matrix to a Brep in place (rigid, scaling and mirroring).");

    m.def("copy_faces", [](const SmBrep* brep, const std::vector<SmFace*>& faces) {
        SmTArray<SmFace*> list;
        for (SmFace* f : faces)
            list.Add(f);
        SmBrep* out = new (ctx()) SmBrep();
        SmStatus st = const_cast<SmBrep*>(brep)->CopyFaces(list, out, nullptr, FALSE);
        if (st != SM_SUCCESS)
        {
            delete out;
            check(st, "SmBrep::CopyFaces");
        }
        return out;
    }, py::arg("brep"), py::arg("faces"), py::return_value_policy::take_ownership,
       "Copy faces of a Brep into a new Brep (no merge, no stitching).");

    m.def("face_from_surface", [](const SmSurface* surface) {
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
    }, py::arg("surface"), py::return_value_policy::take_ownership,
       "A sheet Brep with one face covering the whole (copied) surface.");

    m.def("combine", [](const std::vector<SmBrep*>& breps) {
        SmBrep* out = new (ctx()) SmBrep();
        for (SmBrep* b : breps)
        {
            SmTArray<SmFace*> faces;
            b->GetFaces(faces);
            SmStatus st = b->CopyFaces(faces, out, nullptr, FALSE);
            if (st != SM_SUCCESS)
            {
                delete out;
                check(st, "SmBrep::CopyFaces");
            }
        }
        return out;
    }, py::arg("breps"), py::return_value_policy::take_ownership,
       "Copy all faces of several Breps into one new Brep without Booleans (for disjoint bodies).");

    m.def("separate_bodies", [](const SmBrep* brep) {
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
        py::list out;
        for (ULONG i = 0; i < parts.GetSize(); ++i)
            out.append(py::cast(parts[i], py::return_value_policy::take_ownership));
        return out;
    }, py::arg("brep"), "Split a copy of a Brep into one Brep per connected body.");

    m.def("delete_brep", [](SmBrep* brep) { delete brep; }, py::arg("brep"),
          "Free a Brep. Every handle into it becomes invalid.");
    m.def("delete_curve", [](SmCurve* curve) {
        if (curve && curve->GetOwner() == nullptr)
            delete curve;
    }, py::arg("curve"), "Free a standalone curve (curves owned by a Brep are left alone).");
    m.def("delete_surface", [](SmSurface* surface) {
        if (surface && surface->GetOwner() == nullptr)
            delete surface;
    }, py::arg("surface"), "Free a standalone surface (surfaces owned by a Brep are left alone).");
    m.def("delete_polybrep", [](SmPolyBrep* poly) { delete poly; }, py::arg("poly"));

    m.def("copy_curve", [](const SmCurve* curve) {
        SmCurve* out = nullptr;
        check(curve->Copy(ctx(), out), "SmCurve::Copy");
        return out;
    }, py::arg("curve"), py::return_value_policy::take_ownership,
       "Standalone copy of a curve (also of a curve owned by an edge).");

    m.def("trimmed_curve", [](const SmCurve* curve, double t0, double t1) {
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
    }, py::arg("curve"), py::arg("t0"), py::arg("t1"), py::return_value_policy::take_ownership,
       "Standalone copy of a curve restricted to [t0, t1].");

    m.def("edge_curve", [](const SmEdge* edge) {
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
    }, py::arg("edge"), py::return_value_policy::take_ownership,
       "Standalone copy of an edge's curve over the edge's interval.");

    m.def("reverse_curve", [](SmCurve* curve) {
        SmExtent1d reversed;
        check(curve->ReverseParameterization(curve->GetNaturalInterval(), reversed), "SmCurve::ReverseParameterization");
        return py::make_tuple(reversed.GetMin(), reversed.GetMax());
    }, py::arg("curve"), "Reverse the direction of a standalone curve in place; returns the new interval.");

    m.def("approximate_curve", [](const SmCurve* curve, double tolerance) {
        SmTArray<double> breaks;
        SmExtent1d ivl = curve->GetNaturalInterval();
        breaks.Add(ivl.GetMin());
        breaks.Add(ivl.GetMax());
        double gap = 0.0;
        SmBSplineCurve* out = nullptr;
        check(curve->ApproximateCurve(ctx(), breaks, tolerance, gap, out, FALSE, TRUE), "SmCurve::ApproximateCurve");
        return out;
    }, py::arg("curve"), py::arg("tolerance") = 1e-7, py::return_value_policy::take_ownership,
       "NURBS approximation of any curve that keeps its parameterisation.");

    // Precise integration without the SM_API accuracy clamp ([1e-4, 1e-1] for faces): the
    // kernel's error falls as the accuracy is tightened (usd-brep KNOWN_ISSUES, "Area, volume
    // and mass properties of faces bounded by circles").
    m.def("face_properties", [](const SmFace* face, double accuracy) {
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
        py::dict d;
        d["area"] = std::abs(area);
        d["origin"] = xyz(origin);
        d["first_moments"] = xyz(moments[0]);
        d["signed_area"] = area;
        return d;
    }, py::arg("face"), py::arg("accuracy") = 1e-8);

    m.def("brep_properties", [](const SmBrep* brep, double accuracy, double density) {
        SmExtent3d box;
        check(brep->CalculateBoundingBox(box), "SmBrep::CalculateBoundingBox");
        SmPoint3d origin = box.GetMid();
        SmMassPropertyBehavior behavior(density);
        double area = 0.0, volume = 0.0, mass = 0.0;
        SmTArray<SmVector3d> moments;
        check(brep->ComputePreciseProperties(accuracy, origin, behavior, area, volume, mass, moments),
              "SmBrep::ComputePreciseProperties");
        py::dict d;
        d["area"] = area;
        d["volume"] = volume;
        d["mass"] = mass;
        d["origin"] = xyz(origin);
        py::list m8;
        for (ULONG i = 0; i < moments.GetSize(); ++i)
            m8.append(xyz(moments[i]));
        d["moments"] = m8;
        return d;
    }, py::arg("brep"), py::arg("accuracy") = 1e-8, py::arg("density") = 1.0,
       "Area, volume, mass and moments (about the bounding box centre, see 'origin').");

    m.def("curve_length", [](const SmCurve* curve, double t0, double t1, double accuracy) {
        double length = 0.0;
        check(curve->Length(SmExtent1d(std::min(t0, t1), std::max(t0, t1)), accuracy, length), "SmCurve::Length");
        return length;
    }, py::arg("curve"), py::arg("t0"), py::arg("t1"), py::arg("accuracy") = 1e-9);

    m.def("curve_parameter_at_length", [](const SmCurve* curve, double t_start, double length) {
        double t = 0.0;
        SmBoolean past_end = FALSE;
        check(curve->FindParameterAtArcLength(t_start, length, t, &past_end), "SmCurve::FindParameterAtArcLength");
        return py::make_tuple(t, static_cast<bool>(past_end));
    }, py::arg("curve"), py::arg("t_start"), py::arg("length"),
       "Parameter at signed arc length `length` from `t_start`; returns (t, past_end).");

    m.def("curve_eval", [](const SmCurve* curve, double t, int derivatives) {
        if (derivatives < 0 || derivatives > 3)
            throw std::invalid_argument("derivatives must be 0..3");
        SmVector3d out[4];
        check(curve->Evaluate(t, static_cast<ULONG>(derivatives), TRUE, out, FALSE), "SmCurve::Evaluate");
        py::list l;
        for (int i = 0; i <= derivatives; ++i)
            l.append(xyz(out[i]));
        return l;
    }, py::arg("curve"), py::arg("t"), py::arg("derivatives") = 1,
       "Point and derivatives [p, dp/dt, d2p/dt2, ...] at parameter t.");

    m.def("curve_sweep", [](const std::vector<SmCurve*>& profile, SmBSplineCurve* path, bool cap_ends, bool center,
                            bool orient, bool translational, SmBSplineCurve* scale_reference, SmBSplineCurve* scale_curve) {
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
        check(SmApiCreateCurveSweep(curves, path, scale_reference, scale_curve, &options, out, nullptr, nullptr, nullptr), "SmApiCreateCurveSweep");
        return out;
    }, py::arg("profile"), py::arg("path"), py::arg("cap_ends") = true, py::arg("center") = true,
       py::arg("orient") = false, py::arg("translational") = false, py::arg("scale_reference") = nullptr,
       py::arg("scale_curve") = nullptr, py::return_value_policy::take_ownership,
       "Sweep profile curves along a path with all SmSweepOptions. Profile and path are copied, not consumed. "
       "With `center` the bounding-box centre of all profile curves travels along the path; otherwise the "
       "start point of the first curve does.");

    m.def("curve_kind", [](const SmCurve* c) { return std::string(curve_kind(c)); });
    m.def("surface_kind", [](const SmSurface* s) { return std::string(surface_kind(s)); });
    m.def("object_class", [](const SmObject* o) { return std::string(o->GetClassString()); });
}
