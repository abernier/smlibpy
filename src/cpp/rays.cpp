// SPDX-License-Identifier: Apache-2.0
//
// Many rays at once (`smlibpy._core.ext`, `ext__...` in the JavaScript module):
//
//   mesh_first_hits(vertices, triangles, origins, directions)   the first triangle each ray meets
//   body_first_hits(brep, vertices, triangles, owners, ...)     the first face of a body, from its mesh
//
// Mesh.raycast tests every triangle for every ray (36 ms a ray on a sphere of 246k triangles). The
// kernel's ray tracer (SmRayTracer, as SmPolyBrep::RayIntersection builds it) sorts the triangles
// into a grid of boxes and a tree once and follows each ray through the boxes it crosses: 0.01 ms
// a ray on that mesh, after 0.8 s to build the kernel mesh and the tracer (so rays go in one call).
//
// The triangles go into a kernel mesh of their own, unstitched (the tracer needs no neighbours),
// which remembers the index of each triangle.
//
// For a body, the face of the first triangle is the face the ray meets first, and the hit is moved
// onto it by Newton's method along the ray. Whether the point lies inside the face, the mesh tells
// where the point is far enough from the face's border: the border of a face's triangles (edges no
// other triangle of the face shares) is within the mesh's tolerance of the face's edges. Nearer
// the border the face is asked (SmApiFaceClassifyUV), which costs a millisecond on a plate with a
// hundred holes.

#include "kernel.h"
#include "rays.h"

#include <SmApiGeneral.h>
#include <SmApiQueries.h>
#include <SmPoly.h>
#include <SmRayTracer.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <unordered_map>

namespace
{

const double kNaN = std::numeric_limits<double>::quiet_NaN();

// The tolerance of the kernel mesh, relative to its size: how far outside a triangle a ray still
// hits it. (The kernel's STL reader takes 1e-7: a ray beside an edge then hit the neighbour's plane
// 1e-5 outside it on a sphere of radius 25, before the triangle it passes through.)
const double kTolerance = 1e-10;

void check_points(const std::vector<double>& values, const char* what)
{
    if (values.size() % 3 != 0)
        throw std::invalid_argument(std::string(what) + " must be x, y, z triples");
    for (double x : values)
        if (!std::isfinite(x))
            throw std::invalid_argument(std::string(what) + " must be finite numbers");
}

// The unit direction of ray i.
SmVector3d direction(const std::vector<double>& directions, size_t i)
{
    SmVector3d d(directions[3 * i], directions[3 * i + 1], directions[3 * i + 2]);
    const double length = d.Length();
    if (!(length > 0))
        throw std::invalid_argument("the direction of a ray must not be zero");
    return d * (1.0 / length);
}

}  // namespace

