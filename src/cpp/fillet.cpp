// SPDX-License-Identifier: Apache-2.0
//
// Fillets and chamfers (`smlibpy._core.ext.round_edges`).
//
// The kernel's fillet executive (SmFilletExecutive), driven as SM_API's SmApiFilletEdges,
// SmApiFilletEdgesPerEdge and SmApiVariableRadiusFillet drive it, with the solvers, cross-sections
// and defaults SetFilletParameters makes for them, so that the results stay the same (bit for bit).
// What SM_API does not give:
//   * the executive's record of a failure (SmFilletErrorInfo): the kind of problem, the step that
//     failed (its SmFilStatus, private to the record: read through a pointer to the member), the edge
//     or corner it names, where, and its comment. SM_API builds the executive on its stack and
//     returns only the status; smlibpy's errors said "the radius may be too large" for every failure.
//   * two offsets per edge (SmConstantRadiusFS with its second radius) with a linear section: a
//     chamfer with a different setback on each face. SM_API's chamfers offset both faces alike.
//   * a finer approximation tolerance (`tolerance_factor`): SetFilletParameters builds the rounds'
//     edges within 4 times each edge's tolerance, and rounds close to the largest radius that fits
//     then come out as open bodies (a 10 mm cube rounded by 4.98); within 1 times, as
//     SmApiCircularFillet's own solvers, they are exact. smlibpy tries SM_API's first.
//   * radius laws along whole chains of edges that meet tangentially (SmFilletExecutive::
//     CreateSequenceOfLaws: one law spread over the chain in proportion to arc length), linear or
//     through radii at points along the chain (SmBSplineFilletLaw, joined smoothly without
//     overshooting). SM_API's law runs along each edge on its own, and where the rounds of two edges
//     meet, the executive bends both to one radius.
//   * mitred corners (SmFilletCorner::SetBevel) for any cross-section and radius
//     (SmApiSetBevelCorners: circular rounds of one radius), only on the corners whose code takes it:
//     the convex corners of three rounded edges and no other edge (SmFilletConvexNxNCorner bevels
//     three and fails on more; the other corners skip their patch and would leave a hole).
//   * set-back corners (SmFilletCorner::SetSetBackDist) where three or more rounded convex edges meet
//     and no other edge (SmFilletConvexNxNCorner): the rounds stop short of the vertex and one larger
//     patch joins them. (SmFilletConcaveNxNCorner hands set-back corners to the convex code, which
//     builds broken bodies there: a cube pocket's floor corners gave an invalid body of 59 times the
//     volume; and radius laws with set-back corners crashed: neither is offered.) Every set-back
//     corner read freed memory in SmCurveClassification::MergeInterval (patched: third_party/patches,
//     SmCurveClass.cpp). The corner's edges then merge into the faces (InsertIntersectionTopology,
//     SmTopologyIntersector::Relate) only where each edge's first edgeuse runs along it (SM_OT_SAME),
//     as in the kernel's own test box (TestFiles/.../Solids/box.smb); SmApiCreateBox's boxes, and most
//     bodies, list the opposite edgeuse first at some edges, and the merge failed there on conflicting
//     mates (an open body of the fillet half merged). Before set-back corners every edge's SAME
//     edgeuse is made its first (SmEdge::ResetPrimaryEdgeuse: the order of the edge's list of
//     edgeuses, nothing else changes).
//
// (SM_API asks for the executive's global merge before SetFilletParameters, which turns it off
// again. Turning it on for real changed no near-limit result measured and broke chamfers and G2
// fillets of a box with a hole, so it stays off here as well: third_party/patches/README.md.)

#include "kernel.h"
#include "fillet.h"

#include <SmApiGeneral.h>
#include <SmFilletCorner.h>
#include <SmFilletExecutive.h>
#include <SmFilletStandardSolver.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <memory>
#include <unordered_map>
#include <utility>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

const char* error_name(SmFilletErrorType e)
{
    switch (e)
    {
    case SM_FILERR_OK: return "";
    case SM_FILERR_EXEC_UNINITIALIZED: return "setup";
    case SM_FILERR_INVALID_INPUT: return "input";
    case SM_FILERR_VERTEX_PROBLEM: return "corner";
    case SM_FILERR_EDGE_PROBLEM: return "edge";
    case SM_FILERR_BAD_INT: return "intersection";
    case SM_FILERR_BAD_TRIM: return "trim";
    case SM_FILERR_BAD_MERGE: return "merge";
    }
    return "";
}

