// SPDX-License-Identifier: Apache-2.0
//
// USD files of exact bodies (`smlibpy._core.ext`):
//
//   usd_text(items, up_axis, meters_per_unit)   the .usda text of a stage of bodies (and meshes)
//   usd_read(text, heal)                        the bodies of the BrepArray prims of a .usda text
//
// NVIDIA's usd-brep stores B-reps in USD as BrepArray prims (its omniSolid schema): one prim holds
// one or more bodies as arrays, one array per kind of topology and geometry (regions, shells,
// faceuses, faces, loops, edgeuses, edges, vertices, curves, surfaces). Its conversion between
// SMLib bodies and those arrays (UsdBrepArrayData) is copied in src/cpp/usd; its reading and writing
// of the arrays goes through OpenUSD, which smlibpy does not depend on. Here the arrays are written
// as .usda text and read from it, attribute by attribute as usd-brep's UsdBrepWrite.cpp writes them
// (the table below), with the applied API schemas it declares. Binary USD (.usdc, .usdz) is not read.

#include "kernel.h"
#include "usd.h"

#include "SmuConvert.h"
#include "UsdBrepArrayData.h"
#include "UsdBrepTokens.h"

#include <SmApiGeneral.h>

#include <algorithm>
#include <array>
#include <clocale>
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <cstring>
#include <map>
#include <set>
#include <stdexcept>
#include <unordered_map>

namespace pxr {
std::string& usd_diagnostics()
{
    static thread_local std::string d;
    return d;
}
}  // namespace pxr

namespace
{

using UsdBrepData::UsdBrepArrayData;
using UsdBrepData::UsdBrepArraySpans;
using pxr::GfVec2d;
using pxr::GfVec2i;
using pxr::GfVec3d;
using pxr::TfToken;
using pxr::VtArray;

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

// -- the attributes of a BrepArray prim ------------------------------------------------------------
// One entry per array of UsdBrepArrayData: its attribute name, its USD type and the applied API
// schema it belongs to (none: the BrepArray schema itself, written always). A schema is applied when
// the first array of its group is not empty, as UsdBrepWrite.cpp decides it.
enum Kind { DOUBLE, DOUBLE2, DOUBLE3, POINT3D, VECTOR3D, UINT, INT2, TOKEN };

struct Field
{
    const char* name;
    Kind kind;
    const char* schema;
    VtArray<double> UsdBrepArrayData::*d = nullptr;
    VtArray<GfVec2d> UsdBrepArrayData::*d2 = nullptr;
    VtArray<GfVec3d> UsdBrepArrayData::*d3 = nullptr;
    VtArray<uint32_t> UsdBrepArrayData::*u = nullptr;
    VtArray<GfVec2i> UsdBrepArrayData::*i2 = nullptr;
    VtArray<TfToken> UsdBrepArrayData::*t = nullptr;