namespace smlibpy {

namespace
{

// A kernel mesh of triangles (unstitched) that knows the index of each, and the kernel's ray tracer
// for it, built by SmPolyBrep::RayIntersection with the first ray (a grid of 10 x 10 x 10 boxes
// over a tree of the triangles; finer grids made no ray faster).
class Tracer
{
  public:
    Tracer(const std::vector<double>& vertices, const std::vector<int64_t>& triangles)
    {
        const size_t nvert = vertices.size() / 3;
        // the size of the mesh: the larger of the diagonal of its box and its largest coordinate
        SmExtent3d box;
        double largest = 0.0;
        for (size_t i = 0; i < nvert; ++i)
        {
            box.AddPoint3d(SmPoint3d(vertices[3 * i], vertices[3 * i + 1], vertices[3 * i + 2]));
            for (int k = 0; k < 3; ++k)
                largest = std::max(largest, std::fabs(vertices[3 * i + k]));
        }
        const double scale = std::max(box.GetSize().Length(), largest);
        const SmZoneTol3d tol = kTolerance * std::max(scale, 1e-12);
        const SmContext& context = *SmApiGetOrCreateContext();
        poly_.reset(new (context) SmPolyBrep(tol, static_cast<ULONG>(std::min<size_t>(6 * triangles.size(), 4000000))));
        std::vector<SmPolyVertex*> made(nvert, nullptr);
        auto vertex = [&](int64_t i) {
            if (!made[i])
                made[i] = new (poly_.get()) SmPolyVertex(SmPoint3d(vertices[3 * i], vertices[3 * i + 1], vertices[3 * i + 2]), tol);
            return made[i];
        };
        index_.reserve(triangles.size() / 3);
        normals_.assign(triangles.size() / 3, SmVector3d(0, 0, 0));
        SmPolyShell* shell = nullptr;
        for (size_t t = 0; t + 2 < triangles.size(); t += 3)
        {
            const int64_t a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
            if (a == b || b == c || a == c)
                continue;
            const SmPoint3d pa(vertices[3 * a], vertices[3 * a + 1], vertices[3 * a + 2]);
            const SmPoint3d pb(vertices[3 * b], vertices[3 * b + 1], vertices[3 * b + 2]);
            const SmPoint3d pc(vertices[3 * c], vertices[3 * c + 1], vertices[3 * c + 2]);
            SmVector3d normal = (pb - pa) * (pc - pa);
            const double length = normal.Length();
            if (!(length > 0))
                continue;  // (no area: never hit)
            normals_[t / 3] = normal * (1.0 / length);
            SmPolyFace* face = nullptr;
            // (corners of their own where the triangles cannot share them: a fan of triangles around
            // an edge, or neighbours that run the other way)
            if (poly_->CreatePolyTriangle(nullptr, shell, vertex(a), vertex(b), vertex(c), face) != SM_SUCCESS || !face)
            {
                face = nullptr;
                SmPolyVertex* own[3];
                for (int k = 0; k < 3; ++k)
                {
                    const int64_t v = triangles[t + k];
                    own[k] = new (poly_.get()) SmPolyVertex(SmPoint3d(vertices[3 * v], vertices[3 * v + 1], vertices[3 * v + 2]), tol);
                }
                if (poly_->CreatePolyTriangle(nullptr, nullptr, own[0], own[1], own[2], face) != SM_SUCCESS || !face)
                    SmPyRaise(SM_ERR, "raycast: SmPolyBrep::CreatePolyTriangle", __FILE__, __LINE__);
            }
            if (!shell)
                shell = face->GetPolyShell();
            index_.emplace(face, static_cast<int32_t>(t / 3));
        }
    }

    ~Tracer() { delete tracer_; }  // (before the mesh it refers to)

    // The first triangle the ray meets (t >= 0, and a hair before), -1 for none.
    int32_t fire(const SmPoint3d& origin, const SmVector3d& unit, double& t)
    {
        if (index_.empty())
            return -1;
        SmSolutionArray solutions;
        // (on a failure the kernel deletes the tracer and sets it to null)
        const SmStatus status = poly_->RayIntersection(origin, &unit, 0.0, 0.0, &tracer_, solutions);
        if (status != SM_SUCCESS || !tracer_)
            SmPyRaise(status == SM_SUCCESS ? SM_ERR : status, "raycast: SmPolyBrep::RayIntersection", __FILE__, __LINE__);
        if (solutions.GetSize() < 1)
            return -1;
        const auto found = index_.find(SM_CAST_PTR(SmPolyFace, solutions[0].m_apObjects[0]));
        if (found == index_.end())
            return -1;
        t = solutions[0].m_vStart[0];
        return found->second;
    }

    const SmVector3d& normal(int32_t triangle) const { return normals_[triangle]; }

