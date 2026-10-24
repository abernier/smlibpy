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
#include <SmApiPrimitives.h>
#include <SmApiBrep.h>
#include <SmApiQueries.h>

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
    P x;     // placement X axis: where the periodic parameter starts (the seam)
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
        a.x = unit(from(pl.GetXAxisRef()));
    }
    return a;
}

// The signed distance to a free-form surface (B-spline, surface of revolution or extrusion, offset)
// and its normal, from the kernel's projection of the point: positive on the side the normal points
// to. `uv` is the last point's projection, a start for the next one nearby.
struct Freeform
{
    const SmSurface* surface = nullptr;
    SmExtent2d domain;
    mutable SmPoint2d uv;
    mutable bool started = false;

    bool project(P p, double& d, P& n) const
    {
        SmBoolean ok = FALSE, multi = FALSE;
        SmPoint2d at;
        double gap = 0.0;
        const SmPoint3d q(p.x, p.y, p.z);
        if (surface->DropPoint(q, domain, started ? &uv : nullptr, ok, at, gap, multi) != SM_SUCCESS || !ok)
        {
            if (!started || surface->DropPoint(q, domain, nullptr, ok, at, gap, multi) != SM_SUCCESS || !ok)
                return false;
        }
        SmPoint3d foot;
        SmVector3d normal;
        if (surface->EvaluatePoint(at, foot) != SM_SUCCESS || surface->EvaluateNormal(at, TRUE, TRUE, normal) != SM_SUCCESS)
            return false;
        uv = at, started = true;
        n = unit(from(normal));
        d = dot(p - from(foot), n);
        return norm(n) > 0.5;
    }
};

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
    Freeform free;  // (the face's own surface where it is not analytic)

    P normal(P p) const
    {
        if (!free.surface)
            return surface.normal(p);
        double d = 0.0;
        P n;
        return free.project(p, d, n) ? n : P{};
    }
};

