// Close-out of area W of the kernel plan (phase 1): what the review of 0.5.0 left open in the
// WebAssembly runtime. Methods and constructors that kept their intermediates until the garbage
// collector ran (W9), fallbacks that went on after a crash of the kernel (W10), a real
// out-of-memory of the module (W8), and the kernel's deadline, which holds a step that no probe
// worker runs (a page's main thread) to GUARD_SECONDS (W2).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

import {
  AnnularSector,
  Axis,
  Box,
  Circle,
  Cone,
  ConicArc,
  CounterBoreHole,
  CounterSinkHole,
  Cylinder,
  Helix,
  Hole,
  KernelError,
  Line,
  Location,
  Part,
  Plane,
  Polyline,
  Rectangle,
  Sphere,
  Spiral,
  Spline,
  Text,
  Torus,
  Wedge,
  Z,
  bendAllowance,
  blend,
  drawingViews,
  extrude,
  fill,
  fitCurve,
  flatPattern,
  fromUsd,
  memoryUsage,
  network,
  ruled,
  scope,
  stitch,
  surface,
  sweep,
  swing,
  thicken,
  toUsd,
  unroll,
} from '../src/index.ts'
import type { Edge, Face, Shell } from '../src/index.ts'
import { _reachable, ext, k, setWarningHandler } from '../src/kernel.ts'
import { _underDeadline } from '../src/defeature.ts'

// biome-ignore lint: internal fields, for the checks
type Any = any

const SRC = new URL('../src/', import.meta.url)
const WASM = new URL('../wasm/smlibwasm.wasm', import.meta.url)
const MB = 2 ** 20

/** Runs `code` (an ES module) in a Node process of its own; its output, which must be JSON. */
function run(code: string, timeout = 120_000): Record<string, Any> {
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout })
  assert.equal(out.status, 0, `${out.stdout}\n${out.stderr}`)
  return JSON.parse(out.stdout.trim().split('\n').at(-1) as string)
}

/** How many kernel objects `make` makes, and how many of them its result holds. */
function leftover(make: () => unknown): [number, number] {
  make() // (warm up: caches of the inputs)
  const mark = Box(1, 1, 1)
  const id = mark._h.id
  mark.dispose()
  const before = memoryUsage().handles
  const result = make()
  const made = memoryUsage().handles - before
  const held = [..._reachable(result)].filter((h) => h.id > id && h.alive).length
  return [made, held]
}

// ================================================================================ W9
test('methods and constructors leave only what they return, as in Python (W9)', () => {
  // Each kept one to 36 intermediate kernel objects until the garbage collector ran, which it does
  // only between tasks: 400 synchronous Sketch.revolve calls grew the module's memory by 267 MB,
  // although each result was disposed.
  const lathe = Rectangle(5, 5).translate(10, 0)
  const axis = new Axis([0, 0, 0], [0, 1, 0])
  const sq = Rectangle(5, 5)
  const plate = Box(100, 50, 2)
  const folded = plate.fold(new Axis([0, 0, 1], [0, 1, 0]), 90, { radius: 2 })
  const top = Box(10, 10, 10).faces().top().first
  const sheet = Rectangle(20, 20).faces()[0].toShell()
  const ring = Rectangle(4, 10).translate(12, 0).on(Plane.XZ)
  const disc = Circle(2).translate(10, 0)
  const outline = Circle(15)
  const ball = Sphere(10)
  const can = Cylinder(5, 10)
  const cube = Box(10, 10, 10)
  const holed = Box(10, 10, 10).cut(Cylinder(2, 20))
  const triangle = Polyline([0, 0, 0], [10, 0, 0], [5, 10, 3], [0, 0, 0])
  const dot = Circle(1)
  const line = Line([0, 0, 0], [10, 0, 0])
  const cases: [string, () => unknown][] = [
    ['Sketch.revolve', () => lathe.revolve(axis)],
    ['Sketch.revolve 180', () => disc.revolve(axis, 180)],
    ['Sketch.extrude taper', () => sq.extrude(5, { taper: 5 })],
    ['Sketch.extrude both', () => sq.extrude(5, { both: true })],
    ['Sketch.swing', () => ring.swing(outline)],
    ['swing', () => swing(ring, outline)],
    ['Sketch.sectionProperties', () => sq.sectionProperties()],
    ['Face.extrude', () => top.extrude(5)],
    ['Face.offset', () => top.offset(1)],
    ['Face.flipped', () => top.flipped()],
    ['Face.translate', () => top.translate(1, 0, 0)],
    ['thicken (a face)', () => thicken(sheet.faces()[0], 2)],
    ['Shell.thicken both', () => sheet.thicken(2, { both: true })],
    ['fill (three sides)', () => fill(triangle)],
    ['Part.partingLine', () => ball.partingLine(Z)],
    ['Part.silhouette', () => ball.silhouette(Z)],
    ['Part.outline', () => can.outline(Plane.XZ)],
    ['Part.outline hidden', () => cube.outline(Plane.XZ, { hidden: true })],
    ['Part.fold', () => plate.fold(new Axis([0, 0, 1], [0, 1, 0]), 90, { radius: 2 })],
    ['Part.flange', () => plate.flange(plate.edges().filter((e) => e.center().x > 49 && e.center().z > 0.9).first, 20, { radius: 2 })],
    ['Part.unfold', () => folded.unfold()],
    ['Face.wrap', () => can.faces().cylinders().first.wrap(dot)],
    ['Edge.through', () => line.through([5, 1, 0])],
    ['Box align', () => Box(10, 10, 10, { align: 'min' })],
    ['Cylinder align', () => Cylinder(3, 10, { align: 'min' })],
    ['Cone align', () => Cone(3, 1, 10, { align: 'min' })],
    ['Sphere align', () => Sphere(3, { align: 'min' })],
    ['Torus align', () => Torus(10, 2, { align: 'min' })],
    ['Wedge', () => Wedge(10, 10, 10, 2)],
    ['AnnularSector', () => AnnularSector(5, 10, 4, 90)],
    ['Hole', () => Hole(3, 10)],
    ['CounterBoreHole', () => CounterBoreHole(3, 5, 2, 10)],
    ['CounterSinkHole', () => CounterSinkHole(3, 6, 10)],
    ['drawingViews', () => drawingViews(holed)],
  ]
  for (const [name, make] of cases) {
    const [made, held] = leftover(make)
    assert.equal(made, held, `${name}: ${made} kernel objects made, ${held} in the result`)
  }
})

