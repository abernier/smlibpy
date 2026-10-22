// SPDX-License-Identifier: Apache-2.0
//
// Where the faces and edges of a body came from (`smlibpy._core.ext`, kernel plan T3):
//
//   tag_topology(brep, fresh)          a tag of its own on every face and edge that has none
//   topology_tags(brep)                the tags of each face and edge
//   set_topology_tags(brep, f, e)      tags put back by order (a body read back from a file)
//   add_face_tags(brep, faces, tags)   more tags on some faces
//   untag_topology(brep)               the tags taken off
//
// The kernel propagates attributes through its operations (SmAttribute.h, section 5): the edit
// functions notify each face and edge they copy, split or merge, and the attributes on them decide
// what goes onto the copies, the halves and the merged result. A copy (SmBrep::Copy, the copies
// that transforms and Booleans work on) keeps every tag; both halves of a split face or edge keep
// their parent's; faces and edges a fillet, chamfer, shell or Boolean makes anew carry none (on a
// plate with a boss: exactly the two circles along which they meet). The kernel's default Merge
// keeps the survivor's attribute only; the tags here take the union, so that a face merged from
// two (a box's top face with a boss's top face in one plane) descends from both, and so does a
// face of a Boolean that the kernel finds coincident with a face of the other body.
//
// smlibpy tags every body it wraps (shapes.py, shapes.ts) and reads the tags to select the faces and
// edges that are new since an earlier body or that descend from given ones, and to map a selection
// taken before an operation onto the result. The kernel's .smb writer (SmBrep::WriteToFile) writes
// no attributes, so the tags never reach a file.

#include "kernel.h"
#include "history.h"

#include <SmApiGeneral.h>

#include <algorithm>
#include <atomic>
#include <stdexcept>

// (the attribute and type ids: SM_AI_USER_1 + 1 to + 3 and SmFirstUserAttribute_TYPE + 1, + 2 are
// usd/SmuAttribute.h's)
#define SM_AI_SMLIBPY_TAGS (SM_AI_USER_1 + 50)
#define SmTagsAttribute_TYPE (SmFirstUserAttribute_TYPE + 50)

namespace
{

// (Empty arrays made when the module loads. An SmTArray is an SmObject: one made between the
// allocation of an object with `new (context)` and the SmObject constructor of that object takes
// the kernel's one "been through new" flag, and the object's context is then left unset, which
// AssertValid reports for every attribute. So no array is made in a constructor's arguments, and
// the context is set again in the constructor.)
const SmTArray<double> no_doubles;
const SmTArray<char> no_chars;

// The tags of a face or an edge: a set of numbers, ascending. Copies and halves get a copy (the
// default SM_AB_COPY behaviour); a merged or coincident object gets the union.
class SmTagsAttribute : public SmGenericAttribute
{
public:
    SmTagsAttribute(const SmContext* context, const SmTArray<long>& tags)
        : SmGenericAttribute(SM_AI_SMLIBPY_TAGS, SM_AB_COPY, tags, no_doubles, no_chars)
    {
        SetContext(context);
        m_vUsers.SetContext(context);
    }

    // A new attribute in an object's context.
    static SmTagsAttribute* make(const SmAObject* owner, const SmTArray<long>& tags)
    {
        const SmContext* context = owner->GetContext() ? owner->GetContext() : SmApiGetOrCreateContext();
        return new (context) SmTagsAttribute(context, tags);
    }

    SmAttribute* MakeCopy(const SmContext& context) const override
    {
        return new (context) SmTagsAttribute(&context, m_vLongElements);
    }

    // (The kernel calls Merge only for the survivor's attribute where both objects carry one, with
    // the survivor as the merged object: the other's tags come from the object it deletes.)
    void Merge(SmAObject* first, SmAObject* second, SmAObject* merged) override
    {
        unite(merged);
        for (SmAObject* other : {first, second})
            if (other && other != merged)
                if (SmAttribute* a = other->FindAttribute(SM_AI_SMLIBPY_TAGS))
                    if (a != this && a->IsKindOf(SmTagsAttribute_TYPE))
                        static_cast<SmTagsAttribute*>(a)->unite(merged);
    }

