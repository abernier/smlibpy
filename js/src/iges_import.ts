// IGES import: neutral B-rep data from iges_reader.ts -> kernel bodies.
//
// Solids (manifold solid B-rep objects, 186) are built as STEP bodies are: each face on its exact
// surface, each edge on its exact curve, the faces sharing the edges the file gives them. Trimmed
// and bounded surfaces (144, 143) share nothing: each is built as a face of its own, and the faces
// are stitched together where their edges meet; what closes up becomes a part, the rest sheets.

import { KernelError, ModelingError, _opts, _warn, ext, k, kernelCall } from './kernel.ts'
import { _identity } from './geometry.ts'
import type { BytesLike } from './_bytes.ts'
import { type Face, Part, Shell, _list, type ShapeList } from './shapes.ts'
import { type IgesModel, interpret, parse } from './iges_reader.ts'
import { _buildBody, _kernelVolume, _label, _reading, _text } from './step_import.ts'
import { BodyData, type FaceData, _bodyError, _failure } from './step_reader.ts'
import { _fs } from './exporters.ts'

// biome-ignore lint: kernel results and specs are plain objects
type Any = any

/** How an IGES file is read: `heal` (default true) repairs solids that come out invalid, as
 * `fromStep` does; `strict` (default false) throws a ModelingError for the first thing that cannot
 * be read instead of leaving it out with a warning. */
export interface IgesImportOptions {
  heal?: boolean
  strict?: boolean
}

/** Face `i` of the model's trimmed and bounded surfaces as a sheet of its own. */
function _oneFace(model: IgesModel, i: number): BodyData {
  const src = model.faces
  const f = src.faces[i]
  const b = new BodyData('sheet', f.name ?? '')
  b.uncertainty = src.uncertainty
  const emap = new Map<number, number>()
  const vmap = new Map<number, number>()
  const vertex = (v: number): number => {
    if (!vmap.has(v)) {
      vmap.set(v, b.vertices.length)
      b.vertices.push(src.vertices[v])
    }
    return vmap.get(v) as number
  }
  const loops = f.loops.map((loop) => {
    const items: [number, boolean][] = []
    for (const [ei, fwd] of loop.edges ?? []) {
      if (!emap.has(ei)) {
        const e = src.edges[ei]
        b.curves.push(src.curves[e.curve])
        emap.set(ei, b.edges.length)
        b.edges.push({ ...e, curve: b.curves.length - 1, v0: vertex(e.v0), v1: vertex(e.v1) })
      }
      items.push([emap.get(ei) as number, fwd])
    }
    return { ...loop, edges: items }
  })
  b.surfaces.push(src.surfaces[f.surface])
  b.faces.push({ ...f, surface: 0, loops })
  b.shells.push({ faces: [0], reversed: false, closed: false })
  return b
}

/** A face of a trimmed or bounded surface, built; null for a sliver that has no area. IGES does not
 * hold writers to an orientation of a face's boundary: where its outer loop runs clockwise in the
 * parameters of its surface the face is built facing the other way, and a hole whose loop runs the
 * way the outer loop does is turned round. */
function _face(body: BodyData): Shell | null {
  const sheet = _buildBody(body, _identity(), false) as Shell
  const info = kernelCall('import IGES', () => ext.loop_areas(sheet._brep)[0])
  const areas: (number | null)[] = info.loops
  if (!areas.length || areas.some((a) => a === null)) return sheet // (a loop that does not close in the parameters has no orientation to read)
  const span = Math.max(...info.domain)
  const sum = (areas as number[]).reduce((a, b) => a + b, 0)
  if (Math.abs(sum) <= 1e-9 * span * span) {
    // (narrower than 1e-9 of its length)
    sheet.dispose()
    return null
  }
  let outer = 0
  areas.forEach((a, i) => {
    if (Math.abs(a as number) > Math.abs(areas[outer] as number)) outer = i
  })
  const out = areas[outer] as number
  const flip = out < 0
  const turn = areas.map((a, i) => (i !== outer && (a as number) > 0 === out > 0 ? i : -1)).filter((i) => i >= 0)
  if (!flip && !turn.length) return sheet
  sheet.dispose()
  const f = body.faces[0]
  const loops = f.loops.map((loop, i) => (turn.includes(i) ? { ...loop, edges: [...(loop.edges ?? [])].reverse().map(([e, fwd]) => [e, !fwd] as [number, boolean]) } : loop))
  body.faces[0] = { ...f, same_sense: f.same_sense !== flip, loops } as FaceData
  return _buildBody(body, _identity(), false) as Shell
}