    size_t size(const UsdBrepArrayData& a) const
    {
        return d ? (a.*d).size() : d2 ? (a.*d2).size() : d3 ? (a.*d3).size() : u ? (a.*u).size()
             : i2 ? (a.*i2).size() : (a.*t).size();
    }
};

Field F(const char* n, VtArray<double> UsdBrepArrayData::*m, const char* s = nullptr)
{
    Field f{n, DOUBLE, s};
    f.d = m;
    return f;
}
Field F2(const char* n, VtArray<GfVec2d> UsdBrepArrayData::*m, const char* s = nullptr)
{
    Field f{n, DOUBLE2, s};
    f.d2 = m;
    return f;
}
Field F3(const char* n, Kind k, VtArray<GfVec3d> UsdBrepArrayData::*m, const char* s = nullptr)
{
    Field f{n, k, s};
    f.d3 = m;
    return f;
}
Field FU(const char* n, VtArray<uint32_t> UsdBrepArrayData::*m, const char* s = nullptr)
{
    Field f{n, UINT, s};
    f.u = m;
    return f;
}
Field FI2(const char* n, VtArray<GfVec2i> UsdBrepArrayData::*m, const char* s = nullptr)
{
    Field f{n, INT2, s};
    f.i2 = m;
    return f;
}
Field FT(const char* n, VtArray<TfToken> UsdBrepArrayData::*m, const char* s = nullptr)
{
    Field f{n, TOKEN, s};
    f.t = m;
    return f;
}

const std::vector<Field>& fields()
{
    using A = UsdBrepArrayData;
    static const std::vector<Field> all = {
        F("brep:intersectTol3d", &A::m_sBrepXSectTol3dArray),
        F3("brep:extent", DOUBLE3, &A::m_sBrepExtentArray),
        FU("brep:regionCount", &A::m_sBrepRegionCountArray),
        FT("region:type", &A::m_sRegionTypeArray),
        FU("region:shellCount", &A::m_sRegionShellCountArray),
        FU("shell:faceuseCount", &A::m_sShellFaceuseCountArray),
        FU("shell:wireEdgeCount", &A::m_sShellWireEdgeCountArray),
        FT("shell:pointType", &A::m_sShellPointTypeArray),
        FU("faceuse:faceIndex", &A::m_sFaceuseFaceIndexArray),
        FT("faceuse:orientationType", &A::m_sFaceuseOrientationTypeArray),
        FU("face:loopCount", &A::m_sFaceLoopCountArray),
        FT("face:surfaceType", &A::m_sFaceSurfaceTypeArray),
        FT("face:trimType", &A::m_sFaceTrimTypeArray),
        F2("face:range", &A::m_sFaceRangeArray),
        FU("loop:edgeuseCount", &A::m_sLoopEdgeuseCountArray),
        FU("loop:vertexIndex", &A::m_sLoopVertexIndexArray),
        FU("edgeuse:edgeIndex", &A::m_sEdgeuseEdgeIndexArray),
        FT("edgeuse:orientationType", &A::m_sEdgeuseOrientationTypeArray),
        FU("edgeuse:nextRadialEUIndex", &A::m_sEdgeuseNextRadialEUIndexArray),
        FT("edgeuse:thisRadialEntryType", &A::m_sEdgeuseThisRadialEntryTypeArray),
        FT("edge:curveType", &A::m_sEdgeCurveTypeArray),
        F("edge:range", &A::m_sEdgeRangeArray),
        FI2("edge:vertexIndices", &A::m_sEdgeVertexIndicesArray),
        FT("wireEdge:curveType", &A::m_sWireEdgeCurveTypeArray),
        F("wireEdge:range", &A::m_sWireEdgeRangeArray),
        FI2("wireEdge:vertexIndices", &A::m_sWireEdgeVertexIndicesArray),
        FT("vertex:pointType", &A::m_sVertexPointTypeArray),

        F3("brep:vertexPoint:point:position", POINT3D, &A::m_sVertex_PointPositionArray, "BrepPointAPI:vertexPoint"),
        F3("brep:shellPoint:point:position", POINT3D, &A::m_sShell_PointPositionArray, "BrepPointAPI:shellPoint"),

        F("brep:edge3dCircle:curve3d:circle:radius", &A::m_sEdge_CurveCircle_RadiusArray, "BrepCurve3dCircleAPI:edge3dCircle"),
        F3("brep:edge3dCircle:curve3d:circle:center", POINT3D, &A::m_sEdge_CurveCircle_CenterArray, "BrepCurve3dCircleAPI:edge3dCircle"),
        F3("brep:edge3dCircle:curve3d:circle:axis", VECTOR3D, &A::m_sEdge_CurveCircle_AxisArray, "BrepCurve3dCircleAPI:edge3dCircle"),
        F3("brep:edge3dCircle:curve3d:circle:refDirection", VECTOR3D, &A::m_sEdge_CurveCircle_RefDirectionArray, "BrepCurve3dCircleAPI:edge3dCircle"),
        F3("brep:edge3dLine:curve3d:line:origin", POINT3D, &A::m_sEdge_CurveLine_OriginArray, "BrepCurve3dLineAPI:edge3dLine"),
        F3("brep:edge3dLine:curve3d:line:direction", VECTOR3D, &A::m_sEdge_CurveLine_DirectionArray, "BrepCurve3dLineAPI:edge3dLine"),
        F3("brep:edge3dEllipse:curve3d:ellipse:center", POINT3D, &A::m_sEdge_CurveEllipse_CenterArray, "BrepCurve3dEllipseAPI:edge3dEllipse"),
        F3("brep:edge3dEllipse:curve3d:ellipse:axis", VECTOR3D, &A::m_sEdge_CurveEllipse_AxisArray, "BrepCurve3dEllipseAPI:edge3dEllipse"),
        F3("brep:edge3dEllipse:curve3d:ellipse:refDirection", VECTOR3D, &A::m_sEdge_CurveEllipse_RefDirectionArray, "BrepCurve3dEllipseAPI:edge3dEllipse"),
        F("brep:edge3dEllipse:curve3d:ellipse:xRadius", &A::m_sEdge_CurveEllipse_XRadiusArray, "BrepCurve3dEllipseAPI:edge3dEllipse"),
        F("brep:edge3dEllipse:curve3d:ellipse:yRadius", &A::m_sEdge_CurveEllipse_YRadiusArray, "BrepCurve3dEllipseAPI:edge3dEllipse"),
        F3("brep:edge3dNurb:curve3d:nurb:controlVertices", POINT3D, &A::m_sEdge_CurveNurb_ControlVerticesArray, "BrepCurve3dNurbAPI:edge3dNurb"),
        FU("brep:edge3dNurb:curve3d:nurb:vertexCount", &A::m_sEdge_CurveNurb_VertexCountArray, "BrepCurve3dNurbAPI:edge3dNurb"),
        FU("brep:edge3dNurb:curve3d:nurb:order", &A::m_sEdge_CurveNurb_OrderArray, "BrepCurve3dNurbAPI:edge3dNurb"),
        F("brep:edge3dNurb:curve3d:nurb:knots", &A::m_sEdge_CurveNurb_KnotsArray, "BrepCurve3dNurbAPI:edge3dNurb"),
        F("brep:edge3dNurb:curve3d:nurb:weights", &A::m_sEdge_CurveNurb_WeightsArray, "BrepCurve3dNurbAPI:edge3dNurb"),

        F("brep:wireEdge3dCircle:curve3d:circle:radius", &A::m_sWireEdge_CurveCircle_RadiusArray, "BrepCurve3dCircleAPI:wireEdge3dCircle"),
        F3("brep:wireEdge3dCircle:curve3d:circle:center", POINT3D, &A::m_sWireEdge_CurveCircle_CenterArray, "BrepCurve3dCircleAPI:wireEdge3dCircle"),
        F3("brep:wireEdge3dCircle:curve3d:circle:axis", VECTOR3D, &A::m_sWireEdge_CurveCircle_AxisArray, "BrepCurve3dCircleAPI:wireEdge3dCircle"),
        F3("brep:wireEdge3dCircle:curve3d:circle:refDirection", VECTOR3D, &A::m_sWireEdge_CurveCircle_RefDirectionArray, "BrepCurve3dCircleAPI:wireEdge3dCircle"),
        F3("brep:wireEdge3dLine:curve3d:line:origin", POINT3D, &A::m_sWireEdge_CurveLine_OriginArray, "BrepCurve3dLineAPI:wireEdge3dLine"),
        F3("brep:wireEdge3dLine:curve3d:line:direction", VECTOR3D, &A::m_sWireEdge_CurveLine_DirectionArray, "BrepCurve3dLineAPI:wireEdge3dLine"),
        F3("brep:wireEdge3dEllipse:curve3d:ellipse:center", POINT3D, &A::m_sWireEdge_CurveEllipse_CenterArray, "BrepCurve3dEllipseAPI:wireEdge3dEllipse"),
        F3("brep:wireEdge3dEllipse:curve3d:ellipse:axis", VECTOR3D, &A::m_sWireEdge_CurveEllipse_AxisArray, "BrepCurve3dEllipseAPI:wireEdge3dEllipse"),
        F3("brep:wireEdge3dEllipse:curve3d:ellipse:refDirection", VECTOR3D, &A::m_sWireEdge_CurveEllipse_RefDirectionArray, "BrepCurve3dEllipseAPI:wireEdge3dEllipse"),
        F("brep:wireEdge3dEllipse:curve3d:ellipse:xRadius", &A::m_sWireEdge_CurveEllipse_XRadiusArray, "BrepCurve3dEllipseAPI:wireEdge3dEllipse"),
        F("brep:wireEdge3dEllipse:curve3d:ellipse:yRadius", &A::m_sWireEdge_CurveEllipse_YRadiusArray, "BrepCurve3dEllipseAPI:wireEdge3dEllipse"),
        F3("brep:wireEdge3dNurb:curve3d:nurb:controlVertices", POINT3D, &A::m_sWireEdge_CurveNurb_ControlVerticesArray, "BrepCurve3dNurbAPI:wireEdge3dNurb"),
        FU("brep:wireEdge3dNurb:curve3d:nurb:vertexCount", &A::m_sWireEdge_CurveNurb_VertexCountArray, "BrepCurve3dNurbAPI:wireEdge3dNurb"),
        FU("brep:wireEdge3dNurb:curve3d:nurb:order", &A::m_sWireEdge_CurveNurb_OrderArray, "BrepCurve3dNurbAPI:wireEdge3dNurb"),
        F("brep:wireEdge3dNurb:curve3d:nurb:knots", &A::m_sWireEdge_CurveNurb_KnotsArray, "BrepCurve3dNurbAPI:wireEdge3dNurb"),
        F("brep:wireEdge3dNurb:curve3d:nurb:weights", &A::m_sWireEdge_CurveNurb_WeightsArray, "BrepCurve3dNurbAPI:wireEdge3dNurb"),

        F2("brep:curveUv:nurb:controlVertices", &A::m_sEdgeuse_CurveNurb_ControlVerticesArray, "BrepCurveUvNurbAPI"),
        FU("brep:curveUv:nurb:vertexCount", &A::m_sEdgeuse_CurveNurb_VertexCountArray, "BrepCurveUvNurbAPI"),
        FU("brep:curveUv:nurb:order", &A::m_sEdgeuse_CurveNurb_OrderArray, "BrepCurveUvNurbAPI"),
        F("brep:curveUv:nurb:knots", &A::m_sEdgeuse_CurveNurb_KnotsArray, "BrepCurveUvNurbAPI"),
        F("brep:curveUv:nurb:weights", &A::m_sEdgeuse_CurveNurb_WeightsArray, "BrepCurveUvNurbAPI"),

        F("brep:surface:sphere:radius", &A::m_sFace_SurfaceSphere_RadiusArray, "BrepSurfaceSphereAPI"),
        F3("brep:surface:sphere:center", POINT3D, &A::m_sFace_SurfaceSphere_CenterArray, "BrepSurfaceSphereAPI"),
        F3("brep:surface:sphere:axis", VECTOR3D, &A::m_sFace_SurfaceSphere_AxisArray, "BrepSurfaceSphereAPI"),
        F3("brep:surface:sphere:refDirection", VECTOR3D, &A::m_sFace_SurfaceSphere_RefDirectionArray, "BrepSurfaceSphereAPI"),
        F3("brep:surface:plane:origin", POINT3D, &A::m_sFace_SurfacePlane_OriginArray, "BrepSurfacePlaneAPI"),
        F3("brep:surface:plane:axis", VECTOR3D, &A::m_sFace_SurfacePlane_AxisArray, "BrepSurfacePlaneAPI"),
        F3("brep:surface:plane:refDirection", VECTOR3D, &A::m_sFace_SurfacePlane_RefDirectionArray, "BrepSurfacePlaneAPI"),
        F("brep:surface:cylinder:radius", &A::m_sFace_SurfaceCylinder_RadiusArray, "BrepSurfaceCylinderAPI"),
        F3("brep:surface:cylinder:origin", POINT3D, &A::m_sFace_SurfaceCylinder_OriginArray, "BrepSurfaceCylinderAPI"),
        F3("brep:surface:cylinder:axis", VECTOR3D, &A::m_sFace_SurfaceCylinder_AxisArray, "BrepSurfaceCylinderAPI"),
        F3("brep:surface:cylinder:refDirection", VECTOR3D, &A::m_sFace_SurfaceCylinder_RefDirectionArray, "BrepSurfaceCylinderAPI"),
        F("brep:surface:cone:radius", &A::m_sFace_SurfaceCone_RadiusArray, "BrepSurfaceConeAPI"),
        F3("brep:surface:cone:origin", POINT3D, &A::m_sFace_SurfaceCone_OriginArray, "BrepSurfaceConeAPI"),
        F3("brep:surface:cone:axis", VECTOR3D, &A::m_sFace_SurfaceCone_AxisArray, "BrepSurfaceConeAPI"),
        F3("brep:surface:cone:refDirection", VECTOR3D, &A::m_sFace_SurfaceCone_RefDirectionArray, "BrepSurfaceConeAPI"),
        F("brep:surface:cone:semiAngle", &A::m_sFace_SurfaceCone_SemiAngleArray, "BrepSurfaceConeAPI"),
        F("brep:surface:torus:majorRadius", &A::m_sFace_SurfaceTorus_MajorRadiusArray, "BrepSurfaceTorusAPI"),
        F3("brep:surface:torus:origin", POINT3D, &A::m_sFace_SurfaceTorus_OriginArray, "BrepSurfaceTorusAPI"),
        F3("brep:surface:torus:axis", VECTOR3D, &A::m_sFace_SurfaceTorus_AxisArray, "BrepSurfaceTorusAPI"),
        F3("brep:surface:torus:refDirection", VECTOR3D, &A::m_sFace_SurfaceTorus_RefDirectionArray, "BrepSurfaceTorusAPI"),
        F("brep:surface:torus:minorRadius", &A::m_sFace_SurfaceTorus_MinorRadiusArray, "BrepSurfaceTorusAPI"),
        F3("brep:surface:nurb:controlVertices", POINT3D, &A::m_sFace_SurfaceNurb_ControlVerticesArray, "BrepSurfaceNurbAPI"),
        F("brep:surface:nurb:uKnots", &A::m_sFace_SurfaceNurb_UKnotsArray, "BrepSurfaceNurbAPI"),
        FU("brep:surface:nurb:uOrder", &A::m_sFace_SurfaceNurb_UOrderArray, "BrepSurfaceNurbAPI"),
        FU("brep:surface:nurb:uVertexCount", &A::m_sFace_SurfaceNurb_UVertexCountArray, "BrepSurfaceNurbAPI"),
        F("brep:surface:nurb:vKnots", &A::m_sFace_SurfaceNurb_VKnotsArray, "BrepSurfaceNurbAPI"),
        FU("brep:surface:nurb:vOrder", &A::m_sFace_SurfaceNurb_VOrderArray, "BrepSurfaceNurbAPI"),
        FU("brep:surface:nurb:vVertexCount", &A::m_sFace_SurfaceNurb_VVertexCountArray, "BrepSurfaceNurbAPI"),
        F("brep:surface:nurb:weights", &A::m_sFace_SurfaceNurb_WeightsArray, "BrepSurfaceNurbAPI"),
    };
    return all;
}

const char* type_name(Kind k)
{
    switch (k)
    {
    case DOUBLE: return "double[]";
    case DOUBLE2: return "double2[]";
    case DOUBLE3: return "double3[]";
    case POINT3D: return "point3d[]";
    case VECTOR3D: return "vector3d[]";
    case UINT: return "uint[]";
    case INT2: return "int2[]";
    default: return "token[]";
    }
}

// -- writing ---------------------------------------------------------------------------------------
// snprintf and strtod write and read the decimal point of the C locale; USD has '.' whatever it is.
char decimal_point()
{
    const std::lconv* l = std::localeconv();
    return l && l->decimal_point && *l->decimal_point ? *l->decimal_point : '.';
}

// snprintf's text of a number, with USD's decimal point
void append_number(std::string& out, char* buf)
{
    const char point = decimal_point();
    for (char* c = buf; *c; ++c)
        if (*c == point)
            *c = '.';
    out += buf;
}

// A short text that reads back as the same double: 15 significant digits where they do, else 16
// or 17. (Not std::to_chars, whose floating point form needs macOS 13.3: the wheels run from 11.)
void put(std::string& out, double x)
{
    if (!std::isfinite(x))
    {
        out += std::isnan(x) ? "nan" : (x > 0 ? "inf" : "-inf");
        return;
    }
    char buf[40];
    for (int digits = 15; digits <= 17; ++digits)
    {
        std::snprintf(buf, sizeof buf, "%.*g", digits, x);
        if (digits == 17 || std::strtod(buf, nullptr) == x)
            break;
    }
    append_number(out, buf);
}

// The same for a float (point3f, normal3f, float3): the fewest of 6 to 9 significant digits that
// read back as the same float.
void put_float(std::string& out, float x)
{
    if (!std::isfinite(x))
    {
        out += std::isnan(x) ? "nan" : (x > 0 ? "inf" : "-inf");
        return;
    }
    char buf[40];
    for (int digits = 6; digits <= 9; ++digits)
    {
        std::snprintf(buf, sizeof buf, "%.*g", digits, static_cast<double>(x));
        if (digits == 9 || std::strtof(buf, nullptr) == x)
            break;
    }
    append_number(out, buf);
}

// (x, y, z), (x, y, z), ... of floats
void put_float3s(std::string& out, const std::vector<float>& v)
{
    for (size_t i = 0; i + 2 < v.size(); i += 3)
    {
        out += i ? ", (" : "(";
        for (int c = 0; c < 3; ++c)
        {
            if (c)
                out += ", ";
            put_float(out, v[i + c]);
        }
        out += ')';
    }
}

void put_field(std::string& out, const Field& f, const UsdBrepArrayData& a)
{
    out += "        uniform ";
    out += type_name(f.kind);
    out += ' ';
    out += f.name;
    out += " = [";
    const size_t n = f.size(a);
    for (size_t i = 0; i < n; ++i)
    {
        if (i)
            out += ", ";
        if (f.d)
            put(out, (a.*f.d)[i]);
        else if (f.u)
            out += std::to_string((a.*f.u)[i]);
        else if (f.t)
            out += '"' + (a.*f.t)[i].GetString() + '"';
        else if (f.d2)
        {
            out += '(';
            put(out, (a.*f.d2)[i][0]);
            out += ", ";
            put(out, (a.*f.d2)[i][1]);
            out += ')';
        }
        else if (f.d3)
        {
            out += '(';
            for (int c = 0; c < 3; ++c)
            {
                if (c)
                    out += ", ";
                put(out, (a.*f.d3)[i][c]);
            }
            out += ')';
        }
        else
            out += '(' + std::to_string((a.*f.i2)[i][0]) + ", " + std::to_string((a.*f.i2)[i][1]) + ')';
    }
    out += "]\n";
}

void put_color(std::string& out, const std::vector<double>& c)
{
    if (c.size() != 3)
        return;
    out += "        color3f[] primvars:displayColor = [(";
    for (int i = 0; i < 3; ++i)
    {
        if (i)
            out += ", ";
        put(out, c[i]);
    }
    out += ")] (\n            interpolation = \"constant\"\n        )\n";
}

void put_extent(std::string& out, const double lo[3], const double hi[3])
{
    out += "        float3[] extent = [(";
    for (int i = 0; i < 3; ++i)
    {
        if (i)
            out += ", ";
        put_float(out, static_cast<float>(lo[i]));
    }
    out += "), (";
    for (int i = 0; i < 3; ++i)
    {
        if (i)
            out += ", ";
        put_float(out, static_cast<float>(hi[i]));
    }
    out += ")]\n";
}

// A valid prim name, not taken yet among its siblings.
std::string prim_name(const std::string& wanted, std::set<std::string>& taken, const char* fallback)
{
    std::string n;
    for (char c : wanted)
        n += (std::isalnum(static_cast<unsigned char>(c)) || c == '_') ? c : '_';
    if (n.empty())
        n = fallback;
    if (std::isdigit(static_cast<unsigned char>(n[0])))
        n = "_" + n;
    std::string out = n;
    for (int k = 1; taken.count(out); ++k)
        out = n + "_" + std::to_string(k);
    taken.insert(out);
    return out;
}

std::string brep_prim(const smlibpy::UsdItem& item, const std::string& name)
{
    // (the conversion adds UV trim curves and attributes to the Brep: a copy goes in)
    SmBrep* copy = new (ctx()) SmBrep(*item.brep, nullptr, nullptr, TRUE, FALSE);
    std::vector<SmBrep*> breps{copy};
    UsdBrepArrayData a;
    pxr::usd_diagnostics().clear();
    SmStatus st;
    try
    {
        SmPyErrorTrail::clear();
        st = SMU_BrepConvert::BrepAppend_SMLibToUsdBrep(breps, a, nullptr, true, true);
    }
    catch (...)
    {
        delete copy;
        throw;
    }
    delete copy;
    if (st != SM_SUCCESS)
        throw std::runtime_error("usd: the body '" + item.name + "' could not be converted to a BrepArray (" +
                                 sm_status_name(st) + ")" +
                                 (pxr::usd_diagnostics().empty() ? "" : ": " + pxr::usd_diagnostics()));
    std::vector<std::string> schemas;
    std::set<std::string> applied;
    for (const Field& f : fields())
        if (f.schema && !applied.count(f.schema) && f.size(a) > 0)
            applied.insert(f.schema), schemas.push_back(f.schema);

    std::string out = "    def BrepArray \"" + name + "\" (\n";
    if (!schemas.empty())
    {
        out += "        prepend apiSchemas = [";
        for (size_t i = 0; i < schemas.size(); ++i)
            out += (i ? ", \"" : "\"") + schemas[i] + "\"";
        out += "]\n";
    }
    out += "        customData = {\n            string source = \"smlibpy\"\n        }\n    )\n    {\n";
    const auto& lo = a.m_sBrepArray_BBox.GetMin();
    const auto& hi = a.m_sBrepArray_BBox.GetMax();
    const double l[3] = {lo[0], lo[1], lo[2]}, h[3] = {hi[0], hi[1], hi[2]};
    put_extent(out, l, h);
    put_color(out, item.color);
    for (const Field& f : fields())
        if (!f.schema || applied.count(f.schema))
            put_field(out, f, a);
    out += "    }\n";
    return out;
}

std::string mesh_prim(const smlibpy::UsdItem& item, const std::string& name)
{
    const auto& p = item.points;
    const auto& t = item.triangles;
    if (p.size() % 3 || t.size() % 3)
        throw std::invalid_argument("usd: a mesh needs x, y, z per point and three point indices per triangle");
    for (long i : t)
        if (i < 0 || static_cast<size_t>(i) * 3 >= p.size())
            throw std::invalid_argument("usd: a triangle refers to a point that is not there");
    double lo[3] = {1e300, 1e300, 1e300}, hi[3] = {-1e300, -1e300, -1e300};
    for (size_t i = 0; i < p.size(); ++i)
        lo[i % 3] = std::min(lo[i % 3], p[i]), hi[i % 3] = std::max(hi[i % 3], p[i]);
    // A normal per point, which every viewer reads, and far less text than one per triangle corner:
    // the given corner normals, a point whose corners have different ones (on a sharp edge) written
    // once for each of them; without them, the area-weighted normal of each point.
    std::vector<float> pts, nrm;  // as written: x, y, z of each point and its unit normal
    std::vector<size_t> tri;      // three written points per triangle
    auto unit = [](const double n[3], float u[3]) {
        double len = std::sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
        if (!(len > 0))
            len = 1.0;
        for (int d = 0; d < 3; ++d)
            u[d] = static_cast<float>(n[d] / len);
    };
    const auto& cn = item.normals;
    if (cn.size() == 3 * t.size() && !t.empty())
    {
        std::map<std::array<long, 4>, size_t> written;  // (point, normal to 1e-6) -> written point
        for (size_t i = 0; i < t.size(); ++i)
        {
            float u[3];
            unit(&cn[3 * i], u);
            const std::array<long, 4> key = {t[i], std::lround(u[0] * 1e6f), std::lround(u[1] * 1e6f),
                                             std::lround(u[2] * 1e6f)};
            const auto [at, fresh] = written.emplace(key, pts.size() / 3);
            if (fresh)
                for (int d = 0; d < 3; ++d)
                    pts.push_back(static_cast<float>(p[3 * t[i] + d])), nrm.push_back(u[d]);
            tri.push_back(at->second);
        }
    }
    else
    {
        std::vector<double> n(p.size(), 0.0);
        for (size_t i = 0; i + 2 < t.size(); i += 3)
        {
            const double* a = &p[3 * t[i]], *b = &p[3 * t[i + 1]], *c = &p[3 * t[i + 2]];
            const double u[3] = {b[0] - a[0], b[1] - a[1], b[2] - a[2]}, v[3] = {c[0] - a[0], c[1] - a[1], c[2] - a[2]};
            const double w[3] = {u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]};
            for (int k = 0; k < 3; ++k)
                for (int d = 0; d < 3; ++d)
                    n[3 * t[i + k] + d] += w[d];
        }
        for (size_t i = 0; i + 2 < p.size(); i += 3)
        {
            float u[3];
            unit(&n[i], u);
            for (int d = 0; d < 3; ++d)
                pts.push_back(static_cast<float>(p[i + d])), nrm.push_back(u[d]);
        }
        tri.assign(t.begin(), t.end());
    }
    std::string out = "    def Mesh \"" + name + "\"\n    {\n";
    if (!p.empty())
        put_extent(out, lo, hi);
    put_color(out, item.color);
    out += "        int[] faceVertexCounts = [";
    for (size_t i = 0; i < tri.size() / 3; ++i)
        out += i ? ", 3" : "3";
    out += "]\n        int[] faceVertexIndices = [";
    for (size_t i = 0; i < tri.size(); ++i)
        out += (i ? ", " : "") + std::to_string(tri[i]);
    out += "]\n        point3f[] points = [";
    put_float3s(out, pts);
    out += "]\n        normal3f[] normals = [";
    put_float3s(out, nrm);
    out += "] (\n            interpolation = \"vertex\"\n        )\n";
    out += "        uniform token subdivisionScheme = \"none\"\n    }\n";
    return out;
}

