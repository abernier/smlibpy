// SPDX-License-Identifier: Apache-2.0
//
// Curves on faces (`smlibpy._core.ext`), shared by the Python extension and the JavaScript module:
//
//   project_curve(faces, curve, direction, tolerance, distance)   along a direction, onto faces
//   normal_project(faces, curve, tolerance)                       along the faces' normals
//   iso_curves(face, along_v, value, tolerance)                   a curve of constant u or v
//   trim_to_face(face, curves, tolerance)                         the parts of curves inside a face
//
// The kernel's entries for these are SM_API calls with tolerances of their own: SmApiProjectCurve
// (k.project_curve, Part.project before) passes no approximation tolerance, so its pieces were 9.4e-5
// off a sphere of radius 10 (2.5e-8 within 1e-7), and SmApiProjectCurve onto one surface
// (k.project_curve_to_surface) takes the curve's own size as the tolerance of the drop, with which a
// slanted line in front of a cylinder came back as a piece of its seam. SmApiDropCurveToSrf drops
// within 10 and lifts within 0.001 (7.5e-4 off a cylinder). Here every tolerance is the caller's,
// and every piece is trimmed to its face (SmFace::CreateCurvesByTrimming).
//
// SmSurface::LiftCurve (a curve of the parameter plane onto the surface) is not used for wrapping:
// on analytic surfaces the parameters are those of the surface's NURBS form, whose speed varies (a
// line of the parameter plane of a cylinder is no helix), so Face.wrap maps points itself and fits
// them (Python and TypeScript), and trims the result here.

#include "kernel.h"
#include "curve_project.h"

#include <SmApiGeneral.h>

#include <cmath>
#include <memory>
#include <stdexcept>
#include <string>

namespace
{

using smlibpy::FaceCurve;

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

void check(SmStatus status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(status, what, __FILE__, __LINE__);
}

void free_curves(SmTArray<SmCurve*>& curves)
{
    for (ULONG i = 0; i < curves.GetSize(); i++)
        delete curves[i];
    curves.ReSet();
}

// Owns curves until they are handed out.
struct Curves
{
    SmTArray<SmCurve*> items;
    ~Curves() { free_curves(items); }
};

void check_tolerance(double tolerance, const char* what)
{
    if (!(tolerance > 0.0) || !std::isfinite(tolerance))
        throw std::invalid_argument(std::string(what) + ": the tolerance must be positive");
}

// The curve as a B-spline: itself where it is one (circles, ellipses), else a copy approximated
// within 1e-9 of its size (lines are exact as B-splines of degree 1).
const SmBSplineCurve* as_bspline(const SmCurve* curve, std::unique_ptr<SmBSplineCurve>& keep)
{
    if (!curve)
        throw std::invalid_argument("curve is None");
    if (curve->IsKindOf(SmBSplineCurve_TYPE))
        return static_cast<const SmBSplineCurve*>(curve);
    SmCurve* copy = nullptr;
    check(curve->Copy(ctx(), copy), "SmCurve::Copy");
    std::unique_ptr<SmCurve> own(copy);
    SmTArray<double> breaks;
    const SmExtent1d ivl = copy->GetNaturalInterval();
    breaks.Add(ivl.GetMin());
    breaks.Add(ivl.GetMax());
    SmExtent3d box;
    copy->CalculateBoundingBox(ivl, &box);
    double gap = 0.0;
    SmBSplineCurve* a = nullptr;
    check(copy->ApproximateCurve(ctx(), breaks, 1e-9 * std::max(1.0, box.GetSize().Length()), gap, a, FALSE, TRUE),
          "SmCurve::ApproximateCurve");
    keep.reset(a);
    return a;
}

std::vector<SmCurve*> handed_out(SmTArray<SmCurve*>& curves)
{
    std::vector<SmCurve*> out;
    for (ULONG i = 0; i < curves.GetSize(); i++)
        out.push_back(curves[i]);
    curves.ReSet();
    return out;
}

// The 3D curves and their faces (indices into `faces`), the UV curves deleted.
std::vector<FaceCurve> paired(SmTArray<SmCurve*>& curves3d, SmTArray<SmCurve*>& curves_uv, SmTArray<SmFace*>& of,
                              const std::vector<SmFace*>& faces)
{
    if (curves3d.GetSize() != of.GetSize())
    {
        free_curves(curves3d);
        free_curves(curves_uv);
        throw std::runtime_error("the kernel returned " + std::to_string(curves3d.GetSize()) + " curves for " +
                                 std::to_string(of.GetSize()) + " faces");
    }
    std::vector<FaceCurve> out;
    for (ULONG i = 0; i < curves3d.GetSize(); i++)
    {
        FaceCurve fc;
        fc.curve = curves3d[i];
        for (size_t j = 0; j < faces.size(); j++)
            if (faces[j] == of[i])
                fc.face = static_cast<int>(j);
        out.push_back(fc);
    }
    curves3d.ReSet();
    free_curves(curves_uv);
    return out;
}

void check_faces(const std::vector<SmFace*>& faces, const char* what)
{
    if (faces.empty())
        throw std::invalid_argument(std::string(what) + ": no faces");
    const SmBrep* brep = faces[0] ? faces[0]->GetBrep() : nullptr;
    for (SmFace* f : faces)
        if (!f || f->GetBrep() != brep || !brep)
            throw std::invalid_argument(std::string(what) + ": the faces must belong to one body");
}

// B-spline curves on a face's surface trimmed to the face (classified in 3D: the kernel trims by
// the UV curves only where they share the 3D curves' parameters, which the lifted and the iso curves
// do not); the input is consumed.
std::vector<SmCurve*> trimmed(const SmFace* face, SmTArray<SmCurve*>& curves3d, double tolerance)
{
    Curves in3d, out3d;
    in3d.items = curves3d;
    curves3d.ReSet();
    SmApproxTol3d tol = SM_CAST_APPROXTOL3D(tolerance);
    check(face->CreateCurvesByTrimming(ctx(), &tol, &in3d.items, nullptr, &out3d.items, nullptr),
          "SmFace::CreateCurvesByTrimming");
    return handed_out(out3d.items);
}

}  // namespace

