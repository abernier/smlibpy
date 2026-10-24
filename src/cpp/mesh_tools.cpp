// SPDX-License-Identifier: Apache-2.0
//
// Triangle meshes as arrays (`smlibpy._core.ext`, `ext__...` in the JavaScript module):
//
//   mesh_nearest_points(vertices, triangles, points)       the nearest point of a mesh to each point
//   crease_normals(vertices, triangles, crease_angle)      corner normals, sharp across creases
//   decimate_triangles(vertices, triangles, fraction, ...) the kernel's quadric decimation
//   repair_triangles(vertices, triangles, clean, fill)     merged points, one way round, holes closed
//   brep_from_triangles(vertices, triangles, ...)          a faceted body (planar faces) of a mesh
//
// Meshes go in and come out as arrays (Mesh's own), so neither side keeps a kernel mesh.
//
// The nearest points come from a tree of boxes around the triangles (each box splits its triangles
// at the middle of its longest side), searched nearest box first: smlibpy measures with it how far
// a decimated mesh is from the one it came from, and finds the triangle of a mesh Boolean's operand
// that a triangle of its result lies on (whose normals it takes).
//
// The decimation is the kernel's (SmPolyDecimate, which SmPolyBrep::CleanSolidMesh uses too): it
// collapses edges, those whose collapse moves the surface least (by its quadric error) first, and
// keeps a closed mesh closed. It stops at a share of the points; its other stopping rule, a "maximum
// error", bounds an accumulated quadric value, not a distance (0.05 collapsed a sphere of radius 10
// to 390 triangles, 5.3 off), so smlibpy measures the distance itself (Mesh.decimate(tolerance=)).
//
// Holes: the kernel's SmPolyBrep::FillLaminaHoles looks for the next edge of a hole among all border
// edges (quadratic) and fills only holes whose edges are not also glued elsewhere. Here the border
// is chained through a map of the edges at each point, and the kernel triangulates each hole's
// polygon (SmPolyFace::TriangulateNonPlanar, as FillLaminaHoles does) in a mesh of its own.
//
// Faceted bodies: SmBrep::CreateFromPolyBrep makes a planar face of each polygon and stitches them
// (0.2 s for 3584 triangles; building faces one by one in Python took 3 s). Neighbouring triangles
// that lie in one plane (within the mesh's tolerance; the faces of a CAD part's mesh) are merged
// into one polygon first (SmPolyBrep::RemoveEdgeBetweenCoplanarFaces), which the kernel's own
// cleanup (SmPolyMerge::CleanupCoPlanarFaces) does for normals within 0.01 of each other: that
// would merge the triangles of a finely meshed sphere into faces that are not planar.

#include "kernel.h"
#include "mesh_tools.h"
#include "fit.h"
#include "poly_arrays.h"
#include "triangle_geometry.h"

#include <SmApiGeneral.h>
#include <SmPoly.h>
#include <SmPolyDecimate.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace
{

constexpr double kPi = 3.14159265358979323846;

const SmContext& context() { return *SmApiGetOrCreateContext(); }

void check_status(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(status, what, __FILE__, __LINE__);
}

void check_points(const std::vector<double>& values, const std::string& what)
{
    if (values.size() % 3 != 0)
        throw std::invalid_argument(what + " must be x, y, z triples");
    for (double x : values)
        if (!std::isfinite(x))
            throw std::invalid_argument(what + " must be finite numbers");
}

void check_mesh(const std::vector<double>& vertices, const std::vector<int64_t>& triangles, const char* what)
{
    check_points(vertices, std::string(what) + ": the vertices");
    if (triangles.size() % 3 != 0)
        throw std::invalid_argument(std::string(what) + ": the triangles must be triples of vertex indices");
    const size_t n = vertices.size() / 3;
    for (int64_t i : triangles)
        if (i < 0 || static_cast<size_t>(i) >= n)
            throw std::invalid_argument(std::string(what) + ": a triangle refers to a vertex that is not there (" +
                                        std::to_string(i) + ")");
}

SmPoint3d point(const std::vector<double>& xyz, size_t i) { return SmPoint3d(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]); }

// A kernel mesh, deleted with its owner.
struct PolyDeleter
{
    void operator()(SmPolyBrep* poly) const { delete poly; }
};
using PolyPtr = std::unique_ptr<SmPolyBrep, PolyDeleter>;

// ---------------------------------------------------------------------------------------- welding

struct KeyHash
{
    size_t operator()(const std::array<int64_t, 3>& k) const
    {
        uint64_t h = 1469598103934665603ull;
        for (int64_t x : k)
            h = (h ^ static_cast<uint64_t>(x)) * 1099511628211ull;
        return static_cast<size_t>(h);
    }
};

// For each vertex, the first vertex that lies on it: the same point to 1e-9 of the largest
// coordinate, as Mesh.is_closed() takes it.
std::vector<int64_t> weld(const std::vector<double>& vertices, int64_t* merged = nullptr)
{
    const size_t n = vertices.size() / 3;
    double size = 0.0;
    for (double x : vertices)
        size = std::max(size, std::fabs(x));
    const double scale = 1e9 / std::max(size, 1e-300);
    std::unordered_map<std::array<int64_t, 3>, int64_t, KeyHash> first;
    first.reserve(n);
    std::vector<int64_t> id(n);
    int64_t count = 0;
    for (size_t i = 0; i < n; ++i)
    {
        const std::array<int64_t, 3> key = {static_cast<int64_t>(std::nearbyint(vertices[3 * i] * scale)),
                                            static_cast<int64_t>(std::nearbyint(vertices[3 * i + 1] * scale)),
                                            static_cast<int64_t>(std::nearbyint(vertices[3 * i + 2] * scale))};
        const auto [it, added] = first.emplace(key, static_cast<int64_t>(i));
        id[i] = it->second;
        if (!added)
            ++count;
    }
    if (merged)
        *merged = count;
    return id;
}

// The undirected edge between two points (by index) as one number.
uint64_t edge_key(int64_t a, int64_t b)
{
    if (a > b)
        std::swap(a, b);
    return (static_cast<uint64_t>(a) << 32) | static_cast<uint64_t>(b);
}

// ----------------------------------------------------------------------------------- nearest points

using smlibpy::nearest_on_triangle;

// A tree of boxes around the triangles of a mesh (those with an area), for nearest points.
class TriangleTree
{
  public:
    TriangleTree(const std::vector<double>& vertices, const std::vector<int64_t>& triangles)
    {
        const size_t m = triangles.size() / 3;
        corners_.reserve(m);
        for (size_t t = 0; t < m; ++t)
        {
            const SmPoint3d a = point(vertices, triangles[3 * t]), b = point(vertices, triangles[3 * t + 1]),
                            c = point(vertices, triangles[3 * t + 2]);
            if (!(((b - a) * (c - a)).Length() > 0))
                continue;  // (no area: its edges belong to its neighbours)
            corners_.push_back({a, b, c});
            index_.push_back(static_cast<int32_t>(t));
        }
        if (corners_.empty())
            return;
        std::vector<int32_t> order(corners_.size());
        for (size_t i = 0; i < order.size(); ++i)
            order[i] = static_cast<int32_t>(i);
        std::vector<SmPoint3d> middles(corners_.size());
        for (size_t i = 0; i < corners_.size(); ++i)
        {
            const auto& t = corners_[i];
            middles[i] = SmPoint3d((t[0].x + t[1].x + t[2].x) / 3, (t[0].y + t[1].y + t[2].y) / 3,
                                   (t[0].z + t[1].z + t[2].z) / 3);
        }
        nodes_.reserve(2 * corners_.size() / kLeaf + 2);
        build(order, middles, 0, static_cast<int32_t>(order.size()));
        // the triangles in the order of the leaves
        std::vector<std::array<SmPoint3d, 3>> corners(corners_.size());
        std::vector<int32_t> index(corners_.size());
        for (size_t i = 0; i < order.size(); ++i)
        {
            corners[i] = corners_[order[i]];
            index[i] = index_[order[i]];
        }
        corners_.swap(corners);
        index_.swap(index);
    }

    // The triangle nearest to p (-1 for none), the distance and the point.
    int32_t nearest(const SmPoint3d& p, double& distance, SmPoint3d& q) const
    {
        distance = std::numeric_limits<double>::infinity();
        if (nodes_.empty())
            return -1;
        int32_t best = -1;
        double best2 = std::numeric_limits<double>::infinity();
        std::vector<int32_t> stack = {0};
        while (!stack.empty())
        {
            const Node& node = nodes_[stack.back()];
            stack.pop_back();
            if (box_distance2(node, p) >= best2)
                continue;
            if (node.left < 0)
            {
                for (int32_t i = node.first; i < node.first + node.count; ++i)
                {
                    const auto& t = corners_[i];
                    const SmPoint3d r = nearest_on_triangle(p, t[0], t[1], t[2]);
                    const double d2 = (r - p).Dot(r - p);
                    if (d2 < best2)
                    {
                        best2 = d2;
                        best = i;
                        q = r;
                    }
                }
                continue;
            }
            const double dl = box_distance2(nodes_[node.left], p), dr = box_distance2(nodes_[node.right], p);
            // (the nearer box last: searched first)
            if (dl < dr)
            {
                stack.push_back(node.right);
                stack.push_back(node.left);
            }
            else
            {
                stack.push_back(node.left);
                stack.push_back(node.right);
            }
        }
        distance = std::sqrt(best2);
        return best < 0 ? -1 : index_[best];
    }