    void Coincident(SmAObject*, SmAObject* to, SmAObject*, SmAObject*) override { unite(to); }

    // Adds a tag (keeps the set ascending, each tag once).
    void add(long tag)
    {
        ULONG i = 0;
        const ULONG n = m_vLongElements.GetSize();
        while (i < n && m_vLongElements[i] < tag)
            ++i;
        if (i < n && m_vLongElements[i] == tag)
            return;
        m_vLongElements.InsertAt(i, tag);
    }

    SM_COMMON(SmTagsAttribute, SmGenericAttribute, SmTagsAttribute_TYPE);

    // The tags onto another object: a copy where it carries none, else added to its own.
    void unite(SmAObject* target)
    {
        if (!target)
            return;
        SmAttribute* there = target->FindAttribute(SM_AI_SMLIBPY_TAGS);
        if (!there)
        {
            target->AddAttribute(make(target, m_vLongElements));
            return;
        }
        if (there == this)
            return;
        if (there->IsKindOf(SmTagsAttribute_TYPE))
        {
            SmTagsAttribute* tags = static_cast<SmTagsAttribute*>(there);
            for (ULONG i = 0; i < m_vLongElements.GetSize(); ++i)
                tags->add(m_vLongElements[i]);
        }
    }
};

void SmTagsAttribute::Dump() const {}

SmBoolean SmTagsAttribute::IsKindOf(SM_TYPE t) const
{
    return t == SmTagsAttribute_TYPE ? TRUE : SmGenericAttribute::IsKindOf(t);
}

std::atomic<long> next_tag{1};

SmTagsAttribute* tags_of(const SmAObject* object)
{
    SmAttribute* a = object->FindAttribute(SM_AI_SMLIBPY_TAGS);
    return a && a->IsKindOf(SmTagsAttribute_TYPE) ? static_cast<SmTagsAttribute*>(a) : nullptr;
}

void remove_tags(SmAObject* object)
{
    if (SmAttribute* a = object->FindAttribute(SM_AI_SMLIBPY_TAGS))
        object->RemoveAttribute(a);
}

// A new tag on an object that has none (or, with `fresh`, in place of the ones it has).
bool tag(SmAObject* object, bool fresh)
{
    if (fresh)
        remove_tags(object);
    else if (object->FindAttribute(SM_AI_SMLIBPY_TAGS))
        return false;
    SmTArray<long> one;
    one.Add(next_tag++);
    object->AddAttribute(SmTagsAttribute::make(object, one));
    return true;
}

std::vector<long> tags_list(const SmAObject* object)
{
    std::vector<long> out;
    if (const SmTagsAttribute* t = tags_of(object))
    {
        const long* data = t->GetLongElementsAddress();
        out.assign(data, data + t->GetNumLongElements());
    }
    return out;
}

}  // namespace

namespace smlibpy {

long tag_topology(SmBrep* brep, bool fresh)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    SmTArray<SmFace*> faces;
    SmTArray<SmEdge*> edges;
    brep->GetFaces(faces);
    brep->GetEdges(edges);
    long count = 0;
    for (ULONG i = 0; i < faces.GetSize(); ++i)
        count += tag(faces[i], fresh) ? 1 : 0;
    for (ULONG i = 0; i < edges.GetSize(); ++i)
        count += tag(edges[i], fresh) ? 1 : 0;
    return count;
}