// The seams of a body whose face is a cylinder, cone, sphere or torus; with `freeform`, only those
// whose face is of another kind (a closed B-spline face).
std::vector<Seam> seams_of(const SmBrep* brep, bool freeform = false)
{
    std::vector<Seam> out;
    SmTArray<SmEdge*> edges;
    brep->GetEdges(edges);
    for (long i : smlibpy::seam_edges(brep))
    {
        SmTArray<SmFace*> faces;
        edges[i]->GetFaces(faces);
        if (faces.GetSize() != 1 || !faces[0]->GetSurface())
            continue;
        Analytic s = analytic(faces[0]->GetSurface());
        if (!freeform && s.kind != Analytic::NONE && s.kind != Analytic::PLANE)
            out.push_back({i, edges[i], s, Freeform()});
        else if (freeform && s.kind == Analytic::NONE)
        {
            Freeform f;
            f.surface = faces[0]->GetSurface();
            f.domain = f.surface->GetNaturalUVDomain();
            out.push_back({i, edges[i], s, f});
        }
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
        P lo = ps[0], hi = ps[0];
        double spacing = 0.0;
        for (int j = 1; j <= samples; ++j)
            spacing = std::max(spacing, norm(ps[j] - ps[j - 1]));
        for (const P& p : ps)
            lo = {std::min(lo.x, p.x), std::min(lo.y, p.y), std::min(lo.z, p.z)},
            hi = {std::max(hi.x, p.x), std::max(hi.y, p.y), std::max(hi.z, p.z)};
        for (ULONG f = 0; f < faces.GetSize(); ++f)
        {
            const Analytic& s = surfaces[f];
            // A face of another kind (a B-spline face: of an imported part, a NURBS copy, a loft) by
            // the kernel's projection, where its box reaches the seam's.
            Freeform free;
            P fl, fh;  // (a free-form face's box, widened by the samples' spacing)
            if (s.kind == Analytic::NONE)
            {
                SmExtent3d fb;
                if (!faces[f]->GetSurface() || faces[f]->CalculateBoundingBox(fb) != SM_SUCCESS)
                    continue;
                const double m = tol + spacing;
                fl = P{fb.GetMin().x - m, fb.GetMin().y - m, fb.GetMin().z - m};
                fh = P{fb.GetMax().x + m, fb.GetMax().y + m, fb.GetMax().z + m};
                if (fl.x > hi.x || fh.x < lo.x || fl.y > hi.y || fh.y < lo.y || fl.z > hi.z || fh.z < lo.z)
                    continue;
                free.surface = faces[f]->GetSurface();
                free.domain = free.surface->GetNaturalUVDomain();
            }
            auto near_face = [&](P p) {
                return !free.surface || (p.x >= fl.x && p.x <= fh.x && p.y >= fl.y && p.y <= fh.y && p.z >= fl.z && p.z <= fh.z);
            };
            auto distance = [&](P p) {
                if (!free.surface)
                    return s.distance(p);
                double d = HUGE_VAL;
                P n;
                return free.project(p, d, n) ? d : HUGE_VAL;
            };
            auto normal = [&](P p) {
                if (!free.surface)
                    return s.normal(p);
                double d = 0.0;
                P n;
                return free.project(p, d, n) ? n : P{};
            };
            // (samples away from a free-form face are not projected: NaN, and no extremum next to them)
            std::vector<double> g(samples + 1);
            double step = 0.0;
            for (int j = 0; j <= samples; ++j)
            {
                g[j] = near_face(ps[j]) ? distance(ps[j]) : std::nan("");
                if (j && std::isfinite(g[j]) && std::isfinite(g[j - 1]))
                    step = std::max(step, std::fabs(g[j] - g[j - 1]));
            }
            int tried = 0;
            for (int j = closed ? 0 : 1; j < samples && tried < 8; ++j)
            {
                // an extremum of the distance between the samples before and after j, near zero
                const int before = j ? j - 1 : samples - 1;
                const double g0 = g[before];
                if (!std::isfinite(g0) || !std::isfinite(g[j]) || !std::isfinite(g[j + 1]))
                    continue;
                if ((g[j] - g0) * (g[j + 1] - g[j]) > 0)
                    continue;
                if (std::min({std::fabs(g0), std::fabs(g[j]), std::fabs(g[j + 1])}) > tol + 2 * step)
                    continue;
                const double sign = g[j] <= g0 ? 1.0 : -1.0;  // a minimum, or a maximum
                double lo = j ? ts[j - 1] : ts[0] - (ts[samples] - ts[samples - 1]), hi = ts[j + 1];
                const double phi = 0.5 * (std::sqrt(5.0) - 1.0);
                double x1 = hi - phi * (hi - lo), x2 = lo + phi * (hi - lo);
                double f1 = sign * distance(at(x1)), f2 = sign * distance(at(x2));
                for (int it = 0; it < 60; ++it)
                {
                    if (f1 < f2)
                        hi = x2, x2 = x1, f2 = f1, x1 = hi - phi * (hi - lo), f1 = sign * distance(at(x1));
                    else
                        lo = x1, x1 = x2, f1 = f2, x2 = lo + phi * (hi - lo), f2 = sign * distance(at(x2));
                }
                const double t = 0.5 * (lo + hi);
                const P p = at(t);
                const double d = distance(p);
                if (!(std::fabs(d) <= tol))
                    continue;
                ++tried;
                // (the seam's own surface turned with it: its normal at the point turned back, turned)
                const P nb = normal(p), na = turn.vector(seam.normal(turn.unpoint(p)));
                if (norm(nb) < 0.5 || norm(na) < 0.5)
                    continue;
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
                c.along = std::fabs(g0) <= tol && std::fabs(g[j + 1]) <= tol;
                out.push_back(c);
                if (first)
                    return out;
                break;  // one point per seam and face
            }
        }
    }
    return out;
}

// The kernel's Boolean, leaving the kernel as it was when it fails (see ext.cpp's boolean): the
// result is b1, changed, and b2 is deleted, on success; both stay the caller's on failure.
SmStatus plain_boolean(SmBrep* b1, SmBrep* b2, SmBooleanOperationType op, SmBrep*& result)
{
    const SmStatus st = SmApiBoolean(b1, b2, op, result);
    if (st != SM_SUCCESS)
        SmApiGetOrCreateContext()->SetDoingBoolean(FALSE);
    return st;
}

// The volume of a body to `accuracy` (SmBrep::ComputePreciseProperties), NaN where that fails.
double volume_of(const SmBrep* brep, double accuracy)
{
    SmExtent3d box;
    if (brep->CalculateBoundingBox(box) != SM_SUCCESS)
        return std::nan("");
    SmMassPropertyBehavior behavior(1.0);
    double area = 0.0, volume = 0.0, mass = 0.0;
    SmTArray<SmVector3d> moments;
    if (const_cast<SmBrep*>(brep)->ComputePreciseProperties(accuracy, box.GetMid(), behavior, area, volume, mass,
                                                            moments) != SM_SUCCESS)
        return std::nan("");
    return volume;
}

double size_of(const SmBrep* brep)
{
    SmExtent3d box;
    if (brep->CalculateBoundingBox(box) != SM_SUCCESS)
        return 1.0;
    return std::max(box.GetSize().Length(), 1e-9);
}