const char* corner_name(SmFilletCornerType c)
{
    switch (c)
    {
    case SM_FCR_UNKNOWN: return "";
    case SM_FCR_OPEN: return "open";
    case SM_FCR_DEGENERATE: return "degenerate";
    case SM_FCR_1_x_1: return "1x1";
    case SM_FCR_2_x_2: return "2x2";
    case SM_FCR_3_x_2_MIXED: return "3x2_mixed";
    case SM_FCR_4_x_3: return "4x3";
    case SM_FCR_N_x_1_CLOSED: return "Nx1_closed";
    case SM_FCR_N_x_1: return "Nx1";
    case SM_FCR_N_x_2: return "Nx2";
    case SM_FCR_N_x_N: return "NxN";
    case SM_FCR_N_x_N_CONVEX: return "NxN_convex";
    case SM_FCR_N_x_N_CONCAVE: return "NxN_concave";
    }
    return "";
}

// The stage at which the executive failed (SmFilletErrorInfo's SmFilStatus, which it keeps private and
// has no getter for: read through a pointer to the member, which an explicit instantiation may name).
struct FilletStatusMember
{
    using type = SmFilStatus SmFilletErrorInfo::*;
    friend type member(FilletStatusMember);
};

template <typename Tag, typename Tag::type M>
struct Expose
{
    friend typename Tag::type member(Tag) { return M; }
};

template struct Expose<FilletStatusMember, &SmFilletErrorInfo::m_eFilletStatus>;

// The executive's lists of the edges of each law sequence (CreateSequenceOfLaws adds one per call),
// which it frees without the arrays in them (SmTArray frees its storage, not its elements'): 128 bytes
// a chain law leaked. Emptied before the executive goes (the same way as above: it is protected).
struct LawListsMember
{
    using type = SmTArray<SmTArray<SmEdge*>> SmFilletExecutive::*;
    friend type member(LawListsMember);
};

template struct Expose<LawListsMember, &SmFilletExecutive::m_sLawSequenceEdgeList>;

struct FreeLawLists
{
    SmFilletExecutive& exec;
    ~FreeLawLists()
    {
        SmTArray<SmTArray<SmEdge*>>& lists = exec.*member(LawListsMember{});
        for (ULONG i = 0; i < lists.GetSize(); ++i)
            lists[i].RemoveAll();
    }
};

const char* stage_name(SmFilStatus s)
{
    switch (s)
    {
    case SM_FIL_UNPROCESSED:
    case SM_FIL_PROCESSED: return "";
    case SM_FIL_FAILURE: return "failure";
    case SM_FIL_SURF_INT_FAILURE: return "surface_intersection";
    case SM_FE_END_PNT_DROP_FAILURE: return "end_point";
    case SM_FE_TO_BE_SQUEEZED: return "squeeze";
    case SM_FE_CUBIC_RAIL_RAIL_INTERPOLATE: return "rail_interpolation";
    case SM_FV_NO_INT_RAIL_EU: return "rail_edge";
    case SM_FV_SOLVER_NOT_CONVERGE: return "solver";
    case SM_FV_TO_BE_DELETED: return "deleted";
    case SM_FS_SURF_TRACING_FAILURE: return "tracing";
    case SM_FS_SELF_INT_HANDLING_FAILURE: return "self_intersection";
    case SM_FS_SURF_SKINNING_FAILURE: return "skinning";
    }
    return "";
}

// The executive's comments end in a newline, and say "<no comment>" when they say nothing.
std::string comment_text(const TCHAR* c)
{
    std::string s;
    for (const TCHAR* p = c; p && *p && s.size() < 400; ++p)
        s += static_cast<char>(*p);
    while (!s.empty() && (s.back() == '\n' || s.back() == '\r' || s.back() == ' '))
        s.pop_back();
    if (s == "<no comment>")
        s.clear();
    return s;
}

SmFilletSurfaceGeneratorType section_type(int section)
{
    return section == 0 ? SM_FSG_LINEAR : section == 2 ? SM_FSG_BLEND_CURVE : SM_FSG_CIRCULAR;
}

template <typename T>
T item(const std::vector<T>& values, size_t i)
{
    return values.size() == 1 ? values[0] : values[i];
}

