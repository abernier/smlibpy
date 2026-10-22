// SPDX-License-Identifier: Apache-2.0
//
// Swung bodies (`smlibpy._core.ext.swung`).
//
// A swung surface is a surface of revolution whose circle is an outline of any shape: a profile in
// the XZ plane carried around an outline in the XY plane and scaled about the Z axis with the
// profile's distance from it, S(u, v) = (a Px(u) Tx(v), a Px(u) Ty(v), Pz(u)) (NLib's
// N_CreateSwungSrf: the tensor product of the two curves, exact). The kernel's
// SmApiCreateSwungPrimitive (SmPrimitiveCreation::CreateSwungPrimitive) picks `a` itself: 1 / |x| of
// the first point where its first outline curve meets the plane y = (y of the profile's start),
// searched over the profile's parameter range. That finds the -X side of an outline as readily as the
// +X side, nothing on an outline whose first curve does not reach y = 0 there (a rounded rectangle
// turned by 30 degrees: SM_ERR), and then divides by the x of the profile's start, which is 0 where it
// starts on the axis. swung takes `a` from the caller (smlibpy's swing measures where the outline
// crosses the +X axis) and makes the same faces: one for each pair of profile and outline curves.

#include "kernel.h"
#include "swing.h"

#include <SmApiGeneral.h>

#include <cmath>
#include <stdexcept>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

void check(SmStatus st, const char* what)
{
    if (st != SM_SUCCESS)
        SmPyRaise(st, what, __FILE__, __LINE__);
}

// Deletes a Brep that is not handed out.
struct BrepGuard
{
    SmBrep* brep;
    ~BrepGuard() { delete brep; }
};

SmBSplineCurve* bspline(SmCurve* c, const char* what)
{
    SmBSplineCurve* b = c ? SM_CAST_PTR(SmBSplineCurve, c) : nullptr;
    if (!b)
        throw std::invalid_argument(what);
    return b;
}

}  // namespace

namespace smlibpy
{

SmBrep* swung(const std::vector<SmCurve*>& profile, const std::vector<SmCurve*>& outline, double scale)
{
    if (profile.empty() || outline.empty())
        throw std::invalid_argument("swung: needs profile and outline curves");
    if (!(scale > 0) || !std::isfinite(scale))
        throw std::invalid_argument("swung: the scale must be positive");
    BrepGuard guard{new (ctx()) SmBrep()};
    SmTArray<SmFace*> faces;
    for (SmCurve* t : outline)
    {
        SmBSplineCurve* tb = bspline(t, "swung: an outline curve is not a B-spline curve");
        for (SmCurve* p : profile)
        {
            SmBSplineCurve* pb = bspline(p, "swung: a profile curve is not a B-spline curve");
            SmBSplineSurface* surface = nullptr;
            check(SmBSplineSurface::CreateSwungSurface(ctx(), pb, tb, scale, surface),
                  "SmBSplineSurface::CreateSwungSurface");
            // (CreateFacesFromSurface owns the surface: it gives it to the face, or splits it where it
            // turns and deletes it; so it is not read again)
            const SmExtent2d domain = surface->GetNaturalUVDomain();
            check(guard.brep->CreateFacesFromSurface(surface, domain, SM_CT_G1, faces), "SmBrep::CreateFacesFromSurface");
        }
    }
    SmBrep* out = guard.brep;
    guard.brep = nullptr;
    return out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_swing(py::module_ m)
{
    m.def("swung", &smlibpy::swung, py::arg("profile"), py::arg("outline"), py::arg("scale"),
          py::return_value_policy::take_ownership,
          "The faces of a swung body, not stitched: each profile curve (XZ plane: x from the Z axis, z the height) "
          "carried around each outline curve (XY plane), S(u, v) = (scale Px Tx, scale Px Ty, Pz), one face for each "
          "pair. Curves are copied, not consumed.");
}
#endif  // SMLIBPY_PYTHON