  private:
    std::unique_ptr<SmPolyBrep> poly_;
    SmRayTracer* tracer_ = nullptr;
    std::unordered_map<const SmPolyFace*, int32_t> index_;
    std::vector<SmVector3d> normals_;
};

void check_mesh(const std::vector<double>& vertices, const std::vector<int64_t>& triangles, const char* what)
{
    check_points(vertices, (std::string(what) + ": the vertices").c_str());
    if (triangles.size() % 3 != 0)
        throw std::invalid_argument(std::string(what) + ": the triangles must be triples of vertex indices");
    const size_t nvert = vertices.size() / 3;
    for (int64_t i : triangles)
        if (i < 0 || static_cast<size_t>(i) >= nvert)
            throw std::invalid_argument(std::string(what) + ": a triangle refers to a vertex that is not there (" +
                                        std::to_string(i) + ")");
}

std::vector<SmVector3d> units(const std::vector<double>& origins, const std::vector<double>& directions,
                              const char* what)
{
    check_points(origins, (std::string(what) + ": the origins").c_str());
    if (directions.size() != origins.size())
        throw std::invalid_argument(std::string(what) + ": give one direction for each origin");
    std::vector<SmVector3d> out(origins.size() / 3);
    for (size_t i = 0; i < out.size(); ++i)
        out[i] = direction(directions, i);
    return out;
}

SmPoint3d point(const std::vector<double>& xyz, size_t i) { return SmPoint3d(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]); }

double to_segment(const SmPoint3d& p, const SmPoint3d& a, const SmPoint3d& b)
{
    const SmVector3d ab = b - a;
    const double length2 = ab.Dot(ab);
    const double s = length2 > 0 ? std::clamp((p - a).Dot(ab) / length2, 0.0, 1.0) : 0.0;
    return p.DistanceBetween(a + ab * s);
}

// The border of each face's triangles: the edges (of the triangles of a face) that no other
// triangle of the face shares, as pairs of vertex indices, by face.
std::vector<std::vector<std::pair<int64_t, int64_t>>> borders(const std::vector<int64_t>& triangles,
                                                               const std::vector<int64_t>& owners, size_t nfaces)
{
    struct Key
    {
        int64_t face, a, b;
        bool operator==(const Key& o) const { return face == o.face && a == o.a && b == o.b; }
    };
    struct Hash
    {
        size_t operator()(const Key& k) const
        {
            return std::hash<int64_t>()(k.face) * 1000003u ^ std::hash<int64_t>()(k.a) * 10007u ^ std::hash<int64_t>()(k.b);
        }
    };
    std::unordered_map<Key, int, Hash> count;
    count.reserve(triangles.size());
    for (size_t t = 0; 3 * t + 2 < triangles.size(); ++t)
    {
        if (owners[t] < 0)
            continue;
        const int64_t* c = &triangles[3 * t];
        for (int k = 0; k < 3; ++k)
            ++count[Key{owners[t], std::min(c[k], c[(k + 1) % 3]), std::max(c[k], c[(k + 1) % 3])}];
    }
    std::vector<std::vector<std::pair<int64_t, int64_t>>> out(nfaces);
    for (const auto& [key, n] : count)
        if (n == 1)
            out[static_cast<size_t>(key.face)].push_back({key.a, key.b});
    return out;
}

}  // namespace

FirstHits mesh_first_hits(const std::vector<double>& vertices, const std::vector<int64_t>& triangles,
                          const std::vector<double>& origins, const std::vector<double>& directions)
{
    check_mesh(vertices, triangles, "mesh_first_hits");
    const std::vector<SmVector3d> dirs = units(origins, directions, "mesh_first_hits");
    const size_t nrays = dirs.size();
    FirstHits out;
    out.t.assign(nrays, kNaN);
    out.points.assign(3 * nrays, kNaN);
    out.normals.assign(3 * nrays, kNaN);
    out.triangles.assign(nrays, -1);
    if (nrays == 0 || triangles.empty())
        return out;
    Tracer tracer(vertices, triangles);
    for (size_t i = 0; i < nrays; ++i)
    {
        const SmPoint3d o = point(origins, i);
        double t = 0;
        const int32_t hit = tracer.fire(o, dirs[i], t);
        if (hit < 0)
            continue;
        const SmPoint3d p = o + dirs[i] * t;
        const SmVector3d& n = tracer.normal(hit);
        out.t[i] = t;
        out.points[3 * i] = p.x, out.points[3 * i + 1] = p.y, out.points[3 * i + 2] = p.z;
        out.normals[3 * i] = n.x, out.normals[3 * i + 1] = n.y, out.normals[3 * i + 2] = n.z;
        out.triangles[i] = hit;
    }
    return out;
}