// The points of the Brep's vertices and of its edges' middles, by object, taken before the
// executive changes it: its record names objects of the Brep, which can be gone by then.
struct Places
{
    std::unordered_map<const void*, SmPoint3d> at;

    explicit Places(SmBrep* brep)
    {
        SmTArray<SmVertex*> vertices;
        brep->GetVertices(vertices);
        for (ULONG i = 0; i < vertices.GetSize(); ++i)
            at[vertices[i]] = vertices[i]->GetPoint();
        SmTArray<SmEdge*> edges;
        brep->GetEdges(edges);
        for (ULONG i = 0; i < edges.GetSize(); ++i)
        {
            SmEdge* e = edges[i];
            SmCurve* c = e->GetCurve();
            SmPoint3d p;
            if (c && c->EvaluatePoint(e->GetInterval().Evaluate(0.5), p) == SM_SUCCESS)
                at[e] = p;
        }
    }

    bool find(const void* object, double out[3]) const
    {
        auto it = object ? at.find(object) : at.end();
        if (it == at.end())
            return false;
        out[0] = it->second.x, out[1] = it->second.y, out[2] = it->second.z;
        return true;
    }
};

// Whether the edges of a chain close a loop (each vertex at the end of two of them).
bool closed_chain(const smlibpy::RoundSpec& spec, const std::vector<long>& chain)
{
    std::unordered_map<const SmVertex*, int> ends;
    for (long i : chain)
    {
        const SmEdge* e = spec.edges[static_cast<size_t>(i)];
        ++ends[e->GetStartVertex()];
        ++ends[e->GetEndVertex()];
    }
    for (const auto& [v, count] : ends)
        if (count != 2)
            return false;
    return !ends.empty();
}

// The laws of the edges along chains (spec.chains): one law per chain, spread over its edges by the
// executive (which orients the edges along the chain); `owned` keeps them (they must outlive the
// executive, whose solvers refer to them). Null for the edges of no chain.
//
// A closed chain's law through radii runs on past its ends as it runs on at the other end (its radii
// repeat a turn before and after), so that it is as smooth where it closes as elsewhere. (Around a
// closed chain of several edges a law that varies gives broken rounds, an extra face and open, also
// so and whatever edge the chain starts at; around a single closed edge it is right: the callers
// refuse the first.)
SmStatus chain_laws(SmFilletExecutive& exec, const SmContext& c, const smlibpy::RoundSpec& spec,
                    std::vector<SmFilletLaw*>& of_edge, std::vector<std::unique_ptr<SmFilletLaw>>& owned)
{
    of_edge.assign(spec.edges.size(), nullptr);
    for (const std::vector<long>& chain : spec.chains)
    {
        const bool closed = closed_chain(spec, chain);
        SmFilletLaw* law = nullptr;
        if (spec.law_at.empty())
            law = new (c) SmLinearFilletLaw(spec.start_radius, spec.end_radius);
        else
        {
            SmTArray<double> at, radii;
            const size_t m = spec.law_at.size();
            for (int turn = closed ? -1 : 0; turn <= (closed ? 1 : 0); ++turn)
                for (size_t i = 0; i < m; ++i)
                    if (!closed || i + 1 < m || turn == 1)  // (a closed chain's 1 is the next turn's 0)
                        at.Add(spec.law_at[i] + turn), radii.Add(spec.law_radii[i]);
            SmBoolean failed = FALSE;
            // (type 2: a piecewise cubic through the radii that does not overshoot them, flat at the
            // ends and at each local extreme)
            law = new (c) SmBSplineFilletLaw(c, at, radii, 2, SmExtent1d(0.0, 1.0), failed);
            if (failed)
            {
                delete law;
                exec.GetFilletErrorInfo()->NoteError(SM_FILERR_INVALID_INPUT, _T("The radius law could not be built"));
                return SM_ERR_INVALID_INPUT;
            }
        }
        owned.emplace_back(law);
        SmTArray<SmEdge*> edges;
        for (long i : chain)
            edges.Add(spec.edges[static_cast<size_t>(i)]);
        SmTArray<SmFilletLaw*> laws;
        const SmStatus st = exec.CreateSequenceOfLaws(c, law, edges, laws);
        for (ULONG i = 1; i < laws.GetSize(); ++i)
            owned.emplace_back(laws[i]);  // (the first is `law`)
        if (st != SM_SUCCESS || laws.GetSize() != edges.GetSize())
            return st != SM_SUCCESS ? st : SM_ERR;
        for (ULONG i = 0; i < laws.GetSize(); ++i)
            of_edge[static_cast<size_t>(chain[i])] = laws[i];
    }
    return SM_SUCCESS;
}

