// SPDX-License-Identifier: Apache-2.0
//
// Colors and names of single faces (`smlibpy._core.ext`, kernel plan T5):
//
//   set_face_colors(brep, faces, colors)   colors on faces (an empty one: none)
//   set_face_names(brep, faces, names)     names on faces (an empty one: none)
//   face_attr(face)                        (color or None, name or None) of one face
//   face_attrs(brep)                       ([colors], [names]) of every face, in the Brep's order
//
// A face's color is the kernel's own color attribute (SM_AI_COLOR with SmColorAttribute,
// SmAttribute.h's example of a face color); its name an SmGenericAttribute of characters. The kernel
// carries both along through its operations as it does every attribute (SmAttribute.h, section 5):
// a copy keeps them, both halves of a split face keep them, a face merged from two keeps the one the
// merged face had, or the other's where it had none (so does a face of a Boolean found coincident
// with one of the other body); faces an operation makes anew (a fillet's round, the rim around a
// shell's opening) have none, the offsets of a face (a shell's inner walls) keep its. So a color
// given to the faces of a hole tool stays on the walls of the hole it cuts.
//
// The kernel's .smb writer (SmBrep::WriteToFile) writes no attributes: smlibpy writes face colors and
// names to STEP files (a STYLED_ITEM per ADVANCED_FACE, the face's name), colors to glTF, USD meshes
// and pictures, and carries both across its forked kernel steps itself.

#include "kernel.h"
#include "face_attrs.h"

#include <SmApiGeneral.h>

#include <stdexcept>
#include <unordered_set>

// (the attribute and type ids: SM_AI_USER_1 + 1 to + 3 and SmFirstUserAttribute_TYPE + 1, + 2 are
// usd/SmuAttribute.h's, + 50 history.cpp's)
#define SM_AI_SMLIBPY_NAME (SM_AI_USER_1 + 51)
#define SmFaceNameAttribute_TYPE (SmFirstUserAttribute_TYPE + 51)

namespace
{

// (Empty arrays made when the module loads: an SmTArray made between the allocation of an object
// with `new (context)` and its SmObject constructor takes the kernel's "been through new" flag, as
// history.cpp explains; no array is made in a constructor's arguments.)
const SmTArray<long> no_longs;
const SmTArray<double> no_doubles;

const SmContext* context_of(const SmAObject* owner)
{
    return owner->GetContext() ? owner->GetContext() : SmApiGetOrCreateContext();
}

// A face's name: its characters (no terminating zero). Copies and halves get a copy; a merged face
// keeps one name (the kernel's default Merge).
class SmFaceNameAttribute : public SmGenericAttribute
{
public:
    SmFaceNameAttribute(const SmContext* context, const SmTArray<char>& chars)
        : SmGenericAttribute(SM_AI_SMLIBPY_NAME, SM_AB_COPY, no_longs, no_doubles, chars)
    {
        SetContext(context);
        m_vUsers.SetContext(context);
    }

    static SmFaceNameAttribute* make(const SmAObject* owner, const std::string& name)
    {
        SmTArray<char> chars;
        for (char c : name)
            chars.Add(c);
        const SmContext* context = context_of(owner);
        return new (context) SmFaceNameAttribute(context, chars);
    }

    SmAttribute* MakeCopy(const SmContext& context) const override
    {
        return new (context) SmFaceNameAttribute(&context, m_vCharacterElements);
    }

    std::string text() const
    {
        const ULONG n = m_vCharacterElements.GetSize();
        return n ? std::string(m_vCharacterElements.GetDataArray(), n) : std::string();
    }

    SM_COMMON(SmFaceNameAttribute, SmGenericAttribute, SmFaceNameAttribute_TYPE);
};

void SmFaceNameAttribute::Dump() const {}

SmBoolean SmFaceNameAttribute::IsKindOf(SM_TYPE t) const
{
    return t == SmFaceNameAttribute_TYPE ? TRUE : SmGenericAttribute::IsKindOf(t);
}

void remove_attribute(SmAObject* object, ULONG id)
{
    while (SmAttribute* a = object->FindAttribute(id))
        object->RemoveAttribute(a);
}

// Refuses a face of another body, and a count of values that fits neither.
void check_faces(const SmBrep* brep, const std::vector<SmFace*>& faces, size_t values, const char* what)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    if (values != faces.size() && values != 1)
        throw std::invalid_argument(std::string(what) + ": give one value for every face, or one for all");
    SmTArray<SmFace*> own;
    brep->GetFaces(own);
    std::unordered_set<const SmFace*> mine;
    for (ULONG i = 0; i < own.GetSize(); ++i)
        mine.insert(own[i]);
    for (const SmFace* f : faces)
        if (!f || !mine.count(f))
            throw std::invalid_argument(std::string(what) + ": a face of another body");
}

