// STEP (ISO 10303-21) reader: parse the file and interpret the B-rep data.
//
// The result is a neutral description of bodies (vertices, edges with curves, faces with surfaces,
// shells) in millimetres and world coordinates, which step_import.ts turns into kernel topology.
// The descriptions are plain objects whose keys are those of the C++ that builds the bodies
// (`same_sense`, `u_degree`, ...), as in Python.

import { _identity, _matmul, type Matrix } from './geometry.ts'
import { solve } from './_linalg.ts'
import { _isRuntimeError, ext, kernelCall } from './kernel.ts'
import { _canonicalCurve } from './shapes.ts'
import { bsplinePoint } from './iges_reader.ts'

// biome-ignore lint: curve and surface descriptions are plain objects of many shapes
type Any = any

/** A reference to another entity (`#123`). */
export class Ref {
  readonly id: number

  constructor(id: number) {
    this.id = id
  }

  /** (Python's Ref is an int: it converts to its number) */
  valueOf(): number {
    return this.id
  }

  toString(): string {
    return `#${this.id}`
  }
}

/** An enumeration value (`.T.`, `.UNSPECIFIED.`). */
export class Enum {
  readonly value: string

  constructor(value: string) {
    this.value = value
  }

  toString(): string {
    return this.value
  }
}

/** A typed parameter such as `LENGTH_MEASURE(1.E-07)`. */
export class Typed {
  readonly name: string
  readonly args: StepValue[]

  constructor(name: string, args: StepValue[]) {
    this.name = name
    this.args = args
  }

  toString(): string {
    return `${this.name}${_reprValue(this.args)}`
  }
}

/** A parameter of an entity: a number, a string, `$` (null), `*`, a reference, an enumeration, a
 * typed parameter or a list of parameters. */
export type StepValue = number | string | null | Ref | Enum | Typed | StepValue[]

/** A thrown error for STEP content this reader does not know (Python's NotImplementedError). */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotImplementedError'
  }
}

// -------------------------------------------------------------------------------- Python's rules
// Python's whitespace (str.split, re's \s): also the separators \x1c-\x1f and \x85, \xa0, ...
const WS = '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]'
const STRIP = new RegExp(`^${WS}+|${WS}+$`, 'g')

function _strip(s: string): string {
  return s.replace(STRIP, '')
}

/** A string or an enumeration (Python's Enum is a str). */
function _isStr(x: unknown): x is string | Enum {
  return typeof x === 'string' || x instanceof Enum
}

function _pyType(x: unknown): string {
  if (x === null || x === undefined) return 'NoneType'
  if (typeof x === 'number') return Number.isInteger(x) ? 'int' : 'float'
  if (typeof x === 'string') return 'str'
  if (Array.isArray(x)) return 'list'
  if (x instanceof Ref) return 'Ref'
  if (x instanceof Enum) return 'Enum'
  return (x as { constructor?: { name?: string } }).constructor?.name ?? typeof x
}

/** Python's repr of a string, for messages (also step_import.ts's). */
export function _repr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'"
  let out = q
  for (const ch of s) {
    const c = ch.codePointAt(0) as number
    if (ch === '\\' || ch === q) out += `\\${ch}`
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (c < 0x20 || (c >= 0x7f && c <= 0xa0) || c === 0xad) out += `\\x${c.toString(16).padStart(2, '0')}`
    else out += ch
  }
  return out + q
}