// -- reading ---------------------------------------------------------------------------------------
// .usda as far as BrepArray prims need it: prims (def, over, class) with their properties and child
// prims; values of numbers, strings, tuples and lists. Metadata, dictionaries, variant sets and
// relationships are skipped.
struct Val
{
    enum K { NUM, STR, LIST, OTHER } k = OTHER;
    double n = 0.0;
    std::string s;
    std::vector<Val> items;  // LIST, and tuples (OTHER with items)
};

class Parser
{
public:
    explicit Parser(const std::string& text) : t_(text) {}

    struct Prim
    {
        std::string type, name;
        std::map<std::string, Val> props;
    };
    std::vector<Prim> brep_arrays;

    void layer()
    {
        skip_space();
        if (peek_char() == '(')
            skip_group();
        while (true)
        {
            skip_space();
            if (i_ >= t_.size())
                return;
            std::string w = word();
            if (w == "def" || w == "over" || w == "class")
                prim();
            else
                fail("a prim (def, over or class)");
        }
    }

private:
    const std::string& t_;
    size_t i_ = 0;

    [[noreturn]] void fail(const std::string& what)
    {
        size_t line = 1 + std::count(t_.begin(), t_.begin() + std::min(i_, t_.size()), '\n');
        throw std::invalid_argument("usd: expected " + what + " on line " + std::to_string(line) + " of the .usda text");
    }