  private:
    static constexpr int32_t kLeaf = 4;

    struct Node
    {
        double lo[3], hi[3];
        int32_t left = -1, right = -1;  // children (-1: a leaf)
        int32_t first = 0, count = 0;   // a leaf's triangles
    };

    static double box_distance2(const Node& node, const SmPoint3d& p)
    {
        const double x[3] = {p.x, p.y, p.z};
        double d2 = 0.0;
        for (int k = 0; k < 3; ++k)
        {
            const double d = x[k] < node.lo[k] ? node.lo[k] - x[k] : x[k] > node.hi[k] ? x[k] - node.hi[k] : 0.0;
            d2 += d * d;
        }
        return d2;
    }

    int32_t build(std::vector<int32_t>& order, const std::vector<SmPoint3d>& middles, int32_t first, int32_t end)
    {
        const int32_t at = static_cast<int32_t>(nodes_.size());
        nodes_.emplace_back();
        Node node;
        for (int k = 0; k < 3; ++k)
        {
            node.lo[k] = std::numeric_limits<double>::infinity();
            node.hi[k] = -std::numeric_limits<double>::infinity();
        }
        for (int32_t i = first; i < end; ++i)
            for (const SmPoint3d& c : corners_[order[i]])
            {
                const double x[3] = {c.x, c.y, c.z};
                for (int k = 0; k < 3; ++k)
                {
                    node.lo[k] = std::min(node.lo[k], x[k]);
                    node.hi[k] = std::max(node.hi[k], x[k]);
                }
            }
        if (end - first <= kLeaf)
        {
            node.first = first;
            node.count = end - first;
            nodes_[at] = node;
            return at;
        }
        int axis = 0;
        for (int k = 1; k < 3; ++k)
            if (node.hi[k] - node.lo[k] > node.hi[axis] - node.lo[axis])
                axis = k;
        auto coordinate = [&](int32_t i) {
            const SmPoint3d& m = middles[i];
            return axis == 0 ? m.x : axis == 1 ? m.y : m.z;
        };
        const int32_t mid = first + (end - first) / 2;
        std::nth_element(order.begin() + first, order.begin() + mid, order.begin() + end,
                         [&](int32_t i, int32_t j) { return coordinate(i) < coordinate(j); });
        node.left = build(order, middles, first, mid);
        node.right = build(order, middles, mid, end);
        nodes_[at] = node;
        return at;
    }

    std::vector<std::array<SmPoint3d, 3>> corners_;
    std::vector<int32_t> index_;
    std::vector<Node> nodes_;
};

// ------------------------------------------------------------------------------------------ holes

// The kernel's triangulation of a hole's polygon (`loop`: points by index, in the order the polygon
// runs), in a mesh of its own: planar or not as the polygon says, or the other way (`other`).
// Empty where it fails.
std::vector<int64_t> kernel_fill(const std::vector<double>& vertices, const std::vector<int64_t>& loop, double tol,
                                 bool other)
{
    PolyPtr poly(new (context()) SmPolyBrep(tol, static_cast<ULONG>(4 * loop.size() + 16)));
    SmTArray<SmPolyVertex*> corners;
    std::unordered_map<const SmPolyVertex*, int64_t> index;
    for (int64_t i : loop)
    {
        SmPolyVertex* v = new (poly.get()) SmPolyVertex(point(vertices, i), tol);
        corners.Add(v);
        index.emplace(v, i);
    }
    SmPolyFace* face = nullptr;
    if (poly->CreatePolyFace(nullptr, nullptr, corners, face) != SM_SUCCESS || !face)
        return {};
    SmTArray<SmPolyFace*> made;
    const bool planar = static_cast<bool>(face->IsPlanar()) != other;
    if ((planar ? face->TriangulatePlanar(made) : face->TriangulateNonPlanar(made)) != SM_SUCCESS)
        return {};
    SmTArray<SmPolyFace*> faces;
    poly->GetPolyFaces(faces);
    std::vector<int64_t> out;
    for (ULONG f = 0; f < faces.GetSize(); ++f)
    {
        SmTArray<SmPolyLoop*> loops;
        faces[f]->GetPolyLoops(loops);
        if (loops.GetSize() != 1)
            return {};
        SmTArray<SmPolyEdge*> edges;
        loops[0]->GetPolyEdges(edges);
        if (edges.GetSize() != 3)
            return {};
        int64_t t[3];
        for (int k = 0; k < 3; ++k)
        {
            const auto found = index.find(edges[k]->GetStartPolyVertex());
            if (found == index.end())
                return {};  // (a point of its own: not a triangulation of the polygon)
            t[k] = found->second;
        }
        out.insert(out.end(), {t[0], t[1], t[2]});
    }
    // (as many triangles as a polygon has corners less two, or the polygon was not closed by them)
    if (out.size() != 3 * (loop.size() - 2))
        return {};
    return out;
}

// The plane of a polygon of points (by index): Newell's normal (zero for none) and the middle.
SmVector3d loop_normal(const std::vector<double>& vertices, const std::vector<int64_t>& loop, SmPoint3d& middle)
{
    SmVector3d n(0, 0, 0), sum(0, 0, 0);
    for (size_t i = 0; i < loop.size(); ++i)
    {
        const SmPoint3d p = point(vertices, loop[i]), q = point(vertices, loop[(i + 1) % loop.size()]);
        n.x += (p.y - q.y) * (p.z + q.z);
        n.y += (p.z - q.z) * (p.x + q.x);
        n.z += (p.x - q.x) * (p.y + q.y);
        sum += SmVector3d(p);
    }
    const double k = 1.0 / static_cast<double>(loop.size());
    middle = SmPoint3d(sum.x * k, sum.y * k, sum.z * k);
    const double length = n.Length();
    return length > 0 ? n * (1.0 / length) : SmVector3d(0, 0, 0);
}

// Ear clipping of a polygon (points by index) seen along its normal: triangles that run as the
// polygon does. Empty where the polygon, seen so, crosses itself.
std::vector<int64_t> ear_clip(const std::vector<double>& vertices, const std::vector<int64_t>& loop)
{
    SmPoint3d middle;
    const SmVector3d n = loop_normal(vertices, loop, middle);
    if (n.Length() == 0)
        return {};
    // a frame in the plane
    SmVector3d u = std::fabs(n.x) < 0.9 ? SmVector3d(1, 0, 0) : SmVector3d(0, 1, 0);
    u = u - n * u.Dot(n);
    u = u * (1.0 / u.Length());
    const SmVector3d v = n * u;
    const size_t count = loop.size();
    std::vector<double> x(count), y(count);
    for (size_t i = 0; i < count; ++i)
    {
        const SmVector3d d = point(vertices, loop[i]) - middle;
        x[i] = d.Dot(u);
        y[i] = d.Dot(v);
    }
    auto turn = [&](size_t a, size_t b, size_t c) { return (x[b] - x[a]) * (y[c] - y[a]) - (x[c] - x[a]) * (y[b] - y[a]); };
    std::vector<size_t> left(count);
    for (size_t i = 0; i < count; ++i)
        left[i] = i;
    std::vector<int64_t> out;
    size_t i = 0, tried = 0;
    while (left.size() > 3)
    {
        const size_t m = left.size();
        const size_t a = left[(i + m - 1) % m], b = left[i % m], c = left[(i + 1) % m];
        bool ear = turn(a, b, c) > 0;
        for (size_t j = 0; ear && j < m; ++j)
        {
            const size_t p = left[j];
            if (p == a || p == b || p == c)
                continue;
            ear = !(turn(a, b, p) >= 0 && turn(b, c, p) >= 0 && turn(c, a, p) >= 0);
        }
        if (ear)
        {
            out.insert(out.end(), {loop[a], loop[b], loop[c]});
            left.erase(left.begin() + static_cast<std::ptrdiff_t>(i % m));
            tried = 0;
            i = i % (m - 1);
            continue;
        }
        if (++tried > m)
            return {};  // (no ear left: the polygon crosses itself seen along its normal)
        i = (i + 1) % m;
    }
    out.insert(out.end(), {loop[left[0]], loop[left[1]], loop[left[2]]});
    return out;
}

// The triangles that close a hole (`loop`: points by index, in the order the hole's polygon runs,
// facing the way the triangles beside it face): the kernel's triangulation of the polygon, flat or
// not; where it fails (a long hole whose polygon zigzags around its plane), ear clipping seen along
// the polygon's normal; where that fails too, a fan around a new point in the middle of the
// polygon (appended to `new_vertices`, its index `next_index`).
std::vector<int64_t> fill_hole(const std::vector<double>& vertices, const std::vector<int64_t>& loop, double tol,
                               int64_t next_index, std::vector<double>& new_vertices)
{
    if (loop.size() == 3)
        return loop;
    for (bool other : {false, true})
    {
        std::vector<int64_t> out = kernel_fill(vertices, loop, tol, other);
        if (!out.empty())
            return out;
    }
    std::vector<int64_t> out = ear_clip(vertices, loop);
    if (!out.empty())
        return out;
    SmPoint3d middle;
    loop_normal(vertices, loop, middle);
    new_vertices.insert(new_vertices.end(), {middle.x, middle.y, middle.z});
    for (size_t i = 0; i < loop.size(); ++i)
        out.insert(out.end(), {next_index, loop[i], loop[(i + 1) % loop.size()]});
    return out;
}

