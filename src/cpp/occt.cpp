// SPDX-License-Identifier: Apache-2.0
//
// OpenCASCADE's .brep files (`smlibpy._core.ext`):
//
//   occt_read(data, heal, check)    the bodies of a .brep file's contents (ASCII or binary)
//   occt_text(breps)                the ASCII .brep text of bodies
//
// OpenCASCADE writes a shape to a .brep file as tables of its locations, curves, surfaces and
// topology (TShapes), ASCII through BRepTools or binary through BinTools. NVIDIA's usd-brep reads
// such files into the BrepArray arrays of a USD body and writes those arrays as ASCII .brep text,
// with code that needs no OpenCASCADE and, without its USD stages, no OpenUSD: that bridge is copied
// in src/cpp/occt (see its README.md). Here the arrays it stages are checked and built into SMLib
// bodies as usd.cpp builds those of a USD file, and SMLib bodies go out through the arrays usd.cpp
// writes.

#include "kernel.h"
#include "occt.h"
#include "usd.h"

#include "SmuConvert.h"
#include "UsdBrepArrayData.h"

#include "BrepStagingState.h"
#include "BrepStatus.h"
#include "BrepUsdWriter.h"
#include "OcctAsciiParser.h"
#include "OcctBinaryParser.h"
#include "OcctAsciiWriter.h"
#include "OcctExport.h"
#include "UsdBrepToOcctModel.h"
#include "OcctFileRecords.h"
#include "OcctFileSource.h"
#include "OcctStagingDriver.h"
#include "UsdBrepBuilder.h"

#include <SmApiGeneral.h>

#include <cstdlib>
#include <stdexcept>

namespace {

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

using occt::EShapeType;
using occt::SOcctModel;
using occt::SSubShapeRef;

std::string n_of(size_t n, const char* one, const char* many) { return std::to_string(n) + " " + (n == 1 ? one : many); }

// What is wrong with the references of a parsed file that the bridge follows without looking ("" when
// nothing is): OpenCASCADE writes the parts of a shape before the shape, and the parts of a location
// before the location, so a reference to itself or to one written after it is malformed (the bridge
// would follow it for ever); locations raised to a power are multiplied out one by one.
std::string unsound(const SOcctModel& m)
{
    const size_t shapes = m.sShapes.size(), locations = m.sLocations.size();
    auto location = [&](int i) { return i >= 0 && static_cast<size_t>(i) <= locations; };
    for (size_t i = 0; i < locations; ++i)
        for (const occt::SLocationTerm& t : m.sLocations[i].sTerms)
        {
            if (t.iLocationIndex < 1 || static_cast<size_t>(t.iLocationIndex) > i)
                return "location " + std::to_string(i + 1) + " is made of location " + std::to_string(t.iLocationIndex) +
                       ", which is not written before it";
            if (std::abs(t.iPower) > 1000)
                return "location " + std::to_string(i + 1) + " raises a location to the power " + std::to_string(t.iPower);
        }
    for (size_t i = 0; i < shapes; ++i)
        for (const SSubShapeRef& r : m.sShapes[i].sSubShapes)
        {
            if (r.iStorageIndex < 1 || static_cast<size_t>(r.iStorageIndex) > i)
                return "shape " + std::to_string(i + 1) + " is made of shape " + std::to_string(r.iStorageIndex) +
                       ", which is not written before it";
            if (!location(r.iLocation))
                return "shape " + std::to_string(i + 1) + " places a part at location " + std::to_string(r.iLocation) +
                       ", which the file does not have";
        }
    if (!m.bHasRoot)
        return "it holds no shape";
    if (m.sRoot.iStorageIndex < 1 || static_cast<size_t>(m.sRoot.iStorageIndex) > shapes || !location(m.sRoot.iLocation))
        return "its shape is not one of its TShapes";
    return "";
}

// What a shape holds as the bridge reads it: solids, shells and faces (each a body; the bridge leaves
// out the ones of a compound it cannot read), and what it does not read: wires and edges, points.
struct Census
{
    size_t bodies = 0, curves = 0, points = 0;
};

void census(const SOcctModel& m, const SSubShapeRef& r, Census& out)
{
    const occt::SShapeRecord& s = m.sShapes[static_cast<size_t>(r.iStorageIndex - 1)];
    switch (s.eType)
    {
    case EShapeType::Solid:
    case EShapeType::Shell:
    case EShapeType::Face: ++out.bodies; break;
    case EShapeType::Wire:
    case EShapeType::Edge: ++out.curves; break;
    case EShapeType::Vertex: ++out.points; break;
    case EShapeType::Compound:
    case EShapeType::CompSolid:
        for (const SSubShapeRef& c : s.sSubShapes)
            census(m, c, out);
        break;
    default: break;
    }
}

const char* type_name(EShapeType t)
{
    switch (t)
    {
    case EShapeType::Vertex: return "a vertex";
    case EShapeType::Edge: return "an edge";
    case EShapeType::Wire: return "a wire";
    case EShapeType::Face: return "a face";
    case EShapeType::Shell: return "a shell";
    case EShapeType::Solid: return "a solid";
    case EShapeType::CompSolid: return "a compsolid";
    case EShapeType::Compound: return "a compound";
    default: return "a shape of no known type";
    }
}

// a message of the bridge as text (a token of a broken file in it can be any bytes; at most 200 of them)
std::string printable(const std::string& s)
{
    std::string out;
    for (char c : s.substr(0, 200))
        out += c >= 0x20 && c < 0x7f ? c : '?';
    return s.size() > 200 ? out + "..." : out;
}

std::string diagnostics() { return pxr::usd_diagnostics().empty() ? "" : ": " + printable(pxr::usd_diagnostics()); }

void delete_all(std::vector<SmBrep*>& breps)
{
    for (SmBrep* b : breps)
        delete b;
    breps.clear();
}

// The staged arrays of a parsed file (a body per connected component of its shape).
void stage(const SOcctModel& model, UsdBrepData::UsdBrepBuilder& builder, Census& found, size_t& read)
{
    const std::string problem = unsound(model);
    if (!problem.empty())
        throw std::invalid_argument("brep: the file is malformed: " + problem);
    census(model, model.sRoot, found);
    const EShapeType root = model.sShapes[static_cast<size_t>(model.sRoot.iStorageIndex - 1)].eType;
    if (found.bodies == 0)
        throw std::invalid_argument(std::string("brep: the file holds no solid, shell or face (its shape is ") +
                                    type_name(root) + (found.curves ? ", of curves" : found.points ? ", of points" : "") +
                                    "), and only those are read");
    occt::OcctFileSource source(model);
    std::string error;
    if (!source.Build(error))
        throw std::invalid_argument("brep: the shape cannot be read: " + printable(error));
    read = source.Solids().size();
    BrepStagingState state;
    occt::OcctStagingDriver driver(source, state);
    pxr::usd_diagnostics().clear();
    if (!driver.Run(error))
        throw std::runtime_error("brep: the shape cannot be converted: " + printable(error) + diagnostics());
    const BrepStatus status = StagedBrepUsdWriter(state).BuildUsdBrepFromStagedData(builder);
    if (!IsBrepStatusSuccess(status))
        throw std::runtime_error("brep: the shape cannot be converted" + diagnostics());
}

void parse(const std::string& data, SOcctModel& model)
{
    std::string error;
    if (occt::IsBinaryOcct(data))
    {
        if (!occt::ReadOcctBinary(data, model, error))
            throw std::invalid_argument("brep: the binary .brep file cannot be read: " + printable(error));
        return;
    }
    if (data.find("CASCADE Topology V") == std::string::npos)
        throw std::invalid_argument("brep: this is not an OpenCASCADE .brep file (it has no \"CASCADE Topology\" "
                                    "banner)");
    if (!occt::ReadOcct(data, model, error))
        throw std::invalid_argument("brep: the .brep file cannot be read: " + printable(error));
}

}  // namespace