    char peek_char() { return i_ < t_.size() ? t_[i_] : '\0'; }

    void skip_space()
    {
        while (i_ < t_.size())
        {
            char c = t_[i_];
            if (c == '#')
                while (i_ < t_.size() && t_[i_] != '\n')
                    ++i_;
            else if (std::isspace(static_cast<unsigned char>(c)) || c == ';')
                ++i_;
            else
                break;
        }
    }

    bool is_word_char(char c) { return std::isalnum(static_cast<unsigned char>(c)) || c == '_' || c == ':' || c == '.' || c == '-' || c == '+'; }

    std::string word()
    {
        skip_space();
        size_t s = i_;
        while (i_ < t_.size() && is_word_char(t_[i_]))
            ++i_;
        if (s == i_)
            fail("a name");
        return t_.substr(s, i_ - s);
    }

    std::string string_literal()
    {
        skip_space();
        char q = peek_char();
        if (q != '"' && q != '\'')
            fail("a string");
        bool triple = t_.compare(i_, 3, std::string(3, q)) == 0;
        i_ += triple ? 3 : 1;
        std::string out;
        while (i_ < t_.size())
        {
            if (triple ? t_.compare(i_, 3, std::string(3, q)) == 0 : t_[i_] == q)
            {
                i_ += triple ? 3 : 1;
                return out;
            }
            if (t_[i_] == '\\' && i_ + 1 < t_.size())
            {
                char e = t_[++i_];
                out += e == 'n' ? '\n' : e == 't' ? '\t' : e;
                ++i_;
                continue;
            }
            out += t_[i_++];
        }
        fail("the end of a string");
    }

    // A balanced group from the bracket here to its partner, strings and comments respected.
    void skip_group()
    {
        skip_space();
        std::vector<char> closers;
        do
        {
            char c = t_[i_];
            if (c == '"' || c == '\'')
            {
                string_literal();
                continue;
            }
            if (c == '#')
            {
                while (i_ < t_.size() && t_[i_] != '\n')
                    ++i_;
                continue;
            }
            if (c == '<')  // a path: may hold brackets of its own ([variant selections])
            {
                while (i_ < t_.size() && t_[i_] != '>')
                    ++i_;
                ++i_;
                continue;
            }
            if (c == '@')
            {
                ++i_;
                while (i_ < t_.size() && t_[i_] != '@')
                    ++i_;
                ++i_;
                continue;
            }
            if (c == '(' || c == '[' || c == '{')
                closers.push_back(c == '(' ? ')' : c == '[' ? ']' : '}');
            else if (c == ')' || c == ']' || c == '}')
            {
                if (closers.empty() || closers.back() != c)
                    fail("matching brackets");
                closers.pop_back();
            }
            ++i_;
        } while (!closers.empty() && i_ < t_.size());
        if (!closers.empty())
            fail("the end of a group");
    }

