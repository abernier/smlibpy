// SPDX-License-Identifier: Apache-2.0
//
// What is wrong with a body, as the kernel's own checks name it (`smlibpy._core.ext`, kernel plan
// T4):
//
//   check_brep(brep, level)   the failed tests of SmBrep::AssertValid, each with the face, edge or
//                             vertex it is about
//   tolerance_gaps(brep)      the largest gaps between vertices, edges and faces, and where
//   edge_tolerance(edge), vertex_tolerance(vertex)
//
// SmBrep::AssertValid is compiled into release builds (only the sm_AssertValid wrapper is a debug
// stub; SmPyDevLib's assert_valid calls it the same way). It runs ValidatePointers, then
// ValidateAndUpdateTolerances with bValidateOnly = TRUE (the gaps between edges, vertices and the
// faces' trim curves against the tolerances, nothing changed), then the tests of every face, loop,
// edge and vertex: at level 0 the structure, at 1 also the geometry, at 2 all, the slow ones too.
// It names the object each failed test is about, the test, a message, the value and the tolerance.
// On generated parts it finds nothing (0.7 to 15 ms); on an imported valve body that smlibpy took
// for valid, 34 failures at level 0 (loops whose vertices do not connect, missing seams, gaps of
// 3.2e-5 for a tolerance of 2.6e-5). It does not see a body that runs through itself.

#include "kernel.h"
#include "check.h"
#include "ext_shared.h"

#include <cmath>
#include <limits>
#include <string>
#include <unordered_map>

namespace
{

using smlibpy::Value;
template <typename T>
Value val(const T& x) { return smlibpy::v(x); }

template <typename T>
std::unordered_map<const void*, long> index_map(const SmTArray<T*>& items)
{
    std::unordered_map<const void*, long> out;
    for (ULONG i = 0; i < items.GetSize(); ++i)
        out.emplace(items[i], static_cast<long>(i));
    return out;
}

struct Indices
{
    std::unordered_map<const void*, long> faces, edges, vertices;
};

// The face, edge or vertex a report's object is about: an edgeuse is its edge's, a vertexuse its
// vertex's, a loop, loopuse or faceuse its face's, a curve or surface its owner's; a shell, region
// or the Brep the body's.
std::pair<std::string, long> entity(const SmObject* object, const Indices& at)
{
    for (int depth = 0; object && depth < 6; ++depth)
    {
        const SM_TYPE type = object->GetType();
        auto find = [&](const std::unordered_map<const void*, long>& m, const char* kind) {
            auto it = m.find(object);
            return it == m.end() ? std::pair<std::string, long>("body", -1L) : std::pair<std::string, long>(kind, it->second);
        };
        if (object->IsKindOf(SmFace_TYPE))
            return find(at.faces, "face");
        if (object->IsKindOf(SmEdge_TYPE))
            return find(at.edges, "edge");
        if (object->IsKindOf(SmVertex_TYPE))
            return find(at.vertices, "vertex");
        if (type == SmEdgeuse_TYPE)
            object = static_cast<const SmEdgeuse*>(object)->GetEdge();
        else if (type == SmVertexuse_TYPE)
            object = static_cast<const SmVertexuse*>(object)->GetVertex();
        else if (type == SmLoopuse_TYPE)
            object = static_cast<const SmLoopuse*>(object)->GetLoop();
        else if (type == SmLoop_TYPE)
        {
            const SmLoop* loop = static_cast<const SmLoop*>(object);
            object = loop->GetLoopuse() && loop->GetLoopuse()->GetFaceuse() ? loop->GetFace() : nullptr;
        }
        else if (type == SmFaceuse_TYPE)
            object = static_cast<const SmFaceuse*>(object)->GetFace();
        else if (object->IsKindOf(SmCurve_TYPE))
            object = static_cast<const SmCurve*>(object)->GetOwner();
        else if (object->IsKindOf(SmSurface_TYPE))
            object = static_cast<const SmSurface*>(object)->GetOwner();
        else
            break;
    }
    return {"body", -1L};
}

Value number_or_none(double x)
{
    if (x == SM_UNDEF_DOUBLE || !std::isfinite(x))
        return Value();
    return val(x);
}

std::string category(const SmAssertReport& report)
{
    std::string s = smos_FromTChar(report.GetAssertTypeString());
    s.erase(s.find_last_not_of(' ') + 1);
    if (s.rfind("SM_AT_", 0) == 0)
        s = s.substr(6);
    for (char& c : s)
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

SmAssertTestLevel test_level(int level)
{
    switch (level)
    {
    case 0:
        return SM_LEVEL_0;
    case 1:
        return SM_LEVEL_1;
    case 2:
        return SM_LEVEL_2;
    default:
        throw std::invalid_argument("level must be 0, 1 or 2");
    }
}

Indices indices_of(const SmBrep* brep)
{
    SmTArray<SmFace*> faces;
    SmTArray<SmEdge*> edges;
    SmTArray<SmVertex*> vertices;
    brep->GetFaces(faces);
    brep->GetEdges(edges);
    brep->GetVertices(vertices);
    return {index_map(faces), index_map(edges), index_map(vertices)};
}

long index_in(const std::unordered_map<const void*, long>& m, const void* object)
{
    auto it = m.find(object);
    return it == m.end() ? -1L : it->second;
}

}  // namespace

namespace smlibpy {

Value check_brep(const SmBrep* brep, int level)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    const SmAssertTestLevel lvl = test_level(level);
    const Indices at = indices_of(brep);
    SmAssertArray failures;
    brep->AssertValid(&failures, lvl, SM_WALK, nullptr);
    SmPyErrorTrail::clear();  // (the failed tests leave kernel errors behind, for no later error to report)
    Value out = Value::make_list();
    for (ULONG i = 0; i < failures.GetSize(); ++i)
    {
        const SmAssertReport* r = failures.GetAt(i);
        if (!r || r->m_bOK)
            continue;
        Value d = Value::dict();
        d.set("category", val(category(*r)));
        d.set("test", val(std::string(r->m_pName ? smos_FromTChar(r->m_pName) : "")));
        TCHAR message[SM_TBLOCK_SIZE];
        r->FormatLogMessage(message, SM_TBLOCK_SIZE);
        d.set("message", val(std::string(smos_FromTChar(message))));
        const auto owner = entity(r->GetOwnerObject(), at);
        d.set("kind", val(owner.first));
        d.set("index", val(owner.second));
        if (const SmObject* other = r->GetOtherObject())
        {
            const auto o = entity(other, at);
            d.set("other_kind", val(o.first));
            d.set("other_index", val(o.second));
        }
        else
        {
            d.set("other_kind", Value());
            d.set("other_index", val(-1L));
        }
        d.set("value", number_or_none(r->GetValue()));
        d.set("tolerance", number_or_none(r->GetTol3d().val));
        out.push(d);
    }
    return out;
}

Value tolerance_gaps(const SmBrep* brep)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    SmBoolean violated = FALSE;
    double edge_trim = 0.0, vertex_edge = 0.0, vertex_face = 0.0, edge_face = 0.0, vertex_trim = 0.0;
    SmEdgeuse *edge_trim_at = nullptr, *edge_face_at = nullptr, *vertex_trim_at = nullptr;
    SmVertexuse *vertex_edge_at = nullptr, *vertex_face_at = nullptr;
    const SmStatus st = const_cast<SmBrep*>(brep)->ValidateAndUpdateTolerances(
        TRUE, violated, edge_trim, vertex_edge, vertex_face, nullptr, SM_LEVEL_0, nullptr, &edge_trim_at,
        &vertex_edge_at, &vertex_face_at, &edge_face_at, &vertex_trim_at, &edge_face, &vertex_trim);
    SmPyErrorTrail::clear();
    if (st != SM_SUCCESS)
        SmPyRaise(st, "SmBrep::ValidateAndUpdateTolerances", __FILE__, __LINE__);
    const Indices at = indices_of(brep);
    Value d = Value::dict();
    d.set("violated", val(violated ? true : false));
    d.set("tolerance", val(static_cast<double>(SmTol::GetZoneTol3d(brep))));
    d.set("edge_face", val(edge_face));
    d.set("edge_face_edge", val(edge_face_at ? index_in(at.edges, edge_face_at->GetEdge()) : -1L));
    d.set("vertex_edge", val(vertex_edge));
    d.set("vertex_edge_vertex", val(vertex_edge_at ? index_in(at.vertices, vertex_edge_at->GetVertex()) : -1L));
    d.set("vertex_face", val(vertex_face));
    d.set("vertex_face_vertex", val(vertex_face_at ? index_in(at.vertices, vertex_face_at->GetVertex()) : -1L));
    return d;
}