// The holes of a mesh (triangles by welded point index, -1 for one left out): loops of the edges
// only one triangle has, each in the order the hole's polygon must run to face as the triangles
// beside it (against the triangles' own edges). `open` counts borders that do not close.
std::vector<std::vector<int64_t>> holes(const std::vector<int64_t>& triangles, int64_t& open)
{
    std::unordered_map<uint64_t, int32_t> uses;
    const size_t m = triangles.size() / 3;
    for (size_t t = 0; t < m; ++t)
    {
        if (triangles[3 * t] < 0)
            continue;
        for (int k = 0; k < 3; ++k)
            ++uses[edge_key(triangles[3 * t + k], triangles[3 * t + (k + 1) % 3])];
    }
    // the border edges against the triangles' direction: from b to a for a triangle's edge a -> b
    std::unordered_map<int64_t, std::vector<int64_t>> next;
    size_t count = 0;
    for (size_t t = 0; t < m; ++t)
    {
        if (triangles[3 * t] < 0)
            continue;
        for (int k = 0; k < 3; ++k)
        {
            const int64_t a = triangles[3 * t + k], b = triangles[3 * t + (k + 1) % 3];
            if (uses[edge_key(a, b)] == 1)
            {
                next[b].push_back(a);
                ++count;
            }
        }
    }
    std::vector<std::vector<int64_t>> out;
    open = 0;
    size_t used = 0;
    while (used < count)
    {
        // a point with a border edge left
        auto start = std::find_if(next.begin(), next.end(), [](const auto& item) { return !item.second.empty(); });
        if (start == next.end())
            break;
        std::vector<int64_t> loop = {start->first};
        std::unordered_map<int64_t, size_t> where = {{start->first, 0}};
        int64_t at = start->first;
        bool closed = false;
        while (true)
        {
            auto& out_edges = next[at];
            if (out_edges.empty())
                break;
            const int64_t to = out_edges.back();
            out_edges.pop_back();
            ++used;
            if (to == loop.front())
            {
                closed = true;
                break;
            }
            const auto again = where.find(to);
            if (again != where.end())
            {
                // back at a point of the loop (holes that touch there): the part since is a hole of
                // its own
                std::vector<int64_t> part(loop.begin() + static_cast<std::ptrdiff_t>(again->second), loop.end());
                for (size_t i = again->second + 1; i < loop.size(); ++i)
                    where.erase(loop[i]);
                loop.resize(again->second + 1);
                if (part.size() >= 3)
                    out.push_back(std::move(part));
                at = to;
                continue;
            }
            where.emplace(to, loop.size());
            loop.push_back(to);
            at = to;
        }
        if (closed && loop.size() >= 3)
            out.push_back(std::move(loop));
        else
            ++open;
    }
    return out;
}

// The edges of a mesh (triangles by welded point index, -1 for one left out) that are not shared
// by exactly two triangles.
int64_t open_edges(const std::vector<int64_t>& triangles)
{
    std::unordered_map<uint64_t, int32_t> uses;
    for (size_t t = 0; t + 2 < triangles.size(); t += 3)
    {
        if (triangles[t] < 0)
            continue;
        for (int k = 0; k < 3; ++k)
        {
            const int64_t a = triangles[t + k], b = triangles[t + (k + 1) % 3];
            if (a != b)
                ++uses[edge_key(a, b)];
        }
    }
    int64_t n = 0;
    for (const auto& item : uses)
        if (item.second != 2)
            ++n;
    return n;
}

// Turns triangles (by welded point index, -1 for one left out) to face the way their neighbours
// face, across edges two triangles share: each connected piece as its first triangle, then a closed
// piece outward (a positive volume), an open one as most of its triangles were. The number turned.
int64_t orient(std::vector<int64_t>& triangles, const std::vector<double>& vertices)
{
    const size_t m = triangles.size() / 3;
    std::unordered_map<uint64_t, std::vector<int32_t>> by_edge;
    for (size_t t = 0; t < m; ++t)
    {
        if (triangles[3 * t] < 0)
            continue;
        for (int k = 0; k < 3; ++k)
            by_edge[edge_key(triangles[3 * t + k], triangles[3 * t + (k + 1) % 3])].push_back(static_cast<int32_t>(t));
    }
    // whether triangle t runs along the edge a -> b (rather than b -> a)
    auto along = [&](size_t t, int64_t a, int64_t b) {
        for (int k = 0; k < 3; ++k)
            if (triangles[3 * t + k] == a && triangles[3 * t + (k + 1) % 3] == b)
                return true;
        return false;
    };
    std::vector<int8_t> flip(m, -1);  // -1: not reached yet
    int64_t turned = 0;
    for (size_t seed = 0; seed < m; ++seed)
    {
        if (triangles[3 * seed] < 0 || flip[seed] >= 0)
            continue;
        std::vector<int32_t> piece = {static_cast<int32_t>(seed)};
        flip[seed] = 0;
        bool closed = true;
        for (size_t i = 0; i < piece.size(); ++i)
        {
            const size_t t = piece[i];
            for (int k = 0; k < 3; ++k)
            {
                int64_t a = triangles[3 * t + k], b = triangles[3 * t + (k + 1) % 3];
                const auto& around = by_edge[edge_key(a, b)];
                if (around.size() == 1)
                    closed = false;
                if (around.size() != 2)
                    continue;  // (a border, or an edge of more than two triangles)
                const size_t u = around[0] == static_cast<int32_t>(t) ? around[1] : around[0];
                if (flip[u] >= 0)
                    continue;
                if (flip[t])
                    std::swap(a, b);  // (t as it will run)
                // u must run the other way: b -> a
                flip[u] = along(u, b, a) ? 0 : 1;
                piece.push_back(static_cast<int32_t>(u));
            }
        }
        int64_t flipped = 0;
        for (int32_t t : piece)
            flipped += flip[t];
        bool all = false;
        if (closed)
        {
            double volume = 0.0;
            for (int32_t t : piece)
            {
                const SmPoint3d a = point(vertices, triangles[3 * t]), b = point(vertices, triangles[3 * t + 1]),
                                c = point(vertices, triangles[3 * t + 2]);
                const double v = SmVector3d(a).Dot(SmVector3d(b) * SmVector3d(c));
                volume += flip[t] ? -v : v;
            }
            all = volume < 0;
        }
        else
            all = 2 * flipped > static_cast<int64_t>(piece.size());
        for (int32_t t : piece)
        {
            if (all)
                flip[t] = static_cast<int8_t>(1 - flip[t]);
            if (flip[t])
            {
                std::swap(triangles[3 * t + 1], triangles[3 * t + 2]);
                ++turned;
            }
        }
    }
    return turned;
}

// The triangles (three point indices each; -1, -1, -1 for one left out) without folds: two
// triangles on the same three points, back to back, both go (they enclose nothing; the decimation
// left 9 such pairs halving a sphere of 15 000 triangles, each making its edges shared by four
// triangles); a triangle repeated the same way round goes once.
std::vector<int64_t> without_folds(const std::vector<int64_t>& tris)
{
    std::unordered_map<std::array<int64_t, 3>, std::vector<size_t>, KeyHash> same;
    for (size_t t = 0; t < tris.size() / 3; ++t)
    {
        if (tris[3 * t] < 0)
            continue;
        std::array<int64_t, 3> key = {tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]};
        std::sort(key.begin(), key.end());
        same[key].push_back(t);
    }
    // the way round of a triangle: the order of its points from the smallest on
    auto way = [&](size_t t) {
        const int64_t* c = &tris[3 * t];
        const int k = c[0] < c[1] ? (c[0] < c[2] ? 0 : 2) : (c[1] < c[2] ? 1 : 2);
        return c[(k + 1) % 3] < c[(k + 2) % 3];
    };
    std::vector<bool> drop(tris.size() / 3, false);
    for (const auto& item : same)
    {
        const std::vector<size_t>& list = item.second;
        if (list.size() < 2)
            continue;
        int balance = 0;
        for (size_t t : list)
            balance += way(t) ? 1 : -1;
        // keep one of the way most of them run when they do not cancel
        bool kept = balance == 0;
        for (size_t t : list)
        {
            if (!kept && (way(t) ? 1 : -1) * balance > 0)
            {
                kept = true;
                continue;
            }
            drop[t] = true;
        }
    }
    std::vector<int64_t> out;
    for (size_t t = 0; t < tris.size() / 3; ++t)
        if (tris[3 * t] >= 0 && !drop[t])
            out.insert(out.end(), {tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]});
    return out;
}

// The triangles of a mesh that face against the triangles beside them (their normal against the
// sum of their neighbours' normals, weighted by area): folds.
int64_t folds(const std::vector<double>& vertices, const std::vector<int64_t>& tris)
{
    auto normal = [&](size_t t) {
        return (point(vertices, tris[3 * t + 1]) - point(vertices, tris[3 * t])) *
               (point(vertices, tris[3 * t + 2]) - point(vertices, tris[3 * t]));
    };
    std::unordered_map<uint64_t, std::vector<int32_t>> by_edge;
    for (size_t t = 0; t < tris.size() / 3; ++t)
        if (tris[3 * t] >= 0)
            for (int k = 0; k < 3; ++k)
                by_edge[edge_key(tris[3 * t + k], tris[3 * t + (k + 1) % 3])].push_back(static_cast<int32_t>(t));
    int64_t n = 0;
    for (size_t t = 0; t < tris.size() / 3; ++t)
    {
        if (tris[3 * t] < 0)
            continue;
        SmVector3d around(0, 0, 0);
        for (int k = 0; k < 3; ++k)
            for (int32_t u : by_edge[edge_key(tris[3 * t + k], tris[3 * t + (k + 1) % 3])])
                if (static_cast<size_t>(u) != t)
                    around += normal(u);
        if (normal(t).Dot(around) < 0)
            ++n;
    }
    return n;
}