function _reprValue(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(_reprValue).join(', ')}]`
  if (v === null) return 'None'
  if (typeof v === 'string') return _repr(v)
  if (v instanceof Enum) return _repr(v.value)
  return String(v)
}

/** Python's int() of a parameter (a reference gives its number). */
function _int(x: unknown): number {
  if (x instanceof Ref) return x.id
  if (typeof x === 'number') {
    if (Number.isNaN(x)) throw new RangeError('cannot convert float NaN to integer')
    if (!Number.isFinite(x)) throw new RangeError('cannot convert float infinity to integer')
    return Math.trunc(x)
  }
  if (typeof x === 'boolean') return x ? 1 : 0
  if (_isStr(x)) {
    const s = _strip(String(x))
    if (/^[+-]?\d(?:_?\d)*$/.test(s)) return Number(s.replaceAll('_', ''))
    throw new RangeError(`invalid literal for int() with base 10: ${_repr(String(x))}`)
  }
  throw new TypeError(`int() argument must be a string, a bytes-like object or a real number, not '${_pyType(x)}'`)
}

const FLOAT = /^[+-]?(?:(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?|inf(?:inity)?|nan)$/i

/** Python's float() of a parameter. */
function _float(x: unknown): number {
  if (typeof x === 'number') return x
  if (x instanceof Ref) return x.id
  if (typeof x === 'boolean') return x ? 1 : 0
  if (_isStr(x)) {
    const s = _strip(String(x))
    if (FLOAT.test(s)) {
      const t = s.toLowerCase().replace(/^\+/, '')
      if (t.endsWith('inf') || t.endsWith('infinity')) return t.startsWith('-') ? -Infinity : Infinity
      if (t.endsWith('nan')) return Number.NaN
      return Number(s.replaceAll('_', ''))
    }
    throw new RangeError(`could not convert string to float: ${_repr(String(x))}`)
  }
  throw new TypeError(`float() argument must be a string or a real number, not '${_pyType(x)}'`)
}

/** Python's list[i] (an index past the end is an IndexError: a RangeError). */
function _at(list: unknown, i: number): StepValue {
  if (Array.isArray(list)) {
    if (i >= list.length) throw new RangeError('list index out of range')
    return list[i]
  }
  if (_isStr(list)) {
    const s = String(list)
    if (i >= s.length) throw new RangeError('string index out of range')
    return s[i]
  }
  throw new TypeError(`'${_pyType(list)}' object is not subscriptable`)
}

/** Python's iteration of a parameter: a list, or the characters of a string. */
function _iter(x: unknown): StepValue[] {
  if (Array.isArray(x)) return x
  if (_isStr(x)) return [...String(x)]
  throw new TypeError(`'${_pyType(x)}' object is not iterable`)
}

/** Python's truth of a parameter. */
function _truthy(x: unknown): boolean {
  if (Array.isArray(x)) return x.length > 0
  if (typeof x === 'string') return x.length > 0
  return x !== null && x !== undefined && x !== 0 && x !== false
}

function _norm(v: readonly number[]): number {
  let s = 0
  for (const x of v) s += x * x
  return Math.sqrt(s)
}

function _dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function _cross(a: readonly number[], b: readonly number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** numpy's linalg.inv of a placement (a singular one throws, as numpy's LinAlgError). */
function _inv(m: Matrix): Matrix {
  const rows = [0, 1, 2, 3].map((r) => [m[r * 4], m[r * 4 + 1], m[r * 4 + 2], m[r * 4 + 3]])
  const x = solve(rows, [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ])
  return Float64Array.from(x.flat())
}

// -------------------------------------------------------------------------------- parsing
const _TOKEN = new RegExp(
  `${WS}*(?:(?<ref>#\\d+)|(?<str>'(?:[^']|'')*')|(?<enum>\\.[A-Z_0-9]+\\.)` +
    `|(?<num>[+-]?(?:\\d+\\.?\\d*(?:[eE][+-]?\\d+)?|\\.\\d+(?:[eE][+-]?\\d+)?))|(?<kw>[A-Za-z_][A-Za-z_0-9]*)|(?<punct>[(),$*]))`,
  'y',
)

function _decodeString(s: string): string {
  s = s.slice(1, -1).replaceAll("''", "'")
  if (!s.includes('\\')) return s
  s = s.replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_m, hex: string) => {
    let out = ''
    for (let i = 0; i < hex.length; i += 4) out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16))
    return out
  })
  s = s.replace(/\\X4\\([0-9A-Fa-f]+)\\X0\\/g, (_m, hex: string) => {
    let out = ''
    for (let i = 0; i < hex.length; i += 8) out += String.fromCodePoint(Number.parseInt(hex.slice(i, i + 8), 16))
    return out
  })
  s = s.replace(/\\X\\([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
  return s.replaceAll('\\\\', '\\')
}

/** Parse a parenthesised parameter list starting at `text[pos] === '('`. */
function _parseArgs(text: string, pos: number): [StepValue[], number] {
  const out: StepValue[] = []
  const stack: StepValue[][] = [out]
  const pendingKw: (string | null)[] = [null]
  let i = pos + 1
  const n = text.length
  while (i < n) {
    _TOKEN.lastIndex = i
    const m = _TOKEN.exec(text)
    if (!m) throw new RangeError(`STEP syntax error near: ${_repr(text.slice(i, i + 40))}`)
    i = _TOKEN.lastIndex
    const g = m.groups as Record<string, string | undefined>
    const cur = stack[stack.length - 1]
    if (g.ref !== undefined) cur.push(new Ref(Number(g.ref.slice(1))))
    else if (g.num !== undefined) cur.push(Number(g.num))
    else if (g.str !== undefined) cur.push(_decodeString(g.str))
    else if (g.enum !== undefined) cur.push(new Enum(g.enum.slice(1, -1)))
    else if (g.kw !== undefined) {
      pendingKw.push(g.kw)
      stack.push([])
      // the '(' that follows opens the typed parameter
      _TOKEN.lastIndex = i
      const m2 = _TOKEN.exec(text)
      if (m2 && (m2.groups as Record<string, string | undefined>).punct === '(') i = _TOKEN.lastIndex
      continue
    } else {
      const tok = g.punct
      if (tok === '(') {
        stack.push([])
        pendingKw.push(null)
      } else if (tok === ')') {
        const done = stack.pop() as StepValue[]
        const kw = pendingKw.pop() as string | null
        if (!stack.length) return [done, i]
        stack[stack.length - 1].push(kw ? new Typed(kw, done) : done)
      } else if (tok === '$') cur.push(null)
      else if (tok === '*') cur.push('*')
      // ',' separates
    }
  }
  throw new RangeError('unterminated parameter list')
}

/** The entities of a STEP file: `entities` maps each entity number to its type and parameters
 * (a complex entity has the type `COMPLEX:<its main part>` and no parameters), `complex` the
 * parts of complex entities. */
export class StepFile {
  entities: Map<number, [string, StepValue[]]>
  complex: Map<number, Map<string, StepValue[]>>
  schema: string

  constructor(entities: Map<number, [string, StepValue[]]>, complex: Map<number, Map<string, StepValue[]>>, schema = '') {
    this.entities = entities
    this.complex = complex
    this.schema = schema
  }

  get(ref: unknown): [string, StepValue[]] {
    const id = _int(ref)
    const e = this.entities.get(id)
    if (e === undefined) throw new RangeError(`the STEP file has no entity #${id}`)
    return e
  }

  typeOf(ref: unknown): string {
    return this.get(ref)[0]
  }

  ofType(...names: string[]): number[] {
    const wanted = new Set(names)
    const out: number[] = []
    for (const [i, [t]] of this.entities) if (wanted.has(t)) out.push(i)
    return out
  }
}

const _RECORD = new RegExp(`#(\\d+)${WS}*=${WS}*`, 'g')
const _NAME = /[A-Za-z_][A-Za-z_0-9]*/y

/** Parse the DATA section of a STEP file. */
export function parse(text: string): StepFile {
  // remove comments
  text = text.replace(/\/\*[\s\S]*?\*\//g, '')
  let schema = ''
  const sm = new RegExp(`FILE_SCHEMA${WS}*\\(${WS}*\\(${WS}*'([^']*)'`).exec(text)
  if (sm) schema = sm[1]
  const start = text.indexOf('DATA;')
  if (start < 0) throw new RangeError('not a STEP file (no DATA section)')
  const entities = new Map<number, [string, StepValue[]]>()
  const complex = new Map<number, Map<string, StepValue[]>>()
  let pos = start + 5
  const n = text.length
  const at = (i: number): string => {
    if (i >= n) throw new RangeError('string index out of range')
    return text[i]
  }
  const blank = (c: string) => c === ' ' || c === '\t' || c === '\r' || c === '\n'
  while (true) {
    _RECORD.lastIndex = pos
    const m = _RECORD.exec(text)
    if (!m) break
    const eid = Number(m[1])
    let i = _RECORD.lastIndex
    if (text.startsWith('(', i)) {
      // complex entity: ( NAME(args) NAME(args) ... )
      const parts = new Map<string, StepValue[]>()
      i += 1
      while (true) {
        while (i < n && blank(text[i])) i += 1
        if (at(i) === ')') {
          i += 1
          break
        }
        _NAME.lastIndex = i
        const km = _NAME.exec(text)
        if (!km) throw new RangeError(`bad complex entity #${eid}`)
        const name = km[0].toUpperCase()
        i = _NAME.lastIndex
        while (blank(at(i))) i += 1
        let args: StepValue[]
        ;[args, i] = _parseArgs(text, i)
        parts.set(name, args)
      }
      complex.set(eid, parts)
      entities.set(eid, [_complexKind(parts), []])
    } else {
      _NAME.lastIndex = i
      const km = _NAME.exec(text)
      if (!km) {
        pos = i
        continue
      }
      const name = km[0].toUpperCase()
      i = _NAME.lastIndex
      while (blank(at(i))) i += 1
      let args: StepValue[]
      ;[args, i] = _parseArgs(text, i)
      entities.set(eid, [name, args])
    }
    const semi = text.indexOf(';', i)
    pos = semi >= 0 ? semi + 1 : n
  }
  return new StepFile(entities, complex, schema)
}

function _complexKind(parts: Map<string, StepValue[]>): string {
  for (const kind of [
    'B_SPLINE_SURFACE_WITH_KNOTS',
    'B_SPLINE_CURVE_WITH_KNOTS',
    'BEZIER_CURVE',
    'BEZIER_SURFACE',
    'UNIFORM_CURVE',
    'UNIFORM_SURFACE',
    'QUASI_UNIFORM_CURVE',
    'QUASI_UNIFORM_SURFACE',
    'GEOMETRIC_REPRESENTATION_CONTEXT',
    'LENGTH_UNIT',
    'PLANE_ANGLE_UNIT',
    'SOLID_ANGLE_UNIT',
    'REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION',
  ]) {
    if (parts.has(kind)) return `COMPLEX:${kind}`
  }
  return `COMPLEX:${[...parts.keys()].sort().join('+')}`
}

// -------------------------------------------------------------------------------- interpretation
/** An edge: its curve (an index into `curves`), its start and end vertex (indices into
 * `vertices`) and whether it runs along its curve. */
export interface EdgeData {
  curve: number
  v0: number
  v1: number
  same_sense: boolean
}

/** A face's loop: its edges with their senses (as the face sees them), or a single vertex. */
export interface LoopData {
  edges?: [number, boolean][]
  vertex?: number
  outer: boolean
}

export interface FaceData {
  surface: number
  same_sense: boolean
  loops: LoopData[]
  name: string
  /** The face's own color, from a STYLED_ITEM of the face (kernel plan T5). */
  color?: number[] | null
  // (the frame of a seam the importer adds)
  frame?: [number[], number[]] | null
}

export interface ShellData {
  faces: number[]
  reversed: boolean
  closed: boolean
}

/** One body in neutral form (lengths in mm, world coordinates). */
export class BodyData {
  /** "solid" or "sheet" */
  kind: string
  name: string
  vertices: number[][] = []
  curves: Any[] = []
  edges: EdgeData[] = []
  surfaces: Any[] = []
  faces: FaceData[] = []
  shells: ShellData[] = []
  color: number[] | null = null
  /** the name of the product the body belongs to, if the file names one */
  product = ''
  /** the body's entity (MANIFOLD_SOLID_BREP, BREP_WITH_VOIDS, ...) */
  entity = 0
  /** the length uncertainty its context declares (mm) */
  uncertainty: number | null = null

  constructor(kind: string, name: string) {
    this.kind = kind
    this.name = name
  }
}

const _MM_PER_METRE_PREFIXED = new Map<string | null, number>([
  [null, 1000.0],
  ['EXA', 1e21],
  ['PETA', 1e18],
  ['TERA', 1e15],
  ['GIGA', 1e12],
  ['MEGA', 1e9],
  ['KILO', 1e6],
  ['HECTO', 1e5],
  ['DECA', 1e4],
  ['DECI', 100.0],
  ['CENTI', 10.0],
  ['MILLI', 1.0],
  ['MICRO', 1e-3],
  ['NANO', 1e-6],
  ['PICO', 1e-9],
  ['FEMTO', 1e-12],
  ['ATTO', 1e-15],
])

const _RADIANS = new Map<string | null, number>([[null, 1.0]])

const _NAMED_COLOURS: Record<string, number[]> = {
  red: [1, 0, 0],
  green: [0, 1, 0],
  blue: [0, 0, 1],
  yellow: [1, 1, 0],
  magenta: [1, 0, 1],
  cyan: [0, 1, 1],
  black: [0, 0, 0],
  white: [1, 1, 1],
}

class _Interp {
  sf: StepFile
  /** model length unit -> mm */
  scale = 1.0
  /** model plane angle unit -> radians */
  angleScale = 1.0
  contextUnits = new Map<number, [number, number]>()
  /** context -> declared length uncertainty (mm) */
  contextUncertainty = new Map<number, number>()
  defaultUnits: [number, number] = [1.0, 1.0]
  repContext = new Map<number, number>()
  colors: Map<number, number[]>

  constructor(sf: StepFile) {
    this.sf = sf
    this._findUnits()
    this.colors = this._findColors()
  }

  // -- units --------------------------------------------------------------------------------
  /** Length and angle unit of every representation context. A file can define more units than
   * it uses for geometry (density units in metres, for example), so only the units a context
   * assigns count. */
  _findUnits(): void {
    const sf = this.sf
    for (const [eid, parts] of sf.complex) {
      const assigned = parts.get('GLOBAL_UNIT_ASSIGNED_CONTEXT')
      if (!_truthy(assigned)) continue
      let length = 1.0
      let angle = 1.0
      for (const u of _iter(_at(assigned, 0))) {
        const kinds = sf.complex.get(_int(u)) ?? new Map<string, StepValue[]>()
        if (kinds.has('LENGTH_UNIT')) length = this._unitValue(_int(u), _MM_PER_METRE_PREFIXED)
        else if (kinds.has('PLANE_ANGLE_UNIT')) angle = this._unitValue(_int(u), _RADIANS)
      }
      this.contextUnits.set(eid, [length, angle])
      const uncertain = parts.get('GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT')
      for (const u of _truthy(uncertain) ? _iter(_at(uncertain, 0)) : []) {
        try {
          // UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07), unit, name, description)
          const [t, a] = sf.get(u)
          const first = _at(a, 0)
          const value = first instanceof Typed ? _at(first.args, 0) : first
          const kinds = sf.complex.get(_int(_at(a, 1))) ?? new Map<string, StepValue[]>()
          const unit = kinds.has('LENGTH_UNIT') ? this._unitValue(_int(_at(a, 1)), _MM_PER_METRE_PREFIXED) : length
          const mm = _float(value) * unit
          if (t === 'UNCERTAINTY_MEASURE_WITH_UNIT' && mm > 0 && Number.isFinite(mm))
            this.contextUncertainty.set(eid, Math.min(mm, this.contextUncertainty.get(eid) ?? Infinity))
        } catch {}
      }
    }
    const units = [...this.contextUnits.values()]
    if (units.length) {
      // where a representation has no context of its own, the most common one counts (of equally
      // common ones the first in the file; Python takes the first of its set)
      const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1]
      let best = units[0]
      let bestCount = 0
      for (const u of units) {
        const count = units.filter((v) => same(u, v)).length
        if (count > bestCount) {
          best = u
          bestCount = count
        }
      }
      ;[this.scale, this.angleScale] = best
    }
    this.defaultUnits = [this.scale, this.angleScale]
    for (const [eid, [t, a]] of sf.entities) {
      if (t.endsWith('REPRESENTATION') && a.length >= 3 && a[2] instanceof Ref) this.repContext.set(eid, a[2].id)
    }
    for (const [eid, parts] of sf.complex) {
      for (const [kind, a] of parts) {
        if (kind.endsWith('REPRESENTATION') && a.length >= 3 && a[2] instanceof Ref) this.repContext.set(eid, a[2].id)
      }
    }
  }

  /** Size of a unit: an SI unit with its prefix, or a conversion-based unit (inch, degree)
   * followed to the unit it is defined in. */
  _unitValue(ref: number, si: Map<string | null, number>, depth = 0): number {
    const kinds = this.sf.complex.get(ref) ?? new Map<string, StepValue[]>()
    if (kinds.has('SI_UNIT')) {
      const prefix = _at(kinds.get('SI_UNIT'), 0)
      if (si.size === 1 && si.has(null)) return 1.0 // angles: radians, no prefixes in practice
      const key = prefix === null ? null : String(prefix).toUpperCase()
      return si.get(key) ?? 1.0
    }
    if (kinds.has('CONVERSION_BASED_UNIT') && depth < 8) {
      const unit = kinds.get('CONVERSION_BASED_UNIT') as StepValue[]
      if (unit.length !== 2) throw new RangeError(`expected 2 values to unpack, got ${unit.length}`)
      const [name, measure] = unit
      try {
        const [, a] = this.sf.get(measure)
        const first = _at(a, 0)
        const value = first instanceof Typed ? _at(first.args, 0) : first
        return _float(value) * this._unitValue(_int(_at(a, 1)), si, depth + 1)
      } catch {
        const n = String(name).toUpperCase()
        return n.startsWith('DEG') ? Math.PI / 180.0 : n.startsWith('INCH') ? 25.4 : 1.0
      }
    }
    return 1.0
  }

  /** [mm per length unit, radians per angle unit] of a representation. */
  unitsOf(rep: number | null): [number, number] {
    if (rep === null) return this.defaultUnits
    return this.contextUnits.get(this.repContext.get(rep) ?? -1) ?? this.defaultUnits
  }

  useUnits(rep: number | null): void {
    ;[this.scale, this.angleScale] = this.unitsOf(rep)
  }

  /** The length uncertainty (mm) the context of a representation declares, or null. */
  uncertaintyOf(rep: number | null): number | null {
    if (rep === null) return null
    return this.contextUncertainty.get(this.repContext.get(rep) ?? -1) ?? null
  }

  // -- colors -------------------------------------------------------------------------------
  _findColors(): Map<number, number[]> {
    const sf = this.sf
    const out = new Map<number, number[]>()
    for (const eid of sf.ofType('STYLED_ITEM', 'OVER_RIDING_STYLED_ITEM')) {
      const [, a] = sf.get(eid)
      try {
        const rgb = this._styleColor(_at(a, 1))
        if (rgb !== null && _at(a, 2) instanceof Ref) out.set((a[2] as Ref).id, rgb)
      } catch {
        continue
      }
    }
    return out
  }

  _styleColor(styles: unknown): number[] | null {
    const sf = this.sf
    const todo: StepValue[] = [..._iter(styles)]
    let seen = 0
    while (todo.length && seen < 64) {
      seen += 1
      const r = todo.shift()
      if (Array.isArray(r)) {
        todo.push(...r)
        continue
      }
      if (!(r instanceof Ref) || !sf.entities.has(r.id)) continue
      const [t, a] = sf.get(r)
      if (t === 'COLOUR_RGB') return [_float(_at(a, 1)), _float(_at(a, 2)), _float(_at(a, 3))]
      if (t === 'DRAUGHTING_PRE_DEFINED_COLOUR') {
        const name = String(_at(a, 0)).toLowerCase()
        return Object.hasOwn(_NAMED_COLOURS, name) ? _NAMED_COLOURS[name] : null
      }
      for (const x of a) if (x instanceof Ref || Array.isArray(x)) todo.push(x)
    }
    return null
  }

  // -- placements ---------------------------------------------------------------------------
  point(ref: unknown): number[] {
    const [t, a] = this.sf.get(ref)
    if (t !== 'CARTESIAN_POINT') throw new RangeError(`expected a point, got ${t}`)
    const c = _iter(_at(a, 1)).map(_float)
    while (c.length < 3) c.push(0.0)
    return c.map((x) => x * this.scale)
  }

  direction(ref: unknown): number[] {
    const [t, a] = this.sf.get(ref)
    if (t === 'VECTOR') return this.direction(_at(a, 1))
    const v = _iter(_at(a, 1)).map(_float)
    while (v.length < 3) v.push(0.0)
    const n = _norm(v)
    return v.map((x) => x / n)
  }

  vector(ref: unknown): number[] {
    const [t, a] = this.sf.get(ref)
    if (t === 'VECTOR') {
      const d = this.direction(_at(a, 1))
      const length = _float(_at(a, 2))
      return d.map((x) => x * length * this.scale)
    }
    return this.direction(ref)
  }

  /** [origin, z, x] of an AXIS2_PLACEMENT_3D. */
  axis2(ref: unknown): [number[], number[], number[]] {
    const [, a] = this.sf.get(ref)
    const o = this.point(_at(a, 1))
    const z = a.length > 2 && a[2] !== null ? this.direction(a[2]) : [0.0, 0.0, 1.0]
    let x: number[]
    if (a.length > 3 && a[3] !== null) x = this.direction(a[3])
    else x = Math.abs(z[0]) < 0.9 ? [1.0, 0.0, 0.0] : [0.0, 1.0, 0.0]
    const d = _dot(x, z)
    x = [x[0] - z[0] * d, x[1] - z[1] * d, x[2] - z[2] * d]
    const n = _norm(x)
    x = x.map((v) => v / n)
    return [o, z, x]
  }

  /** The matrix of an AXIS2_PLACEMENT_3D, or of a CARTESIAN_TRANSFORMATION_OPERATOR_3D (which can
   * mirror and scale). */
  placementMatrix(ref: unknown): Matrix {
    if (this._parts(ref).has(_OPERATOR)) return this.operatorMatrix(ref)
    const [o, z, x] = this.axis2(ref)
    const y = _cross(z, x)
    const m = _identity()
    for (let i = 0; i < 3; i++) {
      m[i * 4] = x[i]
      m[i * 4 + 1] = y[i]
      m[i * 4 + 2] = z[i]
      m[i * 4 + 3] = o[i]
    }
    return m
  }

  /** An entity's parts by type: one for a plain entity, several for a complex one. */
  _parts(ref: unknown): Map<string, StepValue[]> {
    const [t, a] = this.sf.get(ref)
    return t.startsWith('COMPLEX:') ? (this.sf.complex.get(_int(ref)) ?? new Map()) : new Map([[t, a]])
  }

  /** The matrix of a CARTESIAN_TRANSFORMATION_OPERATOR_3D (ISO 10303-42): the axes of base_axis
   * (axis3, then axis1 and axis2 made square to it, in that order: a left-handed set mirrors), times
   * the scale (and scl2, scl3 of a non-uniform one), at local_origin. */
  operatorMatrix(ref: unknown): Matrix {
    const parts = this._parts(ref)
    const a = parts.get(_OPERATOR) as StepValue[]
    // (from the end: name and description come first, as many as the writer gives)
    const n = a.length
    if (n < 5) throw new RangeError(`#${_int(ref)}: a transformation needs axis1, axis2, local_origin, scale and axis3`)
    const [axis1, axis2, origin, scale, axis3] = [a[n - 5], a[n - 4], a[n - 3], a[n - 2], a[n - 1]]
    const given = (r: StepValue): number[] | null => (r === null || r === '*' ? null : this.direction(r))
    const z = given(axis3) ?? [0.0, 0.0, 1.0]
    let v = given(axis1)
    if (v === null) v = z[0] === 1 && z[1] === 0 && z[2] === 0 ? [0.0, 1.0, 0.0] : [1.0, 0.0, 0.0]
    let x = v.map((c, i) => c - z[i] * _dot(v as number[], z))
    if (!(_norm(x) > 1e-12)) throw new RangeError(`#${_int(ref)}: axis1 of the transformation lies along its axis3`)
    x = x.map((c) => c / _norm(x))
    const w = given(axis2) ?? [0.0, 1.0, 0.0]
    let y = w.map((c, i) => c - z[i] * _dot(w, z))
    const yx = _dot(y, x)
    y = y.map((c, i) => c - x[i] * yx)
    if (!(_norm(y) > 1e-12)) throw new RangeError(`#${_int(ref)}: axis2 of the transformation lies in the plane of axis1 and axis3`)
    y = y.map((c) => c / _norm(y))
    const s = scale === null || scale === '*' ? 1.0 : _float(scale)
    const scales = [s, s, s]
    const nonuniform = parts.get('CARTESIAN_TRANSFORMATION_OPERATOR_3D_NON_UNIFORM') ?? parts.get('CARTESIAN_TRANSFORMATION_OPERATOR_NON_UNIFORM')
    if (nonuniform !== undefined && nonuniform.length >= 2) {
      const k = nonuniform.length
      scales[1] = nonuniform[k - 2] === null || nonuniform[k - 2] === '*' ? s : _float(nonuniform[k - 2])
      scales[2] = nonuniform[k - 1] === null || nonuniform[k - 1] === '*' ? s : _float(nonuniform[k - 1])
    }
    if (!scales.every((c) => Number.isFinite(c) && c > 0)) throw new RangeError(`#${_int(ref)}: the scale of the transformation must be positive`)
    const o = this.point(origin)
    const m = _identity()
    for (let i = 0; i < 3; i++) {
      m[i * 4] = x[i] * scales[0]
      m[i * 4 + 1] = y[i] * scales[1]
      m[i * 4 + 2] = z[i] * scales[2]
      m[i * 4 + 3] = o[i]
    }
    return m
  }

  // -- curves -------------------------------------------------------------------------------
  curve(ref: unknown): Any {
    const sf = this.sf
    const [t, a] = sf.get(ref)
    if (t === 'SURFACE_CURVE' || t === 'SEAM_CURVE' || t === 'INTERSECTION_CURVE') return this.curve(_at(a, 1))
    if (t === 'LINE') return { kind: 'line', origin: this.point(_at(a, 1)), direction: this.vector(_at(a, 2)) }
    if (t === 'CIRCLE') {
      const [o, z, x] = this.axis2(_at(a, 1))
      return { kind: 'circle', origin: o, z, x, radius: _float(_at(a, 2)) * this.scale }
    }
    if (t === 'ELLIPSE') {
      const [o, z, x] = this.axis2(_at(a, 1))
      return { kind: 'ellipse', origin: o, z, x, r1: _float(_at(a, 2)) * this.scale, r2: _float(_at(a, 3)) * this.scale }
    }
    if (t === 'B_SPLINE_CURVE_WITH_KNOTS') {
      const degree = _int(_at(a, 1))
      const pts = _iter(_at(a, 2)).map((p) => this.point(p))
      const knots = _expand(_at(a, 7), _at(a, 6))
      return { kind: 'bspline', degree, poles: pts, knots, weights: null }
    }
    if (Object.hasOwn(_KNOT_FORMS, t)) {
      // BEZIER_CURVE, UNIFORM_CURVE, QUASI_UNIFORM_CURVE: knots implied
      const degree = _int(_at(a, 1))
      const pts = _iter(_at(a, 2)).map((p) => this.point(p))
      return { kind: 'bspline', degree, poles: pts, knots: _defaultKnots(pts.length, degree, _KNOT_FORMS[t]), weights: null }
    }
    if (t === 'HYPERBOLA') {
      const [o, z, x] = this.axis2(_at(a, 1))
      return { kind: 'hyperbola', origin: o, z, x, a: _float(_at(a, 2)) * this.scale, b: _float(_at(a, 3)) * this.scale }
    }
    if (t === 'PARABOLA') {
      const [o, z, x] = this.axis2(_at(a, 1))
      return { kind: 'parabola', origin: o, z, x, focal: _float(_at(a, 2)) * this.scale }
    }
    if (t.startsWith('COMPLEX:')) {
      const parts = sf.complex.get(_int(ref)) as Map<string, StepValue[]>
      const bs = parts.get('B_SPLINE_CURVE')
      if (bs !== undefined) {
        const degree = _int(_at(bs, 0))
        const pts = _iter(_at(bs, 1)).map((p) => this.point(p))
        let knots: number[]
        const kk = parts.get('B_SPLINE_CURVE_WITH_KNOTS')
        if (kk !== undefined) knots = _expand(_at(kk, 1), _at(kk, 0))
        else {
          // Bezier / uniform / quasi-uniform
          const form = Object.keys(_KNOT_FORMS).find((k) => parts.has(k))
          knots = _defaultKnots(pts.length, degree, form === undefined ? 'quasi' : _KNOT_FORMS[form])
        }
        const w = parts.get('RATIONAL_B_SPLINE_CURVE')
        return { kind: 'bspline', degree, poles: pts, knots, weights: _truthy(w) ? _iter(_at(w, 0)).map(_float) : null }
      }
    }
    if (t === 'POLYLINE') {
      const pts = _iter(_at(a, 1)).map((p) => this.point(p))
      const n = pts.length
      const knots = [0.0, ...Array.from({ length: n }, (_, i) => i), n - 1]
      return { kind: 'bspline', degree: 1, poles: pts, knots, weights: null }
    }
    if (t === 'TRIMMED_CURVE') return this.curve(_at(a, 1))
    // (name, basis_curve, distance, self_intersect, ref_direction)
    if (t === 'OFFSET_CURVE_3D') return _offsetCurve(this.curve(_at(a, 1)), _float(_at(a, 2)) * this.scale, this.direction(_at(a, 4)), _int(ref))
    // (name, basis_surface, reference_to_curve): an edge given in a surface's parameters
    if (t === 'PCURVE') return this.pcurve(_at(a, 1), _at(a, 2), _int(ref))
    throw new NotImplementedError(`curve type ${t} (#${_int(ref)})`)
  }

  /** A curve in a surface's parameters (a PCURVE's): as `curve` gives it, in the file's numbers (no
   * units: points and lengths as they stand), in the plane z = 0. */
  curve2d(ref: unknown): Any {
    const [t, a] = this.sf.get(ref)
    const scale = this.scale
    this.scale = 1.0
    try {
      if (t === 'CIRCLE' || t === 'ELLIPSE') {
        const [, pa] = this.sf.get(_at(a, 1)) // AXIS2_PLACEMENT_2D(name, location, ref_direction)
        const o = this.point(_at(pa, 1))
        const x = pa.length > 2 && pa[2] !== null ? this.direction(pa[2]) : [1.0, 0.0, 0.0]
        const z = [0.0, 0.0, 1.0]
        if (t === 'CIRCLE') return { kind: 'circle', origin: o, z, x, radius: _float(_at(a, 2)) }
        return { kind: 'ellipse', origin: o, z, x, r1: _float(_at(a, 2)), r2: _float(_at(a, 3)) }
      }
      return this.curve(ref)
    } finally {
      this.scale = scale
    }
  }

  /** The curve in space of a PCURVE: its curve in the parameters of its surface, on it. */
  pcurve(surface: unknown, rep: unknown, eid: number): Any {
    const srf = this.surface(surface)
    const [, ra] = this.sf.get(rep) // DEFINITIONAL_REPRESENTATION(name, items, context)
    const items = ra.length > 1 && Array.isArray(ra[1]) ? (ra[1] as StepValue[]).filter((x) => x instanceof Ref) : []
    if (!items.length) throw new RangeError(`#${eid}: the PCURVE holds no curve`)
    return _pcurveInSpace(srf, this.curve2d(items[0]), this.scale, this.angleScale, eid)
  }

  /** A curve that stands on its own (wireframe geometry), with its trims and segments:
   * `{ kind: 'trimmed', basis, trims: [{ param } | { point }] (two), sense }`,
   * `{ kind: 'composite', segments: [[curve, sameSense], ...] }`, or a curve of `curve`. null for
   * a line without ends. */
  wireCurve(ref: unknown): Any | null {
    const [t, a] = this.sf.get(ref)
    if (t === 'TRIMMED_CURVE') {
      const basis = this.curve(_at(a, 1))
      const master = a.length > 5 ? String(a[5]) : 'UNSPECIFIED'
      const trims = [_at(a, 2), _at(a, 3)].map((sel) => this._trim(sel, basis, master))
      if (trims.some((x) => x === null)) return null
      return { kind: 'trimmed', basis, trims, sense: String(_at(a, 4)) !== 'F' }
    }
    if (t === 'COMPOSITE_CURVE') {
      const segments: [Any, boolean][] = []
      for (const sref of _iter(_at(a, 1))) {
        const [, sa] = this.sf.get(sref) // COMPOSITE_CURVE_SEGMENT(transition, same_sense, parent)
        const c = this.wireCurve(_at(sa, 2))
        if (c === null) return null
        segments.push([c, String(_at(sa, 1)) !== 'F'])
      }
      return { kind: 'composite', segments }
    }
    if (t === 'LINE') return null
    return this.curve(ref)
  }

  /** One end of a trimmed curve: a parameter (radians on circles and ellipses), or a point where
   * the file gives only that. */
  _trim(select: StepValue, basis: Any, master: string): Any | null {
    const items = _iter(select)
    let param: StepValue = null
    for (const x of items) {
      if (x instanceof Typed && x.name === 'PARAMETER_VALUE') {
        param = _at(x.args, 0)
        break
      }
    }
    const point = items.find((x) => x instanceof Ref) ?? null
    if (param !== null && (point === null || master !== 'CARTESIAN')) {
      const p = _float(param)
      return { param: basis.kind === 'circle' || basis.kind === 'ellipse' ? p * this.angleScale : p }
    }
    return point !== null ? { point: this.point(point) } : null
  }

  // -- surfaces -----------------------------------------------------------------------------
  surface(ref: unknown): Any {
    const sf = this.sf
    const [t, a] = sf.get(ref)
    if (t === 'PLANE') {
      const [o, z, x] = this.axis2(_at(a, 1))
      return { kind: 'plane', origin: o, z, x }
    }
    if (t === 'CYLINDRICAL_SURFACE') {
      const [o, z, x] = this.axis2(_at(a, 1))
      return { kind: 'cylinder', origin: o, z, x, radius: _float(_at(a, 2)) * this.scale }
    }
    if (t === 'CONICAL_SURFACE') {
      const [o, z, x] = this.axis2(_at(a, 1))
      return { kind: 'cone', origin: o, z, x, radius: _float(_at(a, 2)) * this.scale, semi_angle: _float(_at(a, 3)) * this.angleScale }
    }
    if (t === 'SPHERICAL_SURFACE') {
      const [o, z, x] = this.axis2(_at(a, 1))
      return { kind: 'sphere', origin: o, z, x, radius: _float(_at(a, 2)) * this.scale }
    }
    if (t === 'TOROIDAL_SURFACE' || t === 'DEGENERATE_TOROIDAL_SURFACE') {
      const [o, z, x] = this.axis2(_at(a, 1))
      return { kind: 'torus', origin: o, z, x, major: _float(_at(a, 2)) * this.scale, minor: _float(_at(a, 3)) * this.scale }
    }
    if (t === 'B_SPLINE_SURFACE_WITH_KNOTS') {
      return this._bsplineSurface(_int(_at(a, 1)), _int(_at(a, 2)), _at(a, 3), _expand(_at(a, 10), _at(a, 8)), _expand(_at(a, 11), _at(a, 9)), null)
    }
    if (Object.hasOwn(_KNOT_FORMS, t)) {
      // BEZIER_SURFACE, UNIFORM_SURFACE, QUASI_UNIFORM_SURFACE: knots implied
      const ud = _int(_at(a, 1))
      const vd = _int(_at(a, 2))
      const grid = _at(a, 3)
      const form = _KNOT_FORMS[t]
      return this._bsplineSurface(ud, vd, grid, _defaultKnots(_iter(grid).length, ud, form), _defaultKnots(_iter(_at(grid, 0)).length, vd, form), null)
    }
    if (t === 'SURFACE_OF_LINEAR_EXTRUSION') return { kind: 'extrusion', curve: this.curve(_at(a, 1)), vector: this.vector(_at(a, 2)) }
    if (t === 'SURFACE_OF_REVOLUTION') {
      const [, ax] = sf.get(_at(a, 2))
      return { kind: 'revolution', curve: this.curve(_at(a, 1)), axis_origin: this.point(_at(ax, 1)), axis: this.direction(_at(ax, 2)) }
    }
    if (t === 'OFFSET_SURFACE') return { kind: 'offset', basis: this.surface(_at(a, 1)), distance: _float(_at(a, 2)) * this.scale }
    if (t === 'RECTANGULAR_TRIMMED_SURFACE') return this.surface(_at(a, 1))
    if (t.startsWith('COMPLEX:')) {
      const parts = sf.complex.get(_int(ref)) as Map<string, StepValue[]>
      const bs = parts.get('B_SPLINE_SURFACE')
      if (bs !== undefined) {
        const ud = _int(_at(bs, 0))
        const vd = _int(_at(bs, 1))
        const grid = _at(bs, 2)
        let uk: number[]
        let vk: number[]
        const kk = parts.get('B_SPLINE_SURFACE_WITH_KNOTS')
        if (kk !== undefined) {
          uk = _expand(_at(kk, 2), _at(kk, 0))
          vk = _expand(_at(kk, 3), _at(kk, 1))
        } else {
          const found = Object.keys(_KNOT_FORMS).find((k) => parts.has(k))
          const form = found === undefined ? 'quasi' : _KNOT_FORMS[found]
          uk = _defaultKnots(_iter(grid).length, ud, form)
          vk = _defaultKnots(_iter(_at(grid, 0)).length, vd, form)
        }
        const w = parts.get('RATIONAL_B_SPLINE_SURFACE')
        return this._bsplineSurface(ud, vd, grid, uk, vk, _truthy(w) ? _at(w, 0) : null)
      }
    }
    throw new NotImplementedError(`surface type ${t} (#${_int(ref)})`)
  }

  _bsplineSurface(ud: number, vd: number, grid: StepValue, uk: number[], vk: number[], weights: StepValue | null): Any {
    const rows = _iter(grid)
    const nu = rows.length
    const nv = _iter(_at(rows, 0)).length
    const poles: number[][] = []
    for (const row of rows) for (const p of _iter(row)) poles.push(this.point(p))
    let w: number[] | null = null
    if (weights !== null) {
      w = []
      for (const row of _iter(weights)) for (const x of _iter(row)) w.push(_float(x))
    }
    return { kind: 'bspline', u_degree: ud, v_degree: vd, nu, nv, poles, u_knots: uk, v_knots: vk, weights: w }
  }

  // -- topology -----------------------------------------------------------------------------
  body(shellRefs: [StepValue, boolean][], kind: string, name: string): BodyData {
    const sf = this.sf
    const b = new BodyData(kind, name)
    const vmap = new Map<number, number>()
    const emap = new Map<number, number>()
    const smap = new Map<number, number>()

    const vertex = (ref: unknown): number => {
      const r = _int(ref)
      if (!vmap.has(r)) {
        const [, a] = sf.get(r)
        vmap.set(r, b.vertices.length)
        b.vertices.push(this.point(_at(a, 1)))
      }
      return vmap.get(r) as number
    }

    const edge = (ref: unknown): number => {
      const r = _int(ref)
      if (!emap.has(r)) {
        const [t, a] = sf.get(r)
        if (t !== 'EDGE_CURVE') throw new NotImplementedError(`edge type ${t} (#${r})`)
        emap.set(r, b.edges.length)
        b.curves.push(this.curve(_at(a, 3)))
        b.edges.push({ curve: b.curves.length - 1, v0: vertex(_at(a, 1)), v1: vertex(_at(a, 2)), same_sense: String(_at(a, 4)) === 'T' })
      }
      return emap.get(r) as number
    }

    for (let [shellRef, reversed] of shellRefs) {
      let [t, a] = sf.get(shellRef)
      if (t === 'ORIENTED_CLOSED_SHELL') {
        reversed = reversed !== (String(_at(a, 3)) === 'F')
        shellRef = _at(a, 2)
        ;[t, a] = sf.get(shellRef)
      }
      const faces: number[] = []
      for (const fref of _iter(_at(a, 1))) {
        const [ft, fa] = sf.get(fref)
        if (ft !== 'ADVANCED_FACE' && ft !== 'FACE_SURFACE') throw new NotImplementedError(`face type ${ft} (#${_int(fref)})`)
        const sref = _int(_at(fa, 2))
        if (!smap.has(sref)) {
          smap.set(sref, b.surfaces.length)
          b.surfaces.push(this.surface(sref))
        }
        const loops: LoopData[] = []
        for (const bref of _iter(_at(fa, 1))) {
          const [bt, ba] = sf.get(bref)
          const [lt, la] = sf.get(_at(ba, 1))
          const boundSense = String(_at(ba, 2)) === 'T'
          if (lt === 'VERTEX_LOOP') {
            loops.push({ vertex: vertex(_at(la, 1)), outer: bt === 'FACE_OUTER_BOUND' })
            continue
          }
          if (lt !== 'EDGE_LOOP') throw new NotImplementedError(`loop type ${lt} (#${_int(_at(ba, 1))})`)
          let items: [number, boolean][] = []
          for (const oref of _iter(_at(la, 1))) {
            const [, oa] = sf.get(oref)
            items.push([edge(_at(oa, 3)), String(_at(oa, 4)) === 'T'])
          }
          if (!boundSense) items = items.reverse().map(([e, fwd]) => [e, !fwd])
          loops.push({ edges: items, outer: bt === 'FACE_OUTER_BOUND' })
        }
        // outer loop first (if marked); otherwise keep the order
        loops.sort((p, q) => Number(!p.outer) - Number(!q.outer))
        faces.push(b.faces.length)
        const faceName = _at(fa, 0)
        // (a face's own color, from a STYLED_ITEM of the face, and its name: kernel plan T5)
        b.faces.push({
          surface: smap.get(sref) as number,
          same_sense: String(_at(fa, 3)) === 'T',
          loops,
          name: _isStr(faceName) ? String(faceName) : '',
          color: this.colors.get(_int(fref)) ?? null,
        })
      }
      b.shells.push({ faces, reversed, closed: t !== 'OPEN_SHELL' })
    }
    return b
  }
}

function _expand(knots: unknown, mults: unknown): number[] {
  const out: number[] = []
  const ks = _iter(knots)
  const ms = _iter(mults)
  for (let i = 0; i < Math.min(ks.length, ms.length); i++) {
    const kv = _float(ks[i])
    for (let j = _int(ms[i]); j > 0; j--) out.push(kv)
  }
  return out
}

const _KNOT_FORMS: Record<string, string> = {
  BEZIER_CURVE: 'bezier',
  UNIFORM_CURVE: 'uniform',
  QUASI_UNIFORM_CURVE: 'quasi',
  BEZIER_SURFACE: 'bezier',
  UNIFORM_SURFACE: 'uniform',
  QUASI_UNIFORM_SURFACE: 'quasi',
}

/** Knot vector of a B-spline whose knots the file leaves implicit (ISO 10303-42). */
function _defaultKnots(n: number, degree: number, form: string): number[] {
  const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i)
  const repeat = (v: number, k: number) => Array<number>(Math.max(0, k)).fill(v)
  if (form === 'uniform') return range(-degree, n + 1)
  if (form === 'bezier') {
    // piecewise Bezier: segments meet with multiplicity `degree`
    if (degree === 0) throw new RangeError('integer division or modulo by zero')
    const segments = Math.max(1, Math.floor((n - 1) / degree))
    const inner = range(1, segments).flatMap((i) => repeat(i, degree))
    return [...repeat(0.0, degree + 1), ...inner, ...repeat(segments, degree + 1)]
  }
  const innerN = n - degree - 1
  return [...repeat(0.0, degree + 1), ...range(1, innerN + 1), ...repeat(innerN + 1, degree + 1)]
}

/** What reading one body can fail with (Python's RuntimeError, ValueError, KeyError, IndexError,
 * TypeError, ArithmeticError): an entity the reader does not know (NotImplementedError), a
 * malformed one, or the kernel (a KernelError) when it is built. */
export function _bodyError(e: unknown): boolean {
  return e instanceof NotImplementedError || e instanceof RangeError || e instanceof TypeError || _isRuntimeError(e)
}

/** How a message names a body: `body 'b' (#99, product 'P')`, its entity and the product it
 * belongs to (where that is not its name). */
export function _bodyLabel(eid: number, name: string, product = ''): string {
  const of = product && product !== name ? `, product ${_repr(product)}` : ''
  return name ? `body ${_repr(name)} (#${eid}${of})` : `body #${eid}${of ? ` (${of.slice(2)})` : ''}`
}

/** The reason a body could not be read, for a message. */
export function _failure(e: unknown): string {
  if (e instanceof NotImplementedError) return `${e.message}, which is not supported`
  return (e instanceof Error && e.message) || String(e)
}

/** All bodies of the file with their world placement (4 x 4, mm).
 *
 * A body that cannot be read (an entity the reader does not know, a malformed one) throws, unless
 * an array is given as `skipped`: then the body is left out and the array gets
 * `{ name, product, entity, message }` for it. */
export function interpret(sf: StepFile, options: { skipped?: Any[] } = {}): [BodyData, Matrix][] {
  const { skipped } = options
  const it = new _Interp(sf)
  const [transforms, inProduct] = _representationTransforms(it)
  const bodies: [BodyData, Matrix][] = []
  const owner = _owningRepresentations(sf)
  const productNames = _representationProductNames(sf)
  for (const [eid, [t, a]] of sf.entities) {
    if (t !== 'MANIFOLD_SOLID_BREP' && t !== 'BREP_WITH_VOIDS' && t !== 'SHELL_BASED_SURFACE_MODEL') continue
    // Representations outside the product structure (the shape for validation properties, for
    // example) list bodies too; they do not place another copy.
    const owned = owner.get(eid) ?? []
    const placed = owned.filter((r) => inProduct.has(r))
    const reps = placed.length ? placed : owned
    it.useUnits(reps.length ? reps[0] : null)
    // Many exporters leave the body unnamed and name the product instead.
    let product = ''
    for (const r of reps) {
      const name = productNames.get(r)
      if (name !== undefined) {
        product = name
        break
      }
    }
    const first = _at(a, 0)
    const label = _isStr(first) && _strip(String(first)) ? String(first) : product
    let body: BodyData
    try {
      if (t === 'MANIFOLD_SOLID_BREP') body = it.body([[_at(a, 1), false]], 'solid', label)
      else if (t === 'BREP_WITH_VOIDS') body = it.body([[_at(a, 1), false], ..._iter(_at(a, 2)).map((v): [StepValue, boolean] => [v, false])], 'solid', label)
      else body = it.body(_iter(_at(a, 1)).map((s): [StepValue, boolean] => [s, false]), 'sheet', label)
    } catch (e) {
      if (skipped === undefined || !_bodyError(e)) throw e
      skipped.push({ name: label, product, entity: eid, message: `${_bodyLabel(eid, label, product)}: ${_failure(e)}` })
      continue
    }
    body.color = it.colors.get(eid) ?? null
    body.product = product
    body.entity = eid
    body.uncertainty = it.uncertaintyOf(reps.length ? reps[0] : null)
    // A body listed by several representations (some exporters put it in two that are related to
    // each other) is the same body where both put it at the same place. Instances of one
    // representation stay, even where they coincide.
    const mats: Matrix[] = []
    for (const r of reps) {
      const seen = [...mats]
      for (const m of transforms.get(r) ?? [_identity()]) {
        let largest = 0
        for (const v of m) if (Math.abs(v) > largest) largest = Math.abs(v)
        const atol = 1e-9 * (largest > 1.0 ? largest : 1.0)
        if (!seen.some((q) => m.every((v, i) => Math.abs(v - q[i]) <= atol))) mats.push(m)
      }
    }
    for (const m of mats.length ? mats : [_identity()]) bodies.push([body, m])
  }
  return bodies
}

const _CURVES = new Set([
  'LINE',
  'CIRCLE',
  'ELLIPSE',
  'POLYLINE',
  'TRIMMED_CURVE',
  'COMPOSITE_CURVE',
  'B_SPLINE_CURVE_WITH_KNOTS',
  ...Object.keys(_KNOT_FORMS).filter((kind) => kind.endsWith('CURVE')),
])

/**
 * The coordinate systems, points and curves of the file that belong to no body, each at its place
 * in the assembly (mm, world coordinates), in file order.
 *
 * Coordinate systems are the placements of supplemental geometry
 * (`CONSTRUCTIVE_GEOMETRY_REPRESENTATION`) and the named placements of shape representations;
 * points and curves are the items of shape representations, also inside `GEOMETRIC_CURVE_SET`
 * and `GEOMETRIC_SET`. Items on hidden layers (`INVISIBILITY`) are left out.
 *
 * Each item is `{ kind: 'frame' | 'point' | 'curve', name, product, color, ... }` with `origin`,
 * `z` and `x` for a frame, `point` for a point, and `curve` (a curve as `_Interp.wireCurve` gives
 * it) for a curve.
 */
export function interpretExtras(sf: StepFile): Any[] {
  const it = new _Interp(sf)
  const [transforms, inProduct] = _representationTransforms(it)
  const productNames = _representationProductNames(sf)
  const hidden = _hiddenItems(sf)
  const reps = [..._repItems(sf).keys()].filter((r) => _geometryRepresentation(sf.typeOf(r)))
  const out: Any[] = []
  const placed = new Map<number, Matrix[]>() // item -> where it went already
  const inside = reps.filter((r) => inProduct.has(r))
  for (const rep of inside.length ? inside : reps) {
    const constructive = sf.typeOf(rep).includes('CONSTRUCTIVE_GEOMETRY')
    it.useUnits(rep)
    const found: [number, Any][] = []

    const take = (item: number, inherited: number[] | null, depth = 0): void => {
      if (hidden.has(item) || !sf.entities.has(item)) return
      const [t, a] = sf.get(item)
      const name = _itemName(sf, item)
      const color = it.colors.get(item) ?? inherited
      if (t === 'AXIS2_PLACEMENT_3D' && (_strip(name) || constructive)) {
        const [o, z, x] = it.axis2(item)
        found.push([item, { kind: 'frame', name, color, origin: o, z, x }])
      } else if (t === 'CARTESIAN_POINT') {
        found.push([item, { kind: 'point', name, color, point: it.point(item) }])
      } else if ((t === 'GEOMETRIC_CURVE_SET' || t === 'GEOMETRIC_SET') && depth < 8) {
        for (const element of _iter(_at(a, 1))) if (element instanceof Ref) take(element.id, color, depth + 1)
      } else if (_CURVES.has(t) || (t.startsWith('COMPLEX:') && (sf.complex.get(item) as Map<string, StepValue[]>).has('B_SPLINE_CURVE'))) {
        let c: Any = null
        try {
          c = it.wireCurve(item)
        } catch (e) {
          // (Python's NotImplementedError, ValueError, KeyError, IndexError, TypeError)
          if (!(e instanceof NotImplementedError || e instanceof RangeError || e instanceof TypeError)) throw e
          c = null
        }
        if (c !== null) found.push([item, { kind: 'curve', name, color, curve: c }])
      }
    }

    for (const item of _representationItemList(sf, rep)) take(item, null)
    it.useUnits(null)
    for (const m of transforms.get(rep) ?? [_identity()]) {
      let largest = 0
      for (const v of m) if (Math.abs(v) > largest) largest = Math.abs(v)
      const atol = 1e-9 * (largest > 1.0 ? largest : 1.0)
      for (const [item, data] of found) {
        const where = placed.get(item) ?? []
        if (where.some((q) => m.every((v, i) => Math.abs(v - q[i]) <= atol))) continue // listed by two related representations: one item
        where.push(m)
        placed.set(item, where)
        out.push({ ..._moved(data, m), product: productNames.get(rep) ?? '' })
      }
    }
  }
  return out
}

function _geometryRepresentation(kind: string): boolean {
  return (kind.includes('SHAPE_REPRESENTATION') || kind.includes('CONSTRUCTIVE_GEOMETRY_REPRESENTATION')) && !kind.includes('RELATIONSHIP')
}

/** The items of a representation in the order the file lists them. */
function _representationItemList(sf: StepFile, rep: number): number[] {
  let [t, a] = sf.get(rep)
  if (t.startsWith('COMPLEX:')) {
    a = []
    for (const [kind, v] of sf.complex.get(rep) as Map<string, StepValue[]>) {
      if (kind.endsWith('REPRESENTATION') && v.length >= 2) {
        a = v
        break
      }
    }
  }
  if (a.length < 2 || !Array.isArray(a[1])) return []
  return a[1].filter((x): x is Ref => x instanceof Ref).map((x) => x.id)
}

function _itemName(sf: StepFile, ref: number): string {
  let [t, a] = sf.get(ref)
  if (t.startsWith('COMPLEX:')) a = (sf.complex.get(ref) as Map<string, StepValue[]>).get('REPRESENTATION_ITEM') ?? ['']
  return a.length && _isStr(a[0]) ? String(a[0]) : ''
}

/** Items made invisible: listed by INVISIBILITY themselves, by their styled item, or by a
 * presentation layer that is. */
function _hiddenItems(sf: StepFile): Set<number> {
  const out = new Set<number>()
  for (const eid of sf.ofType('INVISIBILITY')) {
    for (const ref of _iter(_at(sf.get(eid)[1], 0))) {
      if (!(ref instanceof Ref) || !sf.entities.has(ref.id)) continue
      const [t, a] = sf.get(ref)
      if (t === 'PRESENTATION_LAYER_ASSIGNMENT') {
        for (const x of _iter(_at(a, 2))) if (x instanceof Ref) out.add(x.id)
      } else if ((t === 'STYLED_ITEM' || t === 'OVER_RIDING_STYLED_ITEM') && _at(a, 2) instanceof Ref) out.add((a[2] as Ref).id)
      else out.add(ref.id)
    }
  }
  return out
}

/** `R @ p + t` of the 4 x 4 placement `m` (a point). */
function _place(m: Matrix, p: readonly number[]): number[] {
  return [0, 1, 2].map((r) => m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3])
}