// The executive's solvers and cross-sections, as SmFilletExecutive::SetFilletParameters makes them
// for SM_API (its default tolerances: 20 and 10 degrees, cross-sections within 5 % of the radius, or
// 10 % with one per edge), with the approximation tolerance `tolerance_factor` times each edge's
// (SetFilletParameters: 4), and with SmConstantRadiusFS's second offset for `radii2`.
SmStatus load_solvers(SmFilletExecutive& exec, SmBrep* brep, const smlibpy::RoundSpec& spec, SmFilletLaw& law,
                      std::vector<std::unique_ptr<SmFilletLaw>>& owned, long& bad_edge)
{
    const SmContext& c = *brep->GetContext();
    const double ang = SM_DEG2RAD(20.0), tan = SM_DEG2RAD(10.0);
    const size_t n = spec.edges.size();
    std::vector<SmFilletLaw*> laws;  // per edge, its law along its chain
    if (spec.law && !spec.chains.empty())
    {
        const SmStatus st = chain_laws(exec, c, spec, laws, owned);
        if (st != SM_SUCCESS)
            return st;
    }
    auto make_fsg = [&](int section, double tolerance) -> SmFilletSurfaceGenerator* {
        SmFilletSurfaceGenerator* fsg = nullptr;
        if (section == 0)
            fsg = new (c) SmLinearCrossSectionFSG;
        else if (section == 2)
            fsg = new (c) SmBlendCurveCrossSectionFSG(spec.thumbweight, static_cast<ULONG>(spec.continuity));
        else
            fsg = new (c) SmCircularCrossSectionFSG(TRUE, tolerance);
        exec.AddFilletSurfaceGenerator(fsg);  // (the executive deletes it)
        return fsg;
    };
    // one cross-section for all edges, or one per edge (as SetFilletParameters' overloads)
    SmFilletSurfaceGenerator* shared = spec.sections.size() == 1 ? make_fsg(spec.sections[0], 0.05) : nullptr;
    for (size_t i = 0; i < n; ++i)
    {
        SmEdge* edge = spec.edges[i];
        SmEdgeuse* eu = edge->GetBlendEdgeuse();
        if (eu == nullptr)
        {
            bad_edge = static_cast<long>(i);
            exec.GetFilletErrorInfo()->NoteError(edge, SM_FIL_FAILURE, SM_FILERR_INVALID_INPUT,
                                                 _T("The edge cannot be filleted"));
            return SM_ERR_INVALID_INPUT;
        }
        const double tol = spec.tolerance_factor * static_cast<double>(edge->GetTolerance());
        double first = item(spec.radii, i);
        SmFilletSolver* fs = nullptr;
        if (spec.law)
            fs = new (c) SmVariableRadiusFS(c, tol, ang, tan, spec.start_radius, eu, laws.empty() ? law : *laws[i],
                                            FALSE);
        else if (!spec.radii2.empty())
        {
            double second = item(spec.radii2, i);
            SmFace* face = spec.faces.empty() ? nullptr : item(spec.faces, i);
            if (face != nullptr && face != eu->GetLoopuse()->GetFaceuse()->GetFace())
            {
                SmEdgeuse* other = eu->GetRadial();
                if (other == nullptr || other->GetLoopuse()->GetFaceuse()->GetFace() != face)
                {
                    bad_edge = static_cast<long>(i);
                    exec.GetFilletErrorInfo()->NoteError(edge, SM_FIL_FAILURE, SM_FILERR_INVALID_INPUT,
                                                         _T("The face given for the edge is not one of its faces"));
                    return SM_ERR_INVALID_INPUT;
                }
                std::swap(first, second);  // (the solver's first offset is that of the blend edgeuse's face)
            }
            fs = new (c) SmConstantRadiusFS(c, tol, ang, tan, first, eu, &second);
        }
        else
            fs = new (c) SmConstantRadiusFS(c, tol, ang, tan, first, eu);
        exec.LoadFilletSolver(fs);  // (SetFilletParameters ignores its status too)
        fs->SetFilletSurfaceGenerator(shared ? shared : make_fsg(item(spec.sections, i), 0.1));
    }
    return SM_SUCCESS;
}