// Collapses the folds that flips and merges leave in a decimated mesh (a sphere of 56 000 triangles
// taken to a tenth kept 10 slivers folded over, each about a thousandth of the mean area). A corner of
// a folded triangle that only three or four triangles share (a point pushed through its neighbours, the
// tip of a sliver) goes, its triangles made one or two along their outer edges (of two, the diagonal
// that faces as the outer edges go round). Else an edge of a folded triangle, the shortest first,
// is collapsed, one end moved onto the other, where the mesh stays a manifold there (the two ends share
// no neighbour but the corners across the edge, which two triangles have) and no triangle around the
// end that moves turns over or loses its area; the two triangles on the edge go (-1, -1, -1). Repeated
// while that removes folds, 64 times at most.
void collapse_folds(const std::vector<double>& vertices, std::vector<int64_t>& tris)
{
    auto normal = [&](const int64_t* c) {
        return (point(vertices, c[1]) - point(vertices, c[0])) * (point(vertices, c[2]) - point(vertices, c[0]));
    };
    const size_t m = tris.size() / 3;
    for (int pass = 0; pass < 64; ++pass)
    {
        std::unordered_map<uint64_t, std::vector<int32_t>> by_edge;
        std::unordered_map<int64_t, std::vector<int32_t>> by_point;
        for (size_t t = 0; t < m; ++t)
            if (tris[3 * t] >= 0)
                for (int k = 0; k < 3; ++k)
                {
                    by_edge[edge_key(tris[3 * t + k], tris[3 * t + (k + 1) % 3])].push_back(static_cast<int32_t>(t));
                    by_point[tris[3 * t + k]].push_back(static_cast<int32_t>(t));
                }
        std::vector<size_t> folded;
        for (size_t t = 0; t < m; ++t)
        {
            if (tris[3 * t] < 0)
                continue;
            SmVector3d around(0, 0, 0);
            for (int k = 0; k < 3; ++k)
                for (int32_t u : by_edge[edge_key(tris[3 * t + k], tris[3 * t + (k + 1) % 3])])
                    if (static_cast<size_t>(u) != t)
                        around += normal(&tris[3 * u]);
            if (normal(&tris[3 * t]).Dot(around) < 0)
                folded.push_back(t);
        }
        if (folded.empty())
            return;
        std::unordered_set<int64_t> touched;  // (points whose triangles a collapse of this pass changed)
        bool changed = false;
        for (size_t t : folded)
        {
            if (tris[3 * t] < 0)
                continue;
            const int64_t* c = &tris[3 * t];
            if (touched.count(c[0]) || touched.count(c[1]) || touched.count(c[2]))
                continue;
            // a corner of three or four triangles: they become one or two along their outer edges
            for (int k = 0; k < 3 && !(tris[3 * t] < 0); ++k)
            {
                const int64_t v = c[k];
                std::vector<int32_t> around;
                for (int32_t u : by_point[v])
                    if (tris[3 * u] >= 0)
                        around.push_back(u);
                if (around.size() != 3 && around.size() != 4)
                    continue;
                std::unordered_map<int64_t, int64_t> next;  // (the outer edges: from -> to)
                for (int32_t u : around)
                {
                    const int64_t* d = &tris[3 * u];
                    const int j = d[0] == v ? 0 : d[1] == v ? 1 : 2;
                    next[d[(j + 1) % 3]] = d[(j + 2) % 3];
                }
                if (next.size() != around.size())
                    continue;
                std::vector<int64_t> ring = {next.begin()->first};  // (one cycle, as they run)
                while (ring.size() <= around.size() && next.count(ring.back()) && next[ring.back()] != ring.front())
                    ring.push_back(next[ring.back()]);
                if (ring.size() != around.size() || !next.count(ring.back()) || next[ring.back()] != ring.front())
                    continue;  // (not one cycle: a corner on the border)
                SmVector3d facing(0, 0, 0);  // (the ring's own normal, Newell's)
                for (size_t i = 0; i < ring.size(); ++i)
                    facing += point(vertices, ring[i]) * point(vertices, ring[(i + 1) % ring.size()]);
                // the candidates: the ring as one triangle, or split along one diagonal or the other
                std::vector<std::vector<std::array<int64_t, 3>>> options;
                if (ring.size() == 3)
                    options.push_back({{ring[0], ring[1], ring[2]}});
                else
                    for (int s = 0; s < 2; ++s)
                        options.push_back({{ring[s], ring[s + 1], ring[s + 2]}, {ring[s], ring[s + 2], ring[(s + 3) % 4]}});
                double best = 0.0;
                int chosen = -1;
                for (size_t o = 0; o < options.size(); ++o)
                {
                    double worst = 1.0;
                    for (const auto& tri : options[o])
                    {
                        const SmVector3d n = normal(tri.data());
                        worst = std::min(worst, n.Length() > 0 && facing.Length() > 0 ? n.Dot(facing) / (n.Length() * facing.Length()) : -1.0);
                    }
                    if (ring.size() == 4)  // (a diagonal that is an edge already would be shared by four triangles)
                    {
                        const int s = static_cast<int>(o);
                        if (by_edge.count(edge_key(ring[s], ring[s + 2])))
                            worst = -1.0;
                    }
                    else
                    {
                        std::array<int64_t, 3> s3 = options[o][0];  // (the three a triangle of their own already)
                        std::sort(s3.begin(), s3.end());
                        for (int32_t u : by_point[ring[0]])
                            if (tris[3 * u] >= 0 && std::find(around.begin(), around.end(), u) == around.end())
                            {
                                std::array<int64_t, 3> d = {tris[3 * u], tris[3 * u + 1], tris[3 * u + 2]};
                                std::sort(d.begin(), d.end());
                                if (d == s3)
                                    worst = -1.0;
                            }
                    }
                    if (worst > best)
                        best = worst, chosen = static_cast<int>(o);
                }
                if (chosen < 0)
                    continue;
                const auto& made = options[static_cast<size_t>(chosen)];
                for (size_t i = 0; i < around.size(); ++i)
                {
                    int64_t* d = &tris[3 * around[i]];
                    if (i < made.size())
                        std::copy(made[i].begin(), made[i].end(), d);
                    else
                        d[0] = d[1] = d[2] = -1;
                }
                touched.insert(v);
                touched.insert(ring.begin(), ring.end());
                changed = true;
                break;
            }
            if (tris[3 * t] < 0 || touched.count(c[0]) || touched.count(c[1]) || touched.count(c[2]))
                continue;
            std::array<int, 3> order = {0, 1, 2};  // (edges by length, shortest first)
            auto length = [&](int k) { return point(vertices, c[k]).DistanceBetween(point(vertices, c[(k + 1) % 3])); };
            std::sort(order.begin(), order.end(), [&](int i, int j) { return length(i) < length(j); });
            bool done = false;
            for (int k : order)
            {
                const int64_t p = c[k], q = c[(k + 1) % 3];
                const std::vector<int32_t>& on_edge = by_edge[edge_key(p, q)];
                if (on_edge.size() != 2)
                    continue;  // (a border edge, or one of more than two triangles)
                std::unordered_set<int64_t> across;
                for (int32_t u : on_edge)
                    for (int j = 0; j < 3; ++j)
                        if (tris[3 * u + j] != p && tris[3 * u + j] != q)
                            across.insert(tris[3 * u + j]);
                auto neighbours = [&](int64_t v) {
                    std::unordered_set<int64_t> out;
                    for (int32_t u : by_point[v])
                        if (tris[3 * u] >= 0)
                            for (int j = 0; j < 3; ++j)
                                out.insert(tris[3 * u + j]);
                    return out;
                };
                const std::unordered_set<int64_t> np = neighbours(p), nq = neighbours(q);
                bool manifold = true;
                for (int64_t v : np)
                    if (v != p && v != q && nq.count(v) && !across.count(v))
                        manifold = false;
                if (!manifold)
                    continue;
                for (const auto& [keep, gone] : {std::pair<int64_t, int64_t>{p, q}, std::pair<int64_t, int64_t>{q, p}})
                {
                    bool sound = true;
                    for (int32_t u : by_point[gone])
                    {
                        if (tris[3 * u] < 0 || std::find(on_edge.begin(), on_edge.end(), u) != on_edge.end())
                            continue;
                        std::array<int64_t, 3> moved = {tris[3 * u], tris[3 * u + 1], tris[3 * u + 2]};
                        for (int64_t& v : moved)
                            if (v == gone)
                                v = keep;
                        const SmVector3d before = normal(&tris[3 * u]), after = normal(moved.data());
                        if (!(after.Dot(before) > 0) || !(after.Length() > 1e-6 * before.Length()))
                            sound = false;
                    }
                    if (!sound)
                        continue;
                    for (int32_t u : on_edge)
                        tris[3 * u] = tris[3 * u + 1] = tris[3 * u + 2] = -1;
                    for (int32_t u : by_point[gone])
                        if (tris[3 * u] >= 0)
                            for (int j = 0; j < 3; ++j)
                                if (tris[3 * u + j] == gone)
                                    tris[3 * u + j] = keep;
                    touched.insert(np.begin(), np.end());
                    touched.insert(nq.begin(), nq.end());
                    done = changed = true;
                    break;
                }
                if (done)
                    break;
            }
        }
        if (!changed)
            return;
    }
}