/** `R @ d` of the 4 x 4 placement `m` (a direction). */
function _turn(m: Matrix, d: readonly number[]): number[] {
  return [0, 1, 2].map((r) => m[r * 4] * d[0] + m[r * 4 + 1] * d[1] + m[r * 4 + 2] * d[2])
}

/** An item's data placed by the 4 x 4 matrix `m` (a mirror keeps a frame's x and y and turns its z,
 * so it stays right-handed; a scale scales lengths). */
function _moved(data: Any, m: Matrix): Any {
  const out = { ...data }
  if (data.kind === 'frame') Object.assign(out, { origin: _place(m, data.origin), z: _unit(_normalTurn(m, data.z)), x: _unit(_turn(m, data.x)) })
  else if (data.kind === 'point') out.point = _place(m, data.point)
  else out.curve = _movedCurve(data.curve, m)
  return out
}

function _movedCurve(c: Any, m: Matrix): Any {
  const kind = c.kind
  const out = { ...c }
  if (kind === 'trimmed') {
    out.basis = _movedCurve(c.basis, m)
    out.trims = c.trims.map((x: Any) => ('point' in x ? { ...x, point: _place(m, x.point) } : x))
  } else if (kind === 'composite') {
    out.segments = c.segments.map(([s, same]: [Any, boolean]) => [_movedCurve(s, m), same])
  } else if (kind === 'bspline') {
    out.poles = (c.poles as number[][]).map((p) => _place(m, p))
  } else if (kind === 'line') {
    Object.assign(out, { origin: _place(m, c.origin), direction: _turn(m, c.direction) })
  } else {
    // circle, ellipse, hyperbola, parabola (the frame right-handed, its parameter running as it did)
    const s = _norm(_turn(m, c.x))
    Object.assign(out, { origin: _place(m, c.origin), z: _unit(_normalTurn(m, c.z)), x: _unit(_turn(m, c.x)) })
    if (Math.abs(s - 1.0) > 1e-12) for (const key of ['radius', 'r1', 'r2', 'a', 'b', 'focal']) if (key in c) out[key] = c[key] * s
  }
  return out
}