// The solid of a face's surface over [h0, h1] along its axis (a cylinder or a frustum), or the whole
// sphere, placed with its seam (the start of its periodic parameter, at +X of its own frame) turned
// by `degrees` from the face's. Null where it cannot be made.
SmBrep* surface_solid(const Analytic& s, double h0, double h1, double degrees)
{
    SmBrep* body = nullptr;
    const SmVector3d at(0.0, 0.0, s.kind == Analytic::SPHERE ? 0.0 : h0);
    SmStatus st = SM_ERR;
    switch (s.kind)
    {
    case Analytic::CYLINDER: st = SmApiCreateCylinder(at, s.r, h1 - h0, body); break;
    case Analytic::CONE:
    {
        const double t = s.sin_a / s.cos_a;
        const double r0 = s.r + h0 * t, r1 = s.r + h1 * t;
        if (r0 < 0 || r1 < 0 || (r0 <= 0 && r1 <= 0))
            return nullptr;
        st = SmApiCreateCone(at, r0, r1, h1 - h0, body);
        break;
    }
    case Analytic::SPHERE: st = SmApiCreateSphere(at, s.r, body); break;
    default: return nullptr;
    }
    if (st != SM_SUCCESS || !body)
    {
        delete body;
        return nullptr;
    }
    const Turn turn(P{}, s.z, degrees);
    const P ex = turn.vector(s.x), ez = s.z, ey = cross(ez, ex);
    smlibpy::transform_brep(body, {ex.x, ex.y, ex.z, 0, ey.x, ey.y, ey.z, 0, ez.x, ez.y, ez.z, 0, s.o.x, s.o.y, s.o.z, 1});
    return body;
}

// A copy of body a in which the face that owns the seam of `contact` has its seam turned about the
// face's axis by `degrees`: the face's surface solid (over the face's extent along the axis, widened
// by `margin` at both ends) is added and taken away again turned (a hole's wall, with material
// outside the surface), or taken away and added again turned (a boss's, with material inside). The
// copy keeps a's volume (to 1e-7) where that solid lay wholly outside (or inside) a: else null.
SmBrep* reseamed_face(const SmBrep* a, const smlibpy::SeamContact& contact, double degrees, double margin, double volume)
{
    SmTArray<SmEdge*> edges;
    a->GetEdges(edges);
    if (contact.edge < 0 || static_cast<ULONG>(contact.edge) >= edges.GetSize())
        return nullptr;
    SmTArray<SmFace*> faces;
    edges[contact.edge]->GetFaces(faces);
    if (faces.GetSize() != 1)
        return nullptr;
    const SmFace* face = faces[0];
    const Analytic s = analytic(face->GetSurface());
    if (s.kind != Analytic::CYLINDER && s.kind != Analytic::CONE && s.kind != Analytic::SPHERE)
        return nullptr;
    // the face's extent along the axis, from points along its edges
    double h0 = HUGE_VAL, h1 = -HUGE_VAL;
    SmTArray<SmEdge*> boundary;
    face->GetEdges(boundary);
    for (ULONG i = 0; i < boundary.GetSize(); ++i)
    {
        const SmCurve* curve = boundary[i]->GetCurve();
        const SmExtent1d ivl = boundary[i]->GetInterval();
        if (!curve)
            return nullptr;
        for (int j = 0; j <= 32; ++j)
        {
            SmPoint3d p;
            if (curve->EvaluatePoint(ivl.GetMin() + (ivl.GetMax() - ivl.GetMin()) * j / 32, p) != SM_SUCCESS)
                return nullptr;
            const double h = dot(from(p) - s.o, s.z);
            h0 = std::min(h0, h), h1 = std::max(h1, h);
        }
    }
    if (s.kind != Analytic::SPHERE && !(h1 - h0 > 0))
        return nullptr;
    h0 -= margin, h1 += margin;
    // which side the material is on: a point just off the face on the side its normal points away from
    // the axis (the surface's own normal, which is the face's or its reverse)
    const P q{contact.point[0], contact.point[1], contact.point[2]};
    const P n = s.normal(q);
    const double size = size_of(a);
    const double radius = std::max(1e-9, s.kind == Analytic::CONE ? s.r + dot(q - s.o, s.z) * s.sin_a / s.cos_a : s.r);
    const double eps = std::min(1e-2 * radius, 1e-3 * size);
    const P off = q + eps * n;
    const smlibpy::Value where = smlibpy::classify_points(a, {off.x, off.y, off.z}, 0.0);
    const std::string side = where.at(0).at(0).str();
    if (side != "inside" && side != "outside")
        return nullptr;
    const bool hole = side == "inside";  // material away from the axis: the wall of a hole
    SmBrep *copy = nullptr, *fill = surface_solid(s, h0, h1, 0.0), *again = surface_solid(s, h0, h1, degrees);
    if (!fill || !again || SmApiBrepCopy(a, copy) != SM_SUCCESS)
    {
        delete fill, delete again, delete copy;
        return nullptr;
    }
    SmBrep* step = nullptr;
    if (plain_boolean(copy, fill, hole ? SM_BO_UNION : SM_BO_DIFFERENCE, step) != SM_SUCCESS)
    {
        delete fill, delete again, delete copy;
        return nullptr;
    }
    SmBrep* out = nullptr;
    if (plain_boolean(step, again, hole ? SM_BO_DIFFERENCE : SM_BO_UNION, out) != SM_SUCCESS)
    {
        delete again, delete step;
        return nullptr;
    }
    const double v = out->GetNumFaces() && out->IsManifoldSolid() ? volume_of(out, 1e-9) : std::nan("");
    if (!(std::fabs(v - volume) <= 1e-7 * std::fabs(volume)))
    {
        delete out;
        return nullptr;
    }
    return out;
}

}  // namespace