TopologyTags topology_tags(const SmBrep* brep)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    SmTArray<SmFace*> faces;
    SmTArray<SmEdge*> edges;
    brep->GetFaces(faces);
    brep->GetEdges(edges);
    TopologyTags out;
    out.faces.reserve(faces.GetSize());
    out.edges.reserve(edges.GetSize());
    for (ULONG i = 0; i < faces.GetSize(); ++i)
        out.faces.push_back(tags_list(faces[i]));
    for (ULONG i = 0; i < edges.GetSize(); ++i)
        out.edges.push_back(tags_list(edges[i]));
    return out;
}

bool set_topology_tags(SmBrep* brep, const std::vector<std::vector<long>>& face_tags,
                       const std::vector<std::vector<long>>& edge_tags)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    SmTArray<SmFace*> faces;
    SmTArray<SmEdge*> edges;
    brep->GetFaces(faces);
    brep->GetEdges(edges);
    if (faces.GetSize() != face_tags.size() || edges.GetSize() != edge_tags.size())
        return false;
    auto put = [](SmAObject* object, const std::vector<long>& tags) {
        remove_tags(object);
        if (tags.empty())
            return;
        SmTArray<long> sorted;
        SmTagsAttribute* t = SmTagsAttribute::make(object, sorted);
        for (long tag : tags)
            t->add(tag);
        object->AddAttribute(t);
    };
    for (ULONG i = 0; i < faces.GetSize(); ++i)
        put(faces[i], face_tags[i]);
    for (ULONG i = 0; i < edges.GetSize(); ++i)
        put(edges[i], edge_tags[i]);
    return true;
}

void add_face_tags(SmBrep* brep, const std::vector<SmFace*>& faces, const std::vector<long>& tags)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    SmTArray<SmFace*> own;
    brep->GetFaces(own);
    for (SmFace* face : faces)
    {
        ULONG index = 0;
        if (!face || !own.FindElement(face, index))
            throw std::invalid_argument("add_face_tags: a face of another body");
        SmTagsAttribute* t = tags_of(face);
        if (!t)
        {
            remove_tags(face);  // (one of another type under the id: read from a file)
            SmTArray<long> none;
            t = SmTagsAttribute::make(face, none);
            face->AddAttribute(t);
        }
        for (long tag : tags)
            t->add(tag);
    }
}

void untag_topology(SmBrep* brep)
{
    if (!brep)
        throw std::invalid_argument("brep is None");
    SmTArray<SmFace*> faces;
    SmTArray<SmEdge*> edges;
    brep->GetFaces(faces);
    brep->GetEdges(edges);
    for (ULONG i = 0; i < faces.GetSize(); ++i)
        remove_tags(faces[i]);
    for (ULONG i = 0; i < edges.GetSize(); ++i)
        remove_tags(edges[i]);
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"

void bind_history(py::module_ m)
{
    m.def("tag_topology", &smlibpy::tag_topology, py::arg("brep"), py::arg("fresh") = false,
          "Give every face and edge of a Brep that carries no tag a tag of its own (with `fresh`: a new one in "
          "place of those it had); the kernel carries them through its operations. Returns how many it tagged.");
    m.def("topology_tags", [](const SmBrep* brep) {
        const smlibpy::TopologyTags t = smlibpy::topology_tags(brep);
        return py::make_tuple(py::cast(t.faces), py::cast(t.edges));
    }, py::arg("brep"), "(face tags, edge tags): the tags of each face and edge of a Brep, in its order.");
    m.def("set_topology_tags", &smlibpy::set_topology_tags, py::arg("brep"), py::arg("faces"), py::arg("edges"),
          "Put tags (topology_tags of the same body, read back from a file) on each face and edge in order; False "
          "where the counts differ.");
    m.def("add_face_tags", &smlibpy::add_face_tags, py::arg("brep"), py::arg("faces"), py::arg("tags"),
          "Add tags to the given faces of a Brep.");
    m.def("untag_topology", &smlibpy::untag_topology, py::arg("brep"), "Take the tags off every face and edge.");
}
#endif  // SMLIBPY_PYTHON
