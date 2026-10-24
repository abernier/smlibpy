// tests/test_closeout_K2.py: close-out K2 of the kernel plan's phase 1 (ai/plan/kernel-deep-dive.md,
// "Not done"): memory errors and leaks of the kernel's offset, fillet, sweep and fill code
// (third_party/patches/README.md says what each patch changes). The WebAssembly heap never shrinks,
// so what the kernel lost is what memoryUsage().used keeps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Axis,
  Box,
  Circle,
  Cone,
  Cylinder,
  KernelError,
  Plane,
  Polyline,
  Rectangle,
  Spline,
  ThreePointArc,
  Vector,
  fill,
  fromStep,
  memoryUsage,
  scope,
  sweep,
  toStep,
} from '../src/index.ts'
import type { Face, Part } from '../src/index.ts'
import { ext, k } from '../src/kernel.ts'

/** Bytes the WebAssembly heap keeps per call of `make` (after one call to warm up). */
function perCall(make: () => unknown, calls = 10): number {
  scope(() => {
    make()
  })
  const before = memoryUsage().used
  for (let i = 0; i < calls; i++) {
    scope(() => {
      make()
    })
  }
  return (memoryUsage().used - before) / calls
}

function threeArcs() {
  const r = 10
  const s = r / Math.SQRT2
  return [ThreePointArc([r, 0, 0], [s, s, 0], [0, r, 0]), ThreePointArc([0, r, 0], [0, s, s], [0, 0, r]), ThreePointArc([0, 0, r], [s, 0, s], [r, 0, 0])]
}

function fiveSplines() {
  const pts = [0, 1, 2, 3, 4].map((i): [number, number, number] => [10 * Math.cos((2 * Math.PI * i) / 5), 10 * Math.sin((2 * Math.PI * i) / 5), 0])
  return pts.map((p, i) => {
    const q = pts[(i + 1) % 5]
    return Spline(p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, 2], q)
  })
}

for (const sides of [3, 5]) {
  test(`N-sided fills of ${sides} sides free their work arrays`, () => {
    // N_FillNSidedHole never freed its stack: 77 kB a fill of these three arcs, 23 kB of the five splines.
    const curves = sides === 3 ? threeArcs() : fiveSplines()
    const patch = fill(curves)
    assert.equal(patch.faces().length, sides)
    const bytes = perCall(() => fill(curves))
    assert.ok(bytes < 1024, `${bytes} bytes a fill`)
  })
}

test('fillets along tangent edges free the curves they join', () => {
  // The joined curves of a smooth sequence of edges belonged to no edge: 154 kB a fillet of a rounded plate's top run.
  const plate = Rectangle(40, 30, { fillet: 5 }).extrude(10)
  const edge = [...plate.edges()].filter((e) => e.center().z > 9.9 && e.geomType === 'line').sort((a, b) => b.length - a.length)[0]
  const rounded = plate.fillet([edge], 1)
  assert.ok(rounded.isValid() && rounded.volume < plate.volume)
  const bytes = perCall(() => plate.fillet([edge], 1))
  assert.ok(bytes < 1024, `${bytes} bytes a fillet`)
})

test('refused fillets free their intersections and surfaces', () => {
  // A fillet refused at a corner (one edge of a run of tangent edges, propagate: false) lost the intersection
  // curves of sm_SrfSrfIntersection and the fillet surfaces of its solvers: 19.6 kB a refused fillet.
  const plate = Rectangle(40, 30, { fillet: 5 }).extrude(10)
  const edge = [...plate.edges()].filter((e) => e.center().z > 9.9 && e.geomType === 'line').sort((a, b) => b.length - a.length)[0]
  assert.throws(() => plate.fillet([edge], 1, { propagate: false }), KernelError)
  const bytes = perCall(() => {
    assert.throws(() => plate.fillet([edge], 1, { propagate: false }), KernelError)
  })
  assert.ok(bytes < 1024, `${bytes} bytes a refused fillet`)
})

test('mitered sweeps free their curves', () => {
  // The copies of the profile and the path per segment, the extended segments and the cutting lines: 10.5 kB a sweep.
  const make = (): Part => sweep(Circle(1).on(Plane.YZ), Polyline([0, 0, 0], [20, 0, 0], [20, 20, 0]))
  assert.ok(make().isValid())
  const bytes = perCall(make)
  assert.ok(bytes < 256, `${bytes} bytes a sweep`)
})

test('failed extended shells free the offset body', () => {
  // The offset body of a shell whose last Boolean failed was lost with the caches built on it: 1.08 MB for these three calls.
  const steps: [Part, number[], number][] = []
  for (const [size, r, t] of [[[20, 20, 20], 2, 1], [[40, 30, 10], 1, 0.5], [[40, 30, 10], 2, 1]] as const) {
    const b = Box(size[0], size[1], size[2])
    const f = b.fillet(b.edges(), r)
    steps.push([f, [...f.faces().top()].map((x) => (x as Face)._f), t])
  }
  let failed = 0
  const shells = (): void => {
    for (const [b, top, t] of steps) {
      try {
        ext.delete_brep(k.shell_brep(b._brep, -t, { extended_offset: true, faces_to_shell: top }))
      } catch {
        failed++
      }
    }
  }
  const bytes = perCall(shells, 5)
  assert.ok(failed > 0, 'no shell failed')
  assert.ok(bytes < 16 * 1024, `${bytes} bytes for three shells`)
})