namespace smlibpy {

SmBrep* reseamed(const SmBrep* a, const SmBrep* b, double tolerance)
{
    if (!a || !b)
        throw std::invalid_argument("brep is None");
    const double tol = tolerance > 0 ? tolerance : default_tolerance(a, b);
    // (only seams that touch at a point: a seam that lies in the other face, as a cylinder's in a
    // plane through its axis, gives the kernel no trouble, and the fill and recut can be slow there)
    auto touching = [&](const SmBrep* body) {
        std::vector<SeamContact> out;
        for (const SeamContact& c : contacts(seams_of(body), b, tol, Turn(), false))
            if (!c.along)
                out.push_back(c);
        return out;
    };
    std::vector<SeamContact> found = touching(a);
    if (found.empty())
        return nullptr;
    const double volume = volume_of(a, 1e-9);
    if (!(volume > 0))
        return nullptr;
    const double size = size_of(a);
    SmBrep* current = nullptr;  // (a copy of a's, once a seam is turned)
    SmBrep* next = nullptr;
    try
    {
        for (int round = 0; round < 4 && !found.empty(); ++round)
        {
            const SmBrep* body = current ? current : a;
            for (double margin : {1e-3 * size, 0.0})
            {
                for (double angle : {90.0, 45.0, 135.0, 180.0})
                {
                    next = reseamed_face(body, found.front(), angle, margin, volume);
                    if (next && touching(next).size() < found.size())
                        break;
                    delete next;
                    next = nullptr;
                }
                if (next)
                    break;
            }
            if (!next)
                break;
            delete current;
            current = next;
            next = nullptr;
            found = touching(current);
        }
    }
    catch (...)
    {
        delete next;
        delete current;
        throw;
    }
    if (current && !found.empty())  // (a seam it could not turn: no better than a)
    {
        delete current;
        return nullptr;
    }
    return current;
}

bool freeform_seam_touches(const SmBrep* a, const SmBrep* b, double tolerance)
{
    if (!a || !b)
        throw std::invalid_argument("brep is None");
    const std::vector<Seam> seams = seams_of(a, true);
    if (seams.empty())
        return false;
    for (const SeamContact& c : contacts(seams, b, tolerance > 0 ? tolerance : default_tolerance(a, b), Turn(), false))
        if (!c.along)
            return true;
    return false;
}

std::vector<SeamContact> seam_touches(const SmBrep* a, const SmBrep* b, double tolerance)
{
    if (!a || !b)
        throw std::invalid_argument("brep is None");
    const double tol = tolerance > 0 ? tolerance : default_tolerance(a, b);
    std::vector<SeamContact> out;
    for (bool freeform : {false, true})
        for (const SeamContact& c : contacts(seams_of(a, freeform), b, tol, Turn(), false))
            if (!c.along)
                out.push_back(c);
    return out;
}

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
    m.def("seam_touches", [](const SmBrep* a, const SmBrep* b, double tolerance) {
        py::list out;
        for (const auto& c : smlibpy::seam_touches(a, b, tolerance))
            out.append(py::make_tuple(c.edge, c.face, py::make_tuple(c.point[0], c.point[1], c.point[2])));
        return out;
    }, py::arg("a"), py::arg("b"), py::arg("tolerance") = 0.0,
          "Where a seam of a closed face of body a (a cylinder, cone, sphere, torus or B-spline face) touches a "
          "face of body b at a point (not where it lies on the face's surface along its length): per point (seam "
          "edge index in a, face index in b, (x, y, z)), as seam_contacts. Where a Boolean of a and b can come out "
          "wrong (kernel plan B6).");
}
#endif  // SMLIBPY_PYTHON
