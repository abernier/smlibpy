// SPDX-License-Identifier: Apache-2.0
//
// Seams that run tangent to the other operand of a Boolean (`smlibpy._core.ext`, kernel plan B6):
//
//   seam_contacts(a, b, tolerance)   where a seam of body a touches a face of body b tangentially
//   seam_turns(a, b, tolerance, n)   the turns of a about its axis of revolution after which none does
//
// A cylinder, cone, sphere or torus is bounded by a seam: an edge its face uses twice, at the
// start of its periodic parameter. Where the faces of two bodies cross along a curve that runs
// tangent to such a seam, the kernel's Boolean goes wrong: it returns a closed, valid body of the
// wrong volume, raises, or (before kernel patch K1) read freed memory. A groove pin tangent to a
// bore, `(Box(30, 30, 30) - Cylinder(5, 60)) - Cylinder(2, 60).rotate(Y, 90).translate(0, 5, 0)`,
// came out at 24331.70 for 24299.26: the pin's seam, the line (t, 5, -2), lies in the plane y = 5
// that touches the bore at (0, 5, -2). With the pin turned about its own axis before it is placed
// it comes out right, as did the other such Booleans of the seeded fuzz cases (ext.boolean turns
// the body on copies, passes over a result whose volume cannot be right and goes back to the
// bodies as they are where the kernel fails). Where the faces themselves touch (a seam on the line
// along which a cylinder touches a plane, two cylinders touching at a point) the seam is left where
// it is: turning it there changed nothing, or made a Boolean that worked fail. A torus' outer
// equator is a seam no turn about its axis moves.
//
// A seam is found by sampling: along it, the signed distance to each face's surface (exact for the
// kernel's analytic surfaces; faces of other kinds are not looked at); where that distance has an
// extremum within the tolerance of zero, the seam touches the surface there. The point counts if
// it lies on the face (within its boundary, where no other face there touches the seam's face)
// and the two surfaces cross there at more than a small angle.

#include "kernel.h"
#include "seams.h"
#include "ext_shared.h"