/** A STEP text in which no two faces share an edge or a vertex (as tests/test_lane_IX.py's _per_face). */
function perFace(text: string, gap: number): string {
  const [head, rest] = text.split('DATA;\n', 2)
  const [data, tail] = rest.split('ENDSEC;', 2)
  const ents = new Map(Array.from(data.matchAll(/#(\d+)=(.*?);\n/gs), (m) => [m[1], m[2]] as [string, string]))
  const order = [...ents.keys()]
  const added: [number, string][] = []
  let next = Math.max(...order.map(Number)) + 1
  let count = 0
  const add = (s: string): number => {
    added.push([next, s])
    return next++
  }
  for (const f of order) {
    if (!ents.get(f)!.startsWith('ADVANCED_FACE')) continue
    const vcopy = new Map<string, number>()
    const ecopy = new Map<string, number>()
    const vertex = (v: string): number => {
      if (!vcopy.has(v)) {
        const p = ents.get(v)!.match(/VERTEX_POINT\('',#(\d+)\)/)![1]
        const xyz = ents.get(p)!.match(/CARTESIAN_POINT\('.*?',\((.*)\)\)/)![1].split(',').map(Number)
        const moved = xyz.map((c, j) => c + (gap * (((count * 7 + j * 3) % 5) - 2)) / 2)
        count++
        const point = add(`CARTESIAN_POINT('',(${moved.map((c) => c.toExponential(12).toUpperCase()).join(',')}))`)
        vcopy.set(v, add(`VERTEX_POINT('',#${point})`))
      }
      return vcopy.get(v) as number
    }
    const bounds = ents.get(f)!.match(/ADVANCED_FACE\('[^']*',\(([^)]*)\)/)![1].replaceAll('#', '').split(',')
    for (const b of bounds) {
      const loop = ents.get(b)!.match(/FACE(?:_OUTER)?_BOUND\('[^']*',#(\d+)/)![1]
      const uses: string[] = []
      for (const oe of ents.get(loop)!.match(/EDGE_LOOP\('[^']*',\(([^)]*)\)/)![1].replaceAll('#', '').split(',')) {
        const m = ents.get(oe)!.match(/ORIENTED_EDGE\('',\*,\*,#(\d+),(\.[TF]\.)\)/)!
        const e = m[1]
        if (!ecopy.has(e)) {
          const [, v1, v2, c, sense] = ents.get(e)!.match(/EDGE_CURVE\('',#(\d+),#(\d+),#(\d+),(\.[TF]\.)\)/)!
          ecopy.set(e, add(`EDGE_CURVE('',#${vertex(v1)},#${vertex(v2)},#${c},${sense})`))
        }
        uses.push(`#${add(`ORIENTED_EDGE('',*,*,#${ecopy.get(e)},${m[2]})`)}`)
      }
      ents.set(loop, `EDGE_LOOP('',(${uses.join(',')}))`)
    }
  }
  const body = order.map((i) => `#${i}=${ents.get(i)};\n`).join('') + added.map(([i, s]) => `#${i}=${s};\n`).join('')
  return `${head}DATA;\n${body}ENDSEC;${tail}`
}

test('face copies the kernel cannot build are freed, not kept', () => {
  // A face of an imported body whose faces share no edges and whose vertices lie 1e-3 apart cannot be
  // copied; the copies the kernel failed on were kept for the life of the module (82 kB a failed copy).
  const text = perFace(toStep((Box(20, 10, 10).cut(Cylinder(3, 20))).named('block')), 1e-3)
  const body = fromStep(text, { heal: false }) as Part
  const bad = [...body.faces()].filter((f) => {
    try {
      scope(() => (f as Face).toShell())
      return false
    } catch (e) {
      assert.ok(e instanceof KernelError, String(e))
      return true
    }
  })
  assert.ok(bad.length >= 1, 'no face failed to copy')
  const face = bad[0] as Face
  const bytes = perCall(() => {
    assert.throws(() => face.toShell(), KernelError)
  }, 10)
  assert.ok(bytes < 2048, `${bytes} bytes a failed copy`)
})

test('the all-edge fillet of two cones fails cleanly', () => {
  // The kernel's Boolean inside the fillet took out an Edge between the two sides of one Face and wrote
  // into the Edgeuses it had freed (fuzz case fillet-7-185): refused now, the fillet raises; smaller radii round.
  const part = Cone(3, 0, 10).rotate(new Axis([0, 0, 0], [0, 1, 0]), 90).cut(Cone(1.5, 0, 8).rotate(new Axis([0, 0, 0], [1, 0, 0]), 90).translate(0, 1, 0))
  const keys: [number, number, number][] = [[-5, 0, 3], [-0.89404, 1.76821, 0], [-0.26627, -1.57988, 0]]
  const edges = keys.map((p) => [...part.edges()].sort((a, b) => a.center().sub(new Vector(...p)).length - b.center().sub(new Vector(...p)).length)[0])
  assert.throws(() => part.fillet(edges, 0.721755), KernelError)
  const rounded = part.fillet(edges, 0.3)
  assert.ok(rounded.isValid() && Math.abs(rounded.volume - 90.0851) < 2e-3, String(rounded.volume))
})
