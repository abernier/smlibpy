// Direct editing: faces of a part moved or offset, and the faces around them extended or trimmed to
// meet them (push-pull, moving or resizing a hole or a boss, a thicker wall).
//
// Each edited face gets a new surface: its own moved by a rigid motion, or offset along its outward
// normal (planes move, cylinders, cones, spheres and tori change their radius, other surfaces become
// offset surfaces of themselves). The kernel's SmBrep::LocalOperation then rebuilds the part from
// them and the faces around them (src/cpp/face_edit.cpp), as it does for drafts. It takes faces that
// meet an edited face tangentially only when they are edited alike, and it can close the part with
// faces that do not meet: the result is checked.

import { ModelingError, _crashOf, _isCrash, _isRuntimeError, k, kernelCall } from './kernel.ts'
import { Location, Vector, type VectorLike, _formatG, _isPointLike, _vec } from './geometry.ts'
import { Face, type Part, _flattenFaces } from './shapes.ts'

// biome-ignore lint: the kernel's results are what their bindings return
type Any = any

const _FE = k.face_edit

/** Angle (degrees) between the normals of two faces along an edge below which the faces meet
 * tangentially. A face that meets an edited face so is edited with it (`offsetFaces`) or must be
 * selected too (`moveFaces`). */
export const TANGENCY = 1.0

/** Python's round(v, 9) + 0.0 (no -3e-15, no -0). */
function _round9(v: number): number {
  return Math.round(v * 1e9) / 1e9 + 0.0
}

function _where(face: Face): string {
  const c = face.center()
  const [x, y, z] = [c.x, c.y, c.z].map(_round9)
  const g4 = (v: number) => _formatG(v, 4)
  return `${face.geomType} face at (${g4(x)}, ${g4(y)}, ${g4(z)})`
}

function _selected(part: Part, faces: unknown, what: string): Face[] {
  part._requireValid(what)
  if (!_flattenFaces(faces).length) throw new RangeError(`${what}: no faces selected`)
  const sel: Face[] = []
  for (const kf of part._ownFaces(faces)) {
    if (sel.every((f) => kf !== f._f)) sel.push(new Face(part, kf))
  }
  return sel
}

/** A 4x4 matrix (column vectors, row by row) as the 16 numbers the kernel takes (row vectors). */
function _rows(m: ArrayLike<number>): number[] {
  const out: number[] = []
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out.push(m[r * 4 + c])
  return out
}

function _moveMatrix(by: unknown): number[] {
  if (by instanceof Location) {
    const m = by._m
    const r = (i: number, j: number) => m[i * 4 + j]
    const det =
      r(0, 0) * (r(1, 1) * r(2, 2) - r(1, 2) * r(2, 1)) - r(0, 1) * (r(1, 0) * r(2, 2) - r(1, 2) * r(2, 0)) + r(0, 2) * (r(1, 0) * r(2, 1) - r(1, 1) * r(2, 0))
    let rigid = det > 0
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        const dot = r(a, 0) * r(b, 0) + r(a, 1) * r(b, 1) + r(a, 2) * r(b, 2)
        rigid = rigid && Math.abs(dot - (a === b ? 1 : 0)) <= 1e-9
      }
    }
    if (!rigid || !Array.from(m).every(Number.isFinite)) {
      throw new RangeError('moveFaces: the location must be a rotation and a translation (no scale, no mirror)')
    }
    return _rows(m)
  }
  if (!_isPointLike(by)) throw new TypeError(`moveFaces: by must be a Location or a vector, not ${by === null ? 'null' : typeof by}`)
  const v = _vec(by)
  if (![v.x, v.y, v.z].every(Number.isFinite)) throw new RangeError('moveFaces: the vector must be finite')
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v.x, v.y, v.z, 1]
}

function _distance(value: unknown, what: string, name = 'distance'): number {
  if (typeof value !== 'number') throw new TypeError(`${what}: the ${name} must be a number`)
  if (!Number.isFinite(value)) throw new RangeError(`${what}: the ${name} must be finite (got ${value})`)
  return value
}

/** The message for a face the kernel was not asked to edit, or for a kernel failure. `fix` replaces
 * the advice for faces that meet tangentially. */
