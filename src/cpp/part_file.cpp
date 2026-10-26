// SPDX-License-Identifier: Apache-2.0
//
// SMLib part files (`smlibpy._core.ext`):
//
//   part_bytes(items, ascii)   the contents of a part file (.smp) of bodies and curves
//   part_items(data)           the bodies and curves of a part file's contents
//
// A part file is SMLib's own container (SmBrepData::WritePartToDB and ReadPartFromDB): curves,
// surfaces, Boolean trees and bodies with the attributes of all of them, as ASCII or binary. An .smb
// file (SmBrep::WriteToFile) holds one body without attributes; a part file holds any number of
// bodies and curves, each with its color in the kernel's own color attribute (SM_AI_COLOR, an
// SmVector3dAttribute, which SMLib's tools read) and an attribute of smlibpy's that holds its name
// (its characters), its place among the items and the wire a curve is an edge of (two numbers). Both
// go on copies of the bodies and curves, and come off what is read, so that no body carries them
// into the operations that follow. A body folded as sheet metal also carries its bends (the axis,
// inside radius and K-factor of each) in a third attribute, so that it unfolds as it was folded. Boolean trees are neither written nor read (the binary writer
// writes each of their values twice), and the format holds no assembly placements (the kernel's
// assembly reader and writer are empty).

#include "history.h"
#include "kernel.h"
#include "part_file.h"

#include <SmApiGeneral.h>
#include <SmDatabaseIO.h>

#include <algorithm>
#include <cstring>
#include <locale>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

// smlibpy's attribute of a body or curve in a part file: two numbers (its place among the items, and
// 1 + the number of a curve's wire, 0 for none) and the characters of its name (UTF-8). An id from the
// range SMLib leaves to applications. (No negative numbers: the binary format writes a long as 8
// bytes, the wasm32 build's longs have 4, and a 64-bit build's -1 reads there as a number too large.)
constexpr ULONG kItemAttribute = SM_AI_USER_3 + 1415;
// smlibpy's attribute of a sheet metal body's bends: 8 numbers each (doubles only).
constexpr ULONG kFoldAttribute = SM_AI_USER_3 + 1416;

SmAttribute* attribute(ULONG id, const std::vector<long>& longs, const std::vector<double>& doubles,
                       const std::string& chars)
{
    SmTArray<long> l;
    SmTArray<double> d;
    SmTArray<char> c;
    for (long x : longs)
        l.Add(x);
    for (double x : doubles)
        d.Add(x);
    for (char x : chars)
        c.Add(x);
    return SmAttribute::CreateAttribute(ctx(), id, SM_AB_COPY, l, d, c);
}

// the item's attributes on a copy of its body or curve, in place of any it has under those ids
void tag(SmAObject* o, const smlibpy::PartItem& item, long place)
{
    for (ULONG id : {static_cast<ULONG>(SM_AI_COLOR), kItemAttribute, kFoldAttribute})
        if (SmAttribute* a = o->FindAttribute(id))
            o->RemoveAttribute(a);
    if (item.color.size() == 3)
        o->AddAttribute(attribute(SM_AI_COLOR, {}, item.color, ""));
    o->AddAttribute(attribute(kItemAttribute, {place, item.wire < 0 ? 0 : item.wire + 1}, {}, item.name));
    if (!item.folds.empty())
    {
        if (item.folds.size() % 8 != 0)
            throw std::invalid_argument("part file: a body's bends take 8 numbers each");
        o->AddAttribute(attribute(kFoldAttribute, {}, item.folds, ""));
    }
}

// what an object read from a part file carries (the attributes are taken off it)
struct Tags
{
    std::vector<double> color;
    std::string name;
    long place = -1;  // -1: not written by smlibpy
    long wire = -1;
    std::vector<double> folds;
};

Tags untag(SmAObject* o)
{
    Tags t;
    if (SmAttribute* a = o->FindAttribute(SM_AI_COLOR))
    {
        if (a->GetNumDoubleElements() == 3 && a->GetDoubleElementsAddress())
        {
            const double* d = a->GetDoubleElementsAddress();
            t.color.assign(d, d + 3);
        }
        o->RemoveAttribute(a);
    }
    if (SmAttribute* a = o->FindAttribute(kItemAttribute))
    {
        if (a->GetNumLongElements() == 2 && a->GetLongElementsAddress())
        {
            const long* l = a->GetLongElementsAddress();
            t.place = l[0], t.wire = l[1] - 1;
        }
        if (a->GetNumCharacterElements() > 0 && a->GetCharacterElementsAddress())
            t.name.assign(a->GetCharacterElementsAddress(), a->GetNumCharacterElements());
        o->RemoveAttribute(a);
    }
    if (SmAttribute* a = o->FindAttribute(kFoldAttribute))
    {
        const ULONG n = a->GetNumDoubleElements();
        if (n > 0 && n % 8 == 0 && a->GetDoubleElementsAddress())
        {
            const double* d = a->GetDoubleElementsAddress();
            t.folds.assign(d, d + n);
        }
        o->RemoveAttribute(a);
    }
    return t;
}