function _unit(v: readonly number[]): number[] {
  const n = _norm(v)
  return v.map((x) => x / n)
}

/** What a placement does to the normal of a frame (x by y): R, turned over where R mirrors. */
function _normalTurn(m: Matrix, d: readonly number[]): number[] {
  const det =
    m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8])
  const r = _turn(m, d)
  return det < 0 ? r.map((x) => -x) : r
}

function _unit3(v: readonly number[]): number[] {
  const n = _norm(v)
  return v.map((x) => x / n)
}

function _ptp(points: readonly (readonly number[])[]): number {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const p of points) for (let i = 0; i < 3; i++) (lo[i] = Math.min(lo[i], p[i])), (hi[i] = Math.max(hi[i], p[i]))
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
}

/** A whole circle or ellipse as a rational quadratic B-spline (9 poles), starting at its x and running
 * about its z. */
function _conicNurbs(c: Any): Any {
  const [o, z, x] = [c.origin as number[], c.z as number[], c.x as number[]]
  const y = _cross(z, x)
  const [r1, r2] = c.kind === 'circle' ? [c.radius, c.radius] : [c.r1, c.r2]
  const corners = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0]]
  const poles = corners.map(([a, b]) => [0, 1, 2].map((i) => o[i] + r1 * a * x[i] + r2 * b * y[i]))
  const w = Math.sqrt(0.5)
  return { kind: 'bspline', degree: 2, poles, knots: [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4], weights: [1, w, 1, w, 1, w, 1, w, 1] }
}