test('a synchronous loop of Sketch.revolve whose results are disposed stays flat (W9)', () => {
  // (the verification's loop: 400 calls grew the module's memory by 267 MB before)
  const lathe = Rectangle(5, 5).translate(10, 0)
  const axis = new Axis([0, 0, 0], [0, 1, 0])
  lathe.revolve(axis).dispose()
  const before = memoryUsage()
  let volume = 0
  for (let i = 0; i < 100; i++) {
    const part = lathe.revolve(axis)
    volume += part.volume
    part.dispose()
  }
  const after = memoryUsage()
  assert.equal(after.handles, before.handles)
  assert.ok(after.used - before.used < 256 * 1024, `${after.used - before.used} bytes kept`)
  assert.ok(Math.abs(volume / 100 - 2 * Math.PI * 10 * 25) < 1e-6) // (Pappus: the area 25 about a circle of radius 10)
})

// ================================================================================ W10
/** A real trap of the kernel: a read far beyond its memory (harmless: nothing is written). */
const TRAP = 'k.brep_face_count(0xf0000000)'

test('a step that falls back on other kernel calls stops at a crash of the kernel (W10)', () => {
  // A raycast that the kernel fails on a face asks the face's mesh instead, fitCurve takes the
  // curve through the points where the kernel's approximation fails, and decimate halves its step
  // where a trial fails. After a crash each went on on the memory the crash left (the warning was
  // the only sign); now the crash ends the step with its KernelError.
  const out = run(`
    import { Box, KernelError, fitCurve, memoryUsage, setWarningHandler } from ${JSON.stringify(new URL('index.ts', SRC).href)}
    import { k } from ${JSON.stringify(new URL('kernel.ts', SRC).href)}
    setWarningHandler(() => {})
    const tick = () => new Promise((r) => setTimeout(r, 0))
    const out = {}
    const box = Box(10, 10, 10)
    const mesh = box.mesh(0.01)
    const cases = [
      ['raycast', k, 'intersect_curve_face', () => box.raycast([0, 0, -20], [0, 0, 1])],
      ['fitCurve', k.ext, 'approximate_points', () => fitCurve([[0, 0, 0], [5, 3, 0], [10, 0, 0], [15, 2, 0]])],
      ['decimate', k.ext, 'decimate_triangles', () => mesh.decimate(null, { tolerance: 0.1 })],
    ]
    for (const [name, owner, fn, step] of cases) {
      const fine = step() // (before: what the step gives)
      out[name + ' fine'] = Array.isArray(fine) ? fine.length : fine.constructor.name
      const keep = owner[fn]
      let calls = 0
      owner[fn] = (...args) => { calls++; return ${TRAP} }
      const before = memoryUsage().crashes
      try { step(); out[name] = 'no error' } catch (e) {
        out[name] = [e instanceof KernelError, e.detail, calls, memoryUsage().crashes - before]
      }
      owner[fn] = keep
      await tick() // (the next task: the steps fall back again)
      const again = step()
      out[name + ' again'] = Array.isArray(again) ? again.length : again.constructor.name
    }
    console.log(JSON.stringify(out))`)
  const crash = 'the kernel crashed (memory access out of bounds)'
  // one call, one crash: the step ended there (before: the fallback ran, and the step gave a result)
  assert.deepEqual(out.raycast, [true, crash, 1, 1])
  assert.deepEqual(out.fitCurve, [true, crash, 1, 1])
  assert.deepEqual(out.decimate, [true, crash, 1, 1])
  assert.equal(out['raycast fine'], 2)
  assert.equal(out['raycast again'], 2)
  assert.equal(out['fitCurve again'], 'Edge')
  assert.equal(out['decimate again'], 'Mesh')
})