namespace smlibpy {

std::vector<FaceCurve> project_curve(const std::vector<SmFace*>& faces, const SmCurve* curve,
                                     const std::vector<double>& direction, double tolerance, double distance)
{
    check_faces(faces, "project_curve");
    check_tolerance(tolerance, "project_curve");
    if (direction.size() != 3 || !(std::hypot(direction[0], direction[1], direction[2]) > 0.0))
        throw std::invalid_argument("project_curve: the direction must be three numbers, not all zero");
    std::unique_ptr<SmBSplineCurve> keep;
    const SmBSplineCurve* b = as_bspline(curve, keep);
    const SmVector3d d(direction[0], direction[1], direction[2]);
    SmApproxTol3d tol = SM_CAST_APPROXTOL3D(tolerance);
    SmTArray<SmFace*> subset, of;
    for (SmFace* f : faces)
        subset.Add(f);
    SmTArray<SmCurve*> curves3d, curves_uv;
    check(faces[0]->GetBrep()->CreateParallelProjectionCurves(ctx(), *b, d, distance > 0.0 ? &distance : nullptr, &tol,
                                                              nullptr, &curves3d, &curves_uv, &of, &subset),
          "SmBrep::CreateParallelProjectionCurves");
    return paired(curves3d, curves_uv, of, faces);
}

std::vector<FaceCurve> normal_project(const std::vector<SmFace*>& faces, const SmCurve* curve, double tolerance)
{
    check_faces(faces, "normal_project");
    check_tolerance(tolerance, "normal_project");
    std::unique_ptr<SmBSplineCurve> keep;
    const SmBSplineCurve* b = as_bspline(curve, keep);
    SmTArray<SmFace*> subset, of;
    for (SmFace* f : faces)
        subset.Add(f);
    SmTArray<SmCurve*> curves3d, curves_uv;
    check(faces[0]->GetBrep()->CreateNormalProjectionCurves(ctx(), *b, subset, SM_CAST_APPROXTOL3D(tolerance), &curves3d,
                                                            &curves_uv, &of),
          "SmBrep::CreateNormalProjectionCurves");
    return paired(curves3d, curves_uv, of, faces);
}

std::vector<SmCurve*> trim_to_face(const SmFace* face, const std::vector<SmCurve*>& curves, double tolerance)
{
    if (!face)
        throw std::invalid_argument("trim_to_face: face is None");
    check_tolerance(tolerance, "trim_to_face");
    SmTArray<SmCurve*> copies;
    try
    {
        for (const SmCurve* c : curves)
        {
            std::unique_ptr<SmBSplineCurve> keep;
            const SmBSplineCurve* b = as_bspline(c, keep);
            if (keep)
                copies.Add(keep.release());
            else
                copies.Add(new (ctx()) SmBSplineCurve(*b));  // (a plain B-spline: the trimming copies it as one)
        }
    }
    catch (...)
    {
        free_curves(copies);
        throw;
    }
    return trimmed(face, copies, tolerance);
}

std::vector<SmCurve*> iso_curves(const SmFace* face, bool along_v, double value, double tolerance)
{
    if (!face)
        throw std::invalid_argument("iso_curves: face is None");
    check_tolerance(tolerance, "iso_curves");
    if (!std::isfinite(value))
        throw std::invalid_argument("iso_curves: the parameter must be a finite number");
    const SmSurface* surface = face->GetSurface();
    const SmExtent2d dom = surface->GetNaturalUVDomain();
    SmBSplineCurve* iso = nullptr;
    double gap = 0.0;
    check(surface->CreateIsoParametricCurve(ctx(), along_v ? SM_SP_U : SM_SP_V, value, SM_CAST_APPROXTOL3D(tolerance), iso,
                                            &dom, &gap),
          "SmSurface::CreateIsoParametricCurve");
    if (!iso)
        throw std::runtime_error("iso_curves: the kernel made no curve");
    SmTArray<SmCurve*> curves3d;
    curves3d.Add(iso);
    return trimmed(face, curves3d, tolerance);
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

namespace
{

py::list face_curves(const std::vector<smlibpy::FaceCurve>& r)
{
    py::list out;
    for (const smlibpy::FaceCurve& fc : r)
        out.append(py::make_tuple(py::cast(fc.curve, py::return_value_policy::reference), fc.face));
    return out;
}

py::list curves(const std::vector<SmCurve*>& r)
{
    py::list out;
    for (SmCurve* c : r)
        out.append(py::cast(c, py::return_value_policy::reference));
    return out;
}

}  // namespace

void bind_curve_project(py::module_ m)
{
    m.def("project_curve", [](const std::vector<SmFace*>& faces, const SmCurve* curve, const std::vector<double>& direction,
                              double tolerance, double distance) {
        return face_curves(smlibpy::project_curve(faces, curve, direction, tolerance, distance));
    }, py::arg("faces"), py::arg("curve"), py::arg("direction"), py::arg("tolerance"), py::arg("distance") = 0.0,
          "The curve projected along direction onto the faces (of one body) within tolerance, as far as distance from "
          "the curve (0: through the body): [(curve, index of its face)], each trimmed to its face. The curves are the "
          "caller's.");
    m.def("normal_project", [](const std::vector<SmFace*>& faces, const SmCurve* curve, double tolerance) {
        return face_curves(smlibpy::normal_project(faces, curve, tolerance));
    }, py::arg("faces"), py::arg("curve"), py::arg("tolerance"),
          "The curve projected onto the faces along their normals within tolerance: [(curve, index of its face)], each "
          "trimmed to its face. The curves are the caller's.");
    m.def("trim_to_face", [](const SmFace* face, const std::vector<SmCurve*>& curves_on_face, double tolerance) {
        return curves(smlibpy::trim_to_face(face, curves_on_face, tolerance));
    }, py::arg("face"), py::arg("curves"), py::arg("tolerance"),
          "The parts of curves lying on the face (within tolerance) that are inside its boundary: [curve], new "
          "B-splines (the input is kept). The curves are the caller's.");
    m.def("iso_curves", [](const SmFace* face, bool along_v, double value, double tolerance) {
        return curves(smlibpy::iso_curves(face, along_v, value, tolerance));
    }, py::arg("face"), py::arg("along_v"), py::arg("value"), py::arg("tolerance"),
          "The face's curve of constant u at value (along_v true) or of constant v, within tolerance and trimmed to "
          "the face: [curve]. The curves are the caller's.");
}
#endif  // SMLIBPY_PYTHON