    Val value()
    {
        skip_space();
        Val v;
        char c = peek_char();
        if (c == '[' || c == '(')
        {
            const char close = c == '[' ? ']' : ')';
            v.k = c == '[' ? Val::LIST : Val::OTHER;
            ++i_;
            while (true)
            {
                skip_space();
                if (peek_char() == close)
                {
                    ++i_;
                    return v;
                }
                v.items.push_back(value());
                skip_space();
                if (peek_char() == ',')
                    ++i_;
                else if (peek_char() != close)
                    fail(std::string("',' or '") + close + "'");
            }
        }
        if (c == '{')
        {
            skip_group();
            return v;
        }
        if (c == '"' || c == '\'')
        {
            v.k = Val::STR;
            v.s = string_literal();
            return v;
        }
        if (c == '<' || c == '@')
        {
            skip_group_like_path();
            return v;
        }
        std::string w = word();
        if (const char point = decimal_point(); point != '.')
            std::replace(w.begin(), w.end(), '.', point);
        const char* b = w.c_str();
        char* e = nullptr;
        v.n = std::strtod(b, &e);
        if (e != b && *e == '\0')
            v.k = Val::NUM;
        return v;  // (true, false, None and other words: OTHER)
    }

    void skip_group_like_path()
    {
        char close = peek_char() == '<' ? '>' : '@';
        ++i_;
        while (i_ < t_.size() && t_[i_] != close)
            ++i_;
        ++i_;
    }

    void prim()
    {
        Prim p;
        skip_space();
        if (peek_char() != '"' && peek_char() != '\'')
            p.type = word();
        p.name = string_literal();
        skip_space();
        if (peek_char() == '(')
            skip_group();
        skip_space();
        if (peek_char() != '{')
            fail("'{' after the prim \"" + p.name + "\"");
        ++i_;
        while (true)
        {
            skip_space();
            if (i_ >= t_.size())
                fail("'}' at the end of the prim \"" + p.name + "\"");
            if (peek_char() == '}')
            {
                ++i_;
                break;
            }
            std::string w = word();
            if (w == "def" || w == "over" || w == "class")
                prim();
            else if (w == "variantSet")
            {
                string_literal();
                skip_space();
                if (peek_char() == '=')
                    ++i_;
                skip_group();
            }
            else
                property(w, p);
        }
        if (p.type == "BrepArray")
            brep_arrays.push_back(std::move(p));
    }

    void property(std::string w, Prim& p)
    {
        static const std::set<std::string> qualifiers = {"custom", "uniform", "varying", "prepend", "append",
                                                         "delete", "add", "reorder", "config"};
        while (qualifiers.count(w))
            w = word();
        if (w == "rel")
        {
            word();
            skip_space();
            if (peek_char() == '=')
            {
                ++i_;
                value();
            }
            skip_space();
            if (peek_char() == '(')
                skip_group();
            return;
        }
        // a type (possibly an array of it), then the name
        skip_space();
        if (peek_char() == '[')
        {
            ++i_;
            skip_space();
            if (peek_char() != ']')
                fail("']' after a type");
            ++i_;
        }
        std::string name = word();
        skip_space();
        Val v;
        bool has = false;
        if (peek_char() == '=')
        {
            ++i_;
            v = value();
            has = true;
        }
        skip_space();
        if (peek_char() == '(')
            skip_group();
        const bool plain = name.find(".timeSamples") == std::string::npos && name.find(".connect") == std::string::npos &&
                           name.find(".spline") == std::string::npos;
        if (has && plain)
            p.props[name] = std::move(v);
    }
};

double num(const Val& v, const std::string& name)
{
    if (v.k != Val::NUM)
        throw std::invalid_argument("usd: " + name + " holds something that is not a number");
    return v.n;
}

template <int N>
std::array<double, N> tuple(const Val& v, const std::string& name)
{
    if (v.items.size() != N)
        throw std::invalid_argument("usd: " + name + " holds tuples of the wrong size");
    std::array<double, N> out;
    for (int i = 0; i < N; ++i)
        out[i] = num(v.items[i], name);
    return out;
}

void read_field(const Field& f, const Val& v, UsdBrepArrayData& a)
{
    const std::string name = f.name;
    if (v.k != Val::LIST)
        throw std::invalid_argument("usd: " + name + " is not an array");
    for (const Val& x : v.items)
    {
        if (f.d)
            (a.*f.d).push_back(num(x, name));
        else if (f.u)
        {
            const double n = num(x, name);
            if (!(n >= 0 && n <= 4294967295.0))
                throw std::invalid_argument("usd: " + name + " holds a number that is not an unsigned int");
            (a.*f.u).push_back(static_cast<uint32_t>(n));
        }
        else if (f.t)
        {
            if (x.k != Val::STR)
                throw std::invalid_argument("usd: " + name + " holds something that is not a token");
            (a.*f.t).push_back(TfToken(x.s));
        }
        else if (f.d2)
        {
            auto p = tuple<2>(x, name);
            (a.*f.d2).push_back(GfVec2d(p[0], p[1]));
        }
        else if (f.d3)
        {
            auto p = tuple<3>(x, name);
            (a.*f.d3).push_back(GfVec3d(p[0], p[1], p[2]));
        }
        else
        {
            auto p = tuple<2>(x, name);
            (a.*f.i2).push_back(GfVec2i(static_cast<int>(p[0]), static_cast<int>(p[1])));
        }
    }
}