// Unpinches a decimated mesh: the decimation can fold two slivers onto an edge of the surface (the
// edge then has four triangles, two each way; a sphere of 56 000 triangles taken to a quarter had
// one, which stayed there taken further). Of the two pairs of a triangle each way, the one of less
// area (the slivers) gets the other diagonal of the quadrilateral the pair makes, so that the edge
// has two triangles again. The mesh stays watertight.
void unpinch(const std::vector<double>& vertices, std::vector<int64_t>& tris)
{
    auto area = [&](size_t t) {
        return ((point(vertices, tris[3 * t + 1]) - point(vertices, tris[3 * t])) *
                (point(vertices, tris[3 * t + 2]) - point(vertices, tris[3 * t])))
            .Length();
    };
    // the corner of triangle t after the edge a -> b (-1: t does not run a -> b)
    auto after = [&](size_t t, int64_t a, int64_t b) -> int64_t {
        for (int j = 0; j < 3; ++j)
            if (tris[3 * t + j] == a && tris[3 * t + (j + 1) % 3] == b)
                return tris[3 * t + (j + 2) % 3];
        return -1;
    };
    for (int pass = 0; pass < 8; ++pass)
    {
        std::unordered_map<uint64_t, std::vector<int32_t>> by_edge;
        for (size_t t = 0; t < tris.size() / 3; ++t)
            if (tris[3 * t] >= 0)
                for (int k = 0; k < 3; ++k)
                    by_edge[edge_key(tris[3 * t + k], tris[3 * t + (k + 1) % 3])].push_back(static_cast<int32_t>(t));
        bool changed = false;
        for (const auto& [key, list] : by_edge)
        {
            if (list.size() != 4)
                continue;
            const int64_t a = static_cast<int64_t>(key >> 32), b = static_cast<int64_t>(key & 0xffffffffu);
            std::vector<size_t> forth, back;  // running a -> b, b -> a
            for (int32_t t : list)
                (after(t, a, b) >= 0 ? forth : back).push_back(static_cast<size_t>(t));
            if (forth.size() != 2 || back.size() != 2)
                continue;
            // the pairs, those of less area first, the first whose other diagonal is no edge yet
            std::vector<std::pair<double, std::pair<size_t, size_t>>> pairs;
            for (size_t f : forth)
                for (size_t g : back)
                    pairs.push_back({area(f) + area(g), {f, g}});
            std::sort(pairs.begin(), pairs.end());
            for (const auto& [_, pair] : pairs)
            {
                const auto [t, u] = pair;
                const int64_t r = after(t, a, b), s = after(u, b, a);
                if (r < 0 || s < 0 || r == s || by_edge.count(edge_key(r, s)))
                    continue;
                // t: a -> b -> r, u: b -> a -> s; the quadrilateral a, s, b, r gets the diagonal r - s
                tris[3 * t] = r, tris[3 * t + 1] = a, tris[3 * t + 2] = s;
                tris[3 * u] = s, tris[3 * u + 1] = b, tris[3 * u + 2] = r;
                changed = true;
                break;
            }
            if (changed)
                break;  // (the map is stale now)
        }
        if (!changed)
            break;
    }
}

// Turns folds of a decimated mesh back: the decimation leaves a few slivers (a triangle whose
// longest side is about as long as the other two together) folded over, facing against the
// triangles around them (17 of 7482 halving a sphere of 15 000 triangles), which shade as dark
// specks. An edge of such a triangle, the longest first, is flipped (the two triangles beside it
// get the other diagonal of the quadrilateral they make) where both new triangles then face as the
// triangles around do; where no flip does, the sliver's corner opposite its longest edge, which
// lies about on that edge, is merged into the nearer end of it (the sliver and the triangle beside
// it go; triangles left out are -1, -1, -1), where that keeps the mesh a surface and turns no
// triangle over. The mesh stays closed.
void unfold(const std::vector<double>& vertices, std::vector<int64_t>& tris)
{
    const size_t m = tris.size() / 3;
    auto normal = [&](int64_t a, int64_t b, int64_t c) {
        return (point(vertices, b) - point(vertices, a)) * (point(vertices, c) - point(vertices, a));
    };
    for (int pass = 0; pass < 64; ++pass)
    {
        std::unordered_map<uint64_t, std::vector<int32_t>> by_edge;
        std::unordered_map<int64_t, std::vector<int32_t>> at_point;
        for (size_t t = 0; t < m; ++t)
        {
            if (tris[3 * t] < 0)
                continue;
            for (int k = 0; k < 3; ++k)
            {
                by_edge[edge_key(tris[3 * t + k], tris[3 * t + (k + 1) % 3])].push_back(static_cast<int32_t>(t));
                at_point[tris[3 * t + k]].push_back(static_cast<int32_t>(t));
            }
        }
        std::vector<bool> touched(m, false);
        int64_t changed = 0;
        bool collapsed = false;
        for (size_t t = 0; t < m && !collapsed; ++t)
        {
            if (touched[t] || tris[3 * t] < 0)
                continue;
            const int64_t c[3] = {tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]};
            // the normals of the triangles beside it, weighted by their areas
            SmVector3d around(0, 0, 0);
            for (int k = 0; k < 3; ++k)
                for (int32_t u : by_edge[edge_key(c[k], c[(k + 1) % 3])])
                    if (static_cast<size_t>(u) != t)
                        around += normal(tris[3 * u], tris[3 * u + 1], tris[3 * u + 2]);
            if (normal(c[0], c[1], c[2]).Dot(around) >= 0)
                continue;
            // its edges, longest first: p -> q, and r the corner opposite
            int order[3] = {0, 1, 2};
            double lengths[3];
            for (int j = 0; j < 3; ++j)
                lengths[j] = point(vertices, c[j]).DistanceBetween(point(vertices, c[(j + 1) % 3]));
            std::sort(order, order + 3, [&](int a, int b) { return lengths[a] > lengths[b]; });
            bool done = false;
            for (int k : order)
            {
                const int64_t p = c[k], q = c[(k + 1) % 3], r = c[(k + 2) % 3];
                const auto& across = by_edge[edge_key(p, q)];
                if (across.size() != 2)
                    continue;
                const size_t u = static_cast<size_t>(across[0]) == t ? across[1] : across[0];
                if (touched[u])
                    continue;
                // u runs q -> p -> s
                int64_t s = -1;
                for (int j = 0; j < 3; ++j)
                    if (tris[3 * u + j] == q && tris[3 * u + (j + 1) % 3] == p)
                        s = tris[3 * u + (j + 2) % 3];
                if (s < 0 || s == r || by_edge.count(edge_key(r, s)))
                    continue;
                if (!(normal(r, p, s).Dot(around) > 0 && normal(s, q, r).Dot(around) > 0))
                    continue;
                tris[3 * t] = r, tris[3 * t + 1] = p, tris[3 * t + 2] = s;
                tris[3 * u] = s, tris[3 * u + 1] = q, tris[3 * u + 2] = r;
                by_edge[edge_key(r, s)] = {static_cast<int32_t>(t), static_cast<int32_t>(u)};  // (taken)
                touched[t] = touched[u] = true;
                done = true;
                break;
            }
            if (done)
            {
                ++changed;
                continue;
            }
            if (changed)
                continue;  // (after a flip the maps are stale: merging waits for the next pass)
            // merge the corner opposite the longest edge into the nearer end of it
            const int k = order[0];
            const int64_t p = c[k], q = c[(k + 1) % 3], r = c[(k + 2) % 3];
            const bool p_nearer = point(vertices, r).DistanceBetween(point(vertices, p)) <=
                                  point(vertices, r).DistanceBetween(point(vertices, q));
            for (const int64_t keep : {p_nearer ? p : q, p_nearer ? q : p})
            {
                const int64_t other = keep == p ? q : p;
                const auto& pair = by_edge[edge_key(r, keep)];
                if (pair.size() != 2)
                    continue;
                const size_t w = static_cast<size_t>(pair[0]) == t ? pair[1] : pair[0];
                int64_t x = -1;
                for (int j = 0; j < 3; ++j)
                    if (tris[3 * w + j] != r && tris[3 * w + j] != keep)
                        x = tris[3 * w + j];
                // the points next to both must be the two corners opposite their edge (a surface)
                auto next_to = [&](int64_t v) {
                    std::unordered_set<int64_t> out;
                    for (int32_t f : at_point[v])
                        for (int j = 0; j < 3; ++j)
                            if (tris[3 * f + j] != v)
                                out.insert(tris[3 * f + j]);
                    return out;
                };
                const std::unordered_set<int64_t> nr = next_to(r), nk = next_to(keep);
                size_t shared = 0;
                for (int64_t v : nr)
                    shared += nk.count(v);
                if (x < 0 || x == other || shared != 2 || !nr.count(other) || !nk.count(x))
                    continue;
                // no triangle may turn over, or lie on the points of another
                std::unordered_set<std::array<int64_t, 3>, KeyHash> at_keep;
                for (int32_t f : at_point[keep])
                {
                    std::array<int64_t, 3> key = {tris[3 * f], tris[3 * f + 1], tris[3 * f + 2]};
                    std::sort(key.begin(), key.end());
                    at_keep.insert(key);
                }
                bool ok = true;
                for (int32_t f : at_point[r])
                {
                    if (static_cast<size_t>(f) == t || static_cast<size_t>(f) == w)
                        continue;
                    int64_t g[3] = {tris[3 * f], tris[3 * f + 1], tris[3 * f + 2]};
                    const SmVector3d before = normal(g[0], g[1], g[2]);
                    for (int64_t& v : g)
                        if (v == r)
                            v = keep;
                    const SmVector3d after = normal(g[0], g[1], g[2]);
                    std::array<int64_t, 3> key = {g[0], g[1], g[2]};
                    std::sort(key.begin(), key.end());
                    if (!(after.Dot(before) > 0 && after.Dot(around) > 0) || at_keep.count(key))
                        ok = false;
                }
                if (!ok)
                    continue;
                for (int32_t f : at_point[r])
                    for (int j = 0; j < 3; ++j)
                        if (tris[3 * f + j] == r)
                            tris[3 * f + j] = keep;
                for (const size_t f : {t, w})
                    tris[3 * f] = tris[3 * f + 1] = tris[3 * f + 2] = -1;
                collapsed = true;  // (the maps are stale now: the next pass makes them again)
                ++changed;
                break;
            }
        }
        if (!changed)
            break;
    }
}