namespace smlibpy {

OcctRead occt_read(const std::string& data, const OcctReadOptions& options)
{
    SOcctModel model;
    parse(data, model);
    UsdBrepData::UsdBrepBuilder builder;
    Census found;
    size_t read = 0;
    stage(model, builder, found, read);
    UsdBrepData::UsdBrepArrayData& a = builder.Arrays();
    // (the bridge's arrays are checked as a USD file's are: the conversion trusts them)
    const std::string problem = usd_check_arrays(a);
    if (!problem.empty())
        throw std::runtime_error("brep: the shape converts to malformed arrays: " + problem);

    OcctRead out;
    if (read < found.bodies)
        out.skipped.push_back(n_of(found.bodies - read, "solid, shell or face", "solids, shells and faces") + " of the " +
                              std::to_string(found.bodies) + " in the file cannot be read");
    if (found.curves || found.points)
        out.warnings.push_back("the file also holds " +
                               (found.curves ? n_of(found.curves, "wire or edge", "wires and edges") + " outside faces" : "") +
                               (found.curves && found.points ? " and " : "") +
                               (found.points ? n_of(found.points, "point", "points") : "") + ", which are not read");
    try
    {
        UsdBrepData::UsdBrepArraySpans spans;
        for (uint32_t i = 0; i < a.TotalBrepCount(); ++i)
        {
            pxr::usd_diagnostics().clear();
            if (!spans.SetStartsAndCountsForBrepIndex(a, i, FALSE, TRUE))
                throw std::runtime_error("brep: the shape converts to malformed arrays" + diagnostics());
            SmBrep* brep = nullptr;
            SmPyErrorTrail::clear();
            SmStatus st = SMU_BrepConvert::BrepMove_OneUsdBrepToSMLib(ctx(), a, spans, i, brep, options.heal ? TRUE : FALSE);
            if (st != SM_SUCCESS || !brep)
            {
                delete brep;
                throw std::runtime_error(std::string("brep: the shape could not be built (") + sm_status_name(st) + ")" +
                                         diagnostics());
            }
            if (options.check)
            {
                bool refuse = false;
                const std::string noted = usd_kernel_check(brep, refuse);
                if (refuse)
                {
                    delete brep;
                    throw std::invalid_argument("brep: the shape is broken: " + noted +
                                                "; such a body measures and meshes wrong (turn the check off to read "
                                                "it as it is)");
                }
                if (!noted.empty())
                    out.warnings.push_back("the shape: " + noted + "; it may not mesh or measure exactly");
            }
            // a body per solid, shell or face of the file (the bridge stages them as one)
            SmTArray<SmBrep*> parts;
            SmBrep* whole = brep;
            st = SmBrep::CreateOneBrepPerBody(whole, parts, FALSE);
            if (st != SM_SUCCESS)
            {
                bool kept = false;
                for (ULONG k = 0; k < parts.GetSize(); ++k)
                {
                    kept = kept || parts[k] == whole;
                    delete parts[k];
                }
                if (whole && !kept)
                    delete whole;
                throw std::runtime_error(std::string("brep: the shape's bodies could not be separated (") +
                                         sm_status_name(st) + ")");
            }
            for (ULONG k = 0; k < parts.GetSize(); ++k)
                out.bodies.push_back(parts[k]);
        }
    }
    catch (...)
    {
        delete_all(out.bodies);
        throw;
    }
    if (out.bodies.empty())
        throw std::invalid_argument("brep: the file holds no body that can be read");
    return out;
}

std::string occt_text(const std::vector<SmBrep*>& breps)
{
    if (breps.empty())
        throw std::invalid_argument("brep: nothing to write");
    // (the conversion adds UV trim curves and attributes to the Breps: copies go in)
    std::vector<SmBrep*> copies;
    UsdBrepData::UsdBrepArrayData a;
    SmStatus st = SM_SUCCESS;
    try
    {
        for (SmBrep* b : breps)
            copies.push_back(new (ctx()) SmBrep(*b, nullptr, nullptr, TRUE, FALSE));
        pxr::usd_diagnostics().clear();
        SmPyErrorTrail::clear();
        st = SMU_BrepConvert::BrepAppend_SMLibToUsdBrep(copies, a, nullptr, true, true);
    }
    catch (...)
    {
        delete_all(copies);
        throw;
    }
    delete_all(copies);
    if (st != SM_SUCCESS)
        throw std::runtime_error(std::string("brep: the bodies could not be converted (") + sm_status_name(st) + ")" +
                                 diagnostics());
    // (pcurves on every curved face, as OpenCASCADE needs them: the conversion writes none for analytic faces)
    occt_trim_curves(a);
    SOcctModel shape;
    std::string error;
    if (!occt::BuildOcctModel(a, shape, error))
        throw std::runtime_error("brep: the bodies cannot be written: " + printable(error));
    // (what OpenCASCADE would take for invalid is not written)
    const std::string wrong = occt_check(shape);
    if (!wrong.empty())
        throw std::runtime_error("brep: the bodies cannot be written as OpenCASCADE reads them: " + wrong);
    std::string text = occt::WriteOcct(shape);
    // what is handed out reads back (as occt_read reads it, up to the arrays)
    try
    {
        SOcctModel model;
        parse(text, model);
        UsdBrepData::UsdBrepBuilder builder;
        Census found;
        size_t read = 0;
        stage(model, builder, found, read);
        const std::string problem = read < found.bodies ? "a body is left out" : usd_check_arrays(builder.Arrays());
        if (!problem.empty())
            throw std::runtime_error(problem);
    }
    catch (const std::exception& e)
    {
        throw std::runtime_error(std::string("brep: the text written would not read back (") + e.what() + ")");
    }
    return text;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_occt_files(py::module_ m)
{
    m.def("occt_read", [](const py::bytes& data, bool heal, bool check) {
        smlibpy::OcctReadOptions options;
        options.heal = heal, options.check = check;
        smlibpy::OcctRead got = smlibpy::occt_read(std::string(data), options);
        py::list bodies;
        for (SmBrep* b : got.bodies)
            bodies.append(py::cast(b, py::return_value_policy::take_ownership));
        py::dict out;
        out["bodies"] = bodies;
        out["warnings"] = py::cast(got.warnings);
        out["skipped"] = py::cast(got.skipped);
        return out;
    }, py::arg("data"), py::arg("heal") = false, py::arg("check") = true,
       "The bodies of an OpenCASCADE .brep file's contents (ASCII or binary bytes): {'bodies': [brep, ...] (one per "
       "solid, shell and face, in the file's order), 'warnings': [...], 'skipped': [what cannot be read, left out]}. "
       "heal: the kernel's import healer; check: "
       "refuse bodies with gaps above 1e-3 of their size.");
    m.def("occt_text", [](const std::vector<SmBrep*>& breps) { return smlibpy::occt_text(breps); }, py::arg("breps"),
          "The ASCII OpenCASCADE .brep text of bodies (a compound when there are several).");
}
#endif  // SMLIBPY_PYTHON