// Mitres the executive's corners that take it (see the head of this file), counting them.
void mitre_corners(SmFilletExecutive& exec, smlibpy::Rounded& r)
{
    SmTArray<SmFilletCorner*>& corners = exec.GetFilletCorners();
    for (ULONG i = 0; i < corners.GetSize(); ++i)
    {
        SmFilletCorner* c = corners[i];
        if (c->GetCornerType() != SM_FCR_N_x_N_CONVEX || c->GetFilletedVertex() == nullptr)
            continue;
        SmTArray<SmEdge*> edges;
        c->GetFilletedVertex()->GetEdges(edges);
        if (edges.GetSize() == 3)
        {
            c->SetBevel(TRUE);
            ++r.mitred;
        }
    }
}

// Sets back the executive's corners that take it (see the head of this file), counting them.
void set_back_corners(SmFilletExecutive& exec, double distance, smlibpy::Rounded& r)
{
    SmTArray<SmFilletCorner*>& corners = exec.GetFilletCorners();
    for (ULONG i = 0; i < corners.GetSize(); ++i)
    {
        SmFilletCorner* c = corners[i];
        if (c->GetCornerType() != SM_FCR_N_x_N_CONVEX || c->GetFilletedVertex() == nullptr)
            continue;
        c->SetSetBackDist(distance);
        ++r.set_back;
    }
}

// Makes the edgeuse of each edge of `brep` that runs along it (SM_OT_SAME) the first of its edgeuses:
// set-back corners merge only so (see the head of this file).
void same_first(SmBrep* brep)
{
    SmTArray<SmEdge*> edges;
    brep->GetEdges(edges);
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        SmEdge* e = edges[i];
        SmEdgeuse* first = e->GetPrimaryEdgeuse();
        if (first != nullptr && first->GetOrientation() != SM_OT_SAME)
        {
            SmEdgeuse* same = first->GetMate();
            if (same != nullptr && same != first && same->GetOrientation() == SM_OT_SAME)
                e->ResetPrimaryEdgeuse(same);
        }
    }
}

}  // namespace