#include <SmApiGeneral.h>

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace
{

struct P
{
    double x = 0.0, y = 0.0, z = 0.0;
};
P operator+(P a, P b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
P operator-(P a, P b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
P operator*(double s, P a) { return {s * a.x, s * a.y, s * a.z}; }
double dot(P a, P b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
P cross(P a, P b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
double norm(P a) { return std::sqrt(dot(a, a)); }
P unit(P a)
{
    double n = norm(a);
    return n > 0 ? (1.0 / n) * a : P{};
}
P from(const SmVector3d& p) { return {p.x, p.y, p.z}; }  // (SmPoint3d is SmVector3d)

// A rotation about an axis through `origin`.
struct Turn
{
    P origin, axis;
    double c = 1.0, s = 0.0;
    Turn() = default;
    Turn(P o, P d, double degrees) : origin(o), axis(unit(d))
    {
        const double a = degrees * SM_PI / 180.0;
        c = std::cos(a), s = std::sin(a);
    }
    P vector(P v) const { return c * v + s * cross(axis, v) + ((1.0 - c) * dot(axis, v)) * axis; }
    P point(P p) const { return origin + vector(p - origin); }
    P unvector(P v) const { return c * v - s * cross(axis, v) + ((1.0 - c) * dot(axis, v)) * axis; }
    P unpoint(P p) const { return origin + unvector(p - origin); }
};

// One of the kernel's analytic surfaces: its signed distance (exact on and near the surface) and
// its normal.
struct Analytic
{
    enum Kind { NONE, PLANE, CYLINDER, CONE, SPHERE, TORUS } kind = NONE;
    P o, z;  // placement origin and axis (a plane's normal)
    double r = 0.0, R = 0.0, sin_a = 0.0, cos_a = 1.0;

    // Distance from the axis, and the unit vector from the axis toward the point.
    double radial(P p, P& e, double& h) const
    {
        P d = p - o;
        h = dot(d, z);
        P q = d - h * z;
        double rho = norm(q);
        e = rho > 0 ? (1.0 / rho) * q : P{};
        return rho;
    }
    double distance(P p) const
    {
        P e;
        double h = 0.0;
        switch (kind)
        {
        case PLANE: return dot(p - o, z);
        case CYLINDER: return radial(p, e, h) - r;
        case CONE:
        {
            double rho = radial(p, e, h);
            return rho * cos_a - (r * cos_a + h * sin_a);  // (rho - (r + h tan a)) cos a
        }
        case SPHERE: return norm(p - o) - r;
        case TORUS:
        {
            double rho = radial(p, e, h);
            return std::hypot(rho - R, h) - r;
        }
        default: return HUGE_VAL;
        }
    }
    P normal(P p) const
    {
        P e;
        double h = 0.0;
        switch (kind)
        {
        case PLANE: return z;
        case CYLINDER: radial(p, e, h); return e;
        case CONE: radial(p, e, h); return cos_a * e - sin_a * z;
        case SPHERE: return unit(p - o);
        case TORUS:
        {
            double rho = radial(p, e, h);
            return unit((rho - R) * e + h * z);
        }
        default: return P{};
        }
    }
};

Analytic analytic(const SmSurface* s)
{
    Analytic a;
    if (!s)
        return a;
    SmAxis2Placement pl;
    SmBoolean swap_uv = FALSE, inside_out = FALSE;
    switch (s->GetType())
    {
    case SmPlane_TYPE:
        if (static_cast<const SmPlane*>(s)->GetCanonical(pl) == SM_SUCCESS)
            a.kind = Analytic::PLANE;
        break;
    case SmCylinder_TYPE:
        if (static_cast<const SmCylinder*>(s)->GetCanonical(pl, a.r) == SM_SUCCESS)
            a.kind = Analytic::CYLINDER;
        break;
    case SmCone_TYPE:
    {
        double semi = 0.0;  // in degrees
        if (static_cast<const SmCone*>(s)->GetCanonical(pl, a.r, semi, &swap_uv, &inside_out) == SM_SUCCESS)
        {
            a.kind = Analytic::CONE;
            a.sin_a = std::sin(semi * SM_PI / 180.0), a.cos_a = std::cos(semi * SM_PI / 180.0);
        }
        break;
    }
    case SmSphere_TYPE:
        if (static_cast<const SmSphere*>(s)->GetCanonical(pl, a.r, &swap_uv, &inside_out) == SM_SUCCESS)
            a.kind = Analytic::SPHERE;
        break;
    case SmTorus_TYPE:
        if (static_cast<const SmTorus*>(s)->GetCanonical(pl, a.R, a.r, &swap_uv, &inside_out) == SM_SUCCESS)
            a.kind = Analytic::TORUS;
        break;
    default: break;
    }
    if (a.kind != Analytic::NONE)
    {
        a.o = from(pl.GetOriginRef());
        a.z = unit(from(pl.GetXAxisRef() * pl.GetYAxisRef()));  // (operator* is the cross product)
    }
    return a;
}

// The axis about which a body keeps its shape when turned: every face a plane across it, or a
// cylinder, cone or torus about it, or a sphere centred on it. A body of spheres and planes only
// takes the first sphere's axis, or the first plane's normal through its centre.
bool revolution_axis(const SmBrep* brep, P& origin, P& axis)
{
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    std::vector<Analytic> surfaces;
    const Analytic* round = nullptr;
    const Analytic* sphere = nullptr;
    const Analytic* plane = nullptr;
    double size = 1.0;
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        surfaces.push_back(analytic(faces[i]->GetSurface()));
        if (surfaces.back().kind == Analytic::NONE)
            return false;
    }
    for (const Analytic& s : surfaces)
    {
        size = std::max({size, norm(s.o), s.r, s.R});
        if (!round && (s.kind == Analytic::CYLINDER || s.kind == Analytic::CONE || s.kind == Analytic::TORUS))
            round = &s;
        if (!sphere && s.kind == Analytic::SPHERE)
            sphere = &s;
        if (!plane && s.kind == Analytic::PLANE)
            plane = &s;
    }
    if (round)
        origin = round->o, axis = round->z;
    else if (sphere)
        origin = sphere->o, axis = plane ? plane->z : sphere->z;
    else
        return false;
    const double eps = 1e-9, along = 1e-9 * size;
    auto on_axis = [&](P p) { return norm(cross(p - origin, axis)) <= along; };
    for (const Analytic& s : surfaces)
    {
        bool parallel = norm(cross(s.z, axis)) <= eps;
        switch (s.kind)
        {
        case Analytic::PLANE:
            if (!parallel)
                return false;
            break;
        case Analytic::SPHERE:
            if (!on_axis(s.o))
                return false;
            break;
        default:
            if (!parallel || !on_axis(s.o))
                return false;
        }
    }
    return true;
}

// The seams of a body: each edge one face uses twice, with that face's surface.
struct Seam
{
    long index;
    const SmEdge* edge;
    Analytic surface;
};

std::vector<Seam> seams_of(const SmBrep* brep)
{
    std::vector<Seam> out;
    SmTArray<SmEdge*> edges;
    brep->GetEdges(edges);
    for (long i : smlibpy::seam_edges(brep))
    {
        SmTArray<SmFace*> faces;
        edges[i]->GetFaces(faces);
        if (faces.GetSize() != 1)
            continue;
        Analytic s = analytic(faces[0]->GetSurface());
        if (s.kind != Analytic::NONE && s.kind != Analytic::PLANE)
            out.push_back({i, edges[i], s});
    }
    return out;
}

double default_tolerance(const SmBrep* a, const SmBrep* b)
{
    return std::max(1e-4, 10.0 * std::max(SmTol::GetZoneTol3d(a).val, SmTol::GetZoneTol3d(b).val));
}

// The surfaces of the faces must cross at more than this (the sine of the angle between them).
constexpr double crossing = 1e-2;

// Whether a face at an edge or vertex of b (where a seam touches the boundary of a face) touches
// the seam's own face there, whose normal is `n`: one that runs along the seam (a cylinder's seam on
// the plane of a disc whose rim it touches). Turning the seam off such a line made Booleans fail.
bool touches(const SmObject* where, P q, P n)
{
    SmTArray<SmFace*> faces;
    if (const SmEdge* edge = SM_CAST_PTR(SmEdge, where))
        edge->GetFaces(faces);
    else if (const SmVertex* vertex = SM_CAST_PTR(SmVertex, where))
        vertex->GetFaces(faces);
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        const Analytic s = analytic(faces[i]->GetSurface());
        if (s.kind != Analytic::NONE && norm(cross(s.normal(q), n)) < crossing)
            return true;
    }
    return false;
}
// Samples along a seam.
constexpr int samples = 96;

// The contacts of a's seams, turned by `turn`, with b's faces; the first only with `first`.
std::vector<smlibpy::SeamContact> contacts(const std::vector<Seam>& seams, const SmBrep* b, double tol,
                                           const Turn& turn, bool first)
{
    std::vector<smlibpy::SeamContact> out;
    SmTArray<SmFace*> faces;
    b->GetFaces(faces);
    std::vector<Analytic> surfaces;
    for (ULONG i = 0; i < faces.GetSize(); ++i)
        surfaces.push_back(analytic(faces[i]->GetSurface()));
    const SmZoneTol3d ztol = SmTol::GetZoneTol3d(b);
    for (const Seam& seam : seams)
    {
        const SmCurve* curve = seam.edge->GetCurve();
        const SmExtent1d ivl = seam.edge->GetInterval();
        const double t0 = ivl.GetMin(), t1 = ivl.GetMax();
        if (!curve || !(t1 > t0))
            continue;
        auto at = [&](double t) {
            SmPoint3d p;
            if (t < t0)  // (before the start of a closed seam: at its end)
                t += t1 - t0;
            if (curve->EvaluatePoint(t, p) != SM_SUCCESS)
                throw std::runtime_error("seams: a seam could not be evaluated");
            return turn.point(from(p));
        };
        std::vector<double> ts(samples + 1);
        std::vector<P> ps(samples + 1);
        for (int j = 0; j <= samples; ++j)
            ts[j] = t0 + (t1 - t0) * j / samples, ps[j] = at(ts[j]);
        // A closed seam (a torus' circles) has no ends: an extremum at its start counts too.
        const bool closed = norm(ps[0] - ps[samples]) <= tol;
        for (ULONG f = 0; f < faces.GetSize(); ++f)
        {
            const Analytic& s = surfaces[f];
            if (s.kind == Analytic::NONE)
                continue;
            std::vector<double> g(samples + 1);
            double step = 0.0;
            for (int j = 0; j <= samples; ++j)
            {
                g[j] = s.distance(ps[j]);
                if (j)
                    step = std::max(step, std::fabs(g[j] - g[j - 1]));
            }
            int tried = 0;
            for (int j = closed ? 0 : 1; j < samples && tried < 8; ++j)
            {
                // an extremum of the distance between the samples before and after j, near zero
                const int before = j ? j - 1 : samples - 1;
                const double g0 = g[before];
                if ((g[j] - g0) * (g[j + 1] - g[j]) > 0)
                    continue;
                if (std::min({std::fabs(g0), std::fabs(g[j]), std::fabs(g[j + 1])}) > tol + 2 * step)
                    continue;
                const double sign = g[j] <= g0 ? 1.0 : -1.0;  // a minimum, or a maximum
                double lo = j ? ts[j - 1] : ts[0] - (ts[samples] - ts[samples - 1]), hi = ts[j + 1];
                const double phi = 0.5 * (std::sqrt(5.0) - 1.0);
                double x1 = hi - phi * (hi - lo), x2 = lo + phi * (hi - lo);
                double f1 = sign * s.distance(at(x1)), f2 = sign * s.distance(at(x2));
                for (int it = 0; it < 60; ++it)
                {
                    if (f1 < f2)
                        hi = x2, x2 = x1, f2 = f1, x1 = hi - phi * (hi - lo), f1 = sign * s.distance(at(x1));
                    else
                        lo = x1, x1 = x2, f1 = f2, x2 = lo + phi * (hi - lo), f2 = sign * s.distance(at(x2));
                }
                const double t = 0.5 * (lo + hi);
                const P p = at(t);
                const double d = s.distance(p);
                if (std::fabs(d) > tol)
                    continue;
                ++tried;
                // (the seam's own surface turned with it: its normal at the point turned back, turned)
                const P nb = s.normal(p), na = turn.vector(seam.surface.normal(turn.unpoint(p)));
                if (norm(cross(na, nb)) < crossing)
                    continue;  // the faces touch here: the seam is left alone
                const P q = p - d * nb;
                SmPointClassification pc(ztol, b->GetContext());
                if (faces[f]->Point3DClassify(SmPoint3d(q.x, q.y, q.z), ztol, TRUE, pc) != SM_SUCCESS)
                    continue;
                const auto cls = pc.GetPointClass();
                if (cls != SM_PC_FACE && cls != SM_PC_EDGE && cls != SM_PC_VERTEX)
                    continue;
                if (cls != SM_PC_FACE && touches(pc.GetObject(), q, na))
                    continue;  // on the face's boundary, where another face of b touches the seam's face
                smlibpy::SeamContact c;
                c.edge = seam.index, c.face = static_cast<long>(f);
                c.point[0] = q.x, c.point[1] = q.y, c.point[2] = q.z;
                out.push_back(c);
                if (first)
                    return out;
                break;  // one point per seam and face
            }
        }
    }
    return out;
}

}  // namespace

namespace smlibpy {

std::vector<SeamContact> seam_contacts(const SmBrep* a, const SmBrep* b, double tolerance)
{
    if (!a || !b)
        throw std::invalid_argument("brep is None");
    return contacts(seams_of(a), b, tolerance > 0 ? tolerance : default_tolerance(a, b), Turn(), false);
}

SeamTurns seam_turns(const SmBrep* a, const SmBrep* b, double tolerance, size_t count)
{
    if (!a || !b)
        throw std::invalid_argument("brep is None");
    SeamTurns out;
    const std::vector<Seam> seams = seams_of(a);
    if (seams.empty() || count == 0)
        return out;
    P origin, axis;
    if (!revolution_axis(a, origin, axis))
        return out;
    const double tol = tolerance > 0 ? tolerance : default_tolerance(a, b);
    if (contacts(seams, b, tol, Turn(), true).empty())
        return out;
    out.origin[0] = origin.x, out.origin[1] = origin.y, out.origin[2] = origin.z;
    out.axis[0] = axis.x, out.axis[1] = axis.y, out.axis[2] = axis.z;
    for (double angle : {45.0, 135.0, 90.0, 22.5, 67.5, 112.5, 157.5, 180.0, 202.5, 247.5, 292.5, 337.5})
        if (contacts(seams, b, tol, Turn(origin, axis, angle), true).empty())
        {
            out.angles.push_back(angle);
            if (out.angles.size() == count)
                break;
        }
    return out;
}

void turn_brep(SmBrep* brep, const SeamTurns& turns, double degrees)
{
    const Turn turn({turns.origin[0], turns.origin[1], turns.origin[2]}, {turns.axis[0], turns.axis[1], turns.axis[2]},
                    degrees);
    // rows 0-2: the images of the axes; row 3: the image of the origin
    const P ex = turn.vector({1, 0, 0}), ey = turn.vector({0, 1, 0}), ez = turn.vector({0, 0, 1});
    const P shift = turn.point({0, 0, 0});
    transform_brep(brep, {ex.x, ex.y, ex.z, 0, ey.x, ey.y, ey.z, 0, ez.x, ez.y, ez.z, 0, shift.x, shift.y, shift.z, 1});
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_seams(py::module_ m)
{
    m.def("seam_contacts", [](const SmBrep* a, const SmBrep* b, double tolerance) {
        py::list out;
        for (const auto& c : smlibpy::seam_contacts(a, b, tolerance))
            out.append(py::make_tuple(c.edge, c.face, py::make_tuple(c.point[0], c.point[1], c.point[2])));
        return out;
    }, py::arg("a"), py::arg("b"), py::arg("tolerance") = 0.0,
          "Where a seam of body a touches a face of body b tangentially while the faces cross there: per point "
          "(seam edge index in a, face index in b, (x, y, z)). Tolerance 0: ten times the larger zone tolerance, "
          "at least 1e-4.");
}
#endif  // SMLIBPY_PYTHON