// -- checking ---------------------------------------------------------------------------------------
// usd-brep's conversion trusts the arrays of a BrepArray: wrong sizes, indices out of range or unknown
// tokens make it read past their ends (its own test files for its validator crash it). This pass
// counts the topology and geometry of each body the way UsdBrepArraySpans::SetStartsAndCountsForBrepIndex
// does, with every access checked, and says what is wrong ("" when nothing is).
std::string check(const UsdBrepArrayData& a)
{
    using pxr::UsdBrepCurveTokens;
    using pxr::UsdBrepSolidTokens;
    using pxr::UsdBrepSurfaceTokens;
    constexpr uint64_t LIMIT = 200000000;  // more than any real model: sums past it are malformed
    auto bad = [](const std::string& what) { return what; };
    auto short_of = [](size_t have, uint64_t need) { return static_cast<uint64_t>(have) < need; };

    const uint64_t breps = a.m_sBrepRegionCountArray.size();
    if (short_of(a.m_sBrepXSectTol3dArray.size(), breps))
        return bad("brep:intersectTol3d has fewer entries than there are bodies");
    uint64_t region = 0, shell = 0, shellPoint = 0, faceuse = 0, face = 0, loop = 0, edgeuse = 0, edge = 0,
             wire = 0, vertex = 0, vertexPoint = 0;
    uint64_t sNurb = 0, sNurbCV = 0, sNurbUK = 0, sNurbVK = 0, sSphere = 0, sPlane = 0, sCylinder = 0, sCone = 0,
             sTorus = 0;
    uint64_t eNurb = 0, eNurbCV = 0, eNurbKnot = 0, eCircle = 0, eLine = 0, eEllipse = 0;
    uint64_t wNurb = 0, wNurbCV = 0, wNurbKnot = 0, wCircle = 0, wLine = 0, wEllipse = 0;
    uint64_t uvCV = 0, uvKnot = 0;
    const bool uv = !a.m_sEdgeuse_CurveNurb_VertexCountArray.empty();

    // a NURBS block: order 2 or more, no more than its vertices; its knots non-decreasing
    auto nurbs = [&](uint32_t count, uint32_t order, const VtArray<double>& knots, uint64_t knotStart,
                     const char* what) -> std::string {
        if (order < 2 || count < order)
            return bad(std::string(what) + " has an order below 2 or above its control vertices");
        const uint64_t n = static_cast<uint64_t>(count) + order;
        if (short_of(knots.size(), knotStart + n))
            return bad(std::string(what) + " knots are missing");
        for (uint64_t k = knotStart + 1; k < knotStart + n; ++k)
            if (!(knots[k] >= knots[k - 1]))
                return bad(std::string(what) + " knots decrease");
        return "";
    };

    for (uint64_t b = 0; b < breps; ++b)
    {
        const uint64_t R = a.m_sBrepRegionCountArray[b];
        if (R > LIMIT || short_of(a.m_sRegionShellCountArray.size(), region + R) ||
            short_of(a.m_sRegionTypeArray.size(), region + R))
            return bad("region arrays are too short");
        uint64_t S = 0;
        for (uint64_t r = region; r < region + R; ++r)
        {
            S += a.m_sRegionShellCountArray[r];
            const TfToken& t = a.m_sRegionTypeArray[r];
            if (t != UsdBrepSolidTokens->solidRegion && t != UsdBrepSolidTokens->voidRegion)
                return bad("region:type holds '" + t.GetString() + "'");
        }
        if (S > LIMIT || short_of(a.m_sShellFaceuseCountArray.size(), shell + S) ||
            short_of(a.m_sShellWireEdgeCountArray.size(), shell + S) || short_of(a.m_sShellPointTypeArray.size(), shell + S))
            return bad("shell arrays are too short");
        uint64_t FU = 0, WE = 0, SP = 0;
        for (uint64_t s = shell; s < shell + S; ++s)
        {
            FU += a.m_sShellFaceuseCountArray[s];
            WE += a.m_sShellWireEdgeCountArray[s];
            const TfToken& t = a.m_sShellPointTypeArray[s];
            if (t == UsdBrepSolidTokens->brepPointAPI)
                ++SP;
            else if (t != UsdBrepSolidTokens->none)
                return bad("shell:pointType holds '" + t.GetString() + "'");
        }
        if (FU > LIMIT || WE > LIMIT || FU % 2 != 0)
            return bad("shell:faceuseCount does not add up to two faceuses per face");
        if (short_of(a.m_sShell_PointPositionArray.size(), shellPoint + SP))
            return bad("shell point positions are missing");
        const uint64_t F = FU / 2;
        if (short_of(a.m_sFaceuseFaceIndexArray.size(), faceuse + FU) ||
            short_of(a.m_sFaceuseOrientationTypeArray.size(), faceuse + FU))
            return bad("faceuse arrays are too short");
        for (uint64_t i = faceuse; i < faceuse + FU; ++i)
        {
            const uint64_t f = a.m_sFaceuseFaceIndexArray[i];
            if (f < face || f >= face + F)
                return bad("faceuse:faceIndex refers to a face of no body");
            const TfToken& t = a.m_sFaceuseOrientationTypeArray[i];
            if (t != UsdBrepSolidTokens->same && t != UsdBrepSolidTokens->opposite)
                return bad("faceuse:orientationType holds '" + t.GetString() + "'");
        }
        {
            std::vector<uint8_t> uses(F, 0);
            for (uint64_t i = faceuse; i < faceuse + FU; ++i)
                if (++uses[a.m_sFaceuseFaceIndexArray[i] - face] > 2)
                    break;
            for (uint8_t n : uses)
                if (n != 2)
                    return bad("a face is not used by exactly two faceuses");
        }
        if (short_of(a.m_sFaceLoopCountArray.size(), face + F) || short_of(a.m_sFaceSurfaceTypeArray.size(), face + F) ||
            short_of(a.m_sFaceTrimTypeArray.size(), face + F) || short_of(a.m_sFaceRangeArray.size(), 2 * (face + F)))
            return bad("face arrays are too short");
        uint64_t L = 0;
        for (uint64_t f = face; f < face + F; ++f)
        {
            if (a.m_sFaceLoopCountArray[f] < 1)
                return bad("a face has no loop");
            L += a.m_sFaceLoopCountArray[f];
            const TfToken& trim = a.m_sFaceTrimTypeArray[f];
            if (trim != UsdBrepSolidTokens->rectangular && trim != UsdBrepSolidTokens->general)
                return bad("face:trimType holds '" + trim.GetString() + "'");
            const TfToken& t = a.m_sFaceSurfaceTypeArray[f];
            if (t == UsdBrepSurfaceTokens->brepSurfaceNurbAPI)
            {
                if (short_of(a.m_sFace_SurfaceNurb_UVertexCountArray.size(), sNurb + 1) ||
                    short_of(a.m_sFace_SurfaceNurb_VVertexCountArray.size(), sNurb + 1) ||
                    short_of(a.m_sFace_SurfaceNurb_UOrderArray.size(), sNurb + 1) ||
                    short_of(a.m_sFace_SurfaceNurb_VOrderArray.size(), sNurb + 1))
                    return bad("NURBS surface arrays are too short");
                const uint32_t nu = a.m_sFace_SurfaceNurb_UVertexCountArray[sNurb], nv = a.m_sFace_SurfaceNurb_VVertexCountArray[sNurb];
                const uint32_t ou = a.m_sFace_SurfaceNurb_UOrderArray[sNurb], ov = a.m_sFace_SurfaceNurb_VOrderArray[sNurb];
                if (std::string e = nurbs(nu, ou, a.m_sFace_SurfaceNurb_UKnotsArray, sNurbUK, "a NURBS surface (u)"); !e.empty())
                    return e;
                if (std::string e = nurbs(nv, ov, a.m_sFace_SurfaceNurb_VKnotsArray, sNurbVK, "a NURBS surface (v)"); !e.empty())
                    return e;
                const uint64_t cv = static_cast<uint64_t>(nu) * nv;
                if (cv > LIMIT || short_of(a.m_sFace_SurfaceNurb_ControlVerticesArray.size(), sNurbCV + cv) ||
                    (!a.m_sFace_SurfaceNurb_WeightsArray.empty() && short_of(a.m_sFace_SurfaceNurb_WeightsArray.size(), sNurbCV + cv)))
                    return bad("NURBS surface control vertices or weights are missing");
                sNurb += 1, sNurbCV += cv, sNurbUK += static_cast<uint64_t>(nu) + ou, sNurbVK += static_cast<uint64_t>(nv) + ov;
            }
            else if (t == UsdBrepSurfaceTokens->brepSurfaceSphereAPI)
                ++sSphere;
            else if (t == UsdBrepSurfaceTokens->brepSurfacePlaneAPI)
                ++sPlane;
            else if (t == UsdBrepSurfaceTokens->brepSurfaceCylinderAPI)
                ++sCylinder;
            else if (t == UsdBrepSurfaceTokens->brepSurfaceConeAPI)
                ++sCone;
            else if (t == UsdBrepSurfaceTokens->brepSurfaceTorusAPI)
                ++sTorus;
            else
                return bad("face:surfaceType holds '" + t.GetString() + "'");
        }
        if (L > LIMIT || short_of(a.m_sLoopEdgeuseCountArray.size(), loop + L) ||
            short_of(a.m_sLoopVertexIndexArray.size(), loop + L))
            return bad("loop arrays are too short");
        uint64_t EU = 0, LV = 0;
        for (uint64_t l = loop; l < loop + L; ++l)
        {
            EU += a.m_sLoopEdgeuseCountArray[l];
            LV += a.m_sLoopEdgeuseCountArray[l] == 0 ? 1 : 0;
        }
        if (EU > LIMIT || short_of(a.m_sEdgeuseEdgeIndexArray.size(), edgeuse + EU) ||
            short_of(a.m_sEdgeuseOrientationTypeArray.size(), edgeuse + EU) ||
            short_of(a.m_sEdgeuseNextRadialEUIndexArray.size(), edgeuse + EU) ||
            short_of(a.m_sEdgeuseThisRadialEntryTypeArray.size(), edgeuse + EU))
            return bad("edgeuse arrays are too short");
        // the edges a body has are the ones its edgeuses refer to, numbered 0 to E - 1 from its first
        std::vector<bool> edgeUsed(EU, false);
        uint64_t E = 0, maxEdge = 0;
        for (uint64_t u = edgeuse; u < edgeuse + EU; ++u)
        {
            const uint64_t e = a.m_sEdgeuseEdgeIndexArray[u];
            if (e < edge || e - edge >= EU)
                return bad("edgeuse:edgeIndex refers to an edge of no body");
            if (!edgeUsed[e - edge])
                edgeUsed[e - edge] = true, ++E;
            maxEdge = std::max(maxEdge, e - edge);
            const uint64_t next = a.m_sEdgeuseNextRadialEUIndexArray[u];
            if (next < edgeuse || next >= edgeuse + EU)
                return bad("edgeuse:nextRadialEUIndex refers to an edgeuse of no body");
            const TfToken& o = a.m_sEdgeuseOrientationTypeArray[u];
            if (o != UsdBrepSolidTokens->same && o != UsdBrepSolidTokens->opposite)
                return bad("edgeuse:orientationType holds '" + o.GetString() + "'");
            const TfToken& r = a.m_sEdgeuseThisRadialEntryTypeArray[u];
            if (r != UsdBrepSolidTokens->topEntry && r != UsdBrepSolidTokens->bottomEntry)
                return bad("edgeuse:thisRadialEntryType holds '" + r.GetString() + "'");
            if (uv)
            {
                if (short_of(a.m_sEdgeuse_CurveNurb_VertexCountArray.size(), u + 1) ||
                    short_of(a.m_sEdgeuse_CurveNurb_OrderArray.size(), u + 1))
                    return bad("UV curve arrays are too short");
                const uint32_t n = a.m_sEdgeuse_CurveNurb_VertexCountArray[u], o2 = a.m_sEdgeuse_CurveNurb_OrderArray[u];
                if (n != 0)  // (0: no UV curve for this edgeuse)
                {
                    if (std::string err = nurbs(n, o2, a.m_sEdgeuse_CurveNurb_KnotsArray, uvKnot, "a UV curve"); !err.empty())
                        return err;
                    if (short_of(a.m_sEdgeuse_CurveNurb_ControlVerticesArray.size(), uvCV + n) ||
                        (!a.m_sEdgeuse_CurveNurb_WeightsArray.empty() && short_of(a.m_sEdgeuse_CurveNurb_WeightsArray.size(), uvCV + n)))
                        return bad("UV curve control vertices or weights are missing");
                }
                uvCV += n, uvKnot += n == 0 ? 0 : static_cast<uint64_t>(n) + o2;
            }
        }
        if (E > 0 && maxEdge >= E)
            return bad("the edges of a body are not numbered without gaps");
        {
            std::vector<bool> reached(EU, false);
            for (uint64_t u = edgeuse; u < edgeuse + EU; ++u)
            {
                const uint64_t next = a.m_sEdgeuseNextRadialEUIndexArray[u];
                if (reached[next - edgeuse] || a.m_sEdgeuseEdgeIndexArray[next] != a.m_sEdgeuseEdgeIndexArray[u])
                    return bad("edgeuse:nextRadialEUIndex does not go around the edgeuses of each edge");
                reached[next - edgeuse] = true;
            }
        }
        if (short_of(a.m_sEdgeCurveTypeArray.size(), edge + E) || short_of(a.m_sEdgeVertexIndicesArray.size(), edge + E) ||
            short_of(a.m_sEdgeRangeArray.size(), 2 * (edge + E)))
            return bad("edge arrays are too short");
        if (WE > 0 && (short_of(a.m_sWireEdgeCurveTypeArray.size(), wire + WE) ||
                       short_of(a.m_sWireEdgeVertexIndicesArray.size(), wire + WE) ||
                       short_of(a.m_sWireEdgeRangeArray.size(), 2 * (wire + WE))))
            return bad("wire edge arrays are too short");
        // vertices: one per vertex loop, and the ends of the edges and wire edges
        const uint64_t slots = L + 2 * E + 2 * WE;
        std::vector<bool> vertexUsed(slots, false);
        uint64_t V = LV, maxVertex = 0;
        for (uint64_t l = loop; l < loop + L; ++l)
            if (a.m_sLoopEdgeuseCountArray[l] == 0)
            {
                // (the counting takes the index as it is, the conversion from the body's first vertex)
                const uint64_t v = a.m_sLoopVertexIndexArray[l];
                if (v >= slots || v < vertex || v - vertex >= slots)
                    return bad("loop:vertexIndex refers to a vertex of no body");
                vertexUsed[v] = true;
                maxVertex = std::max(maxVertex, v - vertex);
            }
        auto ends = [&](const VtArray<GfVec2i>& idx, uint64_t first, uint64_t count) -> bool {
            for (uint64_t e = first; e < first + count; ++e)
                for (int k = 0; k < 2; ++k)
                {
                    const int64_t v = static_cast<int64_t>(idx[e][k]) - static_cast<int64_t>(vertex);
                    if (v < 0 || static_cast<uint64_t>(v) >= slots)
                        return false;
                    if (!vertexUsed[v])
                        vertexUsed[v] = true, ++V;
                    maxVertex = std::max(maxVertex, static_cast<uint64_t>(v));
                }
            return true;
        };
        if (!ends(a.m_sEdgeVertexIndicesArray, edge, E) || (WE > 0 && !ends(a.m_sWireEdgeVertexIndicesArray, wire, WE)))
            return bad("edge:vertexIndices refers to a vertex of no body");
        if (V > 0 && maxVertex >= V)
            return bad("the vertices of a body are not numbered without gaps");
        if (short_of(a.m_sVertexPointTypeArray.size(), vertex + V) ||
            short_of(a.m_sVertex_PointPositionArray.size(), vertexPoint + V))
            return bad("vertex arrays or positions are missing");
        // curves of edges and wire edges
        auto curves = [&](const VtArray<TfToken>& types, uint64_t first, uint64_t count, uint64_t& nurb, uint64_t& cvs,
                          uint64_t& knots, uint64_t& circle, uint64_t& line, uint64_t& ellipse,
                          const VtArray<uint32_t>& counts, const VtArray<uint32_t>& orders,
                          const VtArray<double>& knotArray, const VtArray<GfVec3d>& cvArray,
                          const VtArray<double>& weights, const char* what) -> std::string {
            for (uint64_t e = first; e < first + count; ++e)
            {
                const TfToken& t = types[e];
                if (t == UsdBrepCurveTokens->brepCurve3dNurbAPI)
                {
                    if (short_of(counts.size(), nurb + 1) || short_of(orders.size(), nurb + 1))
                        return bad(std::string(what) + " NURBS arrays are too short");
                    const uint32_t n = counts[nurb], o = orders[nurb];
                    if (std::string err = nurbs(n, o, knotArray, knots, what); !err.empty())
                        return err;
                    if (short_of(cvArray.size(), cvs + n) || (!weights.empty() && short_of(weights.size(), cvs + n)))
                        return bad(std::string(what) + " control vertices or weights are missing");
                    nurb += 1, cvs += n, knots += static_cast<uint64_t>(n) + o;
                }
                else if (t == UsdBrepCurveTokens->brepCurve3dCircleAPI)
                    ++circle;
                else if (t == UsdBrepCurveTokens->brepCurve3dLineAPI)
                    ++line;
                else if (t == UsdBrepCurveTokens->brepCurve3dEllipseAPI)
                    ++ellipse;
                else
                    return bad(std::string(what) + " curve type '" + t.GetString() + "'");
            }
            return "";
        };
        if (std::string e = curves(a.m_sEdgeCurveTypeArray, edge, E, eNurb, eNurbCV, eNurbKnot, eCircle, eLine, eEllipse,
                                   a.m_sEdge_CurveNurb_VertexCountArray, a.m_sEdge_CurveNurb_OrderArray,
                                   a.m_sEdge_CurveNurb_KnotsArray, a.m_sEdge_CurveNurb_ControlVerticesArray,
                                   a.m_sEdge_CurveNurb_WeightsArray, "an edge");
            !e.empty())
            return e;
        if (WE > 0)
            if (std::string e = curves(a.m_sWireEdgeCurveTypeArray, wire, WE, wNurb, wNurbCV, wNurbKnot, wCircle, wLine,
                                       wEllipse, a.m_sWireEdge_CurveNurb_VertexCountArray, a.m_sWireEdge_CurveNurb_OrderArray,
                                       a.m_sWireEdge_CurveNurb_KnotsArray, a.m_sWireEdge_CurveNurb_ControlVerticesArray,
                                       a.m_sWireEdge_CurveNurb_WeightsArray, "a wire edge");
                !e.empty())
                return e;
        region += R, shell += S, shellPoint += SP, faceuse += FU, face += F, loop += L, edgeuse += EU, edge += E;
        wire += WE, vertex += V, vertexPoint += V;
    }
    // the analytic geometry, all bodies together
    auto three = [&](uint64_t n, std::initializer_list<size_t> sizes) {
        for (size_t s : sizes)
            if (short_of(s, n))
                return false;
        return true;
    };
    if (!three(sSphere, {a.m_sFace_SurfaceSphere_CenterArray.size(), a.m_sFace_SurfaceSphere_AxisArray.size(),
                         a.m_sFace_SurfaceSphere_RefDirectionArray.size(), a.m_sFace_SurfaceSphere_RadiusArray.size()}) ||
        !three(sPlane, {a.m_sFace_SurfacePlane_OriginArray.size(), a.m_sFace_SurfacePlane_AxisArray.size(),
                        a.m_sFace_SurfacePlane_RefDirectionArray.size()}) ||
        !three(sCylinder, {a.m_sFace_SurfaceCylinder_OriginArray.size(), a.m_sFace_SurfaceCylinder_AxisArray.size(),
                           a.m_sFace_SurfaceCylinder_RefDirectionArray.size(), a.m_sFace_SurfaceCylinder_RadiusArray.size()}) ||
        !three(sCone, {a.m_sFace_SurfaceCone_OriginArray.size(), a.m_sFace_SurfaceCone_AxisArray.size(),
                       a.m_sFace_SurfaceCone_RefDirectionArray.size(), a.m_sFace_SurfaceCone_RadiusArray.size(),
                       a.m_sFace_SurfaceCone_SemiAngleArray.size()}) ||
        !three(sTorus, {a.m_sFace_SurfaceTorus_OriginArray.size(), a.m_sFace_SurfaceTorus_AxisArray.size(),
                        a.m_sFace_SurfaceTorus_RefDirectionArray.size(), a.m_sFace_SurfaceTorus_MajorRadiusArray.size(),
                        a.m_sFace_SurfaceTorus_MinorRadiusArray.size()}))
        return bad("analytic surface arrays are too short");
    if (!three(eCircle, {a.m_sEdge_CurveCircle_CenterArray.size(), a.m_sEdge_CurveCircle_AxisArray.size(),
                         a.m_sEdge_CurveCircle_RefDirectionArray.size(), a.m_sEdge_CurveCircle_RadiusArray.size()}) ||
        !three(eLine, {a.m_sEdge_CurveLine_OriginArray.size(), a.m_sEdge_CurveLine_DirectionArray.size()}) ||
        !three(eEllipse, {a.m_sEdge_CurveEllipse_CenterArray.size(), a.m_sEdge_CurveEllipse_AxisArray.size(),
                          a.m_sEdge_CurveEllipse_RefDirectionArray.size(), a.m_sEdge_CurveEllipse_XRadiusArray.size(),
                          a.m_sEdge_CurveEllipse_YRadiusArray.size()}) ||
        !three(wCircle, {a.m_sWireEdge_CurveCircle_CenterArray.size(), a.m_sWireEdge_CurveCircle_AxisArray.size(),
                         a.m_sWireEdge_CurveCircle_RefDirectionArray.size(), a.m_sWireEdge_CurveCircle_RadiusArray.size()}) ||
        !three(wLine, {a.m_sWireEdge_CurveLine_OriginArray.size(), a.m_sWireEdge_CurveLine_DirectionArray.size()}) ||
        !three(wEllipse, {a.m_sWireEdge_CurveEllipse_CenterArray.size(), a.m_sWireEdge_CurveEllipse_AxisArray.size(),
                          a.m_sWireEdge_CurveEllipse_RefDirectionArray.size(), a.m_sWireEdge_CurveEllipse_XRadiusArray.size(),
                          a.m_sWireEdge_CurveEllipse_YRadiusArray.size()}))
        return bad("analytic curve arrays are too short");
    return "";
}

}  // namespace