/** Whether a face lies on a line (its loose box, within 1e-9 of the model's size, in two directions
 * at least): a sliver that has no area. */
function _noArea(face: Face, size: number): boolean {
  const [lo, hi] = k.face_bounding_box(face._f, false)
  return [0, 1, 2].map((i) => Math.abs(hi[i] - lo[i])).sort((a, b) => a - b)[1] <= 1e-9 * size
}

/** Faces that share no edges stitched where their edges meet, and taken apart into the pieces that
 * hang together: a `Part` for each piece that closes up into a solid, a `Shell` for each other one.
 * The kernel's stitch first (it makes the solids), then a looser one for what stays open, closing
 * gaps of up to 1e-4 of the model's size (or the file's resolution). */
function _stitched(sheets: Shell[], uncertainty: number | null): (Part | Shell)[] {
  const whole = kernelCall('import IGES', () => Shell._wrap(ext.combine(sheets.map((s) => s._brep))))
  try {
    const size = whole._looseBox().diagonal
    try {
      kernelCall('import IGES: stitch', () => {
        const [, solid] = k.stitch_into_solid(whole._brep)
        if (!solid) k.stitch_into_shell(whole._brep, Math.max(uncertainty || 0, 1e-4 * size, 1e-9))
      })
    } catch (e) {
      if (!(e instanceof KernelError)) throw e // (the faces as they are)
    }
    const pieces: number[] = kernelCall('import IGES', () => (whole.faces().length > 1 ? [...ext.separate_bodies(whole._brep)] : [whole._copyBrep()]))
    const out: (Part | Shell)[] = []
    for (const b of pieces) {
      const part = Part._wrap(b)
      const faces = part.faces()
      if (faces.length === 1 && _noArea(faces[0], size)) {
        // (the stitch can squeeze a sliver face to that)
        part.dispose()
        continue
      }
      if (part._shapeProblem() !== null) {
        // (a piece the loose stitch closed has no solid region yet)
        try {
          kernelCall('import IGES: stitch', () => k.stitch_into_solid(part._brep))
        } catch (e) {
          if (!(e instanceof KernelError)) throw e
        }
      }
      if (part._shapeProblem() === null) {
        const volume = _kernelVolume(part) // (its sign: the precise volume is measured when asked for)
        if (volume !== null && volume > 0) {
          out.push(part)
          continue
        }
      }
      out.push(Shell._wrap(part._copyBrep()))
      part.dispose()
    }
    return out
  } finally {
    whole.dispose()
  }
}

/** The bodies of an IGES file, and what was left out (a message each). `strict` throws a
 * ModelingError for the first thing that cannot be read instead. */