// ------------------------------------------------------------------------------ coplanar merging

// The plane of a polygon (Newell's normal, through the middle of its corners); false for one
// without an area.
bool polygon_plane(SmPolyFace* face, SmVector3d& normal, SmPoint3d& origin)
{
    SmPolyLoop* loop = face->GetOuterPolyLoop();
    if (!loop)
        return false;
    SmTArray<SmPolyEdge*> edges;
    loop->GetPolyEdges(edges);
    if (edges.GetSize() < 3)
        return false;
    SmVector3d n(0, 0, 0), sum(0, 0, 0);
    for (ULONG i = 0; i < edges.GetSize(); ++i)
    {
        const SmPoint3d p = edges[i]->GetStartPoint(), q = edges[i]->GetEndPoint();
        n.x += (p.y - q.y) * (p.z + q.z);
        n.y += (p.z - q.z) * (p.x + q.x);
        n.z += (p.x - q.x) * (p.y + q.y);
        sum += SmVector3d(p);
    }
    const double length = n.Length();
    if (!(length > 0))
        return false;
    normal = n * (1.0 / length);
    const double k = 1.0 / edges.GetSize();
    origin = SmPoint3d(sum.x * k, sum.y * k, sum.z * k);
    return true;
}

// Whether every corner of `other` lies within tol of the plane of `face`, the two facing one way.
bool coplanar(SmPolyFace* face, SmPolyFace* other, double tol)
{
    SmVector3d n1, n2;
    SmPoint3d o1, o2;
    if (!polygon_plane(face, n1, o1) || !polygon_plane(other, n2, o2) || n1.Dot(n2) <= 0)
        return false;
    for (SmPolyFace* f : {face, other})
    {
        SmTArray<SmPolyLoop*> loops;
        f->GetPolyLoops(loops);
        for (ULONG l = 0; l < loops.GetSize(); ++l)
        {
            SmTArray<SmPolyEdge*> edges;
            loops[l]->GetPolyEdges(edges);
            for (ULONG i = 0; i < edges.GetSize(); ++i)
                if (std::fabs((edges[i]->GetStartPoint() - o1).Dot(n1)) > tol)
                    return false;
        }
    }
    return true;
}

// Merges neighbouring polygons that lie in one plane (within tol) into one, removing the edges
// between them.
void merge_coplanar(SmPolyBrep* poly, double tol)
{
    for (int pass = 0; pass < 8; ++pass)
    {
        SmTArray<SmPolyEdge*> edges;
        poly->GetPolyEdges(edges);
        std::unordered_set<const SmPolyEdge*> gone;
        bool changed = false;
        for (ULONG i = 0; i < edges.GetSize(); ++i)
        {
            SmPolyEdge* edge = edges[i];
            if (gone.count(edge) || !edge->IsManifold())
                continue;
            SmPolyEdge* mate = edge->GetRadial();
            if (!mate || mate == edge || gone.count(mate))
                continue;
            SmPolyFace* face = edge->GetPolyFace();
            SmPolyFace* other = mate->GetPolyFace();
            if (!face || !other || face == other || !coplanar(face, other, tol))
                continue;
            SmTArray<SmPolyEdge*> removed;
            if (!poly->RemoveEdgeBetweenCoplanarFaces(edge, removed))
                continue;
            changed = true;
            gone.insert(edge);
            gone.insert(mate);
            for (ULONG k = 0; k < removed.GetSize(); ++k)
                gone.insert(removed[k]);
        }
        if (!changed)
            break;
    }
}

// The size of a mesh: the larger of the diagonal of its box and its largest coordinate (as the
// kernel's STL reader takes it).
double mesh_size(const std::vector<double>& vertices)
{
    SmExtent3d box;
    double largest = 0.0;
    for (size_t i = 0; i < vertices.size() / 3; ++i)
    {
        box.AddPoint3d(point(vertices, i));
        for (int k = 0; k < 3; ++k)
            largest = std::max(largest, std::fabs(vertices[3 * i + k]));
    }
    return std::max(vertices.empty() ? 0.0 : box.GetSize().Length(), largest);
}

// Triangles by welded point index, for poly_from_triangles (its long indices).
std::vector<long> welded_triangles(const std::vector<int64_t>& triangles, const std::vector<int64_t>& id)
{
    std::vector<long> out(triangles.size());
    for (size_t i = 0; i < triangles.size(); ++i)
        out[i] = static_cast<long>(id[triangles[i]]);
    return out;
}

}  // namespace