BodyHits body_first_hits(SmBrep* brep, const std::vector<double>& vertices, const std::vector<int64_t>& triangles,
                         const std::vector<int64_t>& owners, const std::vector<double>& origins,
                         const std::vector<double>& directions, double tolerance, double mesh_tolerance)
{
    if (!brep)
        throw std::invalid_argument("body_first_hits: no body");
    check_mesh(vertices, triangles, "body_first_hits");
    if (owners.size() != triangles.size() / 3)
        throw std::invalid_argument("body_first_hits: give the face of each triangle");
    if (!(tolerance > 0) || !(mesh_tolerance >= 0))
        throw std::invalid_argument("body_first_hits: the tolerances must be positive");
    const std::vector<SmVector3d> dirs = units(origins, directions, "body_first_hits");
    const size_t nrays = dirs.size();
    BodyHits out;
    out.found.assign(nrays, 0);
    out.t.assign(nrays, kNaN);
    out.points.assign(3 * nrays, kNaN);
    out.normals.assign(3 * nrays, kNaN);
    out.faces.assign(nrays, -1);
    if (nrays == 0 || triangles.empty())
        return out;
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    for (int64_t f : owners)
        if (f < -1 || f >= static_cast<int64_t>(faces.GetSize()))
            throw std::invalid_argument("body_first_hits: a triangle names a face that is not there");
    Tracer tracer(vertices, triangles);
    const auto border = borders(triangles, owners, faces.GetSize());
    // (the rays start a little earlier: the mesh lies up to its tolerance inside convex faces)
    const double back = 2.0 * mesh_tolerance;
    for (size_t i = 0; i < nrays; ++i)
    {
        const SmPoint3d o = point(origins, i);
        const SmVector3d& d = dirs[i];
        double t0 = 0;
        const int32_t hit = tracer.fire(o - d * back, d, t0);
        if (hit < 0 || owners[hit] < 0)
            continue;
        t0 -= back;
        out.found[i] = 2;  // (unless the face is met below)
        out.faces[i] = static_cast<int32_t>(owners[hit]);
        const SmFace* face = faces[static_cast<ULONG>(owners[hit])];
        const SmSurface* surface = face->GetSurface();
        if (!surface)
            continue;
        // Newton along the ray, against the tangent plane at the closest point of the surface
        double s = t0;
        bool converged = false;
        for (int step = 0; step < 30; ++step)
        {
            const SmPoint3d p = o + d * s;
            SmPoint3d q;
            SmTArray<SmPoint2d> uvs;
            double gap = 0;
            SmVector3d n;
            if (SmApiSurfaceClosestPoint(surface, p, q, uvs, gap) != SM_SUCCESS || uvs.GetSize() < 1 ||
                surface->EvaluateNormal(uvs[0], TRUE, TRUE, n) != SM_SUCCESS)
                break;
            const double dn = d.Dot(n);
            if (std::fabs(dn) < 1e-12)
                break;
            const double move = (q - p).Dot(n) / dn;
            s += move;
            if (!std::isfinite(s))
                break;
            if (std::fabs(move) <= tolerance)
            {
                converged = true;
                break;
            }
        }
        if (!converged || s < -tolerance)
            continue;
        const SmPoint3d p = o + d * s;
        SmPoint3d q;
        SmTArray<SmPoint2d> uvs;
        double gap = 0;
        SmVector3d n;
        if (SmApiSurfaceClosestPoint(surface, p, q, uvs, gap) != SM_SUCCESS || uvs.GetSize() < 1 ||
            (q - p).Length() > 100.0 * tolerance || surface->EvaluateNormal(uvs[0], TRUE, TRUE, n) != SM_SUCCESS)
            continue;
        // inside the face: further from the border of its triangles than the point moved and the
        // mesh is off (the face's edges are that close to the border), or by the face's own test
        const SmPoint3d m = o + d * t0;
        const double margin = mesh_tolerance + std::fabs(s - t0) + tolerance;
        bool inside = true;
        for (const auto& [a, b] : border[static_cast<size_t>(owners[hit])])
            if (to_segment(m, point(vertices, a), point(vertices, b)) <= margin)
            {
                inside = false;
                break;
            }
        int where = SM_PC_UNKNOWN;
        if (!inside && (SmApiFaceClassifyUV(face, uvs[0], where) != SM_SUCCESS ||
                        (where != SM_PC_FACE && where != SM_PC_EDGE && where != SM_PC_VERTEX)))
            continue;
        // outward: against the body's material
        SmBrep* owner = face->GetBrep();
        SmFaceuse* up = face->GetUpwardFaceuse();
        if (owner && up && up->GetShell() && owner->GetInfiniteRegion() != up->GetShell()->GetRegion())
            n = -n;
        n = n * (1.0 / n.Length());
        out.found[i] = 1;
        out.t[i] = std::max(s, 0.0);
        out.points[3 * i] = p.x, out.points[3 * i + 1] = p.y, out.points[3 * i + 2] = p.z;
        out.normals[3 * i] = n.x, out.normals[3 * i + 1] = n.y, out.normals[3 * i + 2] = n.z;
    }
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

py::array_t<double> rows(const std::vector<double>& v)
{
    py::array_t<double> out({static_cast<py::ssize_t>(v.size() / 3), py::ssize_t(3)});
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

}  // namespace

void bind_rays(py::module_ m)
{
    m.def(
        "mesh_first_hits",
        [](const Doubles& vertices, const Integers& triangles, const Doubles& origins, const Doubles& directions) {
            const smlibpy::FirstHits r =
                smlibpy::mesh_first_hits(flat(vertices), flat(triangles), flat(origins), flat(directions));
            py::dict out;
            out["t"] = column(r.t);
            out["points"] = rows(r.points);
            out["normals"] = rows(r.normals);
            out["triangles"] = column(r.triangles);
            return out;
        },
        py::arg("vertices"), py::arg("triangles"), py::arg("origins"), py::arg("directions"),
        "The first triangle of a mesh ((n, 3) vertices, (m, 3) vertex indices) that each ray meets, by the "
        "kernel's grid ray tracer: rays from origins along directions ((k, 3) each). {'t' (k,): the distance "
        "along the ray, NaN for a miss; 'points', 'normals' (k, 3): the point and the triangle's unit normal; "
        "'triangles' (k,): the index of the triangle, -1 for a miss}.");
    m.def(
        "body_first_hits",
        [](SmBrep* brep, const Doubles& vertices, const Integers& triangles, const Integers& owners,
           const Doubles& origins, const Doubles& directions, double tolerance, double mesh_tolerance) {
            const smlibpy::BodyHits r =
                smlibpy::body_first_hits(brep, flat(vertices), flat(triangles), flat(owners), flat(origins),
                                         flat(directions), tolerance, mesh_tolerance);
            py::dict out;
            out["found"] = column(r.found);
            out["t"] = column(r.t);
            out["points"] = rows(r.points);
            out["normals"] = rows(r.normals);
            out["faces"] = column(r.faces);
            return out;
        },
        py::arg("brep"), py::arg("vertices"), py::arg("triangles"), py::arg("owners"), py::arg("origins"),
        py::arg("directions"), py::arg("tolerance"), py::arg("mesh_tolerance"),
        "The first face of a body each ray meets, from a mesh of it (vertices, triangles, owners: the index of the "
        "face of each triangle in brep.faces(); mesh_tolerance: how far the mesh is off the faces): the face of "
        "the first triangle, the hit moved onto it along the ray within tolerance. {'found' (k,): 0 a miss, 1 the "
        "hit, 2 cast this ray at the body itself (the face is missed where the mesh met it, or met behind the "
        "start); 't'; 'points', 'normals' (k, 3): the point and the face's outward unit normal; 'faces' (k,): the "
        "index of the face, -1 for a miss}.");
}
#endif  // SMLIBPY_PYTHON