function _refusal(what: string, verb: string, res: Any, part: Part, faces: readonly Face[], fix: string | null): string {
  const code: string = res.error
  const i: number = res.face
  const every = [...faces, ...(res.added as number[]).map((f) => new Face(part, f))]
  const f = (i >= 0 && i < every.length ? every[i] : null) as Face
  if (code === 'void') {
    return `${what}: the part has a cavity (a closed void inside it), and the kernel's face edit drops cavities; edit the part without it and cut the cavity out afterwards`
  }
  if (code === 'tangent') {
    const g = new Face(part, res.other)
    return `${what}: the ${_where(g)} meets the ${verb} ${_where(f)} tangentially, so it must be ${verb} with it (the kernel keeps tangent faces together); ${fix ?? 'add it to the faces'}`
  }
  if (code === 'conflict') {
    const g = new Face(part, res.other)
    return `${what}: the ${_where(g)} meets the ${_where(f)} tangentially, but they are ${verb} differently; ${fix ?? `faces that meet tangentially (a round and the faces it joins) must be ${verb} alike`}`
  }
  if (code === 'alone') {
    return `${what}: the ${_where(f)} meets no other face (a void or a body of one face); the kernel rebuilds the faces around an edited face, and there are none: fill it and cut the new one instead`
  }
  if (code === 'collapse') return `${what}: the ${_where(f)} would shrink to nothing (its radius reaches 0); use a smaller distance`
  if (code === 'offset') return `${what}: the kernel could not offset the ${_where(f)}`
  if (code === 'kernel') {
    return `${what}: the kernel could not rebuild the part around the ${verb} faces; the faces around them may not reach them (extend or trim), or the change is too large`
  }
  if (code === 'open') {
    return `${what}: the ${verb} faces do not close the part again: a face around them vanishes, or ${verb} faces run into each other; use a smaller change`
  }
  return `${what}: the ${_where(f)} could not be prepared (${code})`
}

/** The kernel's edit of `faces` and the checks of its result. `grows`: whether the volume must go up
 * (true), down (false), or either (null); `fix`: see `_refusal`. */
function _edit(
  part: Part,
  what: string,
  verb: string,
  faces: readonly Face[],
  matrices: readonly number[],
  distances: readonly number[],
  grow: boolean,
  grows: boolean | null,
  fix: string | null = null,
): Part {
  const res = kernelCall(what, () => _FE.edit_faces(part._brep, faces.map((f) => f._f), [...matrices], [...distances], grow, TANGENCY))
  if (res.error !== null) throw new ModelingError(_refusal(what, verb, res, part, faces, fix))
  const result = part._like(res.brep) as Part

  // The kernel may close the part with faces that do not meet: its vertices and edges then leave the
  // faces they bound (by whole millimetres, where a correct edit has 1e-6 or less).
  const gap = Math.max(...res.gaps)
  const limit = Math.max(10.0 * res.tolerance, 10.0 * Math.max(...res.gaps_before))
  if (!(gap <= limit)) {
    throw new ModelingError(
      `${what}: the kernel returned a part whose edges leave its faces (by up to ${_formatG(gap, 2)}); a face around the ${verb} ones may not reach them, or the change is too large`,
    )
  }
  if (result.faces().length !== part.faces().length) {
    throw new ModelingError(
      `${what}: the ${verb} faces change which faces of the part meet (a face vanishes, or ${verb} faces run into other faces); use a smaller change, or a Boolean`,
    )
  }
  const problem = result._solidProblem()
  if (problem !== null) throw new ModelingError(`${what}: the kernel returned a body that is ${problem}; use a smaller change`)
  if (grows !== null) {
    const before = part._quickVolume()
    const after = result._quickVolume()
    if ((grows ? before - after : after - before) > 1e-4 * Math.abs(before)) {
      throw new ModelingError(`${what}: the kernel returned a body whose volume went the wrong way (${_formatG(before)} -> ${_formatG(after)}); use a smaller change`)
    }
  }
  return result
}

/** See `Part.moveFaces`. */
export function moveFaces(part: Part, faces: unknown, by: Location | VectorLike): Part {
  const m = _moveMatrix(by)
  const sel = _selected(part, faces, 'moveFaces')
  if (m.every((v, i) => v === (i % 5 === 0 ? 1 : 0))) return part._like(part._copyBrep()) as Part
  return _edit(part, 'moveFaces', 'moved', sel, m, [], false, null)
}

/** See `Part.offsetFaces`. */
export function offsetFaces(part: Part, faces: unknown, distance: number): Part {
  const d = _distance(distance, 'offsetFaces')
  const sel = _selected(part, faces, 'offsetFaces')
  if (d === 0) return part._like(part._copyBrep()) as Part
  return _edit(part, 'offsetFaces', 'offset', sel, [], [d], true, d > 0)
}

/** The faces of `part` and their own wall thickness from `shell`'s `walls`: [faces, thickness] pairs,
 * or a Map of them. Faces given twice must have one thickness. */
export function _wallThicknesses(part: Part, walls: unknown, t: number, openings: readonly number[]): [Face, number][] {
  let pairs: unknown[]
  if (walls instanceof Map) pairs = [...walls.entries()]
  else if (walls != null && typeof (walls as Any)[Symbol.iterator] === 'function') pairs = [...(walls as Iterable<unknown>)]
  else throw new TypeError('shell: walls takes [faces, thickness] pairs, or a Map of faces to thicknesses')
  const out: [Face, number][] = []
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2) throw new TypeError('shell: walls takes [faces, thickness] pairs, or a Map of faces to thicknesses')
    const [faces, thickness] = pair
    const w = Math.abs(_distance(thickness, 'shell', 'thickness of a wall'))
    if (!(w > 0)) throw new RangeError("shell: a wall's thickness must not be zero")
    for (const kf of part._ownFaces(faces)) {
      const f = new Face(part, kf)
      if (openings.includes(kf)) throw new RangeError(`shell: the ${_where(f)} is an opening; it has no wall`)
      for (const [g, v] of out) {
        if (g._f === kf && v !== w) throw new RangeError(`shell: the ${_where(f)} is given two wall thicknesses (${_formatG(v)} and ${_formatG(w)})`)
      }
      if (out.every(([g]) => g._f !== kf)) out.push([f, w])
    }
  }
  return out
}