/** A B-spline curve dict of a curve the kernel makes (`make()`: a new curve, deleted after). */
function _kernelNurbs(make: () => number, what: string): Any {
  return kernelCall(what, () => {
    const curve = make()
    try {
      const d = ext.curve_data(curve, true)
      return {
        kind: 'bspline',
        degree: Math.trunc(d.degree),
        poles: Array.from(d.poles as Iterable<number[]>, (p) => [p[0], p[1], p[2]]),
        knots: Array.from(d.knots as Iterable<number>, Number),
        weights: d.weights === null ? null : Array.from(d.weights as Iterable<number>, Number),
      }
    } finally {
      ext.delete_curve(curve)
    }
  })
}

/** An OFFSET_CURVE_3D: each point moved `d` along tangent x `ref` (ISO 10303-42; IGES's offset curve,
 * 130, the same). The offset of a line is a line, of a circle about `ref` a circle; others are the
 * kernel's offset curve (SmOffsetCurve) over the whole basis (its parameters kept), as a NURBS within
 * 1e-9 of their size. `eid`: the entity, a STEP id or how a message names it (`'DE 7'`). */
export function _offsetCurve(basis: Any, d: number, ref: number[], eid: number | string, what = 'read STEP offset curve'): Any {
  eid = typeof eid === 'number' ? `#${eid}` : eid
  const kind = basis.kind
  ref = _unit3(ref)
  if (kind === 'line') {
    const n = _cross(_unit3(basis.direction), ref)
    if (!(_norm(n) > 1e-12)) throw new RangeError(`${eid}: the offset curve's reference direction runs along its line`)
    const u = _unit3(n)
    return { ...basis, origin: [0, 1, 2].map((i) => basis.origin[i] + d * u[i]) }
  }
  if (kind === 'circle' && Math.abs(Math.abs(_dot(_unit3(basis.z), ref)) - 1.0) <= 1e-12) {
    // (tangent x axis points out of the circle)
    const r = basis.radius + (_dot(_unit3(basis.z), ref) > 0 ? d : -d)
    if (r > 0) return { ...basis, radius: r }
  }
  if (kind === 'circle' || kind === 'ellipse') basis = _conicNurbs(basis)
  else if (kind !== 'bspline') throw new NotImplementedError(`an offset of a ${kind} (${eid})`)
  const poles = basis.poles as number[][]
  const size = _ptp(poles) + Math.abs(d)
  return _kernelNurbs(() => {
    const curve = _canonicalCurve(poles, basis.knots, basis.degree, basis.weights)
    try {
      return ext.offset_curve_3d(curve, d, ref, 1e-9 * Math.max(size, 1e-9))
    } finally {
      ext.delete_curve(curve)
    }
  }, what)
}