namespace smlibpy {

NearestPoints mesh_nearest_points(const std::vector<double>& vertices, const std::vector<int64_t>& triangles,
                             const std::vector<double>& points)
{
    check_mesh(vertices, triangles, "mesh_nearest_points");
    check_points(points, "mesh_nearest_points: the points");
    const TriangleTree tree(vertices, triangles);
    const size_t n = points.size() / 3;
    NearestPoints out;
    out.triangles.resize(n);
    out.distances.resize(n);
    out.points.resize(3 * n, std::numeric_limits<double>::quiet_NaN());
    for (size_t i = 0; i < n; ++i)
    {
        SmPoint3d q;
        double distance = 0.0;
        out.triangles[i] = tree.nearest(point(points, i), distance, q);
        out.distances[i] = distance;
        if (out.triangles[i] >= 0)
        {
            out.points[3 * i] = q.x;
            out.points[3 * i + 1] = q.y;
            out.points[3 * i + 2] = q.z;
        }
    }
    return out;
}

std::vector<float> crease_normals(const std::vector<double>& vertices, const std::vector<int64_t>& triangles,
                                  double crease_angle_deg)
{
    check_mesh(vertices, triangles, "crease_normals");
    const size_t m = triangles.size() / 3;
    const std::vector<int64_t> id = weld(vertices);
    std::vector<SmVector3d> normals(m, SmVector3d(0, 0, 0));
    std::vector<std::array<double, 3>> angles(m, {0.0, 0.0, 0.0});
    std::unordered_map<int64_t, std::vector<std::pair<int32_t, int8_t>>> around;  // point -> (triangle, corner)
    for (size_t t = 0; t < m; ++t)
    {
        SmPoint3d c[3];
        for (int k = 0; k < 3; ++k)
            c[k] = point(vertices, triangles[3 * t + k]);
        const SmVector3d n = (c[1] - c[0]) * (c[2] - c[0]);
        const double length = n.Length();
        if (length > 0)
            normals[t] = n * (1.0 / length);
        for (int k = 0; k < 3; ++k)
        {
            const SmVector3d u = c[(k + 1) % 3] - c[k], w = c[(k + 2) % 3] - c[k];
            const double lu = u.Length(), lw = w.Length();
            angles[t][k] = lu > 0 && lw > 0 ? std::acos(std::clamp(u.Dot(w) / (lu * lw), -1.0, 1.0)) : 0.0;
            around[id[triangles[3 * t + k]]].emplace_back(static_cast<int32_t>(t), static_cast<int8_t>(k));
        }
    }
    const double limit = std::cos(std::clamp(crease_angle_deg, 0.0, 180.0) * kPi / 180.0) - 1e-12;
    // A sliver (no higher than a tenth of its longest side) that turns from all its neighbours by
    // more than the crease angle is a tilted sliver of a decimation, not a facet of its own (a cut
    // corner of a box is no sliver): its corners take the normals around them that turn from the
    // neighbour across its longest side by at most the crease angle.
    std::unordered_map<uint64_t, std::vector<int32_t>> by_edge;
    for (size_t t = 0; t < m; ++t)
        for (int k = 0; k < 3; ++k)
            by_edge[edge_key(id[triangles[3 * t + k]], id[triangles[3 * t + (k + 1) % 3]])].push_back(static_cast<int32_t>(t));
    std::vector<SmVector3d> reference(normals);
    std::vector<bool> tilted(m, false);
    for (size_t t = 0; t < m; ++t)
    {
        SmPoint3d c[3];
        double longest = 0.0;
        int side = 0;
        for (int k = 0; k < 3; ++k)
            c[k] = point(vertices, triangles[3 * t + k]);
        for (int k = 0; k < 3; ++k)
        {
            const double length = c[k].DistanceBetween(c[(k + 1) % 3]);
            if (length > longest)
                longest = length, side = k;
        }
        const double area2 = ((c[1] - c[0]) * (c[2] - c[0])).Length();
        if (!(longest > 0) || area2 / longest > 0.1 * longest)
            continue;
        bool alone = true;
        int32_t across = -1;
        for (int k = 0; k < 3 && alone; ++k)
            for (int32_t u : by_edge[edge_key(id[triangles[3 * t + k]], id[triangles[3 * t + (k + 1) % 3]])])
                if (static_cast<size_t>(u) != t)
                {
                    if (normals[u].Dot(normals[t]) >= limit)
                        alone = false;
                    if (k == side)
                        across = u;
                }
        if (alone && across >= 0)
        {
            tilted[t] = true;
            reference[t] = normals[across];
        }
    }
    std::vector<float> out(9 * m, 0.0f);
    for (size_t t = 0; t < m; ++t)
        for (int k = 0; k < 3; ++k)
        {
            SmVector3d sum(0, 0, 0);
            for (const auto& [u, j] : around[id[triangles[3 * t + k]]])
                if (!(tilted[u] && static_cast<size_t>(u) != t) && normals[u].Dot(reference[t]) >= limit)
                    sum += normals[u] * angles[u][j];
            if (tilted[t])
                sum -= normals[t] * angles[t][k];  // (its own normal is the tilted one)
            const double length = sum.Length();
            const SmVector3d n = length > 0 ? sum * (1.0 / length) : reference[t];
            out[9 * t + 3 * k] = static_cast<float>(n.x);
            out[9 * t + 3 * k + 1] = static_cast<float>(n.y);
            out[9 * t + 3 * k + 2] = static_cast<float>(n.z);
        }
    return out;
}

// One run of the kernel's decimation (see decimate_triangles), of triangles by welded point index.
static TriangleArrays decimate_once(const std::vector<double>& vertices, const std::vector<long>& welded, double fraction,
                             double feature_angle_deg, bool keep_boundary)
{
    PolyPtr poly(poly_from_triangles(vertices, welded));
    SmPyErrorTrail::clear();
    SmPolyDecimate decimation(poly.get(), fraction, 0.0, FALSE, feature_angle_deg, 1.0, keep_boundary ? 0.0 : 1.0);
    check_status(decimation.DoQuadricDecimation(), "SmPolyDecimate::DoQuadricDecimation");
    triangulate_poly(poly.get());
    const PolyArrays arrays = poly_arrays(poly.get(), false, nullptr);
    TriangleArrays out;
    std::vector<int64_t> made;
    for (size_t i = 0; i < arrays.faces.size();)
    {
        const int32_t n = arrays.faces[i];
        for (int32_t j = 1; j + 1 < n; ++j)
            made.insert(made.end(), {arrays.faces[i + 1], arrays.faces[i + 1 + j], arrays.faces[i + 2 + j]});
        i += static_cast<size_t>(n) + 1;
    }
    std::vector<int64_t> kept = without_folds(made);
    unpinch(arrays.points, kept);
    unfold(arrays.points, kept);
    kept = without_folds(kept);  // (a merge in unfold can leave a fold too)
    collapse_folds(arrays.points, kept);
    kept = without_folds(kept);
    // the points the triangles use, in their order
    std::vector<int64_t> index(arrays.points.size() / 3, -1);
    for (int64_t v : kept)
        if (v >= 0)
            index[v] = 0;
    int64_t count = 0;
    for (size_t i = 0; i < index.size(); ++i)
        if (index[i] == 0)
        {
            index[i] = count++;
            out.vertices.insert(out.vertices.end(), {arrays.points[3 * i], arrays.points[3 * i + 1], arrays.points[3 * i + 2]});
        }
    for (size_t t = 0; t < kept.size() / 3; ++t)
        if (kept[3 * t] >= 0)
            out.triangles.insert(out.triangles.end(), {index[kept[3 * t]], index[kept[3 * t + 1]], index[kept[3 * t + 2]]});
    return out;
}

TriangleArrays decimate_triangles(const std::vector<double>& vertices, const std::vector<int64_t>& triangles,
                                  double fraction, double feature_angle_deg, bool keep_boundary)
{
    check_mesh(vertices, triangles, "decimate");
    if (!(fraction > 0.0 && fraction < 1.0))
        throw std::invalid_argument("decimate: the fraction to remove must be between 0 and 1");
    if (!(feature_angle_deg >= 0.0 && feature_angle_deg <= 180.0))
        throw std::invalid_argument("decimate: the feature angle must be between 0 and 180 degrees");
    const std::vector<int64_t> id = weld(vertices);
    const std::vector<long> welded = welded_triangles(triangles, id);
    const int64_t border = open_edges(std::vector<int64_t>(welded.begin(), welded.end()));
    // A run whose mesh, after the repairs of decimate_once, still has another border than the mesh
    // (none for a closed mesh) or a fold (a sphere of 56 000 triangles taken to a tenth: 6 slivers
    // that unpinching turned over) is done again in steps that each take away at most half of what
    // is left, a step that fails so again with a little less (2 % of its share, three times at
    // most); the quadric errors start afresh with each step. Where that fails too, the first run.
    TriangleArrays out = decimate_once(vertices, welded, fraction, feature_angle_deg, keep_boundary);
    if (open_edges(out.triangles) == border && folds(out.vertices, out.triangles) == 0)
        return out;
    const int steps = static_cast<int>(std::ceil(std::log(1.0 - fraction) / std::log(0.5)));
    const double step = 1.0 - std::pow(1.0 - fraction, 1.0 / std::max(steps, 1));
    std::vector<double> points = vertices;
    std::vector<long> tris = welded;
    for (int i = 0; i < steps; ++i)
    {
        bool done = false;
        for (int attempt = 0; attempt < 4 && !done; ++attempt)
        {
            TriangleArrays next = decimate_once(points, tris, step * (1.0 - 0.02 * attempt), feature_angle_deg, keep_boundary);
            if (open_edges(next.triangles) == border && folds(next.vertices, next.triangles) == 0)
            {
                points = std::move(next.vertices);
                tris.assign(next.triangles.begin(), next.triangles.end());
                done = true;
            }
        }
        if (!done)
            return out;  // (the first run: the caller checks its border)
    }
    out.vertices = std::move(points);
    out.triangles.assign(tris.begin(), tris.end());
    return out;
}

MeshRepair repair_triangles(const std::vector<double>& vertices, const std::vector<int64_t>& triangles, bool clean,
                            bool fill)
{
    check_mesh(vertices, triangles, "repair");
    MeshRepair out;
    const std::vector<int64_t> id = weld(vertices, &out.merged_vertices);
    const size_t m = triangles.size() / 3;
    std::vector<int64_t> tris(triangles.size());
    for (size_t i = 0; i < triangles.size(); ++i)
        tris[i] = id[triangles[i]];
    // the merged points that a triangle uses (unused points do not count)
    {
        std::unordered_set<int64_t> used;
        for (int64_t i : triangles)
            if (id[i] != i)
                used.insert(i);
        out.merged_vertices = static_cast<int64_t>(used.size());
    }
    if (clean)
    {
        std::unordered_set<std::array<int64_t, 3>, KeyHash> seen;
        for (size_t t = 0; t < m; ++t)
        {
            int64_t* c = &tris[3 * t];
            std::array<int64_t, 3> key = {c[0], c[1], c[2]};
            std::sort(key.begin(), key.end());
            if (c[0] == c[1] || c[1] == c[2] || c[0] == c[2] || !seen.insert(key).second)
            {
                c[0] = c[1] = c[2] = -1;
                ++out.removed_triangles;
            }
        }
        out.flipped_triangles = orient(tris, vertices);
    }
    for (size_t t = 0; t < m; ++t)
        if (tris[3 * t] >= 0)
        {
            out.triangles.insert(out.triangles.end(), {tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]});
            out.sources.push_back(static_cast<int64_t>(t));
        }
    if (fill)
    {
        std::vector<int64_t> topology = tris;  // (triangles whose corners merged have no edges)
        for (size_t t = 0; t < m; ++t)
        {
            int64_t* c = &topology[3 * t];
            if (c[0] >= 0 && (c[0] == c[1] || c[1] == c[2] || c[0] == c[2]))
                c[0] = c[1] = c[2] = -1;
        }
        const double tol = SM_EFF_ZERO_SQRT / 10.0 * std::max(mesh_size(vertices), 1e-12);
        for (const std::vector<int64_t>& loop : holes(topology, out.open_holes))
        {
            const int64_t next_index = static_cast<int64_t>((vertices.size() + out.new_vertices.size()) / 3);
            const std::vector<int64_t> patch = fill_hole(vertices, loop, tol, next_index, out.new_vertices);
            ++out.filled_holes;
            for (size_t i = 0; i < patch.size(); i += 3)
            {
                out.triangles.insert(out.triangles.end(), {patch[i], patch[i + 1], patch[i + 2]});
                out.sources.push_back(-1);
            }
        }
    }
    out.open_edges = open_edges(out.triangles);
    return out;
}