Value update_tolerances(SmBrep* brep)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    SmBoolean updated = FALSE;
    double edge_trim = 0.0, vertex_edge = 0.0, vertex_face = 0.0;
    const SmStatus st = brep->ValidateAndUpdateTolerances(FALSE, updated, edge_trim, vertex_edge, vertex_face);
    SmPyErrorTrail::clear();
    if (st != SM_SUCCESS)
        SmPyRaise(st, "SmBrep::ValidateAndUpdateTolerances", __FILE__, __LINE__);
    Value d = Value::dict();
    d.set("updated", val(updated ? true : false));
    d.set("vertex_edge", val(vertex_edge));
    d.set("vertex_face", val(vertex_face));
    return d;
}

double edge_tolerance(const SmEdge* edge)
{
    if (!edge)
        throw std::invalid_argument("edge is None");
    return static_cast<double>(SmTol::GetZoneTol3d(static_cast<const SmObject*>(edge)));
}

double vertex_tolerance(const SmVertex* vertex)
{
    if (!vertex)
        throw std::invalid_argument("vertex is None");
    return static_cast<double>(SmTol::GetZoneTol3d(static_cast<const SmObject*>(vertex)));
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"
#include "py_value.h"

void bind_check(py::module_ m)
{
    m.def("check_brep", [](const SmBrep* brep, int level) {
        return smlibpy::to_python(smlibpy::check_brep(brep, level));
    }, py::arg("brep"), py::arg("level") = 2,
          "The failed tests of SmBrep::AssertValid at a level (0, 1, 2): per test a dict with 'category', 'test', "
          "'message', 'kind' and 'index' (the face, edge or vertex, or 'body' and -1), 'other_kind', "
          "'other_index', 'value' and 'tolerance'.");
    m.def("tolerance_gaps", [](const SmBrep* brep) {
        return smlibpy::to_python(smlibpy::tolerance_gaps(brep));
    }, py::arg("brep"),
          "The largest gaps between edges, vertices and faces (ValidateAndUpdateTolerances, check only) and where.");
    m.def("update_tolerances", [](SmBrep* brep) {
        return smlibpy::to_python(smlibpy::update_tolerances(brep));
    }, py::arg("brep"),
          "The gaps between edges, vertices and faces repaired (ValidateAndUpdateTolerances, updating): tolerances grow "
          "to the gaps; 'updated', and the largest gaps found before.");
    m.def("edge_tolerance", &smlibpy::edge_tolerance, py::arg("edge"), "The tolerance of an edge.");
    m.def("vertex_tolerance", &smlibpy::vertex_tolerance, py::arg("vertex"), "The tolerance of a vertex.");
}
#endif  // SMLIBPY_PYTHON