/** The curve in space of the curve `c` in the parameters of surface `srf` (ISO 10303-42's parameters:
 * lengths in the file's unit, `s` mm each; angles in its angle unit, `ang` radians each). On a plane,
 * and along a parameter line of a cylinder, cone, sphere or torus, the curve of its kind; on a B-spline
 * surface the kernel's curve on it, on the others a NURBS through 257 of its points, within 1e-9 of
 * their size. */
function _pcurveInSpace(srf: Any, c: Any, s: number, ang: number, eid: number): Any {
  const kind = srf.kind
  const ck = c.kind
  const lin = (a: readonly number[], f: number, b: readonly number[], g: number, base: readonly number[] = [0, 0, 0]) =>
    [0, 1, 2].map((i) => base[i] + f * a[i] + g * b[i])
  if (kind === 'plane') {
    const [o, z, x] = [srf.origin as number[], srf.z as number[], srf.x as number[]]
    const y = _cross(z, x)
    const at = (p: readonly number[]) => lin(x, s * p[0], y, s * p[1], o)
    const along = (v: readonly number[]) => lin(x, s * v[0], y, s * v[1])
    if (ck === 'line') return { kind: 'line', origin: at(c.origin), direction: along(c.direction) }
    if (ck === 'circle' || ck === 'ellipse') {
      const out = { ...c, origin: at(c.origin), z, x: _unit3(along(c.x)) }
      if (ck === 'circle') out.radius = c.radius * s
      else [out.r1, out.r2] = [c.r1 * s, c.r2 * s]
      return out
    }
    if (ck === 'bspline') return { ...c, poles: (c.poles as number[][]).map(at) }
    throw new NotImplementedError(`a ${ck} in the parameters of a plane (#${eid})`)
  }
  if (kind === 'bspline') {
    if (ck !== 'bspline') throw new NotImplementedError(`a ${ck} in the parameters of a B-spline surface (#${eid})`)
    const tol = 1e-9 * Math.max(_ptp(srf.poles as number[][]), 1e-9)
    const uv = { degree: c.degree, poles: c.poles, knots: Array.from(c.knots as Iterable<number>), weights: c.weights }
    const d = kernelCall('read STEP curve on a surface', () => ext.curve_on_surface(srf, uv, tol))
    return {
      kind: 'bspline',
      degree: Math.trunc(d.degree),
      poles: Array.from(d.poles as Iterable<number[]>, (p) => [p[0], p[1], p[2]]),
      knots: Array.from(d.knots as Iterable<number>, Number),
      weights: d.weights === null ? null : Array.from(d.weights as Iterable<number>, Number),
    }
  }
  if (!['cylinder', 'cone', 'sphere', 'torus'].includes(kind)) throw new NotImplementedError(`a curve in the parameters of a ${kind} surface (#${eid})`)
  const [o, z, x] = [srf.origin as number[], srf.z as number[], srf.x as number[]]
  const y = _cross(z, x)
  // (u is an angle; v an angle on spheres and tori)
  const vAngular = kind === 'sphere' || kind === 'torus'
  const uvOf = (p: readonly number[]): [number, number] => [p[0] * ang, p[1] * (vAngular ? ang : s)]
  const point = (u: number, v: number): number[] => {
    const e = lin(x, Math.cos(u), y, Math.sin(u))
    if (kind === 'cylinder') return lin(e, srf.radius, z, v, o)
    if (kind === 'cone') return lin(e, srf.radius + v * Math.tan(srf.semi_angle), z, v, o)
    if (kind === 'sphere') return lin(e, srf.radius * Math.cos(v), z, srf.radius * Math.sin(v), o)
    return lin(e, srf.major + srf.minor * Math.cos(v), z, srf.minor * Math.sin(v), o)
  }
  if (ck === 'line') {
    const [u0, v0] = uvOf(c.origin)
    const [du, dv] = [c.direction[0] as number, c.direction[1] as number]
    if (Math.abs(du) <= 1e-12 * Math.abs(dv)) {
      // u fixed: along v
      const e = lin(x, Math.cos(u0), y, Math.sin(u0))
      if (kind === 'cylinder' || kind === 'cone') {
        const p0 = point(u0, v0)
        const p1 = point(u0, v0 + 1.0)
        return { kind: 'line', origin: p0, direction: lin(p1, dv > 0 ? 1 : -1, p0, dv > 0 ? -1 : 1) }
      }
      const centre = kind === 'sphere' ? o : lin(e, srf.major, z, 0, o)
      const r = kind === 'sphere' ? srf.radius : srf.minor
      // (v runs from e up toward z: the circle of x = e, y = z runs that way about e x z)
      const normal = _cross(e, z).map((q) => q * (dv > 0 ? 1 : -1))
      return { kind: 'circle', origin: centre, z: normal, x: e, radius: r }
    }
    if (Math.abs(dv) <= 1e-12 * Math.abs(du)) {
      // v fixed: around the axis
      const p = point(0.0, v0)
      const h = _dot(lin(p, 1, o, -1), z)
      const r = _norm(lin(lin(p, 1, o, -1), 1, z, -h))
      if (!(r > 0)) throw new NotImplementedError(`a curve along a pole of a ${kind} (#${eid})`)
      return { kind: 'circle', origin: lin(z, h, z, 0, o), z: z.map((q) => q * (du > 0 ? 1 : -1)), x, radius: r }
    }
    throw new NotImplementedError(`a line across the parameters of a ${kind} (#${eid})`)
  }
  if (!['bspline', 'circle', 'ellipse'].includes(ck)) throw new NotImplementedError(`a ${ck} in the parameters of a ${kind} (#${eid})`)
  const spec = ck === 'bspline' ? c : _conicNurbs(c)
  const ks = spec.knots as number[]
  const [t0, t1] = [ks[spec.degree], ks[ks.length - spec.degree - 1]]
  const pts: number[][] = []
  for (let i = 0; i <= 256; i++) pts.push(point(...uvOf(bsplinePoint(spec, t0 + ((t1 - t0) * i) / 256))))
  const tol = 1e-9 * Math.max(_ptp(pts), 1e-9)
  return _kernelNurbs(() => ext.approximate_points(pts.flat(), 3, tol, [], [], false)[0], 'read STEP curve on a surface')
}