smlibpy::Value color_of(const SmFace* face)
{
    const SmAttribute* a = face->FindAttribute(SM_AI_COLOR);
    // (the kernel's part-file reader makes an SmVector3dAttribute of a color: any attribute of three
    // numbers will do)
    if (!a || a->GetNumDoubleElements() != 3 || !a->GetDoubleElementsAddress())
        return smlibpy::Value();
    const double* c = a->GetDoubleElementsAddress();
    return smlibpy::Value::tuple({smlibpy::Value::of(c[0]), smlibpy::Value::of(c[1]), smlibpy::Value::of(c[2])});
}

smlibpy::Value name_of(const SmFace* face)
{
    const SmAttribute* a = face->FindAttribute(SM_AI_SMLIBPY_NAME);
    if (!a || !a->IsKindOf(SmFaceNameAttribute_TYPE))
        return smlibpy::Value();
    return smlibpy::Value::of(static_cast<const SmFaceNameAttribute*>(a)->text());
}

}  // namespace

namespace smlibpy {

void set_face_colors(SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<std::vector<double>>& colors)
{
    check_faces(brep, faces, colors.size(), "set_face_colors");
    for (const auto& c : colors)
    {
        if (!c.empty() && c.size() != 3)
            throw std::invalid_argument("set_face_colors: a color is (r, g, b)");
        for (double x : c)
            if (!(x >= 0.0 && x <= 1.0))
                throw std::invalid_argument("set_face_colors: r, g and b lie between 0 and 1");
    }
    for (size_t i = 0; i < faces.size(); ++i)
    {
        SmFace* f = faces[i];
        const std::vector<double>& c = colors[colors.size() == 1 ? 0 : i];
        remove_attribute(f, SM_AI_COLOR);
        if (c.empty())
            continue;
        const SmContext* context = context_of(f);
        f->AddAttribute(new (context) SmColorAttribute(SM_AI_COLOR, SmVector3d(c[0], c[1], c[2]), SM_AB_COPY));
    }
}

void set_face_names(SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<std::string>& names)
{
    check_faces(brep, faces, names.size(), "set_face_names");
    for (size_t i = 0; i < faces.size(); ++i)
    {
        SmFace* f = faces[i];
        const std::string& name = names[names.size() == 1 ? 0 : i];
        remove_attribute(f, SM_AI_SMLIBPY_NAME);
        if (!name.empty())
            f->AddAttribute(SmFaceNameAttribute::make(f, name));
    }
}

Value face_attr(const SmFace* face)
{
    if (!face)
        throw std::invalid_argument("face is None");
    return Value::tuple({color_of(face), name_of(face)});
}

Value face_attrs(const SmBrep* brep)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    Value colors = Value::make_list(), names = Value::make_list();
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        colors.push(color_of(faces[i]));
        names.push(name_of(faces[i]));
    }
    return Value::tuple({colors, names});
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"
#include "py_value.h"

void bind_face_attrs(py::module_ m)
{
    m.def("set_face_colors", &smlibpy::set_face_colors, py::arg("brep"), py::arg("faces"), py::arg("colors"),
          "Give faces of a Brep a color each ((r, g, b) from 0 to 1, one per face or one for all; an empty one takes "
          "the color off): the kernel's SM_AI_COLOR attribute, carried along through copies, splits, merges and "
          "Booleans.");
    m.def("set_face_names", &smlibpy::set_face_names, py::arg("brep"), py::arg("faces"), py::arg("names"),
          "Give faces of a Brep a name each (one per face or one for all; an empty one takes the name off), carried "
          "along as the colors are.");
    m.def("face_attr", [](const SmFace* face) { return smlibpy::to_python(smlibpy::face_attr(face)); },
          py::arg("face"), "(color or None, name or None) of a face.");
    m.def("face_attrs", [](const SmBrep* brep) { return smlibpy::to_python(smlibpy::face_attrs(brep)); },
          py::arg("brep"), "([color or None, ...], [name or None, ...]) of every face of a Brep, in its order.");
}
#endif  // SMLIBPY_PYTHON