FacetedBody brep_from_triangles(const std::vector<double>& vertices, const std::vector<int64_t>& triangles,
                                bool merge_coplanar_faces, int64_t max_faces)
{
    check_mesh(vertices, triangles, "brep_from_triangles");
    const std::vector<int64_t> id = weld(vertices);
    PolyPtr poly(poly_from_triangles(vertices, welded_triangles(triangles, id)));
    if (merge_coplanar_faces)
        merge_coplanar(poly.get(), poly->GetTolerance());
    SmTArray<SmPolyFace*> faces;
    poly->GetPolyFaces(faces);
    FacetedBody out;
    out.faces = static_cast<int64_t>(faces.GetSize());
    if (max_faces > 0 && out.faces > max_faces)
        return out;
    SmPyErrorTrail::clear();
    SmBrep* brep = nullptr;
    const SmStatus status = SmBrep::CreateFromPolyBrep(context(), *poly, brep);
    if (status != SM_SUCCESS)
    {
        delete brep;
        check_status(status, "SmBrep::CreateFromPolyBrep");
    }
    if (!brep)
        check_status(SM_ERR, "SmBrep::CreateFromPolyBrep");
    out.brep = brep;
    return out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

#include <pybind11/numpy.h>

namespace
{

using Doubles = py::array_t<double, py::array::c_style | py::array::forcecast>;
using Integers = py::array_t<int64_t, py::array::c_style | py::array::forcecast>;

std::vector<double> flat(const Doubles& a) { return std::vector<double>(a.data(), a.data() + a.size()); }
std::vector<int64_t> flat(const Integers& a) { return std::vector<int64_t>(a.data(), a.data() + a.size()); }

template <typename T>
py::array_t<T> rows(const std::vector<T>& v, py::ssize_t width = 3)
{
    py::array_t<T> out({static_cast<py::ssize_t>(v.size() / width), width});
    std::copy(v.begin(), v.end(), out.mutable_data());
    return out;
}

template <typename T>
py::array_t<T> column(const std::vector<T>& v)
{
    py::array_t<T> out(static_cast<py::ssize_t>(v.size()));
    std::copy(v.begin(), v.end(), out.mutable_data());
    return out;
}

// SmPyLib's PolyBrep.ray_intersection with the hit polygon tied to its mesh: SmPyLib returns it
// with reference_internal and no parent, so pybind11 raised "Could not activate keep_alive!" for
// every ray that hit (a miss returned []). The mesh (the Python object) is the parent here.
py::list poly_ray_intersection(py::object self, py::tuple ray_point, py::object ray_direction, double ray_tolerance,
                               double ray_stepoff)
{
    const SmPolyBrep& poly = self.cast<const SmPolyBrep&>();
    if (py::len(ray_point) != 3)
        throw std::invalid_argument("ray_intersection: the ray point must be (x, y, z)");
    const SmPoint3d origin(ray_point[0].cast<double>(), ray_point[1].cast<double>(), ray_point[2].cast<double>());
    std::unique_ptr<SmVector3d> direction;
    if (!ray_direction.is_none())
    {
        const py::tuple d = ray_direction.cast<py::tuple>();
        if (py::len(d) != 3)
            throw std::invalid_argument("ray_intersection: the ray direction must be (x, y, z)");
        direction = std::make_unique<SmVector3d>(d[0].cast<double>(), d[1].cast<double>(), d[2].cast<double>());
    }
    SmSolutionArray solutions;
    SmPyErrorTrail::clear();
    check_status(poly.RayIntersection(origin, direction.get(), ray_tolerance, ray_stepoff, nullptr, solutions),
                 "SmPolyBrep::RayIntersection");
    py::list hits;
    for (ULONG i = 0; i < solutions.GetSize(); ++i)
    {
        const SmSolution& s = solutions[i];
        py::dict h;
        h["t"] = s.m_vStart[0];
        h["point"] = py::make_tuple(s.m_vStart[3], s.m_vStart[4], s.m_vStart[5]);
        h["normal"] = py::make_tuple(s.m_vStart[6], s.m_vStart[7], s.m_vStart[8]);
        if (s.m_lNumObjects > 0 && s.m_apObjects[0])
            if (SmPolyFace* face = SM_CAST_PTR(SmPolyFace, s.m_apObjects[0]))
                h["face"] = py::cast(face, py::return_value_policy::reference_internal, self);
        hits.append(h);
    }
    return hits;
}

}  // namespace

void bind_mesh_tools(py::module_ m)
{
    m.def(
        "mesh_nearest_points",
        [](const Doubles& vertices, const Integers& triangles, const Doubles& points) {
            const smlibpy::NearestPoints r = smlibpy::mesh_nearest_points(flat(vertices), flat(triangles), flat(points));
            py::dict out;
            out["triangles"] = column(r.triangles);
            out["distances"] = column(r.distances);
            out["points"] = rows(r.points);
            return out;
        },
        py::arg("vertices"), py::arg("triangles"), py::arg("points"),
        "The nearest point of a mesh ((n, 3) vertices, (m, 3) vertex indices) to each of points ((k, 3)): "
        "{'triangles' (k,): the index of its triangle, -1 for none; 'distances' (k,); 'points' (k, 3)}.");
    m.def(
        "crease_normals",
        [](const Doubles& vertices, const Integers& triangles, double crease_angle) {
            return rows(smlibpy::crease_normals(flat(vertices), flat(triangles), crease_angle), 9);
        },
        py::arg("vertices"), py::arg("triangles"), py::arg("crease_angle"),
        "Corner normals (m, 9) of a mesh: at each corner the angle-weighted average of the normals of the "
        "triangles around its point that turn from the triangle's own by at most crease_angle degrees.");
    m.def(
        "decimate_triangles",
        [](const Doubles& vertices, const Integers& triangles, double fraction, double feature_angle,
           bool keep_boundary) {
            const smlibpy::TriangleArrays r = smlibpy::decimate_triangles(flat(vertices), flat(triangles), fraction,
                                                                          feature_angle, keep_boundary);
            py::dict out;
            out["vertices"] = rows(r.vertices);
            out["triangles"] = rows(r.triangles);
            return out;
        },
        py::arg("vertices"), py::arg("triangles"), py::arg("fraction"), py::arg("feature_angle") = 30.0,
        py::arg("keep_boundary") = true,
        "The kernel's quadric decimation of a mesh, `fraction` of its points removed: {'vertices' (n, 3), "
        "'triangles' (m, 3)}.");
    m.def(
        "repair_triangles",
        [](const Doubles& vertices, const Integers& triangles, bool clean, bool fill) {
            const smlibpy::MeshRepair r = smlibpy::repair_triangles(flat(vertices), flat(triangles), clean, fill);
            py::dict out;
            out["triangles"] = rows(r.triangles);
            out["new_vertices"] = rows(r.new_vertices);
            out["sources"] = column(r.sources);
            out["merged_vertices"] = r.merged_vertices;
            out["removed_triangles"] = r.removed_triangles;
            out["flipped_triangles"] = r.flipped_triangles;
            out["filled_holes"] = r.filled_holes;
            out["open_holes"] = r.open_holes;
            out["open_edges"] = r.open_edges;
            return out;
        },
        py::arg("vertices"), py::arg("triangles"), py::arg("clean") = true, py::arg("fill") = true,
        "A repaired mesh: points on each other merged; with clean, triangles without area and repeated ones left "
        "out and all turned to face as their neighbours; with fill, holes closed. {'triangles' (indices into the "
        "vertices, then new_vertices), 'new_vertices', 'sources' (the input triangle of each, -1 new), counts}.");
    m.def(
        "brep_from_triangles",
        [](const Doubles& vertices, const Integers& triangles, bool merge_coplanar, int64_t max_faces) {
            const smlibpy::FacetedBody r =
                smlibpy::brep_from_triangles(flat(vertices), flat(triangles), merge_coplanar, max_faces);
            py::dict out;
            out["brep"] = r.brep ? py::cast(r.brep, py::return_value_policy::take_ownership) : py::none();
            out["faces"] = r.faces;
            return out;
        },
        py::arg("vertices"), py::arg("triangles"), py::arg("merge_coplanar") = true, py::arg("max_faces") = 0,
        "A faceted body of a mesh (SmBrep::CreateFromPolyBrep), neighbouring triangles in one plane merged into "
        "one face first: {'brep' (the caller's, None with more faces than max_faces > 0), 'faces'}.");
}

void bind_poly_ray_intersection(py::module_ m)
{
    py::object cls = m.attr("PolyBrep");
    cls.attr("ray_intersection") = py::cpp_function(
        &poly_ray_intersection, py::name("ray_intersection"), py::is_method(cls), py::arg("ray_point"),
        py::arg("ray_direction"), py::arg("ray_tolerance"), py::arg("ray_stepoff"),
        "Ray / point tests: ``ray_direction`` may be ``None`` for point-in-mesh style queries. Each hit is a dict "
        "with ``t``, ``point``, ``normal``, and optionally ``face`` (a PolyFace of this mesh, valid while it "
        "lives). (smlibpy: replaces SmPyLib's, which raised for every hit; Mesh.raycast_many casts many rays.)");
}
#endif  // SMLIBPY_PYTHON