/** The surface an OFFSET_SURFACE of a plane, sphere, cylinder, cone or torus is, as the reader gives
 * surfaces (ISO 10303-42's normals of those point out of them: a sphere of radius r offset by d is the
 * sphere of radius r + d, a cone keeps its angle and gains d / cos(angle) at its placement); null for any
 * other surface, or an offset that passes through the axis or the centre. */
export function analyticOffset(srf: Any): Any | null {
  if (srf.kind !== 'offset') return null
  const basis = srf.basis
  const d = srf.distance as number
  const kind = basis.kind
  if (kind === 'plane') return { ...basis, origin: [0, 1, 2].map((i) => basis.origin[i] + d * basis.z[i]) }
  if ((kind === 'sphere' || kind === 'cylinder') && basis.radius + d > 0) return { ...basis, radius: basis.radius + d }
  if (kind === 'cone' && Math.abs(Math.cos(basis.semi_angle)) > 1e-12 && basis.radius + d / Math.cos(basis.semi_angle) >= 0)
    return { ...basis, radius: basis.radius + d / Math.cos(basis.semi_angle) }
  if (kind === 'torus' && basis.minor + d > 0 && basis.minor + d < basis.major) return { ...basis, minor: basis.minor + d }
  return null
}

// A placement that can mirror and scale (MAPPED_ITEM's target, a functionally defined transformation)
const _OPERATOR = 'CARTESIAN_TRANSFORMATION_OPERATOR_3D'

