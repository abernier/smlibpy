// SPDX-License-Identifier: Apache-2.0
//
// USD files of exact bodies (`smlibpy._core.ext`):
//
//   usd_text(items, up_axis, meters_per_unit)   the .usda text of a stage of bodies (and meshes)
//   usd_assets(text)                            the layers a .usda text names (subLayers, references)
//   usd_stage(layers, heal, check, placement, units)
//                                               the bodies of a stage, placed, in millimeters
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
#include "ext_shared.h"
#include "usd.h"

#include "SmuConvert.h"
#include "UsdBrepArrayData.h"
#include "UsdBrepTokens.h"

#include <SmApiGeneral.h>
#include <SmAssertArray.h>
#include <SmEdgeuse.h>
#include <SmLoop.h>

#include <algorithm>
#include <array>
#include <clocale>
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <cstring>
#include <functional>
#include <map>
#include <memory>
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
// .usda as far as the bodies of a stage need it: prims (def, over, class) with their properties, the
// metadata that decides what a prim is (active, references, payload, customData's source) and their
// child prims; the layer's metadata (defaultPrim, metersPerUnit, upAxis, subLayers); values of
// numbers, strings, tuples and lists. Other metadata, dictionaries, variant sets and relationships are
// skipped, and so are the values of properties that nothing reads (those of meshes).
struct Val
{
    enum K { NUM, STR, LIST, OTHER } k = OTHER;
    double n = 0.0;
    std::string s;           // STR, and the word of an OTHER (true, false, None)
    std::vector<Val> items;  // LIST, and tuples (OTHER with items)
};

// A reference or payload: the prim `path` ("": the layer's defaultPrim) of the layer at `asset`
// ("": the layer stack it is written in).
struct Arc
{
    std::string asset, path;
    bool operator==(const Arc& o) const { return asset == o.asset && path == o.path; }
};

struct PrimSpec
{
    std::string specifier, type, name;
    std::string source;  // customData's source ("smlibpy" in the files smlibpy writes)
    int active = -1;     // -1: not said, 0: false, 1: true
    std::vector<Arc> references, payloads, deleted;
    std::map<std::string, Val> props;
    std::vector<std::unique_ptr<PrimSpec>> children;

    const PrimSpec* child(const std::string& n) const
    {
        for (const auto& c : children)
            if (c->name == n)
                return c.get();
        return nullptr;
    }
};

// One .usda text and what the caller found for the assets it names (smlibpy::UsdLayer).
struct Layer
{
    std::string id;
    std::vector<std::unique_ptr<PrimSpec>> roots;
    double meters_per_unit = 0.0;  // 0: not said
    std::string up_axis, default_prim;
    std::vector<std::string> sublayers;
    const std::map<std::string, std::string>* links = nullptr;    // asset -> id of the layer read for it
    const std::map<std::string, std::string>* missing = nullptr;  // asset -> why none was read

    const PrimSpec* root(const std::string& n) const
    {
        for (const auto& c : roots)
            if (c->name == n)
                return c.get();
        return nullptr;
    }
};

class Parser
{
public:
    explicit Parser(const std::string& text) : t_(text) {}

    // the assets the layer names: subLayers, references and payloads, each once, in order
    std::vector<std::string> assets;