namespace smlibpy {

std::string usd_text(const std::vector<UsdItem>& items, const std::string& up_axis, double meters_per_unit)
{
    if (up_axis != "Y" && up_axis != "Z")
        throw std::invalid_argument("usd: the up axis is \"Y\" or \"Z\"");
    if (!(meters_per_unit > 0))
        throw std::invalid_argument("usd: meters per unit must be positive");
    std::string out = "#usda 1.0\n(\n    defaultPrim = \"World\"\n    metersPerUnit = ";
    put(out, meters_per_unit);
    out += "\n    upAxis = \"" + up_axis + "\"\n    doc = \"smlibpy\"\n)\n\ndef Xform \"World\"\n{\n";
    std::set<std::string> taken;
    bool first = true;
    for (const UsdItem& item : items)
    {
        if (item.brep)
        {
            out += first ? "" : "\n";
            out += brep_prim(item, prim_name(item.name, taken, "body"));
            first = false;
        }
        if (!item.triangles.empty())
        {
            out += first ? "" : "\n";
            out += mesh_prim(item, prim_name(item.brep ? item.name + "_mesh" : item.name, taken, "mesh"));
            first = false;
        }
    }
    out += "}\n";
    return out;
}

std::vector<UsdItem> usd_read(const std::string& text, bool heal)
{
    if (text.compare(0, 8, "PXR-USDC") == 0)
        throw std::invalid_argument("usd: this is binary USD (.usdc), which is not read: convert it to text with "
                                    "usdcat (usdcat in.usdc -o out.usda)");
    if (text.compare(0, 2, "PK") == 0)
        throw std::invalid_argument("usd: this is a USD package (.usdz), which is not read: unzip it and read its "
                                    ".usda (or convert its .usdc with usdcat)");
    if (text.compare(0, 5, "#usda") != 0)
        throw std::invalid_argument("usd: not a .usda text (it does not start with #usda)");
    Parser parser(text);
    parser.layer();
    std::unordered_map<std::string, const Field*> by_name;
    for (const Field& f : fields())
        by_name[f.name] = &f;
    std::vector<UsdItem> out;
    try
    {
        for (const Parser::Prim& prim : parser.brep_arrays)
        {
            UsdBrepArrayData a;
            a.m_sPrimPath = pxr::SdfPath("/" + prim.name);
            std::vector<double> color;
            for (const auto& [name, v] : prim.props)
            {
                auto it = by_name.find(name);
                if (it != by_name.end())
                    read_field(*it->second, v, a);
                else if (name == "extent" && v.k == Val::LIST && v.items.size() >= 2)
                {
                    auto lo = tuple<3>(v.items[0], name), hi = tuple<3>(v.items[1], name);
                    a.m_sBrepArray_BBox = pxr::GfRange3f(pxr::GfVec3f(lo[0], lo[1], lo[2]), pxr::GfVec3f(hi[0], hi[1], hi[2]));
                }
                else if (name == "primvars:displayColor" && v.k == Val::LIST && !v.items.empty() && v.items[0].items.size() == 3)
                {
                    auto c = tuple<3>(v.items[0], name);
                    color.assign(c.begin(), c.end());
                }
            }
            if (std::string problem = check(a); !problem.empty())
                throw std::invalid_argument("usd: the BrepArray \"" + prim.name + "\" is malformed: " + problem);
            const uint32_t count = a.TotalBrepCount();
            UsdBrepArraySpans spans;
            for (uint32_t i = 0; i < count; ++i)
            {
                pxr::usd_diagnostics().clear();
                if (!spans.SetStartsAndCountsForBrepIndex(a, i, FALSE, TRUE))
                    throw std::invalid_argument("usd: the BrepArray \"" + prim.name + "\" is malformed (body " +
                                                std::to_string(i) + ")" +
                                                (pxr::usd_diagnostics().empty() ? "" : ": " + pxr::usd_diagnostics()));
                SmBrep* brep = nullptr;
                SmPyErrorTrail::clear();
                SmStatus st = SMU_BrepConvert::BrepMove_OneUsdBrepToSMLib(ctx(), a, spans, i, brep, heal ? TRUE : FALSE);
                if (st != SM_SUCCESS || !brep)
                {
                    delete brep;
                    throw std::runtime_error("usd: body " + std::to_string(i) + " of the BrepArray \"" + prim.name +
                                             "\" could not be built (" + sm_status_name(st) + ")" +
                                             (pxr::usd_diagnostics().empty() ? "" : ": " + pxr::usd_diagnostics()));
                }
                UsdItem item;
                item.brep = brep;
                item.name = count == 1 || i == 0 ? prim.name : prim.name + "_" + std::to_string(i);
                item.color = color;
                out.push_back(std::move(item));
            }
        }
    }
    catch (...)
    {
        for (UsdItem& item : out)
            delete item.brep;
        throw;
    }
    return out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_usd_files(py::module_ m)
{
    m.def("usd_text", [](const py::list& items, const std::string& up_axis, double meters_per_unit) {
        std::vector<smlibpy::UsdItem> in;
        for (const auto& o : items)
        {
            auto t = o.cast<py::tuple>();
            smlibpy::UsdItem item;
            item.brep = t[0].is_none() ? nullptr : t[0].cast<SmBrep*>();
            item.name = t[1].cast<std::string>();
            if (!t[2].is_none())
                item.color = t[2].cast<std::vector<double>>();
            if (!t[3].is_none())
                item.points = t[3].cast<std::vector<double>>();
            if (!t[4].is_none())
                item.triangles = t[4].cast<std::vector<long>>();
            if (t.size() > 5 && !t[5].is_none())
                item.normals = t[5].cast<std::vector<double>>();
            in.push_back(std::move(item));
        }
        return smlibpy::usd_text(in, up_axis, meters_per_unit);
    }, py::arg("items"), py::arg("up_axis") = "Z", py::arg("meters_per_unit") = 0.001,
       "The .usda text of a stage: items are (brep or None, name, (r, g, b) or None, points or None, triangles "
       "or None[, corner normals or None]); a BrepArray prim per body, a Mesh prim per mesh.");
    m.def("usd_read", [](const std::string& text, bool heal) {
        std::vector<smlibpy::UsdItem> items = smlibpy::usd_read(text, heal);
        py::list out;
        for (auto& item : items)
            out.append(py::make_tuple(py::cast(item.brep, py::return_value_policy::take_ownership), item.name,
                                      item.color.empty() ? py::object(py::none()) : py::cast(item.color)));
        return out;
    }, py::arg("text"), py::arg("heal") = false,
       "The bodies of the BrepArray prims of a .usda text: [(brep, name, (r, g, b) or None)].");
}
#endif  // SMLIBPY_PYTHON
