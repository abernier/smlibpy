// Fuzz runner for smlibwasm (the WebAssembly build), driven by run_wasm.py: the cases from START to
// END of CASES.json, with the parameters the Python run resolved (RESOLVED.json: edges, sizes,
// openings, distances), one JSON line per operation on stdout. A trap (the kernel crashed) ends
// this process with code 7, and the driver goes on in a new one.
//
// usage: node tools/fuzz/run_wasm.ts CASES.json RESOLVED.json START [END]
import { readFileSync, writeSync } from 'node:fs'
import { Box, Cone, Cylinder, Plane, Sphere, Torus, X, Y, Z, setGuardSeconds } from '../../js/src/index.ts'

// biome-ignore lint: shapes of the fuzz cases
type Any = any

const [casesPath, resolvedPath, startArg, endArg] = process.argv.slice(2)
const cases: Any[] = JSON.parse(readFileSync(casesPath, 'utf8'))
const resolved: Record<string, Any> = JSON.parse(readFileSync(resolvedPath, 'utf8'))
const start = Number(startArg)
const end = endArg ? Number(endArg) : cases.length
const AX: Record<string, Any> = { X, Y, Z }
setGuardSeconds(0) // (the kernel here: a trap is seen as one, as smlibpy's runner sees a crash)

function build(e: Any[]): Any {
  const t = e[0]
  if (t === 'box') return Box(e[1], e[2], e[3])
  if (t === 'cyl') return Cylinder(e[1], e[2])
  if (t === 'cone') return Cone(e[1], e[2], e[3])
  if (t === 'sph') return Sphere(e[1])
  if (t === 'tor') return Torus(e[1], e[2])
  if (t === 'rot') return build(e[1]).rotate(AX[e[2]], e[3])
  if (t === 'tr') return build(e[1]).translate(e[2], e[3], e[4])
  const a = build(e[1])
  const b = build(e[2])
  return t === 'fuse' ? a.fuse(b) : t === 'cut' ? a.cut(b) : a.intersect(b)
}

function metrics(p: Any): Any {
  const m: Any = {}
  try {
    m.nf = p.faces().length
    m.ne = p.edges().length
  } catch (e) {
    m.nf_err = String(e).slice(0, 80)
  }
  if (m.nf === 0) return { ...m, v: 0, valid: false, empty: true }
  try {
    m.valid = p.isValid()
  } catch (e) {
    m.valid_err = String(e).slice(0, 80)
  }
  try {
    m.v = p.volume
    m.a = p.area
  } catch (e) {
    m.v_err = String(e).slice(0, 120)
  }
  try {
    const bb = p.bbox()
    m.bb = [...bb.min.toArray(), ...bb.max.toArray()]
  } catch (e) {
    m.bb_err = String(e).slice(0, 80)
  }
  return m
}

function nearest(items: Any[], pts: number[][]): Any[] {
  return pts.map((p) => {
    let best: Any = null
    let bd = Infinity
    for (const s of items) {
      const c = s.center()
      const d = (c.x - p[0]) ** 2 + (c.y - p[1]) ** 2 + (c.z - p[2]) ** 2
      if (d < bd) {
        bd = d
        best = s
      }
    }
    return best
  })
}

let cid = ''
const say = (m: Any) => writeSync(1, JSON.stringify({ id: cid, ...m }) + '\n')

function op(name: string, fn: () => Any): Any {
  say({ rec: { op: name, start: true } })
  const t0 = performance.now()
  let rec: Any
  let p: Any = null
  try {
    p = fn()
    rec = { op: name, ok: true }
    if (p && typeof p === 'object' && typeof p.isValid === 'function') Object.assign(rec, metrics(p))
    else if (p && typeof p === 'object') Object.assign(rec, p)
  } catch (e: Any) {
    p = null
    const trap = e?.cause instanceof WebAssembly.RuntimeError || e instanceof WebAssembly.RuntimeError
    rec = { op: name, ok: false, err: e?.name ?? typeof e, msg: String(e?.message ?? e).slice(0, 300), trap }
  }
  rec.ms = Math.round((performance.now() - t0) * 10) / 10
  say({ rec })
  if (rec.trap) {
    say({ trapped: true })
    process.exit(7) // (the module may be damaged: the driver goes on in a new process)
  }
  return p
}

for (let i = start; i < end; i++) {
  const c = cases[i]
  cid = c.id
  const R = resolved[c.id] ?? {}
  say({ case_start: i })
  if (c.kind === 'csg') {
    const A = op('A', () => build(c.A))
    const B = op('B', () => build(c.B))
    if (A && B && A.isValid() && B.isValid()) {
      op('U', () => A.fuse(B))
      op('I', () => A.intersect(B))
      op('D', () => A.cut(B))
      op('E', () => B.cut(A))
      op('M', () => {
        const m = A.merge(B)
        const cs = m.cells()
        return { ncells: cs.length, cellv: cs.map((x: Any) => x.volume), mv: m.volume }
      })
    }
  } else {
    const P = op('base', () => build(c.base))
    if (P && P.isValid()) {
      if (c.kind === 'fillet' || c.kind === 'chamfer') {
        if (R.edges?.length) {
          const sel = nearest(P.edges(), R.edges)
          if (c.kind === 'fillet') op('F', () => P.fillet(sel, R.size))
          else op('C', () => P.chamfer(sel, R.size))
        }
      } else if (c.kind === 'shell') {
        if (R.t !== undefined) {
          const opens = R.faces?.length ? nearest(P.faces(), R.faces) : null
          op('S', () => P.shell(R.t, opens))
        }
      } else if (c.kind === 'offset') {
        if (R.d !== undefined) {
          const O = op('O', () => P.offset(R.d))
          if (O && R.d > 0) op('O2', () => O.offset(-R.d))
        }
      } else if (c.kind === 'slice') {
        const k = 'XYZ'.indexOf(c.axis)
        const n = [0, 0, 0]
        n[k] = 1
        if (c.tilt) n[(k + 1) % 3] = Math.tan((c.tilt * Math.PI) / 180)
        const o = [0, 0, 0]
        o[k] = c.at
        const pl = new Plane(o as Any, null, n as Any)
        op('above', () => P.split(pl, 'above'))
        op('below', () => P.split(pl, 'below'))
        op('sec', () => ({ sa: P.section(pl).area }))
      }
    }
  }
  say({ case_done: true })
}
