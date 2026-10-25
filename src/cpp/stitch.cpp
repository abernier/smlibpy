// SPDX-License-Identifier: Apache-2.0
//
// Sewing faces into sheets and solids, and turning faces over (`smlibpy._core.ext`):
//
//   stitch_faces(brep, tolerance)   sews the faces of a Brep in place; returns a report
//   flip_faces(brep)                a copy with every face turned over
//
// The kernel's SmStitch::StitchIntoSolid (behind SmApiStitchIntoSolid, which smlibpy's stitch used)
// takes no tolerance: it starts at a tenth of the body's tolerance and doubles up to 1/200 of the
// body's diagonal, so a gap of 0.067 in a 200 mm box was closed with stitch(tolerance=1e-4), and a
// body sewn shut by the looser SmApiStitchIntoShell came back without a solid region. SmApiStitch-
// Advanced takes the tolerance as given and reports the free edges left and the gaps it closed; the
// loop here runs it from the body's own tolerance up to the caller's, so that edges that meet closely
// are sewn before looser candidates are looked at. Open results keep the normal of each piece's first
// face (SmStitch::UnifyNormals, along sewn edges only: no ray samples across free edges).
#include "kernel.h"
#include "stitch.h"

#include <SmApiBrep.h>
#include <SmApiGeneral.h>

#include <algorithm>
#include <cmath>
#include <deque>
#include <stdexcept>
#include <unordered_set>
#include <vector>

namespace
{

const SmContext& ctx() { return *SmApiGetOrCreateContext(); }

void check(long status, const char* what)
{
    if (status != SM_SUCCESS)
        SmPyRaise(static_cast<SmStatus>(status), what, __FILE__, __LINE__);
}

// The faces of the Brep in its own order, grouped into pieces connected through sewn edges (edges
// that two faces use); each piece starts with its first face in that order.
std::vector<std::vector<SmFace*>> pieces_of(const SmBrep* brep)
{
    SmTArray<SmFace*> faces;
    brep->GetFaces(faces);
    std::unordered_set<SmFace*> seen;
    std::vector<std::vector<SmFace*>> out;
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        if (seen.count(faces[i]))
            continue;
        std::vector<SmFace*> piece;
        std::deque<SmFace*> todo{faces[i]};
        seen.insert(faces[i]);
        while (!todo.empty())
        {
            SmFace* f = todo.front();
            todo.pop_front();
            piece.push_back(f);
            SmTArray<SmEdge*> edges;
            f->GetEdges(edges);
            for (ULONG j = 0; j < edges.GetSize(); ++j)
            {
                SmTArray<SmFace*> across;
                edges[j]->GetFaces(across);
                if (across.GetSize() != 2)
                    continue;
                for (ULONG n = 0; n < across.GetSize(); ++n)
                    if (!seen.count(across[n]))
                    {
                        seen.insert(across[n]);
                        todo.push_back(across[n]);
                    }
            }
        }
        out.push_back(std::move(piece));
    }
    return out;
}

}  // namespace

namespace smlibpy {

Value stitch_faces(SmBrep* brep, double tolerance)
{
    if (!brep)
        throw std::invalid_argument("stitch_faces: no body");
    if (!(tolerance > 0.0) || !std::isfinite(tolerance))
        throw std::invalid_argument("stitch_faces: the tolerance must be a positive number");
    double t = std::max(1e-7, double(brep->GetTolerance()));
    ULONG sewn = 0, open = 0;
    double vertex_gap = 0.0, edge_gap = 0.0, last = 0.0;
    for (;;)
    {
        const double step = std::min(t, tolerance);
        ULONG s = 0, lamina = 0;
        double vg = 0.0, eg = 0.0;
        // squeeze edges shorter than the step, split edges at vertices within it, glue only free
        // edges in pairs (no non-manifold sewing), keep sliver faces (SmApiStitchAdvanced's defaults)
        check(SmApiStitchAdvanced(brep, step, TRUE, TRUE, TRUE, FALSE, s, lamina, vg, eg), "SmApiStitchAdvanced");
        sewn += s;
        open = lamina;
        if (s > 0)
            vertex_gap = std::max(vertex_gap, vg), edge_gap = std::max(edge_gap, eg);
        last = step;
        if (lamina == 0 || step >= tolerance)
            break;
        t *= 2.0;
    }
    long turned = 0;
    if (open > 0)
        for (const std::vector<SmFace*>& piece : pieces_of(brep))
        {
            if (piece.size() < 2)
                continue;
            SmTArray<SmFace*> flipped;
            // no ray samples: follow sewn edges only (across free edges it would pair faces by distance)
            check(SmApiUnifyNormals(brep, piece.front(), 0, flipped), "SmApiUnifyNormals");
            turned += static_cast<long>(flipped.GetSize());
        }
    return Value::dict({{"sewn", Value::integer(sewn)},
                        {"open", Value::integer(open)},
                        {"vertex_gap", Value::of(vertex_gap)},
                        {"edge_gap", Value::of(edge_gap)},
                        {"tolerance", Value::of(last)},
                        {"turned", Value::integer(turned)}});
}

SmBrep* flip_faces(const SmBrep* brep)
{
    if (!brep)
        throw std::invalid_argument("flip_faces: no body");
    SmBrep* copy = new (ctx()) SmBrep(*brep, nullptr, nullptr, TRUE, FALSE);
    SmTArray<SmFace*> faces;
    copy->GetFaces(faces);
    for (ULONG i = 0; i < faces.GetSize(); ++i)
    {
        const SmStatus st = faces[i]->SwapUV();
        if (st != SM_SUCCESS)
        {
            delete copy;
            check(st, "SmFace::SwapUV");
        }
    }
    return copy;
}

}  // namespace smlibpy

#ifdef SMLIBPY_PYTHON
#include "ext.h"
#include "py_value.h"

void bind_stitch(py::module_ m)
{
    m.def("stitch_faces", [](SmBrep* brep, double tolerance) { return smlibpy::to_python(smlibpy::stitch_faces(brep, tolerance)); },
          py::arg("brep"), py::arg("tolerance"),
          "Sew the faces of a Brep in place along edges within `tolerance` (from the Brep's own tolerance up, "
          "doubling); open results keep each connected piece's first face's normal. A dict: sewn, open, "
          "vertex_gap, edge_gap, tolerance, turned.");
    m.def("flip_faces", &smlibpy::flip_faces, py::arg("brep"), py::return_value_policy::take_ownership,
          "A copy of a Brep with every face turned over (SmFace::SwapUV).");
}
#endif  // SMLIBPY_PYTHON