test('after a crash, the rest of the task falls back on nothing; the next task does (W10)', () => {
  const out = run(`
    import { KernelError, setWarningHandler } from ${JSON.stringify(new URL('index.ts', SRC).href)}
    import { k, _isCrash } from ${JSON.stringify(new URL('kernel.ts', SRC).href)}
    setWarningHandler(() => {})
    const out = { before: _isCrash(new KernelError('x', 'refused')) }
    try { ${TRAP} } catch (e) { out.trap = _isCrash(e) }
    out.same = _isCrash(new KernelError('x', 'refused')) // (in the task of the crash: any failure)
    await new Promise((r) => setTimeout(r, 0))
    out.next = _isCrash(new KernelError('x', 'refused'))
    console.log(JSON.stringify(out))`)
  assert.deepEqual(out, { before: false, trap: true, same: true, next: false })
})

// ================================================================================ W8
test('memory that runs out for real: the kernel fails with SM_ERR_OUT_OF_MEMORY, and works again once parts are disposed (W8)', () => {
  // The module's memory may grow to 4 GB, which a test cannot fill: here its file says 160 MB (the
  // limit in its memory section; a browser that refuses to grow it further does the same). The
  // kernel then runs out for real: an allocation fails. The module's reserve (js/cpp/bind_runtime.cpp)
  // lets the step that finds the memory used up finish, and the next one fails before the kernel
  // runs; without it the kernel threw std::bad_alloc in the middle of a sphere's surface cache, and
  // the destructors that ran while it unwound crashed and broke the allocator (in some memory
  // layouts the next Box crashed too).
  const out = run(`
    import { readFileSync } from 'node:fs'
    const bytes = new Uint8Array(readFileSync(new URL(${JSON.stringify(WASM.href)})))
    let p = 8
    const leb = () => { let r = 0, s = 0, x; do { x = bytes[p++]; r += (x & 0x7f) * 2 ** s; s += 7 } while (x & 0x80); return r }
    for (let done = false; p < bytes.length && !done;) {
      const id = bytes[p++]; const size = leb(); const body = p
      if (id === 5) { // the memory section: count, flags, then the minimum and maximum in pages of 64 kB
        leb(); leb(); leb(); const at = p; leb()
        const width = p - at, pages = 160 * 16
        for (let i = 0; i < width; i++) bytes[at + i] = ((pages >> (7 * i)) & 0x7f) | (i < width - 1 ? 0x80 : 0)
        done = true
      }
      p = body + size
    }
    const { init } = await import(${JSON.stringify(new URL('init.ts', SRC).href)})
    const { Box, Cylinder, KernelError, Sphere, memoryUsage, setWarningHandler } = await init({ wasmBinary: bytes })
    setWarningHandler(() => {})
    const parts = []
    let error = null
    for (let i = 0; i < 100000 && error === null; i++) {
      try { parts.push(Sphere(5)) } catch (e) { error = e }
    }
    const out = { made: parts.length, error: [error instanceof KernelError, error.status, error.message], heap: memoryUsage().heap, crashes: memoryUsage().crashes }
    for (const part of parts) part.dispose()
    await new Promise((r) => setTimeout(r, 0))
    out.after = Box(30, 20, 10).cut(Cylinder(4, 20)).volume
    out.used = memoryUsage().used
    console.log(JSON.stringify(out))`)
  assert.ok(out.made > 500, `${out.made} spheres before the memory ran out`)
  assert.equal(out.error[0], true)
  assert.equal(out.error[1], 'SM_ERR_OUT_OF_MEMORY')
  assert.match(out.error[2], /^Sphere failed \(SM_ERR_OUT_OF_MEMORY\): .*\(\d+ MB in use, the module's memory at 1[56]\d MB of at most 4096 MB\): dispose\(\) parts/)
  assert.ok(out.heap > 150 * MB && out.heap <= 160 * MB, `the memory grew to ${out.heap} bytes`)
  assert.equal(out.crashes, 0) // (the kernel did not run out in the middle of a step)
  assert.ok(Math.abs(out.after - 5497.3452) < 1e-4) // (the module works again)
  assert.ok(out.used < 16 * MB)
})

// ================================================================================ N5
// tools/parity.py's `capabilities()`: a step or more of each capability phase 1 added, made with
// smlibwasm under the same names and compared with smlibpy's numbers in tests/data/parity/golden.json
// (as lane_WN.test.ts compares its `cases`).
const GOLDEN = new URL('../../tests/data/parity/golden.json', import.meta.url)

/** tools/parity.py's `same_value`: numbers to `rel` of their size (at least 1e-9), integers and the rest exactly. */
function sameValue(a: unknown, b: unknown, rel = 1e-7, at = ''): string | null {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isInteger(a) && Number.isInteger(b)) return a === b ? null : `${at}: ${a} against ${b}`
    return Math.abs(a - b) <= 1e-9 + rel * Math.max(Math.abs(a), Math.abs(b)) ? null : `${at}: ${a} against ${b}`
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${at}: ${a.length} items against ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const d = sameValue(a[i], b[i], rel, `${at}[${i}]`)
      if (d !== null) return d
    }
    return null
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const [ka, kb] = [Object.keys(a).sort(), Object.keys(b).sort()]
    if (ka.join() !== kb.join()) return `${at}: keys ${ka} against ${kb}`
    for (const key of ka) {
      const d = sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], rel, `${at}.${key}`)
      if (d !== null) return d
    }
    return null
  }
  return a === b ? null : `${at}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`
}