function _bodies(text: string, heal: boolean, strict: boolean): [(Part | Shell)[], string[]] {
  const skipped: Any[] = []
  const model = interpret(parse(text), { skipped })
  if (strict && skipped.length) throw new ModelingError(`import IGES: ${skipped[0].message}`)
  const notes: string[] = skipped.map((s) => s.message)
  const out: (Part | Shell)[] = []
  const leaveOut = (what: string, e: unknown): void => {
    if (!_bodyError(e)) throw e
    if (strict) throw new ModelingError(`import IGES: ${what}: ${_failure(e)}`)
    notes.push(`${what}: ${_failure(e)}`)
  }
  const sheets: Shell[] = []
  const looks: [number[] | null, string][] = [] // (color, name) of each face
  _reading('IGES', () => {
    for (const body of model.solids) {
      try {
        out.push(_buildBody(body, _identity(), heal))
      } catch (e) {
        leaveOut(_label(body), e)
      }
    }
    model.faceLabels.forEach((label, i) => {
      try {
        const sheet = _face(_oneFace(model, i))
        if (sheet === null) return // (a sliver of no area: some writers leave them where faces meet)
        sheets.push(sheet)
        looks.push([model.faceColors[i], model.faceNames[i]])
      } catch (e) {
        leaveOut(label, e)
      }
    })
    for (const [spec, rng, color, name, label] of model.untrimmed) {
      try {
        sheets.push(kernelCall('import IGES', () => Shell._wrap(ext.surface_face(spec, [...rng]))))
        looks.push([color, name])
      } catch (e) {
        leaveOut(label, e)
      }
    }
  })
  if (sheets.length) {
    const boxes = sheets.map((s) => s._looseBox())
    for (const body of _stitched(sheets, model.faces.uncertainty)) {
      // a body takes the color its faces have (most of them), and the name they all have
      const box = body._looseBox()
      const mine = looks.filter((_, i) => box.contains(boxes[i].center))
      const counts = new Map<string, [number[], number]>()
      for (const [c] of mine) {
        if (c === null) continue
        const key = c.join(',')
        counts.set(key, [c, (counts.get(key)?.[1] ?? 0) + 1])
      }
      let best: [number[], number] | null = null
      for (const entry of counts.values()) if (best === null || entry[1] > best[1]) best = entry // (the first of the most common)
      if (best !== null) body.color = best[0] as [number, number, number]
      const names = new Set(mine.map(([, n]) => n))
      if (names.size === 1) {
        const [name] = names
        if (name) body.name = name
      }
      out.push(body)
    }
    for (const s of sheets) s.dispose()
  }
  for (const note of notes) _warn(`import IGES: left out ${note}`)
  return [out, notes]
}

/**
 * Read the solids and surfaces of IGES file contents (IGES 5.3, ASCII): the text, or the bytes of
 * the file.
 *
 * Returns a single `Part` (or `Shell`) when the file holds one body, otherwise a `ShapeList` of
 * them, in millimeters whatever unit the file uses, named and colored as the file has them.
 *
 * Solids (manifold solid B-rep objects, entity 186) come in as STEP bodies do: each face on its
 * exact surface, each edge on its exact curve, the faces sharing their edges. Trimmed and bounded
 * surfaces (144, 143), the way most CAD systems write IGES, share nothing: each becomes a face, the
 * faces are stitched where their edges meet, and each set of faces that closes up becomes a part,
 * the others sheets. `heal` repairs solids that come out invalid, as `fromStep` does.
 *
 * Something that cannot be read (an entity smlibwasm does not read, one the kernel cannot build) is
 * left out with a warning that names it and the reason; `strict: true` throws a `ModelingError`
 * instead. A file none of whose bodies can be read throws.
 */
export function fromIges(data: string | BytesLike, options: IgesImportOptions = {}): Part | Shell | ShapeList<Part | Shell> {
  _opts('fromIges', options)
  const { heal = true, strict = false } = options
  const [found, skipped] = _bodies(_text(data, 'fromIges'), heal, strict)
  if (!found.length) {
    if (skipped.length)
      throw new ModelingError(`import IGES: nothing in the file could be read: ${skipped.slice(0, 3).join('; ')}${skipped.length > 3 ? '; ...' : ''}`)
    throw new ModelingError('the IGES file holds no solids or surfaces')
  }
  for (const body of found) body._h.imported = true // (read from a file: its fillets run in the probe worker)
  const out = _list(found)
  return out.length === 1 ? out[0] : out
}

/** Read the solids and surfaces of an IGES file (.igs, .iges; IGES 5.3, ASCII); see `fromIges`. */
export function importIges(path: string, options: IgesImportOptions = {}): Part | Shell | ShapeList<Part | Shell> {
  _opts('importIges', options)
  return fromIges(_fs().readFileSync(String(path)), options)
}