namespace smlibpy {

Rounded round_edges(SmBrep* brep, const RoundSpec& spec)
{
    const size_t n = spec.edges.size();
    auto fits = [n](size_t size) { return size == 1 || size == n; };
    if (brep == nullptr || n == 0)
        throw std::invalid_argument("round_edges: no Brep or no edges");
    if (spec.radii.empty() || !fits(spec.radii.size()) || spec.sections.empty() || !fits(spec.sections.size()))
        throw std::invalid_argument("round_edges: give one radius and one section, or one per edge");
    if (!spec.radii2.empty() && (!fits(spec.radii2.size()) || (!spec.faces.empty() && !fits(spec.faces.size()))))
        throw std::invalid_argument("round_edges: give one second radius and one face, or one per edge");
    if (!spec.radii2.empty() && (spec.law || spec.sections.size() != 1 || spec.sections[0] != 0))
        throw std::invalid_argument("round_edges: two offsets are for linear sections of a constant size only");
    if (spec.law && (spec.radii.size() != 1 || spec.sections.size() != 1))
        throw std::invalid_argument("round_edges: a law is for one section and no radius per edge");
    if (!spec.chains.empty())
    {
        if (!spec.law)
            throw std::invalid_argument("round_edges: chains are for a law");
        std::vector<int> seen(n, 0);
        for (const std::vector<long>& chain : spec.chains)
        {
            if (chain.empty())
                throw std::invalid_argument("round_edges: a chain has no edges");
            for (long i : chain)
                if (i < 0 || static_cast<size_t>(i) >= n || seen[static_cast<size_t>(i)]++)
                    throw std::invalid_argument("round_edges: each edge must lie in one chain, given by its index");
        }
        if (std::find(seen.begin(), seen.end(), 0) != seen.end())
            throw std::invalid_argument("round_edges: each edge must lie in one chain, given by its index");
    }
    if (!spec.law_at.empty())
    {
        bool ok = spec.chains.size() > 0 && spec.law_at.size() >= 2 && spec.law_at.size() == spec.law_radii.size() &&
                  spec.law_at.front() == 0.0 && spec.law_at.back() == 1.0;
        for (size_t i = 0; ok && i < spec.law_at.size(); ++i)
            ok = spec.law_radii[i] > 0 && (i == 0 || spec.law_at[i] > spec.law_at[i - 1]);
        if (!ok)
            throw std::invalid_argument("round_edges: law_at (from 0 to 1, rising) and law_radii (positive) are for "
                                        "chains, one radius at each position");
    }
    if (!(spec.tolerance_factor > 0))
        throw std::invalid_argument("round_edges: the tolerance factor must be positive");
    if (!(spec.setback >= 0) || !std::isfinite(spec.setback))
        throw std::invalid_argument("round_edges: the setback must be 0 (none) or positive");
    if (spec.setback > 0 && spec.mitre)
        throw std::invalid_argument("round_edges: a corner is mitred or set back, not both");
    if (spec.setback > 0 && spec.law)
        throw std::invalid_argument("round_edges: set-back corners join rounds of a constant radius, not laws");

    Rounded r;
    const Places places(brep);
    SmLinearFilletLaw law(spec.start_radius, spec.end_radius);  // (the solvers use it: it outlives the executive)
    std::vector<std::unique_ptr<SmFilletLaw>> chain_laws;          // (so do the laws along chains)
    SmFilletExecutive exec(ctx(), brep);
    const FreeLawLists free_law_lists{exec};  // (goes before the executive)
    SmFilletErrorInfo* info = exec.GetFilletErrorInfo();
    const double nan = std::numeric_limits<double>::quiet_NaN();
    info->m_vLocation = SmPoint3d(nan, nan, nan);  // (set by few of its records)

    // (SetFilletParameters, then DoFillet: CreateFilletCorners and DoFilleting)
    long bad_edge = -1;
    if (spec.setback > 0)
        same_first(brep);
    SmStatus status = load_solvers(exec, brep, spec, law, chain_laws, bad_edge);
    if (status == SM_SUCCESS)
        status = exec.CreateFilletCorners();
    if (status == SM_SUCCESS && spec.mitre)
        mitre_corners(exec, r);
    if (status == SM_SUCCESS && spec.setback > 0)
        set_back_corners(exec, spec.setback, r);
    if (status == SM_SUCCESS)
        status = exec.DoFilleting();

    if (status == SM_SUCCESS)
    {
        brep->StitchAndOrient();  // (as SM_API does)
        return r;
    }
    r.status = static_cast<long>(status);
    r.error = error_name(info->GetErrorCode());
    r.corner = corner_name(info->m_eCornerType);
    r.stage = stage_name(info->*member(FilletStatusMember{}));
    r.comment = comment_text(info->m_cComment);
    for (size_t i = 0; i < n && r.edge < 0; ++i)
        if (info->m_pFilletedEdge == spec.edges[i])
            r.edge = static_cast<long>(i);
    if (r.edge < 0)
        r.edge = bad_edge;
    if (places.find(info->m_pFilletedVertex, r.vertex))
        r.has_vertex = true;
    const SmPoint3d& at = info->m_vLocation;
    if (std::isfinite(at.x) && std::isfinite(at.y) && std::isfinite(at.z))
    {
        r.has_location = true;
        r.location[0] = at.x, r.location[1] = at.y, r.location[2] = at.z;
    }
    else if (r.edge < 0 && places.find(info->m_pFilletedEdge, r.location))
        r.has_location = true;  // (an edge that was not to be rounded: its middle)
    return r;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_fillet(py::module_ m)
{
    m.def("round_edges", [](SmBrep* brep, const std::vector<SmEdge*>& edges, const std::vector<double>& radii,
                            const std::vector<int>& sections, const std::vector<double>& radii2,
                            const std::vector<SmFace*>& faces, const std::vector<double>& law, int continuity,
                            double thumbweight, double tolerance_factor, bool mitre,
                            const std::vector<std::vector<long>>& chains, const std::vector<double>& law_at,
                            const std::vector<double>& law_radii, double setback) {
        smlibpy::RoundSpec spec;
        spec.edges = edges, spec.radii = radii, spec.sections = sections, spec.radii2 = radii2, spec.faces = faces;
        if (!law.empty())
        {
            if (law.size() != 2)
                throw std::invalid_argument("round_edges: law is (start radius, end radius)");
            spec.law = true, spec.start_radius = law[0], spec.end_radius = law[1];
        }
        spec.continuity = continuity, spec.thumbweight = thumbweight, spec.tolerance_factor = tolerance_factor;
        spec.mitre = mitre, spec.setback = setback;
        spec.chains = chains, spec.law_at = law_at, spec.law_radii = law_radii;
        if (!law_at.empty() && law.empty())
            spec.law = true, spec.start_radius = law_radii.empty() ? 0.0 : law_radii.front();
        SmPyErrorTrail::clear();
        const smlibpy::Rounded r = smlibpy::round_edges(brep, spec);
        auto point = [](bool has, const double* p) {
            return has ? py::object(py::make_tuple(p[0], p[1], p[2])) : py::object(py::none());
        };
        py::dict d;
        d["status"] = r.status ? py::object(py::str(sm_status_name(static_cast<SmStatus>(r.status)))) : py::object(py::none());
        d["error"] = r.error;
        d["edge"] = r.edge;
        d["vertex"] = point(r.has_vertex, r.vertex);
        d["location"] = point(r.has_location, r.location);
        d["corner"] = r.corner;
        d["stage"] = r.stage;
        d["comment"] = r.comment;
        d["mitred"] = r.mitred;
        d["set_back"] = r.set_back;
        return d;
    }, py::arg("brep"), py::arg("edges"), py::arg("radii"), py::arg("sections"),
          py::arg("radii2") = std::vector<double>{}, py::arg("faces") = std::vector<SmFace*>{},
          py::arg("law") = std::vector<double>{}, py::arg("continuity") = 1, py::arg("thumbweight") = 1.0,
          py::arg("tolerance_factor") = 4.0, py::arg("mitre") = false,
          py::arg("chains") = std::vector<std::vector<long>>{}, py::arg("law_at") = std::vector<double>{},
          py::arg("law_radii") = std::vector<double>{}, py::arg("setback") = 0.0,
          "Mutates: brep. Round or bevel `edges` of `brep` in place with the kernel's fillet executive, as "
          "fillet_edges (one radius and one section), fillet_edges_per_edge (one of each per edge) and "
          "variable_radius_fillet (`law`: (start radius, end radius)) do. `sections`: 0 linear, 1 circular, 2 a "
          "blend curve (`continuity` 1-3, `thumbweight`). `tolerance_factor`: how closely the rounds' edges follow "
          "the faces, in edge tolerances (SM_API's 4; 1 builds radii closer to the largest that fits). `radii2` (with "
          "one linear section): a second offset, of "
          "the other face of each edge than `faces` (None or left out: the face of its blend edgeuse); `radii` "
          "offsets that face. `mitre`: mitre the corners where three rounded convex edges meet and no other edge "
          "(the rounds run on until they meet, no corner patch). `chains` (with `law`, or `law_at` and `law_radii`): "
          "the indices of the edges of each chain of edges that meet tangentially, in order along it (each edge in "
          "one chain): the law runs along each chain in proportion to arc length, from `law`'s start radius to "
          "its end radius, or through the radii `law_radii` at the positions `law_at` (from 0, the chain's start, "
          "to 1, its end), joined smoothly without overshooting them. `setback`: set back the corners where three "
          "or more rounded convex edges meet and no other edge: the rounds stop `setback` from the vertex along its "
          "edges and one patch joins them (0: none; not with `mitre` or a law). "
          "Returns {'status': None, or the kernel status of a failure, 'error': the kind of "
          "problem the executive recorded ('input', 'corner', 'edge', 'intersection', 'trim', 'merge', 'setup' or "
          "''), 'edge': the index of the edge it names or -1, 'vertex': the point of the vertex it names or None, "
          "'location': where it happened or None, 'corner': the kind of corner ('1x1', '2x2', 'Nx1', ... or ''), "
          "'stage': the step that failed ('surface_intersection', 'end_point', 'squeeze', 'rail_interpolation', "
          "'rail_edge', 'solver', 'deleted', 'tracing', 'self_intersection', 'skinning', 'failure' or ''), "
          "'comment': the executive's comment, 'mitred': how many corners were mitred, 'set_back': how many "
          "corners were set back}. A failure can leave the "
          "Brep half changed.");
}
#endif  // SMLIBPY_PYTHON