    void layer(Layer& out)
    {
        skip_space();
        if (peek_char() == '(')
            layer_metadata(out);
        while (true)
        {
            skip_space();
            if (i_ >= t_.size())
                return;
            std::string w = word();
            if (w == "def" || w == "over" || w == "class")
                out.roots.push_back(prim(w));
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

    // an asset path, @...@ or @@@...@@@ (for paths that hold an @)
    std::string asset()
    {
        skip_space();
        const bool triple = t_.compare(i_, 3, "@@@") == 0;
        const std::string end = triple ? "@@@" : "@";
        if (peek_char() != '@')
            fail("an asset path (@...@)");
        i_ += end.size();
        const size_t s = i_, e = t_.find(end, s);
        if (e == std::string::npos)
            fail("the end of an asset path");
        i_ = e + end.size();
        return t_.substr(s, e - s);
    }

    // a prim path, <...>
    std::string prim_path()
    {
        skip_space();
        if (peek_char() != '<')
            fail("a prim path (<...>)");
        const size_t s = ++i_, e = t_.find('>', s);
        if (e == std::string::npos)
            fail("the end of a prim path");
        i_ = e + 1;
        return t_.substr(s, e - s);
    }

    // A balanced group from the bracket here to its partner, strings, comments, paths and assets
    // respected.
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
                prim_path();
                continue;
            }
            if (c == '@')
            {
                asset();
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
        if (c == '<')
        {
            prim_path();
            return v;
        }
        if (c == '@')
        {
            asset();
            return v;
        }
        std::string w = word();
        v.s = w;
        if (const char point = decimal_point(); point != '.')
            std::replace(w.begin(), w.end(), '.', point);
        const char* b = w.c_str();
        char* e = nullptr;
        v.n = std::strtod(b, &e);
        if (e != b && *e == '\0')
            v.k = Val::NUM;
        return v;  // (true, false, None and other words: OTHER)
    }

    // a value nothing reads, passed over without building it
    void skip_value()
    {
        skip_space();
        const char c = peek_char();
        if (c == '[' || c == '(' || c == '{')
            skip_group();
        else if (c == '"' || c == '\'')
            string_literal();
        else if (c == '<')
            prim_path();
        else if (c == '@')
            asset();
        else
            word();
    }

    void note_asset(const std::string& a)
    {
        if (!a.empty() && std::find(assets.begin(), assets.end(), a) == assets.end())
            assets.push_back(a);
    }

    // references or payloads: None, one, or a list; each @asset@<path> (either may be left out),
    // with a layer offset or customData in brackets after it
    std::vector<Arc> arcs()
    {
        std::vector<Arc> out;
        skip_space();
        const bool list = peek_char() == '[';
        if (list)
            ++i_;
        while (true)
        {
            skip_space();
            if (list && peek_char() == ']')
            {
                ++i_;
                break;
            }
            if (std::isalpha(static_cast<unsigned char>(peek_char())))  // None
            {
                word();
                if (!list)
                    break;
                continue;
            }
            Arc a;
            if (peek_char() == '@')
                note_asset(a.asset = asset());
            skip_space();
            if (peek_char() == '<')
                a.path = prim_path();
            skip_space();
            if (peek_char() == '(')
                skip_group();
            out.push_back(a);
            if (!list)
                break;
            skip_space();
            if (peek_char() == ',')
                ++i_;
            else if (peek_char() != ']')
                fail("',' or ']' in a list of references");
        }
        return out;
    }

    void layer_metadata(Layer& out)
    {
        ++i_;  // (
        while (true)
        {
            skip_space();
            if (i_ >= t_.size())
                fail("')' at the end of the layer's metadata");
            if (peek_char() == ')')
            {
                ++i_;
                return;
            }
            if (peek_char() == '"' || peek_char() == '\'')  // the layer's doc
            {
                string_literal();
                continue;
            }
            const std::string w = word();
            skip_space();
            if (peek_char() != '=')
                continue;
            ++i_;
            if (w == "subLayers")
            {
                for (const Arc& a : arcs())
                    if (!a.asset.empty())
                        out.sublayers.push_back(a.asset);
            }
            else if (w == "metersPerUnit" || w == "upAxis" || w == "defaultPrim")
            {
                const Val v = value();
                if (w == "metersPerUnit" && (v.k != Val::NUM || !(v.n > 0) || !std::isfinite(v.n)))
                    throw std::invalid_argument("usd: the layer's metersPerUnit is not a positive number");
                if (w == "metersPerUnit")
                    out.meters_per_unit = v.n;
                else if (w == "upAxis")
                    out.up_axis = v.s;
                else
                    out.default_prim = v.s;
            }
            else
                skip_value();
        }
    }

    // customData = { ... }: its source, if it says one
    void custom_data(PrimSpec& p)
    {
        skip_space();
        if (peek_char() != '{')
            return skip_value();
        ++i_;
        while (true)
        {
            skip_space();
            if (i_ >= t_.size())
                fail("'}' at the end of a dictionary");
            if (peek_char() == '}')
            {
                ++i_;
                return;
            }
            word();  // the type
            if (peek_char() == '[')
                skip_group();
            const std::string name = word();
            skip_space();
            if (peek_char() != '=')
                fail("'=' in a dictionary");
            ++i_;
            const Val v = value();
            if (name == "source" && v.k == Val::STR)
                p.source = v.s;
        }
    }

    void prim_metadata(PrimSpec& p)
    {
        static const std::set<std::string> list_ops = {"prepend", "append", "add", "delete", "reorder"};
        ++i_;  // (
        while (true)
        {
            skip_space();
            if (i_ >= t_.size())
                fail("')' at the end of the metadata of the prim \"" + p.name + "\"");
            if (peek_char() == ')')
            {
                ++i_;
                return;
            }
            if (peek_char() == '"' || peek_char() == '\'')  // the prim's doc
            {
                string_literal();
                continue;
            }
            std::string w = word(), op;
            if (list_ops.count(w))
                op = w, w = word();
            skip_space();
            if (peek_char() != '=')
                continue;
            ++i_;
            if (w == "references" || w == "payload")
            {
                std::vector<Arc> a = arcs();
                std::vector<Arc>& to = op == "delete" ? p.deleted : w == "references" ? p.references : p.payloads;
                to.insert(to.end(), a.begin(), a.end());
            }
            else if (w == "active")
            {
                const Val v = value();
                p.active = v.s == "false" || (v.k == Val::NUM && v.n == 0) ? 0 : 1;
            }
            else if (w == "customData")
                custom_data(p);
            else
                skip_value();
        }
    }

    std::unique_ptr<PrimSpec> prim(const std::string& specifier)
    {
        auto p = std::make_unique<PrimSpec>();
        p->specifier = specifier;
        skip_space();
        if (peek_char() != '"' && peek_char() != '\'')
            p->type = word();
        p->name = string_literal();
        skip_space();
        if (peek_char() == '(')
            prim_metadata(*p);
        skip_space();
        if (peek_char() != '{')
            fail("'{' after the prim \"" + p->name + "\"");
        ++i_;
        while (true)
        {
            skip_space();
            if (i_ >= t_.size())
                fail("'}' at the end of the prim \"" + p->name + "\"");
            if (peek_char() == '}')
            {
                ++i_;
                break;
            }
            std::string w = word();
            if (w == "def" || w == "over" || w == "class")
                p->children.push_back(prim(w));
            else if (w == "variantSet")
            {
                string_literal();
                skip_space();
                if (peek_char() == '=')
                    ++i_;
                skip_group();
            }
            else
                property(w, *p);
        }
        return p;
    }

    void property(std::string w, PrimSpec& p)
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
                skip_value();
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
        // what is read: the arrays of a BrepArray (or of a prim that may compose onto one), and
        // the transforms of every prim
        const bool plain = name.find(".timeSamples") == std::string::npos && name.find(".connect") == std::string::npos &&
                           name.find(".spline") == std::string::npos;
        const bool wanted = plain && (p.type == "BrepArray" || p.type.empty() || name == "xformOpOrder" ||
                                      name.compare(0, 8, "xformOp:") == 0);
        if (peek_char() == '=')
        {
            ++i_;
            if (wanted)
                p.props[name] = value();
            else
                skip_value();
        }
        skip_space();
        if (peek_char() == '(')
            skip_group();
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
// Where each body's faces, edges, wire edges and edgeuses start in the arrays (check() finds them).
struct Layout
{
    std::vector<uint64_t> face, edge, wire, edgeuse;  // per body
    uint64_t faces = 0, edges = 0, wires = 0;         // of all bodies
};

// usd-brep's conversion trusts the arrays of a BrepArray: wrong sizes, indices out of range or unknown
// tokens make it read past their ends (its own test files for its validator crash it). This pass
// counts the topology and geometry of each body the way UsdBrepArraySpans::SetStartsAndCountsForBrepIndex
// does, with every access checked, and says what is wrong ("" when nothing is).
std::string check(const UsdBrepArrayData& a, Layout& layout)
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
        layout.face.push_back(face), layout.edge.push_back(edge), layout.wire.push_back(wire);
        layout.edgeuse.push_back(edgeuse);
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
        if (FU == 0 && WE == 0 && SP == 0)
            return bad("body " + std::to_string(b) + " is empty (it has no faces, wire edges or points)");
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
    if (a.m_sEdgeCurveTypeArray.size() > edge)
        return bad(std::to_string(a.m_sEdgeCurveTypeArray.size() - edge) + " of the edges are used by no edgeuse (BA.582)");
    layout.faces = face, layout.edges = edge, layout.wires = wire;
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


// The values of a BrepArray that check() found sound in its shape, against the rules of usd-brep's
// validator that the conversion relies on (their codes in brackets): numbers that are not finite,
// tolerances, weights and radii that are not positive, ranges the wrong way round, directions of
// length 0 and frames whose axis and reference direction are parallel. The conversion takes them as
// they are: a sphere whose refDirection was its axis crashed it, a weight of 0 crashed the meshing
// later, and a cylinder axis of length 0, an edge weight of 0 or a cone axis of length 2 gave bodies
// of the wrong volume that said they were valid. Directions are made unit, and a reference direction
// that is nearly at right angles to its axis is made exactly so (frames of the conversion are not
// orthonormalized, and the surface turned about the reference direction instead). Says what is wrong,
// with the body, the face or edge and the rule ("" when nothing is).
std::string check_values(UsdBrepArrayData& a, const Layout& layout)
{
    using pxr::UsdBrepCurveTokens;
    using pxr::UsdBrepSurfaceTokens;
    // (body b's face, edge, ... f: the body and its own number of it)
    auto at = [](const std::vector<uint64_t>& starts, uint64_t i, const char* what) {
        const auto b = std::upper_bound(starts.begin(), starts.end(), i) - starts.begin() - 1;
        return "body " + std::to_string(b) + ", " + what + " " + std::to_string(i - starts[b]) + ": ";
    };
    auto g = [](double x) {
        char buf[32];
        std::snprintf(buf, sizeof buf, "%.6g", x);
        return std::string(buf);
    };
    // every floating-point array (but the extent, which no body is built from)
    for (const Field& f : fields())
    {
        if (!std::strcmp(f.name, "brep:extent"))
            continue;
        const size_t n = f.size(a);
        for (size_t i = 0; i < n; ++i)
        {
            bool finite = true;
            if (f.d)
                finite = std::isfinite((a.*f.d)[i]);
            else if (f.d2)
                finite = std::isfinite((a.*f.d2)[i][0]) && std::isfinite((a.*f.d2)[i][1]);
            else if (f.d3)
                finite = std::isfinite((a.*f.d3)[i][0]) && std::isfinite((a.*f.d3)[i][1]) && std::isfinite((a.*f.d3)[i][2]);
            if (!finite)
                return std::string(f.name) + "[" + std::to_string(i) + "] is not a finite number (BA.660)";
        }
    }
    for (size_t b = 0; b < a.m_sBrepRegionCountArray.size(); ++b)
        if (!(a.m_sBrepXSectTol3dArray[b] > 0))
            return "body " + std::to_string(b) + ": brep:intersectTol3d is " + g(a.m_sBrepXSectTol3dArray[b]) +
                   ", not positive (BA.010)";
    // the weights of a NURBS block, [first, first + n), all positive
    auto weights = [&](const VtArray<double>& w, uint64_t first, uint64_t n, const char* rule) -> std::string {
        for (uint64_t i = first; i < first + n && i < w.size(); ++i)
            if (!(w[i] > 0))
                return "a weight of " + g(w[i]) + ", not positive (" + rule + ")";
        return "";
    };
    // a positive radius; a direction of some length, made unit
    auto positive = [&](double r, const char* what, const char* rule) -> std::string {
        return r > 0 ? "" : std::string(what) + " is " + g(r) + ", not positive (" + rule + ")";
    };
    auto unit = [&](GfVec3d& v, const char* what, const char* rule) -> std::string {
        const double len = std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        if (!(len > 1e-12))
            return std::string(what) + " has no length (" + rule + ")";
        v = GfVec3d(v[0] / len, v[1] / len, v[2] / len);
        return "";
    };
    // an axis and a reference direction, made unit and at right angles
    auto frame = [&](GfVec3d& axis, GfVec3d& ref, const char* rules) -> std::string {
        if (std::string e = unit(axis, "the axis", rules); !e.empty())
            return e;
        if (std::string e = unit(ref, "the refDirection", rules); !e.empty())
            return e;
        const double c = axis[0] * ref[0] + axis[1] * ref[1] + axis[2] * ref[2];
        if (std::fabs(c) > 1e-3)  // (more than 0.06 degrees off)
            return std::fabs(c) > 1 - 1e-9 ? std::string("the axis and the refDirection are parallel (") + rules + ")"
                                           : "the axis and the refDirection are " +
                                                 g(std::acos(std::max(-1.0, std::min(1.0, c))) * 180.0 / SM_PI) +
                                                 " degrees apart, not at right angles (" + rules + ")";
        ref = GfVec3d(ref[0] - c * axis[0], ref[1] - c * axis[1], ref[2] - c * axis[2]);
        return unit(ref, "the refDirection", rules);
    };

    // faces: their ranges and surfaces
    uint64_t sphere = 0, plane = 0, cylinder = 0, cone = 0, torus = 0, nurb = 0, nurb_cv = 0;
    for (uint64_t f = 0; f < layout.faces; ++f)
    {
        std::string e;
        const GfVec2d lo = a.m_sFaceRangeArray[2 * f], hi = a.m_sFaceRangeArray[2 * f + 1];
        if (!(lo[0] < hi[0]))
            e = "its range in u is empty or the wrong way round (BA.155)";
        else if (!(lo[1] < hi[1]))
            e = "its range in v is empty or the wrong way round (BA.160)";
        const TfToken& t = a.m_sFaceSurfaceTypeArray[f];
        if (!e.empty())
            ;
        else if (t == UsdBrepSurfaceTokens->brepSurfaceNurbAPI)
        {
            const uint64_t n = static_cast<uint64_t>(a.m_sFace_SurfaceNurb_UVertexCountArray[nurb]) *
                               a.m_sFace_SurfaceNurb_VVertexCountArray[nurb];
            if (!(e = weights(a.m_sFace_SurfaceNurb_WeightsArray, nurb_cv, n, "BA.440")).empty())
                e = "its NURBS surface has " + e;
            ++nurb, nurb_cv += n;
        }
        else if (t == UsdBrepSurfaceTokens->brepSurfaceSphereAPI)
        {
            const uint64_t i = sphere++;
            if ((e = positive(a.m_sFace_SurfaceSphere_RadiusArray[i], "the sphere's radius", "BA.481")).empty())
                e = frame(a.m_sFace_SurfaceSphere_AxisArray[i], a.m_sFace_SurfaceSphere_RefDirectionArray[i],
                          "BA.482-484");
        }
        else if (t == UsdBrepSurfaceTokens->brepSurfacePlaneAPI)
        {
            const uint64_t i = plane++;
            e = frame(a.m_sFace_SurfacePlane_AxisArray[i], a.m_sFace_SurfacePlane_RefDirectionArray[i], "BA.491-493");
        }
        else if (t == UsdBrepSurfaceTokens->brepSurfaceCylinderAPI)
        {
            const uint64_t i = cylinder++;
            if ((e = positive(a.m_sFace_SurfaceCylinder_RadiusArray[i], "the cylinder's radius", "BA.501")).empty())
                e = frame(a.m_sFace_SurfaceCylinder_AxisArray[i], a.m_sFace_SurfaceCylinder_RefDirectionArray[i],
                          "BA.502-504");
        }
        else if (t == UsdBrepSurfaceTokens->brepSurfaceConeAPI)
        {
            // (a semi-angle of 0 or below is read: the conversion turns a negative one round, and
            // usd-brep's own writer has written them)
            const uint64_t i = cone++;
            const double angle = a.m_sFace_SurfaceCone_SemiAngleArray[i];
            if (!(a.m_sFace_SurfaceCone_RadiusArray[i] >= 0))
                e = "the cone's radius is " + g(a.m_sFace_SurfaceCone_RadiusArray[i]) + ", below 0 (BA.511)";
            else if (!(std::fabs(angle) < SM_PI / 2))
                e = "the cone's semiAngle is " + g(angle) + ", 90 degrees or more: no cone (BA.515)";
            else
                e = frame(a.m_sFace_SurfaceCone_AxisArray[i], a.m_sFace_SurfaceCone_RefDirectionArray[i], "BA.512-514");
        }
        else if (t == UsdBrepSurfaceTokens->brepSurfaceTorusAPI)
        {
            const uint64_t i = torus++;
            if ((e = positive(a.m_sFace_SurfaceTorus_MajorRadiusArray[i], "the torus' majorRadius", "BA.521")).empty() &&
                (e = positive(a.m_sFace_SurfaceTorus_MinorRadiusArray[i], "the torus' minorRadius", "BA.522")).empty())
                e = frame(a.m_sFace_SurfaceTorus_AxisArray[i], a.m_sFace_SurfaceTorus_RefDirectionArray[i], "BA.523-525");
        }
        if (!e.empty())
            return at(layout.face, f, "face") + e;
    }

    // edges and wire edges: their ranges and curves
    struct Curves
    {
        const VtArray<TfToken>& types;
        VtArray<double>& ranges;
        VtArray<GfVec3d>&circle_axis, &circle_ref;
        VtArray<double>& circle_radius;
        VtArray<GfVec3d>& line_direction;
        VtArray<GfVec3d>&ellipse_axis, &ellipse_ref;
        VtArray<double>&ellipse_x, &ellipse_y;
        const VtArray<uint32_t>& nurb_counts;
        const VtArray<double>& nurb_weights;
        const char* weight_rule;
        const std::vector<uint64_t>& starts;
        uint64_t count;
        const char* what;
    };
    const Curves all[] = {
        {a.m_sEdgeCurveTypeArray, a.m_sEdgeRangeArray, a.m_sEdge_CurveCircle_AxisArray, a.m_sEdge_CurveCircle_RefDirectionArray,
         a.m_sEdge_CurveCircle_RadiusArray, a.m_sEdge_CurveLine_DirectionArray, a.m_sEdge_CurveEllipse_AxisArray,
         a.m_sEdge_CurveEllipse_RefDirectionArray, a.m_sEdge_CurveEllipse_XRadiusArray, a.m_sEdge_CurveEllipse_YRadiusArray,
         a.m_sEdge_CurveNurb_VertexCountArray, a.m_sEdge_CurveNurb_WeightsArray, "BA.350", layout.edge, layout.edges, "edge"},
        {a.m_sWireEdgeCurveTypeArray, a.m_sWireEdgeRangeArray, a.m_sWireEdge_CurveCircle_AxisArray,
         a.m_sWireEdge_CurveCircle_RefDirectionArray, a.m_sWireEdge_CurveCircle_RadiusArray, a.m_sWireEdge_CurveLine_DirectionArray,
         a.m_sWireEdge_CurveEllipse_AxisArray, a.m_sWireEdge_CurveEllipse_RefDirectionArray, a.m_sWireEdge_CurveEllipse_XRadiusArray,
         a.m_sWireEdge_CurveEllipse_YRadiusArray, a.m_sWireEdge_CurveNurb_VertexCountArray, a.m_sWireEdge_CurveNurb_WeightsArray,
         "BA.654", layout.wire, layout.wires, "wire edge"},
    };
    for (const Curves& c : all)
    {
        uint64_t circle = 0, line = 0, ellipse = 0, nurb = 0, nurb_cv = 0;
        for (uint64_t e = 0; e < c.count; ++e)
        {
            std::string err;
            if (!(c.ranges[2 * e] <= c.ranges[2 * e + 1]))
                err = "its range is the wrong way round (BA.235)";
            const TfToken& t = c.types[e];
            if (!err.empty())
                ;
            else if (t == UsdBrepCurveTokens->brepCurve3dNurbAPI)
            {
                const uint64_t n = c.nurb_counts[nurb++];
                if (!(err = weights(c.nurb_weights, nurb_cv, n, c.weight_rule)).empty())
                    err = "its NURBS curve has " + err;
                nurb_cv += n;
            }
            else if (t == UsdBrepCurveTokens->brepCurve3dCircleAPI)
            {
                const uint64_t i = circle++;
                if ((err = positive(c.circle_radius[i], "the circle's radius", "BA.531")).empty())
                    err = frame(c.circle_axis[i], c.circle_ref[i], "BA.532-534");
            }
            else if (t == UsdBrepCurveTokens->brepCurve3dLineAPI)
                err = unit(c.line_direction[line++], "the line's direction", "BA.541");
            else if (t == UsdBrepCurveTokens->brepCurve3dEllipseAPI)
            {
                const uint64_t i = ellipse++;
                if ((err = positive(c.ellipse_x[i], "the ellipse's xRadius", "BA.551")).empty() &&
                    (err = positive(c.ellipse_y[i], "the ellipse's yRadius", "BA.552")).empty())
                    err = frame(c.ellipse_axis[i], c.ellipse_ref[i], "BA.553-555");
            }
            if (!err.empty())
                return at(c.starts, e, c.what) + err;
        }
    }

    // the UV curves of the edgeuses (a count of 0: none)
    uint64_t uv_cv = 0;
    for (uint64_t u = 0; u < a.m_sEdgeuse_CurveNurb_VertexCountArray.size(); ++u)
    {
        const uint64_t n = a.m_sEdgeuse_CurveNurb_VertexCountArray[u];
        if (std::string err = weights(a.m_sEdgeuse_CurveNurb_WeightsArray, uv_cv, n, "BA.410"); !err.empty())
            return at(layout.edgeuse, u, "edgeuse") + "its UV curve has " + err;
        uv_cv += n;
    }
    return "";
}


// -- composing a stage -------------------------------------------------------------------------------
// What USD's composition does for the bodies of a stage, in part: the layer stack (a layer and its
// subLayers, the stronger first), references and payloads (to a prim of another layer, or of the same
// layer stack; weaker than the prim's own opinions), prims of the same path in several layers (the
// strongest opinion of each property wins) and the transforms of the prims down to each body. Abstract
// (class) prims, prims that are only overs and inactive prims hold no bodies, nor do their children.
// Inherits, specializes and variant sets are not composed.
using Path = std::vector<std::string>;

std::string path_text(const Path& p)
{
    std::string s;
    for (const std::string& n : p)
        s += "/" + n;
    return s.empty() ? "/" : s;
}

// a prim path as names (variant selections, {set=name}, left out)
Path parse_path(const std::string& s)
{
    Path out;
    std::string n;
    int braces = 0;
    for (char c : s + "/")
    {
        if (c == '{')
            ++braces;
        else if (c == '}')
            --braces;
        else if (braces)
            continue;
        else if (c == '/')
        {
            if (!n.empty())
                out.push_back(n);
            n.clear();
        }
        else
            n += c;
    }
    return out;
}

// A 4 x 4 matrix, row by row, for column vectors (p' = M p): the translation in the last column.
using Matrix = std::array<double, 16>;

Matrix identity()
{
    Matrix m{};
    m[0] = m[5] = m[10] = m[15] = 1.0;
    return m;
}

Matrix mul(const Matrix& a, const Matrix& b)
{
    Matrix m{};
    for (int r = 0; r < 4; ++r)
        for (int c = 0; c < 4; ++c)
            for (int k = 0; k < 4; ++k)
                m[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
    return m;
}

Matrix inverse(const Matrix& m)
{
    // Gauss-Jordan with partial pivoting
    Matrix a = m, inv = identity();
    for (int c = 0; c < 4; ++c)
    {
        int p = c;
        for (int r = c + 1; r < 4; ++r)
            if (std::fabs(a[r * 4 + c]) > std::fabs(a[p * 4 + c]))
                p = r;
        if (!(std::fabs(a[p * 4 + c]) > 1e-300))
            throw std::invalid_argument("usd: an xformOp that is inverted (!invert!) has no inverse");
        for (int k = 0; k < 4; ++k)
            std::swap(a[c * 4 + k], a[p * 4 + k]), std::swap(inv[c * 4 + k], inv[p * 4 + k]);
        const double d = a[c * 4 + c];
        for (int k = 0; k < 4; ++k)
            a[c * 4 + k] /= d, inv[c * 4 + k] /= d;
        for (int r = 0; r < 4; ++r)
            if (r != c)
            {
                const double f = a[r * 4 + c];
                for (int k = 0; k < 4; ++k)
                    a[r * 4 + k] -= f * a[c * 4 + k], inv[r * 4 + k] -= f * inv[c * 4 + k];
            }
    }
    return inv;
}

Matrix rotation(int axis, double degrees)
{
    const double t = degrees * SM_PI / 180.0, c = std::cos(t), s = std::sin(t);
    Matrix m = identity();
    const int i = (axis + 1) % 3, j = (axis + 2) % 3;  // the plane turned: (y, z), (z, x) or (x, y)
    m[i * 4 + i] = c, m[i * 4 + j] = -s, m[j * 4 + i] = s, m[j * 4 + j] = c;
    return m;
}

// The matrix of one xformOp of the prim at `where`: its kind (translate, scale, rotateX, rotateXYZ,
// orient, transform, ...) and its value.
Matrix op_matrix(const std::string& kind, const Val& v, const std::string& where)
{
    auto numbers = [&](size_t n) {
        std::vector<double> out;
        if (n == 1 && v.k == Val::NUM)
            return std::vector<double>{v.n};
        if (v.items.size() != n)
            throw std::invalid_argument("usd: the xformOp:" + kind + " of " + where + " does not hold " + std::to_string(n) + " numbers");
        for (const Val& x : v.items)
        {
            if (x.k != Val::NUM || !std::isfinite(x.n))
                throw std::invalid_argument("usd: the xformOp:" + kind + " of " + where + " holds something that is not a finite number");
            out.push_back(x.n);
        }
        return out;
    };
    Matrix m = identity();
    if (kind == "translate" || kind == "translateX" || kind == "translateY" || kind == "translateZ")
    {
        const std::vector<double> t = kind.size() == 9 ? numbers(3) : numbers(1);
        for (int k = 0; k < 3; ++k)
            m[k * 4 + 3] = kind.size() == 9 ? t[k] : (kind[9] - 'X' == k ? t[0] : 0.0);
        return m;
    }
    if (kind == "scale" || kind == "scaleX" || kind == "scaleY" || kind == "scaleZ")
    {
        const std::vector<double> s = kind.size() == 5 ? numbers(3) : numbers(1);
        for (int k = 0; k < 3; ++k)
            m[k * 5] = kind.size() == 5 ? s[k] : (kind[5] - 'X' == k ? s[0] : 1.0);
        return m;
    }
    if (kind == "rotateX" || kind == "rotateY" || kind == "rotateZ")
        return rotation(kind[6] - 'X', numbers(1)[0]);
    if (kind.size() == 9 && kind.compare(0, 6, "rotate") == 0)  // rotateXYZ ...: the first axis turns first
    {
        const std::vector<double> a = numbers(3);
        for (int k = 0; k < 3; ++k)
        {
            const int axis = kind[6 + k] - 'X';
            if (axis < 0 || axis > 2)
                throw std::invalid_argument("usd: " + where + " has an xformOp:" + kind + ", which is not read");
            m = mul(rotation(axis, a[axis]), m);
        }
        return m;
    }
    if (kind == "orient")  // a quaternion (real, i, j, k)
    {
        std::vector<double> q = numbers(4);
        const double len = std::sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
        if (!(len > 0))
            throw std::invalid_argument("usd: the xformOp:orient of " + where + " is not a rotation (a quaternion of length 0)");
        const double w = q[0] / len, x = q[1] / len, y = q[2] / len, z = q[3] / len;
        const double r[9] = {1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
                             2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
                             2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)};
        for (int i = 0; i < 3; ++i)
            for (int j = 0; j < 3; ++j)
                m[i * 4 + j] = r[i * 3 + j];
        return m;
    }
    if (kind == "transform")  // a matrix4d for row vectors: the translation in the last row
    {
        if (v.items.size() != 4)
            throw std::invalid_argument("usd: the xformOp:transform of " + where + " is not a 4 x 4 matrix");
        for (int r = 0; r < 4; ++r)
        {
            if (v.items[r].items.size() != 4)
                throw std::invalid_argument("usd: the xformOp:transform of " + where + " is not a 4 x 4 matrix");
            for (int c = 0; c < 4; ++c)
            {
                const Val& x = v.items[r].items[c];
                if (x.k != Val::NUM || !std::isfinite(x.n))
                    throw std::invalid_argument("usd: the xformOp:transform of " + where + " holds something that is not a finite number");
                m[c * 4 + r] = x.n;
            }
        }
        return m;
    }
    throw std::invalid_argument("usd: " + where + " has an xformOp:" + kind + ", a kind of transform that is not read");
}

// A prim of the stage as one layer stack has it: `spec` at `path` in `layer`.
struct Site
{
    size_t stack;
    const Layer* layer;
    Path path;
    const PrimSpec* spec;
};

// A BrepArray prim of the stage, its properties composed.
struct BodyPrim
{
    std::string path, leaf, source;
    std::map<std::string, const Val*> props;
    Matrix world;
};

class Composer
{
public:
    Composer(const std::vector<Layer>& layers, smlibpy::UsdStage& out) : layers_(layers), out_(out)
    {
        for (const Layer& l : layers_)
            by_id_[l.id] = &l;
    }

    // the BrepArray prims of the stage whose root layer is layers[0], in the order of the stage
    std::vector<BodyPrim> bodies()
    {
        const size_t root = stack_of(&layers_[0]);
        Path names;  // the root prims of all layers of the stack, in order
        for (const Layer* l : stacks_[root])
            for (const auto& p : l->roots)
                if (std::find(names.begin(), names.end(), p->name) == names.end())
                    names.push_back(p->name);
        std::vector<BodyPrim> out;
        for (const std::string& n : names)
        {
            std::vector<std::pair<size_t, Path>> chain;
            visit(expand(local(root, {n}), chain), {n}, identity(), out);
        }
        return out;
    }

private:
    const std::vector<Layer>& layers_;
    smlibpy::UsdStage& out_;
    std::map<std::string, const Layer*> by_id_;
    std::vector<std::vector<const Layer*>> stacks_;
    std::map<const Layer*, size_t> stack_index_;

    // the layer the asset names, as the caller read it for `from` (none: noted as unresolved)
    const Layer* linked(const Layer* from, const std::string& asset, const std::string& what)
    {
        if (from->links)
            if (auto it = from->links->find(asset); it != from->links->end())
                if (auto l = by_id_.find(it->second); l != by_id_.end())
                    return l->second;
        std::string why = "it was not read";
        if (from->missing)
            if (auto m = from->missing->find(asset); m != from->missing->end())
                why = m->second;
        const std::string note = "the " + what + " " + asset + " was not read (" + why + ")";
        if (std::find(out_.unresolved.begin(), out_.unresolved.end(), note) == out_.unresolved.end())
            out_.unresolved.push_back(note);
        return nullptr;
    }

    // the layer stack of a layer: it and its subLayers, the stronger first, each once
    size_t stack_of(const Layer* root)
    {
        if (auto it = stack_index_.find(root); it != stack_index_.end())
            return it->second;
        std::vector<const Layer*> stack;
        std::function<void(const Layer*, int)> add = [&](const Layer* l, int depth) {
            if (std::find(stack.begin(), stack.end(), l) != stack.end())
                return;
            if (depth > 32)
                throw std::invalid_argument("usd: the subLayers go deeper than 32 layers (do they go round in a circle?)");
            stack.push_back(l);
            for (const std::string& s : l->sublayers)
                if (const Layer* sub = linked(l, s, "subLayer"))
                    add(sub, depth + 1);
        };
        add(root, 0);
        stacks_.push_back(stack);
        return stack_index_[root] = stacks_.size() - 1;
    }

    // the prim at `path` in each layer of a stack that has one
    std::vector<Site> local(size_t stack, const Path& path)
    {
        std::vector<Site> out;
        for (const Layer* l : stacks_[stack])
        {
            const PrimSpec* p = path.empty() ? nullptr : l->root(path[0]);
            for (size_t k = 1; p && k < path.size(); ++k)
                p = p->child(path[k]);
            if (p)
                out.push_back(Site{stack, l, path, p});
        }
        return out;
    }

    // the sites of a prim with those its references and payloads bring in (weaker), and theirs
    std::vector<Site> expand(std::vector<Site> sites, std::vector<std::pair<size_t, Path>>& chain)
    {
        std::vector<Arc> deleted;
        for (const Site& s : sites)
            deleted.insert(deleted.end(), s.spec->deleted.begin(), s.spec->deleted.end());
        const size_t own = sites.size();
        for (int payloads = 0; payloads < 2; ++payloads)  // references, then payloads
            for (size_t k = 0; k < own; ++k)
            {
                const Site s = sites[k];
                for (const Arc& arc : payloads ? s.spec->payloads : s.spec->references)
                {
                    if (std::find(deleted.begin(), deleted.end(), arc) != deleted.end())
                        continue;
                    const char* what = payloads ? "payload" : "reference";
                    size_t stack = s.stack;
                    if (!arc.asset.empty())
                    {
                        const Layer* l = linked(s.layer, arc.asset, what);
                        if (!l)
                            continue;
                        stack = stack_of(l);
                    }
                    const Layer* root = stacks_[stack][0];
                    const Path target = arc.path.empty() ? Path{root->default_prim} : parse_path(arc.path);
                    if (target.empty() || target[0].empty())
                    {
                        out_.unresolved.push_back(std::string("the ") + what + " " + arc.asset + " of " + path_text(s.path) +
                                                  " names no prim, and its layer has no defaultPrim");
                        continue;
                    }
                    for (const auto& c : chain)
                        if (c.first == stack && c.second == target)
                            throw std::invalid_argument("usd: the references go round in a circle at " + path_text(target) +
                                                        (arc.asset.empty() ? "" : " of " + arc.asset));
                    if (chain.size() > 32)
                        throw std::invalid_argument("usd: the references go deeper than 32 prims");
                    std::vector<Site> brought = local(stack, target);
                    if (brought.empty())
                    {
                        out_.unresolved.push_back(std::string("the ") + what + " " + arc.asset + path_text(target) + " of " +
                                                  path_text(s.path) + " names a prim its layer does not have");
                        continue;
                    }
                    chain.emplace_back(stack, target);
                    brought = expand(brought, chain);
                    chain.pop_back();
                    sites.insert(sites.end(), brought.begin(), brought.end());
                }
            }
        return sites;
    }

    void visit(const std::vector<Site>& sites, const Path& path, const Matrix& parent, std::vector<BodyPrim>& out)
    {
        // the strongest opinion of each: specifier (def or class over over), type, active, source,
        // properties
        std::string specifier = "over", type, source;
        int active = -1;
        std::map<std::string, const Val*> props;
        for (const Site& s : sites)
        {
            const PrimSpec& p = *s.spec;
            if (specifier == "over" && p.specifier != "over")
                specifier = p.specifier;
            if (type.empty())
                type = p.type;
            if (active < 0)
                active = p.active;
            if (source.empty())
                source = p.source;
            for (const auto& [name, v] : p.props)
                props.emplace(name, &v);
        }
        if (specifier != "def" || active == 0)  // a class, an over of nothing, inactive: no bodies
            return;
        const std::string where = path_text(path);
        if (path.size() > 256)
            throw std::invalid_argument("usd: the prims nest deeper than 256 at " + where + " (do references go round in a circle?)");
        Matrix world = parent;
        if (auto order = props.find("xformOpOrder"); order != props.end())
        {
            Matrix local = identity();
            for (const Val& token : order->second->items)
            {
                std::string op = token.s;
                if (op == "!resetXformStack!")
                {
                    world = identity(), local = identity();
                    continue;
                }
                const bool invert = op.compare(0, 8, "!invert!") == 0;
                if (invert)
                    op = op.substr(8);
                auto v = props.find(op);
                if (v == props.end())
                {
                    out_.warnings.push_back(where + " lists " + op + " in its xformOpOrder but has no value for it (time "
                                            "samples are not read): it is taken as no move");
                    continue;
                }
                const size_t colon = op.find(':', 8);
                const std::string kind = op.substr(8, colon == std::string::npos ? std::string::npos : colon - 8);
                const Matrix m = op_matrix(kind, *v->second, where);
                local = mul(local, invert ? inverse(m) : m);
            }
            world = mul(world, local);
        }
        if (type == "BrepArray")
            out.push_back(BodyPrim{where, path.back(), source, props, world});
        Path names;
        for (const Site& s : sites)
            for (const auto& c : s.spec->children)
                if (std::find(names.begin(), names.end(), c->name) == names.end())
                    names.push_back(c->name);
        for (const std::string& n : names)
        {
            std::vector<Site> children;
            for (const Site& s : sites)
                if (const PrimSpec* c = s.spec->child(n))
                {
                    Path p = s.path;
                    p.push_back(n);
                    children.push_back(Site{s.stack, s.layer, p, c});
                }
            Path child = path;
            child.push_back(n);
            std::vector<std::pair<size_t, Path>> chain;
            visit(expand(children, chain), child, world, out);
        }
    }
};

// -- checking a body -----------------------------------------------------------------------------------
// The kernel's own check of a body read from a file (SmBrep::AssertValid, all its tests), which takes
// a few milliseconds where measuring the body would change it. Returns what it found ("" nothing);
// `refuse` when a gap between the body's faces, edges and vertices is not a number or is more than
// 1e-3 of the body's size: usd-brep's validator files with such gaps gave a unit cube of volume 0.5, a
// box whose bounding box reached 100 away, a body that did not mesh, all reporting valid. Smaller gaps
// (other writers' tolerances) and reports that have no size are noted.
std::string kernel_check(SmBrep* brep, bool& refuse)
{
    refuse = false;
    SmAssertArray reports;
    brep->AssertValid(&reports, SM_LEVEL_2);
    if (reports.GetSize() == 0)
        return "";
    SmExtent3d box;
    brep->CalculateBoundingBox(box, FALSE, FALSE, FALSE);
    const double size = box.GetSize().Length();
    SmTArray<SmFace*> faces;
    SmTArray<SmEdge*> edges;
    SmTArray<SmVertex*> vertices;
    brep->GetFaces(faces);
    brep->GetEdges(edges);
    brep->GetVertices(vertices);
    auto index = [](const auto& list, const void* p) -> long {
        for (ULONG i = 0; i < list.GetSize(); ++i)
            if (list[i] == p)
                return static_cast<long>(i);
        return -1;
    };
    // where a report is: the edge, face or vertex its owner is or belongs to
    auto where = [&](const SmAssertReport* r) -> std::string {
        const void* o = r->m_pOwner;
        if (!o)
            return "";
        long i = -1;
        const char* what = "";
        switch (r->m_lOwnerType)
        {
        case SmEdgeuse_TYPE: i = index(edges, static_cast<const SmEdgeuse*>(o)->GetEdge()), what = "edge"; break;
        case SmEdge_TYPE: i = index(edges, o), what = "edge"; break;
        case SmLoop_TYPE: i = index(faces, static_cast<const SmLoop*>(o)->GetFace()), what = "face"; break;
        case SmFace_TYPE: i = index(faces, o), what = "face"; break;
        case SmVertex_TYPE: i = index(vertices, o), what = "vertex"; break;
        default: return "";
        }
        return i < 0 ? "" : std::string(" at ") + what + " " + std::to_string(i);
    };
    auto g = [](double x) {
        char buf[32];
        std::snprintf(buf, sizeof buf, "%.3g", x);
        return std::string(buf);
    };
    const SmAssertReport* worst = nullptr;
    double gap = 0.0;
    std::vector<std::string> kinds;
    for (ULONG i = 0; i < reports.GetSize(); ++i)
    {
        const SmAssertReport* r = reports[i];
        const std::string name = r->m_pName ? r->m_pName : "";
        if (!name.empty() && std::find(kinds.begin(), kinds.end(), name) == kinds.end())
            kinds.push_back(name);
        if (name == "Bad Edge Length" && r->m_dValue != SM_UNDEF_DOUBLE && !(r->m_dValue >= 0))
        {
            // (an edge whose curve runs back against it: usd-brep's validator file with a control point
            // moved out of the edge, read back with a box 100 too large and the wrong volume)
            refuse = true;
            return "the kernel finds an edge of length " + g(r->m_dValue) + where(r) + ": its curve does not run from its "
                   "start to its end";
        }
        // (gaps in space; those in the parameter planes are not lengths)
        const bool spatial = name == "Bad Gap" || name == "Edge/Edge Gap" || name == "Bad Vertex Gap";
        if (!spatial || r->m_dValue == SM_UNDEF_DOUBLE)
            continue;
        if (!std::isfinite(r->m_dValue))
        {
            worst = r, gap = r->m_dValue;
            break;
        }
        if (r->m_dValue > gap)
            worst = r, gap = r->m_dValue;
    }
    if (worst)
    {
        const std::string message = worst->m_pMessage ? worst->m_pMessage : worst->m_pName;
        refuse = !std::isfinite(gap) || !(size > 0) || !std::isfinite(size) || gap > 1e-3 * size;
        return "the kernel finds a gap of " + g(gap) + (std::isfinite(gap) && size > 0 ? " (" + g(gap / size) + " of its size)" : "") +
               where(worst) + ": " + message;
    }
    std::string list;
    for (size_t k = 0; k < kinds.size() && k < 3; ++k)
        list += (k ? ", " : "") + kinds[k];
    return "the kernel reports " + std::to_string(reports.GetSize()) + " problems with it (" + list + (kinds.size() > 3 ? ", ..." : "") + ")";
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

// the text of a layer, as Parser takes it
void check_text(const std::string& text, const std::string& id)
{
    const std::string of = id.empty() ? "" : " (" + id + ")";
    if (text.compare(0, 8, "PXR-USDC") == 0)
        throw std::invalid_argument("usd: this is binary USD (.usdc)" + of + ", which is not read: convert it to text with "
                                    "usdcat (usdcat in.usdc -o out.usda)");
    if (text.compare(0, 2, "PK") == 0)
        throw std::invalid_argument("usd: this is a USD package (.usdz)" + of + ", which is not read: unzip it and read its "
                                    ".usda (or convert its .usdc with usdcat)");
    if (text.compare(0, 5, "#usda") != 0)
        throw std::invalid_argument("usd: not a .usda text" + of + " (it does not start with #usda)");
}

std::vector<std::string> usd_assets(const std::string& text)
{
    check_text(text, "");
    Parser parser(text);
    Layer layer;
    parser.layer(layer);
    return parser.assets;
}

UsdStage usd_stage(const std::vector<UsdLayer>& layers, const UsdReadOptions& options)
{
    if (layers.empty())
        throw std::invalid_argument("usd: no layer to read");
    UsdStage out;
    std::vector<Layer> parsed(layers.size());
    for (size_t i = 0; i < layers.size(); ++i)
    {
        check_text(layers[i].text, i ? layers[i].id : "");
        Parser parser(layers[i].text);
        parsed[i].id = layers[i].id;
        parsed[i].links = &layers[i].links;
        parsed[i].missing = &layers[i].missing;
        parser.layer(parsed[i]);
    }
    std::vector<BodyPrim> prims = Composer(parsed, out).bodies();

    // the stage's units and up axis: millimeters, Z up (a stage that says neither is taken as it is)
    const Layer& root = parsed[0];
    if (!(options.units >= 0) || !std::isfinite(options.units))
        throw std::invalid_argument("usd: the units must be a positive number of millimeters per unit");
    const double mm = options.units > 0 ? options.units : root.meters_per_unit > 0 ? root.meters_per_unit * 1000.0 : 1.0;
    Matrix stage = identity();
    for (int k = 0; k < 3; ++k)
        stage[k * 5] = mm;
    if (options.placement && root.up_axis == "Y")
        stage = mul(stage, rotation(0, 90.0));  // (y up turned to z up)
    else if (options.placement && !root.up_axis.empty() && root.up_axis != "Z")
        out.warnings.push_back("the stage's upAxis is \"" + root.up_axis + "\", which is not Y or Z: it is taken as Z");

    // a body is named after its prim, or its prim's path where two prims have one name
    std::map<std::string, int> leaves;
    for (const BodyPrim& p : prims)
        ++leaves[p.leaf];
    std::unordered_map<std::string, const Field*> by_name;
    for (const Field& f : fields())
        by_name[f.name] = &f;
    try
    {
        for (const BodyPrim& prim : prims)
        {
            UsdBrepArrayData a;
            a.m_sPrimPath = pxr::SdfPath(prim.path);
            std::vector<double> color;
            for (const auto& [name, v] : prim.props)
            {
                auto it = by_name.find(name);
                if (it != by_name.end())
                    read_field(*it->second, *v, a);
                else if (name == "extent" && v->k == Val::LIST && v->items.size() >= 2)
                {
                    auto lo = tuple<3>(v->items[0], name), hi = tuple<3>(v->items[1], name);
                    a.m_sBrepArray_BBox = pxr::GfRange3f(pxr::GfVec3f(lo[0], lo[1], lo[2]), pxr::GfVec3f(hi[0], hi[1], hi[2]));
                }
                else if (name == "primvars:displayColor" && v->k == Val::LIST && !v->items.empty() && v->items[0].items.size() == 3)
                {
                    auto c = tuple<3>(v->items[0], name);
                    color.assign(c.begin(), c.end());
                }
            }
            Layout layout;
            std::string problem = check(a, layout);
            if (problem.empty())
                problem = check_values(a, layout);
            if (!problem.empty())
                throw std::invalid_argument("usd: the BrepArray \"" + prim.path + "\" is malformed: " + problem);
            const Matrix place = mul(stage, options.placement ? prim.world : identity());
            bool moved = false;
            for (int k = 0; k < 16; ++k)
                moved = moved || std::fabs(place[k] - identity()[k]) > 1e-15;
            std::vector<double> rows(16);  // (transform_brep takes a matrix for row vectors)
            for (int r = 0; r < 4; ++r)
                for (int c = 0; c < 4; ++c)
                    rows[r * 4 + c] = place[c * 4 + r];
            const uint32_t count = a.TotalBrepCount();
            UsdBrepArraySpans spans;
            for (uint32_t i = 0; i < count; ++i)
            {
                pxr::usd_diagnostics().clear();
                if (!spans.SetStartsAndCountsForBrepIndex(a, i, FALSE, TRUE))
                    throw std::invalid_argument("usd: the BrepArray \"" + prim.path + "\" is malformed (body " +
                                                std::to_string(i) + ")" +
                                                (pxr::usd_diagnostics().empty() ? "" : ": " + pxr::usd_diagnostics()));
                SmBrep* brep = nullptr;
                SmPyErrorTrail::clear();
                SmStatus st = SMU_BrepConvert::BrepMove_OneUsdBrepToSMLib(ctx(), a, spans, i, brep, options.heal ? TRUE : FALSE);
                if (st != SM_SUCCESS || !brep)
                {
                    delete brep;
                    throw std::runtime_error("usd: body " + std::to_string(i) + " of the BrepArray \"" + prim.path +
                                             "\" could not be built (" + sm_status_name(st) + ")" +
                                             (pxr::usd_diagnostics().empty() ? "" : ": " + pxr::usd_diagnostics()));
                }
                UsdItem item;
                item.brep = brep;
                const std::string name = leaves[prim.leaf] > 1 ? prim.path : prim.leaf;
                item.name = count == 1 || i == 0 ? name : name + "_" + std::to_string(i);
                item.color = color;
                out.items.push_back(std::move(item));
                // the kernel's check, before anything measures the body (smlibpy's own files are not
                // checked: what it writes, its kernel has built)
                if (options.check && prim.source != "smlibpy")
                {
                    bool refuse = false;
                    const std::string found = kernel_check(brep, refuse);
                    const std::string body = "body " + std::to_string(i) + " of the BrepArray \"" + prim.path + "\"";
                    if (refuse)
                        throw std::invalid_argument("usd: " + body + " is broken: " + found +
                                                    "; such a body measures and meshes wrong (turn the check off to read it "
                                                    "as it is)");
                    if (!found.empty())
                        out.warnings.push_back(body + ": " + found + "; it may not mesh or measure exactly");
                }
                if (moved)
                    transform_brep(brep, rows);
            }
        }
    }
    catch (...)
    {
        for (UsdItem& item : out.items)
            delete item.brep;
        throw;
    }
    return out;
}

std::vector<UsdItem> usd_read(const std::string& text, bool heal)
{
    UsdReadOptions options;
    options.heal = heal;
    options.placement = false;
    options.units = 1.0;
    return usd_stage({UsdLayer{"", text, {}, {}}}, options).items;
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
        return smlibpy::without_gil([&] { return smlibpy::usd_text(in, up_axis, meters_per_unit); });
    }, py::arg("items"), py::arg("up_axis") = "Z", py::arg("meters_per_unit") = 0.001,
       "The .usda text of a stage: items are (brep or None, name, (r, g, b) or None, points or None, triangles "
       "or None[, corner normals or None]); a BrepArray prim per body, a Mesh prim per mesh.");
    m.def("usd_read", [](const std::string& text, bool heal) {
        std::vector<smlibpy::UsdItem> items = smlibpy::without_gil([&] { return smlibpy::usd_read(text, heal); });
        py::list out;
        for (auto& item : items)
            out.append(py::make_tuple(py::cast(item.brep, py::return_value_policy::take_ownership), item.name,
                                      item.color.empty() ? py::object(py::none()) : py::cast(item.color)));
        return out;
    }, py::arg("text"), py::arg("heal") = false,
       "The bodies of the BrepArray prims of a .usda text: [(brep, name, (r, g, b) or None)].");
    m.def("usd_assets", &smlibpy::usd_assets, py::arg("text"),
          "The assets a .usda text names (subLayers, references, payloads), each once, as written.");
    m.def("usd_stage", [](const py::list& layers, bool heal, bool check, bool placement, double units) {
        std::vector<smlibpy::UsdLayer> in;
        for (const auto& o : layers)
        {
            auto t = o.cast<py::tuple>();
            smlibpy::UsdLayer l;
            l.id = t[0].cast<std::string>();
            l.text = t[1].cast<std::string>();
            l.links = t[2].cast<std::map<std::string, std::string>>();
            l.missing = t[3].cast<std::map<std::string, std::string>>();
            in.push_back(std::move(l));
        }
        smlibpy::UsdReadOptions options;
        options.heal = heal, options.check = check, options.placement = placement, options.units = units;
        smlibpy::UsdStage stage = smlibpy::without_gil([&] { return smlibpy::usd_stage(in, options); });
        py::list bodies;
        for (auto& item : stage.items)
            bodies.append(py::make_tuple(py::cast(item.brep, py::return_value_policy::take_ownership), item.name,
                                         item.color.empty() ? py::object(py::none()) : py::cast(item.color)));
        py::dict out;
        out["bodies"] = bodies;
        out["warnings"] = py::cast(stage.warnings);
        out["unresolved"] = py::cast(stage.unresolved);
        return out;
    }, py::arg("layers"), py::arg("heal") = false, py::arg("check") = true, py::arg("placement") = true,
       py::arg("units") = 0.0,
       "The bodies of a stage: layers are (id, text, {asset: id of the layer read for it}, {asset: why none was "
       "read}), the root first. {'bodies': [(brep, name, (r, g, b) or None)], 'warnings': [...], 'unresolved': "
       "[...]}; the bodies placed (placement: the prims' transforms and the up axis) and in millimeters (units: "
       "millimeters per unit, 0: the stage's metersPerUnit).");
}
#endif  // SMLIBPY_PYTHON