const body = (b: Part) => {
  const box = b.bbox()
  return { volume: b.volume, area: b.area, faces: b.faces().length, edges: b.edges().length, valid: b.isValid(), bbox: [...box.min.toArray(), ...box.max.toArray()] }
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const lengths = (edges: Iterable<Edge>) => sum([...edges].map((e) => e.length))
const sheet = () => Rectangle(20, 20).faces()[0].toShell()
const rounded = () => Box(20, 20, 10).fillet(Box(20, 20, 10).edges().parallelTo(Z), 3)
const arc = () => Spline([0, 0, 0], [5, 3, 0], [10, 0, 0])
const holed = () => Box(20, 20, 10).cut(Cylinder(4, 10))
const folded = () => Box(100, 50, 2).fold(new Axis([0, 0, 1], [0, 1, 0]), 90, { radius: 2 })
const bump = () => surface(Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => [-15 + 10 * i, -15 + 10 * j, 3 * Math.sin(i + j)])))
const byName = (a: [string, number], b: [string, number]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1])

const CAPABILITIES: Record<string, () => unknown> = {
  // Booleans, cells and splits (B11, B12, B14, B15)
  classify: () => [[0, 0, 0], [5, 0, 0], [5, 5, 0], [5, 5, 5], [9, 0, 0]].map((p) => Box(10, 10, 10).classify(p)[0]),
  'split by a sheet': () => ({ volumes: Box(20, 20, 20).split(bump(), 'both').map((p) => p.volume) }),
  imprint: () => {
    const { volume, faces, edges } = body(Box(20, 20, 10).imprint(Cylinder(4, 30)))
    return { volume, faces, edges }
  },
  'cell sources': () =>
    Box(10, 10, 10).named('a').merge(Sphere(6).translate(5, 0, 0).named('b')).cells()
      .map((c): [string, number] => [(c.sources ?? []).map((s) => s.name).sort().join('&'), Math.round(c.volume * 1e6) / 1e6])
      .sort(byName),
  // fillets and chamfers (F6, F9, F10, F12)
  'fillet propagate': () => body(rounded().fillet(rounded().edges().filter((e) => e.center().z > 4.9).sortBy((e) => e.center().x).slice(0, 1), 1, { propagate: true })),
  'chamfer length2': () => body(Box(20, 20, 10).chamfer(Box(20, 20, 10).faces().top()[0].edges(), 2, { length2: 1, reference: Box(20, 20, 10).faces().top()[0] })),
  'fillet mitre': () => body(Box(20, 20, 10).fillet(Box(20, 20, 10).edges(), 2, { corners: 'mitre' })),
  'cone chamfer': () => body(Cylinder(5, 10).chamfer(Cylinder(5, 10).edges().filter((e) => e.geomType === 'circle' && e.center().z > 0), 1)),
  // shells, offsets and direct editing (O7, O9, O10, O12)
  'offset round': () => body(Box(10, 10, 10).offset(2, { corners: 'round' })),
  'shell round': () => body(Box(30, 30, 30).shell(-2, Box(30, 30, 30).faces().top(), { corners: 'round' })),
  'sheet offset': () => ({ area: sheet().offset(2).area, z: sheet().offset(2).bbox().min.z }),
  thicken: () => body(thicken(sheet(), 3, { both: true })),
  'move faces': () => body(Box(20, 20, 10).moveFaces(Box(20, 20, 10).faces().top(), [0, 0, 5])),
  'offset faces': () => body(holed().offsetFaces(holed().faces().filter((f) => f.geomType === 'cylinder'), 1)),
  // primitives, sweeps and extrusions (S3, S4, S7, S9, S12, S13)
  sectors: () =>
    [Cylinder(5, 10, { arcSize: 90 }).volume, Cone(5, 2, 10, { arcSize: 120 }).volume, Sphere(5, { arcSize3: 180 }).volume, Torus(10, 2, { majorAngle: 90 }).volume, AnnularSector(5, 10, 4, 90).volume]
      .map((x) => Math.round(x * 1e9) / 1e9),
  swing: () => body(swing(Rectangle(4, 10).translate(12, 0).on(Plane.XZ), Rectangle(30, 20, { fillet: 5 }))),
  'sweep twist': () => body(sweep(Rectangle(4, 2), Line([0, 0, 0], [0, 0, 30]), { twist: 90 })),
  'sweep scale': () => body(sweep(Circle(2), Line([0, 0, 0], [0, 0, 30]), { scale: [1, 0.5] })),
  'extrude taper round': () => body(Rectangle(20, 10).extrude(5, { taper: 10, corners: 'round' })),
  'revolve analytic': () => Rectangle(4, 6).translate(10, 0).revolve(new Axis([0, 0, 0], [0, 1, 0])).faces().map((f) => f.geomType).sort(),
  // curves and sketches (C2, C4, C5, C6, C7, C8, C9, C10, C14, C16, A5)
  'edge trim': () => ({ len: arc().trim(0.2, 0.7).length, t: arc().paramAtPoint([5, 2.5, 0]) }),
  'edge extend': () => arc().extend(3).length,
  intersections: () => Circle(5).edges()[0].intersections(Line([-10, 1, 0], [10, 1, 0])).map((p) => p.toArray()),
  'edge offset': () => arc().offset(1).length,
  'wire offset': () => Polyline([0, 0, 0], [10, 0, 0], [10, 10, 0]).offset(1).length,
  'fit curve': () => fitCurve(Array.from({ length: 20 }, (_, i) => [i, Math.sin(i / 3), 0]), { tolerance: 1e-3 }).length,
  curvature: () => ({ min: arc().minRadius(), at: arc().curvatureAt(0.3) }),
  'to arcs': () => Spline([0, 0, 0], [5, 3, 0], [10, 0, 0], [15, -2, 0]).toArcs(0.01).edges().length,
  conics: () => [ConicArc([0, 0, 0], [5, 5, 0], [10, 0, 0], 0.3).length, Spiral(2, 6, 3, Plane.XY).length],
  'edge through': () => Line([0, 0, 0], [10, 0, 0]).through([5, 2, 0]).length,
  'helix long': () => Helix(5, 400, 2).length,
  'section properties': () => {
    const s = Rectangle(20, 10).cut(Circle(2).translate(5, 0)).sectionProperties()
    return [s.area, ...s.centroid.toArray(), s.ixx, s.iyy, s.ixy]
  },
  // surfaces (U2, U4, U5, U6, U7, U8, U15)
  blend: () => {
    const a = ruled(Line([0, 0, 0], [10, 0, 0]), Line([0, 5, 0], [10, 5, 0]))
    const b = ruled(Line([0, 10, 4], [10, 10, 4]), Line([0, 15, 4], [10, 15, 4]))
    return blend(a.edges().sortBy((e) => e.center().y).at(-1) as Edge, b.edges().sortBy((e) => e.center().y)[0]).area
  },
  fill: () => fill(Polyline([0, 0, 0], [10, 0, 0], [10, 10, 3], [0, 10, 0], [0, 0, 0])).area,
  network: () =>
    network([Spline([0, 0, 0], [5, 0, 2], [10, 0, 0]), Spline([0, 10, 0], [5, 10, 2], [10, 10, 0])], [Spline([0, 0, 0], [0, 5, 1], [0, 10, 0]), Spline([10, 0, 0], [10, 5, 1], [10, 10, 0])]).area,
  'face extend': () => (Box(10, 10, 10).faces().top()[0] as Face).extend(2).area,
  push: () => body(Box(20, 20, 4).push(Box(20, 20, 4).faces().top()[0], [0, 0, 2], { by: 1 })),
  warp: () => body(Box(20, 20, 4).warp(Box(20, 20, 4).faces().top()[0], [[-5, -5, 2], [5, -5, 2], [5, 5, 2], [-5, 5, 2]], 1)),
  'surface report': () => {
    const points = Array.from({ length: 100 }, (_, n) => [Math.floor(n / 10), n % 10, Math.sin(Math.floor(n / 10) / 3) * Math.cos((n % 10) / 4)])
    const [, report] = surface(points, { report: true })
    return [report.maxDistance, report.rmsDistance]
  },
  stitch: () => (stitch(Box(10, 10, 10).faces().map((f) => f.toShell())) as Part | Shell).faces().length,
  // measuring (A2, A3, A6, C12, M4, M5)
  'closest points': () => {
    const c = Box(10, 10, 10).closestPoints(Sphere(2).translate(10, 10, 10))
    return [c.distance, ...c.point.toArray(), ...c.otherPoint.toArray()]
  },
  'face curvature': () => {
    const c = Sphere(5).faces()[0].curvatureAt([5, 0, 0])
    return [c.k1, c.k2]
  },
  inertia: () => [...Box(10, 20, 30).massProperties().inertiaAbout([5, 5, 5])[0]],
  project: () => lengths(Box(10, 10, 10).project(Circle(3).moved(new Location([0, 0, 20])).edges()[0])),
  wrap: () => lengths(Cylinder(5, 10).faces().filter((f) => f.geomType === 'cylinder')[0].wrap(Circle(1))),
  'outline hidden': () => {
    const [seen, hidden] = holed().outline(Plane.XZ, { hidden: true })
    return [seen.length, hidden.length, lengths(seen), lengths(hidden)]
  },
  'raycast many': () => Sphere(5).raycastMany([[0, 0, -20], [3, 0, -20], [6, 0, -20]], [0, 0, 1]).map((h) => (h ? h.distance : null)),
  // meshes (M6, M7, M8, M10, M11)
  'mesh decimate': () => Sphere(5).mesh(0.01).decimate(0.5).length,
  'mesh slices': () => Sphere(5).mesh(0.01).slices(3).map((s) => Math.round(sum([...s].map((w) => w.length)) * 1e6) / 1e6),
  'mesh to part': () => body(Box(10, 10, 10).mesh().toPart()),
  'max edge': () => Box(10, 10, 10).mesh(null, 15, { maxEdge: 3 }).length,
  'mesh mass': () => [Box(10, 10, 10).mesh().massProperties(1.0).mass, ...Box(10, 10, 10).mesh().centroid.toArray()],
  'drawing views': () => drawingViews(holed()).map((v) => [v.name, v.visible.length, v.hidden.length]),
  // sheet metal and deformations (D1, D3)
  'k factor din': () => flatPattern(folded(), { kFactor: 'din6935' }).size.toArray(),
  unroll: () => body(unroll(Cylinder(10, 5, { arcSize: 180 }).cut(Cylinder(9, 6)), { radius: 9.5 }) as Part),
  'bend allowance 270': () => bendAllowance(270, { radius: 2, thickness: 1 }),
}