// Representations related without a placement: a part's B-rep, wireframe and supplemental geometry
// (coordinate systems, AP242) next to its main shape representation.
const _PLAIN_RELATIONSHIPS = ['SHAPE_REPRESENTATION_RELATIONSHIP', 'REPRESENTATION_RELATIONSHIP', 'CONSTRUCTIVE_GEOMETRY_REPRESENTATION_RELATIONSHIP']

/** The name of the product each shape representation belongs to, also for the representations
 * linked to a product's shape without a placement (a part's B-rep representation next to its main
 * shape representation). */
function _representationProductNames(sf: StepFile): Map<number, string> {
  const names = new Map<number, string>()
  for (const [, [t, a]] of sf.entities) {
    if (t !== 'SHAPE_DEFINITION_REPRESENTATION') continue
    try {
      const [, pds] = sf.get(_at(a, 0))
      const [pdt, pd] = sf.get(_at(pds, 2))
      if (!pdt.includes('PRODUCT_DEFINITION') || pdt.includes('SHAPE')) continue
      const [, pdf] = sf.get(_at(pd, 2))
      const [, prod] = sf.get(_at(pdf, 2))
      let name = ''
      for (const x of [_at(prod, 1), _at(prod, 0)]) {
        if (_isStr(x) && _strip(String(x))) {
          name = String(x)
          break
        }
      }
      if (name) names.set(_int(_at(a, 1)), name)
    } catch {
      continue
    }
  }
  for (let round = 0; round < 4; round++) {
    // follow chains of plain representation relationships
    let grew = false
    for (const [, [t, a]] of sf.entities) {
      if (_PLAIN_RELATIONSHIPS.includes(t) && a.length >= 4) {
        let r1: number
        let r2: number
        try {
          r1 = _int(a[2])
          r2 = _int(a[3])
        } catch (e) {
          if (e instanceof TypeError || e instanceof RangeError) continue
          throw e
        }
        for (const [x, y] of [
          [r1, r2],
          [r2, r1],
        ]) {
          if (!names.has(x) && names.has(y)) {
            names.set(x, names.get(y) as string)
            grew = true
          }
        }
      }
    }
    if (!grew) break
  }
  return names
}

function _owningRepresentations(sf: StepFile): Map<number, number[]> {
  const owner = new Map<number, number[]>()
  for (const [eid, [t, a]] of sf.entities) {
    if (t.endsWith('REPRESENTATION') && a.length >= 2 && Array.isArray(a[1])) {
      for (const item of a[1]) {
        if (item instanceof Ref) {
          const list = owner.get(item.id)
          if (list) list.push(eid)
          else owner.set(item.id, [eid])
        }
      }
    }
  }
  return owner
}

function _repItems(sf: StepFile): Map<number, Set<number>> {
  const items = new Map<number, Set<number>>()
  const refs = (list: StepValue[]) => new Set(list.filter((x): x is Ref => x instanceof Ref).map((x) => x.id))
  for (const [eid, [t, a]] of sf.entities) {
    if (t.endsWith('REPRESENTATION') && a.length >= 2 && Array.isArray(a[1])) items.set(eid, refs(a[1]))
  }
  for (const [eid, parts] of sf.complex) {
    for (const [kind, a] of parts) {
      if (kind.endsWith('REPRESENTATION') && a.length >= 2 && Array.isArray(a[1])) items.set(eid, refs(a[1]))
    }
  }
  return items
}

/**
 * World transforms of each representation, following the assembly structure, and the
 * representations that belong to the product structure (a product's shape, or linked to one).
 *
 * Exporters disagree on which side of a representation relationship is the parent, so the product
 * structure (NEXT_ASSEMBLY_USAGE_OCCURRENCE) decides where it can.
 */
function _representationTransforms(it: _Interp): [Map<number, Matrix[]>, Set<number>] {
  const sf = it.sf
  const items = _repItems(sf)
  // product definition -> its shape representation
  const pdRep = new Map<number, number>()
  for (const [, [t, a]] of sf.entities) {
    if (t === 'SHAPE_DEFINITION_REPRESENTATION') {
      try {
        const [dt, da] = sf.get(_at(a, 0))
        if (dt === 'PRODUCT_DEFINITION_SHAPE' && sf.typeOf(_at(da, 2)).includes('PRODUCT_DEFINITION')) pdRep.set(_int(da[2]), _int(_at(a, 1)))
      } catch {
        continue
      }
    }
  }
  // relationship -> [parent product definition, child product definition]
  const relProducts = new Map<number, [number, number]>()
  for (const [, [t, a]] of sf.entities) {
    if (t === 'CONTEXT_DEPENDENT_SHAPE_REPRESENTATION') {
      try {
        const [, pa] = sf.get(_at(a, 1))
        const [nt, na] = sf.get(_at(pa, 2))
        if (nt.includes('ASSEMBLY_USAGE_OCCURRENCE') || nt === 'PRODUCT_DEFINITION_USAGE') {
          relProducts.set(_int(_at(a, 0)), [_int(_at(na, 3)), _int(_at(na, 4))])
        }
      } catch {
        continue
      }
    }
  }

  const parentOf = new Map<number, [number, Matrix][]>()
  const link = (child: number, parent: number, m: Matrix): void => {
    const list = parentOf.get(child)
    if (list) list.push([parent, m])
    else parentOf.set(child, [[parent, m]])
  }

  for (const [eid, parts] of sf.complex) {
    const rr = parts.get('REPRESENTATION_RELATIONSHIP')
    if (parts.has('REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION') && rr !== undefined) {
      const r1 = _int(_at(rr, 2))
      const r2 = _int(_at(rr, 3))
      const tr = _at(parts.get('REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION'), 0)
      let child = r1 // CAx-IF convention
      let parent = r2
      const rel = relProducts.get(eid)
      if (rel !== undefined) {
        const [ppd, cpd] = rel
        if (pdRep.get(ppd) === r1 || pdRep.get(cpd) === r2) [child, parent] = [r2, r1]
      }
      const m = _itemTransform(it, tr, child, parent, items)
      if (m !== null) link(child, parent, m)
    }
  }
  for (const [eid, [t, a]] of sf.entities) {
    if (_PLAIN_RELATIONSHIPS.includes(t) && a.length >= 4) {
      const r1 = _int(a[2])
      const r2 = _int(a[3])
      // the representation that is a product's main shape is the parent
      const prodReps = new Set(pdRep.values())
      if (prodReps.has(r1) && !prodReps.has(r2)) link(r2, r1, _identity())
      else if (prodReps.has(r2) && !prodReps.has(r1)) link(r1, r2, _identity())
      else link(r2, r1, _identity())
    } else if (t === 'MAPPED_ITEM') {
      try {
        const [, ma] = sf.get(_at(a, 1)) // REPRESENTATION_MAP(origin, mapped representation)
        it.useUnits(_int(_at(ma, 1)))
        const origin = it.placementMatrix(_at(ma, 0))
        for (const [rep, its] of items) {
          if (its.has(eid)) {
            it.useUnits(rep)
            const mapped = _int(ma[1])
            link(mapped, rep, _matmul(it.placementMatrix(_at(a, 2)), _inv(origin)))
          }
        }
      } catch {
        continue
      }
    }
  }

  const cache = new Map<number, Matrix[]>()
  const world = (rep: number, depth = 0): Matrix[] => {
    const cached = cache.get(rep)
    if (cached !== undefined) return cached
    const parents = parentOf.get(rep)
    if (depth > 32 || parents === undefined) return [_identity()]
    const out: Matrix[] = []
    for (const [parent, m] of parents) for (const pm of world(parent, depth + 1)) out.push(_matmul(pm, m))
    const result = out.length ? out : [_identity()]
    cache.set(rep, result)
    return result
  }

  const productReps = new Set(pdRep.values())
  const linked = new Map<number, boolean>()
  const inProduct = (rep: number, depth = 0): boolean => {
    if (!linked.has(rep)) {
      linked.set(rep, false) // guards against cycles
      let yes = productReps.has(rep)
      if (!yes && depth < 32) {
        for (const [parent] of parentOf.get(rep) ?? []) {
          if (inProduct(parent, depth + 1)) {
            yes = true
            break
          }
        }
      }
      linked.set(rep, yes)
    }
    return linked.get(rep) as boolean
  }

  const transforms = new Map<number, Matrix[]>()
  for (const r of items.keys()) transforms.set(r, world(r))
  const placed = new Set<number>()
  for (const r of items.keys()) if (inProduct(r)) placed.add(r)
  return [transforms, placed]
}

/** Placement of the child representation in the parent's coordinates. */
function _itemTransform(it: _Interp, ref: StepValue, child: number, parent: number, items: Map<number, Set<number>>): Matrix | null {
  const sf = it.sf
  const [t, a] = sf.get(ref)
  if (it._parts(ref).has(_OPERATOR)) {
    // a functionally defined transformation: the operator maps the child into the parent
    try {
      it.useUnits(parent)
      return it.operatorMatrix(ref)
    } catch {
      return null
    } finally {
      it.useUnits(null)
    }
  }
  if (t !== 'ITEM_DEFINED_TRANSFORMATION') return null
  try {
    const i1 = _int(_at(a, 2))
    const i2 = _int(_at(a, 3))
    // item 2 lies in the parent's representation and item 1 in the child's (CAx-IF), unless the
    // representations' item lists say otherwise. A placement can be listed in both
    // representations (AutoCAD lists the identity placement in the root and in every part), so
    // the CAx-IF reading wins whenever the lists allow it.
    const pItems = items.get(parent) ?? new Set<number>()
    const cItems = items.get(child) ?? new Set<number>()
    let parentItem: number
    let childItem: number
    if (pItems.has(i2) && cItems.has(i1)) [parentItem, childItem] = [i2, i1]
    else if (pItems.has(i1) || cItems.has(i2)) [parentItem, childItem] = [i1, i2]
    else [parentItem, childItem] = [i2, i1]
    it.useUnits(parent)
    const m1 = it.placementMatrix(parentItem)
    it.useUnits(child)
    const m2 = it.placementMatrix(childItem)
    return _matmul(m1, _inv(m2))
  } catch {
    return null
  } finally {
    it.useUnits(null)
  }
}