// what the kernel read and nobody owns yet
struct Owned
{
    SmTArray<SmCurve*> curves;
    SmTArray<SmSurface*> surfaces;
    SmTArray<SmBrep*> breps;
    ~Owned()
    {
        for (ULONG i = 0; i < curves.GetSize(); ++i)
            if (curves[i] && curves[i]->GetOwner() == nullptr)
                delete curves[i];
        for (ULONG i = 0; i < surfaces.GetSize(); ++i)
            if (surfaces[i] && surfaces[i]->GetOwner() == nullptr)
                delete surfaces[i];
        for (ULONG i = 0; i < breps.GetSize(); ++i)
            delete breps[i];
    }
};

}  // namespace

namespace smlibpy {

std::string part_bytes(const std::vector<PartItem>& items, bool ascii)
{
    Owned copies;  // (deleted when written)
    long place = 0;
    for (const PartItem& item : items)
    {
        if (item.brep)
        {
            SmBrep* copy = new (ctx()) SmBrep(*item.brep, nullptr, nullptr, TRUE, FALSE);
            copies.breps.Add(copy);
            untag_topology(copy);  // (where its faces and edges came from belongs to this session, not the file)
            tag(copy, item, place);
        }
        else if (item.curve)
        {
            SmCurve* copy = nullptr;
            const SmStatus st = item.curve->Copy(ctx(), copy);
            if (st != SM_SUCCESS || !copy)
                SmPyRaise(st, "SmCurve::Copy", __FILE__, __LINE__);
            copies.curves.Add(copy);
            tag(copy, item, place);
        }
        else
            throw std::invalid_argument("part file: an item that is neither a body nor a curve");
        ++place;
    }
    if (place == 0)
        throw std::invalid_argument("part file: nothing to write");
    std::ostringstream out(ascii ? std::ios::out : std::ios::out | std::ios::binary);
    out.imbue(std::locale::classic());
    if (ascii)  // (as SmDatabaseIOFile writes files)
    {
        out.setf(std::ios::fixed);
        out.precision(16);
    }
    SmDatabaseIOStream db(ascii ? SM_ASCII : SM_BINARY, &out);
    SmTArray<long> trees;
    SmPyErrorTrail::clear();
    const SmStatus st = SmBrepData::WritePartToDB(copies.curves, copies.surfaces, trees, copies.breps, db, FALSE, 0.0);
    if (st != SM_SUCCESS)
        SmPyRaise(st, "SmBrepData::WritePartToDB", __FILE__, __LINE__);
    return out.str();
}

std::vector<PartItem> part_items(const std::string& data)
{
    static const char kAscii[] = "//[Output Summary]";
    const bool ascii = data.compare(0, sizeof(kAscii) - 1, kAscii) == 0;
    if (!ascii)
    {
        // a binary part file starts with the number of its curves plus a million times the version of
        // the format (little endian, 8 bytes), then those of its surfaces, Boolean tree nodes and bodies
        long long first = 0;
        if (data.size() >= 32)
            for (int k = 7; k >= 0; --k)
                first = (first << 8) | static_cast<unsigned char>(data[k]);
        if (first < 1000000 || first >= 1000000000)
            throw std::invalid_argument("part file: this is no SMLib part file (.smp): it starts neither with \"//[Output "
                                        "Summary]\" nor with the counts of a binary one");
    }
    std::istringstream in(data, ascii ? std::ios::in : std::ios::in | std::ios::binary);
    in.imbue(std::locale::classic());
    SmDatabaseIOStream db(ascii ? SM_ASCII : SM_BINARY, &in);
    Owned read;
    SmTArray<long> trees;
    SmPyErrorTrail::clear();
    const SmStatus st = SmBrepData::ReadPartFromDB(ctx(), read.curves, read.surfaces, trees, read.breps, db);
    if (st != SM_SUCCESS)
        SmPyRaise(st, "SmBrepData::ReadPartFromDB", __FILE__, __LINE__);

    struct Found
    {
        PartItem item;
        long place;
        size_t order;
    };
    std::vector<Found> found;
    auto take = [&](PartItem item, const Tags& t) {
        item.name = t.name, item.color = t.color, item.wire = t.wire, item.folds = t.folds;
        found.push_back(Found{std::move(item), t.place, found.size()});
    };
    try
    {
        for (ULONG i = 0; i < read.curves.GetSize(); ++i)
            if (SmCurve* c = read.curves[i])
            {
                const Tags t = untag(c);
                read.curves[i] = nullptr;
                PartItem item;
                item.curve = c;
                take(std::move(item), t);
            }
        for (ULONG i = 0; i < read.surfaces.GetSize(); ++i)
            if (SmSurface* s = read.surfaces[i])
            {
                const Tags t = untag(s);
                SmBrep* sheet = new (ctx()) SmBrep();
                SmFace* face = nullptr;
                const SmStatus made = sheet->CreateFaceFromSurface(s, s->GetNaturalUVDomain(), face);
                if (made != SM_SUCCESS)
                {
                    delete sheet;
                    SmPyRaise(made, "SmBrep::CreateFaceFromSurface", __FILE__, __LINE__);
                }
                read.surfaces[i] = nullptr;  // (the face's now)
                PartItem item;
                item.brep = sheet;
                take(std::move(item), t);
            }
        for (ULONG i = 0; i < read.breps.GetSize(); ++i)
            if (SmBrep* b = read.breps[i])
            {
                const Tags t = untag(b);
                read.breps[i] = nullptr;
                PartItem item;
                item.brep = b;
                take(std::move(item), t);
            }
    }
    catch (...)
    {
        for (Found& f : found)
        {
            delete f.item.brep;
            delete f.item.curve;
        }
        throw;
    }
    // smlibpy's items in the order they were written, then the others as the file has them
    std::stable_sort(found.begin(), found.end(), [](const Found& a, const Found& b) {
        const bool ao = a.place >= 0, bo = b.place >= 0;
        if (ao != bo)
            return ao;
        return ao ? a.place < b.place : a.order < b.order;
    });
    std::vector<PartItem> out;
    for (Found& f : found)
        out.push_back(std::move(f.item));
    return out;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_part_files(py::module_ m)
{
    m.def("part_bytes", [](const py::list& items, bool ascii) {
        std::vector<smlibpy::PartItem> in;
        for (const auto& o : items)
        {
            auto t = o.cast<py::tuple>();
            smlibpy::PartItem item;
            item.brep = t[0].is_none() ? nullptr : t[0].cast<SmBrep*>();
            item.curve = t[1].is_none() ? nullptr : t[1].cast<SmCurve*>();
            item.name = t[2].is_none() ? std::string() : t[2].cast<std::string>();
            if (!t[3].is_none())
                item.color = t[3].cast<std::vector<double>>();
            item.wire = t[4].cast<long>();
            if (t.size() > 5 && !t[5].is_none())
                item.folds = t[5].cast<std::vector<double>>();
            in.push_back(std::move(item));
        }
        return py::bytes(smlibpy::part_bytes(in, ascii));
    }, py::arg("items"), py::arg("ascii") = true,
       "The contents of an SMLib part file (.smp): items are (brep or None, curve or None, name or None, (r, g, b) "
       "or None, wire[, folds]), each a body or a curve (wire: the number of the wire a curve is an edge of, -1 for "
       "none; folds: a body's sheet metal bends, 8 numbers each: axis origin, direction, inside radius, K-factor); "
       "ASCII or binary.");
    m.def("part_items", [](const py::bytes& data) {
        std::vector<smlibpy::PartItem> items = smlibpy::part_items(std::string(data));
        py::list out;
        for (auto& item : items)
        {
            // (a name that is not UTF-8, from another program, with its bytes replaced)
            py::object name = py::reinterpret_steal<py::object>(
                PyUnicode_DecodeUTF8(item.name.data(), static_cast<Py_ssize_t>(item.name.size()), "replace"));
            out.append(py::make_tuple(
                item.brep ? py::cast(item.brep, py::return_value_policy::take_ownership) : py::object(py::none()),
                item.curve ? py::cast(item.curve, py::return_value_policy::take_ownership) : py::object(py::none()), name,
                item.color.empty() ? py::object(py::none()) : py::cast(item.color), item.wire,
                item.folds.empty() ? py::object(py::none()) : py::cast(item.folds)));
        }
        return out;
    }, py::arg("data"),
       "The items of an SMLib part file's contents (ASCII or binary): [(brep or None, curve or None, name, (r, g, b) or "
       "None, wire, folds or None)], bodies (loose surfaces as sheets of one face) and curves, in the order smlibpy "
       "wrote them.");
}
#endif  // SMLIBPY_PYTHON