/** Points on a face with its outward normal there: the middle of its parameters and a 3 x 3 grid of
 * them where they lie inside it, then its interior point. */
function _pointsAndNormals(f: Face): [Vector, Vector][] {
  const out: [Vector, Vector][] = []
  try {
    const [[u0, v0], [u1, v1]] = k.face_uv_domain(f._f)
    const grid: [number, number][] = [[0.5, 0.5]]
    for (const a of [0.25, 0.5, 0.75]) for (const b of [0.25, 0.5, 0.75]) if (a !== 0.5 || b !== 0.5) grid.push([a, b])
    for (const [a, b] of grid) {
      const u = u0 + a * (u1 - u0)
      const v = v0 + b * (v1 - v0)
      if (k.face_classify_uv(f._f, u, v) === 'inside') {
        out.push([new Vector(k.face_point_at_uv(f._f, u, v)), new Vector(k.face_outward_normal_at_uv(f._f, u, v)).normalized()])
      }
    }
  } catch (e) {
    if (!(_isRuntimeError(e) || e instanceof RangeError) || _isCrash(e)) throw _crashOf(e) // a face the kernel cannot sample: its interior point only
  }
  const p = f.interiorPoint()
  out.push([p, f.normalAt(p)])
  return out
}

/** The face of `body` across a wall from the face `f` of the part: through the points of `f` moved by
 * `reach` along its outward normal `n`, with the outward normal `facing * n` there. */
function _across(body: Part, f: Face, reach: number, facing: number): Face {
  const tol = 1e-6 * Math.max(body._extent(), 1)
  let found: Face[] = []
  for (const [p, n] of _pointsAndNormals(f)) {
    const q = p.add(n.mul(reach))
    found = body.faces().filter((g) => g.distanceTo(q) <= tol && g.normalAt(q).dot(n) * facing > 1 - 1e-6)
    if (found.length === 1) return found[0]
  }
  throw new ModelingError(
    `shell: the wall of the ${_where(f)} has no face of its own across it in the shelled part (its faces there were merged or trimmed away); give it the common thickness`,
  )
}

/** `shelled` (`part` shelled with walls of `t`) with the wall of each face of `walls` made as thick as
 * given: the shell's face across the wall from it (the cavity's for walls grown inward, the outside's
 * for walls grown outward) offset by the difference. A `closed` shell has a cavity, which the kernel's
 * face edit drops: there the part offset by `t` the way the shell went (the cavity, or for walls grown
 * outward the outside) is edited, and the shell is the Boolean difference of the part and it. */
export function shellWalls(part: Part, shelled: Part, walls: readonly [Face, number][], t: number, outward: boolean, closed: boolean): Part {
  const corners = shelled.info().corners ?? 'round'
  const body = closed ? part.offset(outward ? t : -t, { corners }) : shelled
  // (the face across the wall faces the other way in a shell with walls grown inward; the cavity as a
  // body of its own faces the way the part does)
  const facing = outward || closed ? 1 : -1
  const sign = closed && !outward ? -1 : 1 // (a thicker wall shrinks the cavity as a body)
  const faces: Face[] = []
  const distances: number[] = []
  for (const [f, w] of walls) {
    if (w === t) continue
    const g = _across(body, f, outward ? t : -t, facing)
    if (faces.some((h) => h._f === g._f)) continue
    faces.push(g)
    distances.push(sign * (w - t))
  }
  if (!faces.length) return shelled
  const grows = distances.every((d) => d > 0) ? true : distances.every((d) => d < 0) ? false : null
  const fix =
    'walls that meet smoothly need one thickness: give the faces of the part that run into this wall tangentially (rounds) the same thickness, or use corners="sharp" where the shell rounds its corners'
  const edited = _edit(body, 'shell', 'offset', faces, [], distances, false, grows, fix)
  if (!closed) return edited
  const result = kernelCall('shell', () => (outward ? edited.cut(part) : part.cut(edited)), 'the cavity could not be cut out of the part')
  const whole = Number(part._props(1e-6).volume)
  const cut = Number(edited._props(1e-6).volume)
  const expect = Math.abs(cut - whole)
  const got = Number(result._props(1e-6).volume)
  if (!(Math.abs(got - expect) <= 1e-5 * Math.max(whole, cut))) {
    throw new ModelingError(
      `shell: the walls of their own thickness came out as a body of volume ${_formatG(got, 10)}, where the part and its offset differ by ${_formatG(expect, 10)}`,
    )
  }
  return result
}
