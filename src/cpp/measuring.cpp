// SPDX-License-Identifier: Apache-2.0
//
// Measuring queries the kernel answers loosely (`smlibpy._core.ext`):
//
//   plane_section(brep, point, normal, tolerance)   the curves where a plane cuts a body
//
// The kernel's plane section (SmApiIntersectBrepWithPlane) passes no tolerance to
// SmBrep::CreatePlanarSectionCurves, which then fits each curve within a thousandth of its face's
// size: up to 2.1e-3 off a B-spline sheet 30 x 20, and 1.5e-2 off a part thickened from it. Here the
// same section is asked for with a tolerance.

#include "kernel.h"
#include "measuring.h"

#include <SmApiGeneral.h>

#include <stdexcept>
#include <string>

namespace
{

void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(status, what, __FILE__, __LINE__);
}

SmVector3d vec(const std::vector<double>& v, const char* what)
{
    if (v.size() != 3)
        throw std::invalid_argument(std::string(what) + ": expected three coordinates");
    return SmVector3d(v[0], v[1], v[2]);
}

}  // namespace

namespace smlibpy {

std::vector<SmCurve*> plane_section(const SmBrep* brep, const std::vector<double>& point,
                                    const std::vector<double>& normal, double tolerance)
{
    if (!brep)
        throw std::invalid_argument("plane_section: brep is None");
    if (!(tolerance > 0.0))
        throw std::invalid_argument("plane_section: the tolerance must be positive");
    const SmVector3d o = vec(point, "plane_section");
    SmVector3d n = vec(normal, "plane_section");
    if (n.Unitize() != SM_SUCCESS)
        throw std::invalid_argument("plane_section: the normal must not be zero");
    SmTArray<SmCurve*> curves;
    const SmApproxTol3d tol = tolerance;
    check(brep->CreatePlanarSectionCurves(*SmApiGetOrCreateContext(), SmPoint3d(o.x, o.y, o.z), n, &tol, nullptr, &curves,
                                          nullptr, nullptr, FALSE),
          "SmBrep::CreatePlanarSectionCurves");
    std::vector<SmCurve*> out;
    for (ULONG i = 0; i < curves.GetSize(); ++i)
        out.push_back(curves[i]);
    return out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_measuring(py::module_ m)
{
    m.def("plane_section", &smlibpy::plane_section, py::arg("brep"), py::arg("point"), py::arg("normal"),
          py::arg("tolerance"), py::return_value_policy::reference,
          "The curves where a plane cuts a body, each fitted within `tolerance` of the body's faces (the kernel's "
          "intersect_brep_with_plane fits them within a thousandth of each face's size). The curves are the caller's.");
}
#endif  // SMLIBPY_PYTHON