test("smlibwasm gives smlibpy's numbers for the capabilities of phase 1, but for the known divergences (N5)", () => {
  // The parity test of lane WN covered 18 modelling steps of 0.4 and the first ones of 0.5; these
  // are one or more steps of each capability phase 1 added (tools/parity.py's capabilities()).
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'))
  assert.deepEqual(Object.keys(CAPABILITIES).sort(), Object.keys(golden.capabilities).sort())
  const differ: string[] = []
  for (const [name, make] of Object.entries(CAPABILITIES)) {
    let got: unknown
    try {
      got = scope(make)
    } catch (e) {
      got = { error: (e as Error).name, status: (e as KernelError).status ?? null }
    }
    const known = golden.known[name]
    const d = sameValue(got, known ? known.wasm : golden.capabilities[name], 1e-7, name)
    if (d !== null) differ.push(`${d}${known ? ` (a known divergence: ${known.why})` : ''}`)
  }
  assert.deepEqual(differ, [])
  assert.ok(Object.keys(CAPABILITIES).length >= 50)
})

// ================================================================================ W11
test('the options of the file functions, Part.deform, Hull and Locations are typed (W11)', () => {
  // They took Record<string, unknown> and unknown: a typo in an option of exportFile compiled and
  // failed at run time. Each line marked @ts-expect-error must fail to compile, and every other
  // line must compile (an unused @ts-expect-error is an error itself).
  const dir = mkdtempSync(join(tmpdir(), 'smlibwasm-types-'))
  const index = JSON.stringify(new URL('index.ts', SRC).pathname)
  const app = join(dir, 'app.ts')
  writeFileSync(app, `
import { Box, Circle, Hull, Lattice, Locations, Plane, Pos, type FileOptions, type HullItem, type LocationLike, exportFile, toFile } from ${index}
const part = Box(10, 10, 10)
toFile(part, 'a.step', { name: 'a' })
toFile(part, 'a.stl', { ascii: true, tolerance: 0.1 })
toFile(part, 'a.usda', { mesh: false })
const options: FileOptions = { ascii: false }
exportFile(part, '/tmp/x.smb', options)
part.export('/tmp/x.glb', { tolerance: 0.2 })
part.mesh().export('/tmp/x.stl', { ascii: true })
// @ts-expect-error
toFile(part, 'a.stl', { asci: true })
// @ts-expect-error
part.export('/tmp/x.step', { nmae: 'x' })
part.deform(new Lattice(part, [2, 2, 2]), { tolerance: 0.01 })
// @ts-expect-error
part.deform({ apply: (p: unknown) => p })
const items: HullItem[] = [Circle(10), Pos(60, 0).mul(Circle(6)), [0, 30], [[5, 5], [10, -20]]]
Hull(...items)
// @ts-expect-error
Hull('a lever')
const at: LocationLike[] = [Pos(1, 2, 3), Plane.XY, [5, 0, 0], part.faces().top()]
new Locations(...at)
// @ts-expect-error
new Locations('here')
`)
  const program = ts.createProgram([app], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true,
    noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true, types: ['node'],
  })
  const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName === app)
    .map((d) => `${d.file!.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)
  assert.deepEqual(errors, [])
})

// ================================================================================ W2
const cut = (): number => Box(10, 10, 10).cut(Cylinder(3, 20)).volume

/** Works (without a pause) for `ms` milliseconds. */
function spin(ms: number): void {
  const end = Date.now() + ms
  while (Date.now() < end);
}

test("the kernel's deadline stops its intersections and is cleared (W2)", () => {
  // Past the deadline, the loops of the kernel's surface and topology intersections give up
  // (SM_ERR_METHOD_FAILURE_QUITING, through the error paths they have), and so does every later test
  // of it until the deadline is set again; cleared, the kernel works as before.
  const good = cut()
  ext.set_deadline(1e-9)
  try {
    spin(2)
    assert.throws(cut, (e: Any) => {
      assert.ok(e instanceof KernelError)
      assert.equal(e.status, 'SM_ERR_METHOD_FAILURE_QUITING')
      assert.ok(e.trace.some((t: string) => t.includes('SmTopologyIntersector.cpp')), String(e.trace))
      return true
    })
    assert.equal(ext.deadline_passed(), true)
  } finally {
    ext.set_deadline(0)
  }
  assert.equal(ext.deadline_passed(), false)
  assert.equal(cut(), good)
})

test('a step that no probe worker runs is held to GUARD_SECONDS by the deadline (W2)', () => {
  // _underDeadline (smlibpy._guard.here): a step whose intersections gave up is a _KernelFault, as one
  // that did not finish in the probe worker; what it made after the deadline is freed.
  const good = cut()
  const late = <R>(work: () => R) => (): R => {
    spin(100) // (past the deadline)
    return work()
  }
  assert.throws(() => _underDeadline('test step', 0.05, late(cut)), { name: '_KernelFault', message: /^test step: the kernel did not finish within 0\.05 s/ })
  assert.equal(ext.deadline_passed(), false)
  assert.equal(_underDeadline('test step', 0.05, cut), good) // (in time)
  assert.equal(_underDeadline('test step', 0.05, late(() => Box(1, 2, 3).volume)), 6) // (late, but in no such loop)
  assert.equal(_underDeadline('test step', 0, late(cut)), good) // (no limit)
  // a body made after the deadline (a loop gave up, and another way made one) is dropped and freed
  let made = 0
  let dropped = 0
  const box = Box(5, 5, 5)
  const handles = memoryUsage().handles
  const used = memoryUsage().used
  assert.throws(() =>
    _underDeadline(
      'test step',
      0.05,
      late(() => {
        try {
          scope(cut)
        } catch {
          // (the loop gave up)
        }
        made = k.brep_copy(box._brep) as number
        return made
      }),
      (b) => {
        dropped = b
        ext.delete_brep(b)
      },
    ),
  )
  assert.ok(made > 0)
  assert.equal(dropped, made)
  assert.equal(memoryUsage().handles, handles)
  assert.ok(memoryUsage().used - used < 64 * 1024)
})

test('the enclosure round that loops returns at the deadline on a page\'s main thread (W2)', () => {
  // The kernel's patching of the enclosure example's outer bottom round ran for good on a page's main
  // thread, where no probe worker runs (it spends its time in a surface intersection of the feature
  // executive's Booleans). The deadline stops it now. In a process of its own, so that a hang fails
  // the test instead of stopping the suite.
  const out = run(`
    import { _giveUp } from ${JSON.stringify(new URL('_guard.ts', SRC).href)}
    import { setGuardSeconds } from ${JSON.stringify(new URL('defeature.ts', SRC).href)}
    import { model } from ${JSON.stringify(new URL('../examples/enclosure.ts', import.meta.url).href)}
    _giveUp('no probe worker (as on the main thread of a page)')
    setGuardSeconds(2)
    const box = model()[0]
    const round = box.faces().fillets().filter((f) => f.center().z < 2 && f.geomType === 'cylinder').slice(0, 1)
    const out = {}
    const t = Date.now()
    try {
      box.removeFillets(round)
      out.removed = true
    } catch (e) {
      out.refused = /could not take out 1 of the 1/.test(e.message)
      out.seconds = (Date.now() - t) / 1000
    }
    out.kept = box.removeFillets(round, { partial: true }).volume === box.volume
    console.log(JSON.stringify(out))`, 300_000)
  assert.equal(out.refused, true)
  assert.equal(out.kept, true)
  assert.ok(out.seconds >= 2 && out.seconds < 60, String(out.seconds))
})

// ================================================================================ N4
/** tools/oracles/usd_validator.py --nvidia (NVIDIA's validate_file, with OpenUSD) on `files`, by file
 *  name; null where no Python here has the validator. The Python is SMLIBPY_PYTHON, python3 or
 *  python, with the environment of this process (PYTHONPATH too). */
function nvidia(files: string[]): Record<string, Any> | null {
  const tool = fileURLToPath(new URL('../../tools/oracles/usd_validator.py', import.meta.url))
  for (const exe of [process.env.SMLIBPY_PYTHON, 'python3', 'python'].filter(Boolean) as string[]) {
    const out = spawnSync(exe, [tool, '--nvidia', '--json', ...files], { encoding: 'utf8', timeout: 1_800_000 })
    if (out.error || (out.status !== 0 && out.status !== 1)) continue // (no such Python, or no validator in it: 2)
    assert.ok(out.stdout.trim(), out.stderr)
    const found = JSON.parse(out.stdout.trim().split('\n').at(-1) as string) as Record<string, Any>
    return Object.fromEntries(Object.entries(found).map(([f, r]) => [f.split(/[\\/]/).at(-1), r]))
  }
  return null
}

/** The asset validator's messages but UsdAsciiPerformanceChecker's (large arrays in a text file). */
const general = (r: Any): string[] => r.asset.filter((m: string) => !m.includes('UsdAsciiPerformanceChecker'))

test("toUsd's files pass NVIDIA's own validator (N4)", (t) => {
  // lane_WN.test.ts runs the validator's rules on a shim of OpenUSD; this runs NVIDIA's validate_file
  // itself, where a Python has it (pip install "usd-validation-nvidia[usd]" on any platform, with the
  // submodule's BrepArray rules; or "usd-brep[validation]"). With SMLIBPY_REQUIRE_USD_VALIDATOR set (CI)
  // a missing validator fails the test. Every file passes the BrepArray rules, and of the general rules
  // only UsdAsciiPerformanceChecker complains; bodies read from other software and written again keep
  // what their files break of BA.465 (control points in the body's box), which the plan exempts.
  const dir = mkdtempSync(join(tmpdir(), 'smlibwasm-nvidia-'))
  const rounded = Box(20, 20, 20).fillet(Box(20, 20, 20).edges(), 3)
  const bodies: Record<string, Part | Shell> = {
    box: Box(10, 20, 30), ball: Sphere(5), ring: Torus(10, 3), cone: Cone(5, 2, 10), rounded, void: Box(10, 10, 10).cut(Sphere(2)),
    cells: Box(10, 10, 10).merge(Sphere(4).translate(0, 0, 5)), text: extrude(Text('Ab', 10), 2),
    sectors: Cylinder(5, 10, { arcSize: 90 }), names: Box(5, 5, 5), nurbs: rounded.toNurbs(),
  }
  for (const [name, body] of Object.entries(bodies)) {
    writeFileSync(join(dir, `${name}.usda`), toUsd(body.named(name === 'names' ? 'Grüße 1/2' : name), { mesh: false }))
  }
  writeFileSync(join(dir, 'two.usda'), toUsd([Box(10, 10, 10).named('a'), Sphere(3).translate(20, 0, 0).named('b')])) // (meshes)
  const lines = toUsd(Box(10, 10, 10), { mesh: false }) // (the schema's line edges, read and written again)
  writeFileSync(join(dir, 'lines.usda'), lines)
  writeFileSync(join(dir, 'lines_again.usda'), toUsd(fromUsd(lines) as Part, { mesh: false }))
  const samples = new URL('../../third_party/usd-brep/TestFiles/brep_validator/', import.meta.url)
  const foreign = ['Cube', 'cubeWithVoid', 'nonManifoldCubes', 'Cone_SmConnect_Brep', 'mouse']
  const said: string[] = []
  setWarningHandler((m) => said.push(m))
  try {
    for (const name of foreign) {
      const body = fromUsd(readFileSync(new URL(`${name}.usda`, samples), 'utf8')) as Part
      writeFileSync(join(dir, `re_${name}.usda`), toUsd(body, { mesh: false }))
    }
  } finally {
    setWarningHandler((m) => console.warn(m))
  }
  assert.ok(said.every((m) => m.includes('"/World/mouse"')), said.join('\n')) // (mouse.usda: gaps of 2e-3)
  const found = nvidia(readdirSync(dir).map((f) => join(dir, f)))
  if (found === null) {
    const why = 'NVIDIA\'s validator is not installed (pip install "usd-validation-nvidia[usd]" or "usd-brep[validation]")'
    if (process.env.SMLIBPY_REQUIRE_USD_VALIDATOR) assert.fail(`${why}, and SMLIBPY_REQUIRE_USD_VALIDATOR asks for it`)
    return t.skip(why)
  }
  const names = [...Object.keys(bodies), 'two', 'lines', 'lines_again', ...foreign.map((n) => `re_${n}`)]
  assert.deepEqual(Object.keys(found).sort(), names.map((n) => `${n}.usda`).sort())
  for (const [name, r] of Object.entries(found)) {
    assert.equal(r.breps, name === 'two.usda' ? 2 : 1, name)
    const codes = Object.fromEntries(Object.entries(r.codes).filter(([c]) => !(name.startsWith('re_') && c === 'BA.465')))
    assert.deepEqual([codes, general(r)], [{}, []], `${name}: ${r.messages.join('; ')}`)
  }
  assert.deepEqual([found['re_Cone_SmConnect_Brep.usda'].codes, found['re_mouse.usda'].codes], [{ 'BA.465': 1 }, { 'BA.465': 1 }])
})
