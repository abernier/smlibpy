// tests/test_lane_IX.py: lane IX of the kernel plan (ai/plan/kernel-deep-dive.md), STEP import and
// export, USD names. I3 O-rings, I4 cavities within the gaps of their faces, I5 stitching faces
// that do not share their edges, I6 one unreadable body, I7 assembly instances built once, I8 one
// integration per shell, I9 faces' parameter domains, I10 assemblies in exportStep, X3 non-ASCII
// names in USD.
import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Box,
  Cylinder,
  Edge,
  ModelingError,
  Part,
  Shell,
  ShapeList,
  Torus,
  X,
  Z,
  exportStep,
  fromStep,
  fromStepModel,
  fromUsd,
  importStep,
  load,
  setWarningHandler,
  stitch,
  toStep,
  toUsd,
} from '../src/index.ts'
import { KernelError, ext, k } from '../src/kernel.ts'
import { approx } from './_approx.ts'

function tmpPath(): string {
  return mkdtempSync(join(tmpdir(), 'smlibwasm-lane-ix-'))
}

/** Runs fn and gives back the warnings it made (those of mass properties left out). */
function warnings<T>(fn: () => T): [T, string[]] {
  const said: string[] = []
  setWarningHandler((m) => said.push(m))
  try {
    return [fn(), said.filter((m) => !m.includes('mass properties'))]
  } finally {
    setWarningHandler((m) => console.warn(m))
  }
}

/** A minimal AP214 file in millimeters around the numbered entities (the body is #99). */
function _step(entities: string[]): string {
  const head =
    "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\n" +
    "FILE_NAME('test','2026-01-01T00:00:00',(''),(''),'','','');\n" +
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n"
  const units = [
    '#900=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));',
    '#901=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));',
    '#902=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());',
    "#903=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNIT_ASSIGNED_CONTEXT((#900,#901,#902))REPRESENTATION_CONTEXT('',''));",
    "#904=ADVANCED_BREP_SHAPE_REPRESENTATION('',(#99),#903);",
  ]
  return `${head}${[...entities, ...units].join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`
}

/** The entities of a STEP text by number, in file order, and the text around them. */
function _entities(text: string): [string, Map<string, string>, string] {
  const [head, rest] = text.split('DATA;\n', 2)
  const [data, tail] = rest.split('ENDSEC;', 2)
  return [head, new Map(Array.from(data.matchAll(/#(\d+)=(.*?);\n/gs), (m) => [m[1], m[2]] as [string, string])), tail]
}

/** A STEP text in which no two faces share an edge or a vertex: each ORIENTED_EDGE gets an
 * EDGE_CURVE and VERTEX_POINTs of its own, the points moved by up to `gap`. */
function _unshared(text: string, gap: number): string {
  const [head, ents, tail] = _entities(text)
  const order = [...ents.keys()]
  const added: [number, string][] = []
  let next = Math.max(...order.map(Number)) + 1
  let count = 0
  const add = (s: string): number => {
    added.push([next, s])
    return next++
  }
  const copied = (v: string): number => {
    const p = ents.get(v)!.match(/VERTEX_POINT\('',#(\d+)\)/)![1]
    const xyz = ents.get(p)!.match(/CARTESIAN_POINT\('.*?',\((.*)\)\)/)![1].split(',').map(Number)
    const moved = xyz.map((c, j) => c + (gap * (((count * 7 + j * 3) % 5) - 2)) / 2)
    count++
    return add(`VERTEX_POINT('',#${add(`CARTESIAN_POINT('',(${moved.map((c) => c.toExponential(12).toUpperCase()).join(',')}))`)})`)
  }
  for (const i of order) {
    const m = ents.get(i)!.match(/ORIENTED_EDGE\('',\*,\*,#(\d+),(\.[TF]\.)\)/)
    if (!m) continue
    const [, v1, v2, c, sense] = ents.get(m[1])!.match(/EDGE_CURVE\('',#(\d+),#(\d+),#(\d+),(\.[TF]\.)\)/)!
    const a = copied(v1)
    const b = v1 === v2 ? a : copied(v2)
    ents.set(i, `ORIENTED_EDGE('',*,*,#${add(`EDGE_CURVE('',#${a},#${b},#${c},${sense})`)},${m[2]})`)
  }
  const body = order.map((i) => `#${i}=${ents.get(i)};\n`).join('') + added.map(([i, s]) => `#${i}=${s};\n`).join('')
  return `${head}DATA;\n${body}ENDSEC;${tail}`
}

/** A STEP text in which no two faces share an edge or a vertex: each face gets EDGE_CURVEs and
 * VERTEX_POINTs of its own (a seam stays one edge its face uses twice), the points of each copy
 * moved by up to `gap`. */
function _perFace(text: string, gap: number): string {
  const [head, ents, tail] = _entities(text)
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

// -- I3: O-rings ------------------------------------------------------------------------------------
/** An O-ring as OpenCASCADE writes it (R 4.5, r 0.5): one torus face, its seams on the tube circle
 * and on the outer equator, the frame a rounding error off the axes. The angle of its seam around
 * the tube comes out of atan2 as +6e-15, and the window the importer made of it, -359.99999999999994
 * to 0, the kernel refused. */
function _oring(): string {
  return _step([
    "#1=CARTESIAN_POINT('',(6.232587878746,-35.03807040626,6.235798942157));",
    "#2=VERTEX_POINT('',#1);",
    "#3=CARTESIAN_POINT('',(5.732587878746,-35.03807040626,6.235798942157));",
    "#4=DIRECTION('',(-2.775472858268E-17,-1.348103941297E-33,-1.));",
    "#5=DIRECTION('',(1.,5.551115123126E-17,-2.775472858268E-17));",
    "#6=AXIS2_PLACEMENT_3D('',#3,#4,#5);",
    "#7=CIRCLE('',#6,0.5);",
    "#8=SEAM_CURVE('',#7,(),.PCURVE_S1.);",
    "#9=EDGE_CURVE('',#2,#2,#8,.T.);",
    "#10=CARTESIAN_POINT('',(1.232587878746,-35.03807040626,6.235798942157));",
    "#11=DIRECTION('',(5.551115123126E-17,-1.,-1.925929944387E-34));",
    "#12=AXIS2_PLACEMENT_3D('',#10,#11,#5);",
    "#13=CIRCLE('',#12,5.);",
    "#14=SEAM_CURVE('',#13,(),.PCURVE_S1.);",
    "#15=EDGE_CURVE('',#2,#2,#14,.T.);",
    "#16=TOROIDAL_SURFACE('',#12,4.5,0.5);",
    "#17=ORIENTED_EDGE('',*,*,#9,.F.);",
    "#18=ORIENTED_EDGE('',*,*,#15,.T.);",
    "#19=ORIENTED_EDGE('',*,*,#9,.T.);",
    "#20=ORIENTED_EDGE('',*,*,#15,.F.);",
    "#21=EDGE_LOOP('',(#17,#18,#19,#20));",
    "#22=FACE_BOUND('',#21,.T.);",
    "#23=ADVANCED_FACE('',(#22),#16,.T.);",
    "#98=CLOSED_SHELL('',(#23));",
    "#99=MANIFOLD_SOLID_BREP('o-ring',#98);",
  ])
}

test('O-ring whose seam runs along the outer equator', () => {
  const ring = fromStep(_oring()) as Part
  assert.equal(ring.name, 'o-ring')
  assert.equal(ring.faces().length, 1)
  assert.ok(ring.isValid())
  approx(ring.volume, 2 * Math.PI ** 2 * 4.5 * 0.5 ** 2, 1e-9) // 22.2066
})

// -- I4: cavities whose faces leave gaps --------------------------------------------------------------
function _blockWithCavity(): string {
  const text = toStep(Box(40, 30, 20).cut(Box(20, 10, 10)).named('block'), { name: 'cavity' })
  assert.ok(text.includes('BREP_WITH_VOIDS'))
  return text
}

/** The cavity (the 20 x 10 x 10 box, built as a solid of its own) measures `off` more than it
 * integrates to inside the solid, its faces with `gaps`: as the cavities of the Kraken X60 motor,
 * whose void region came out 2.7 mm3 off of 195,950 with gaps of up to 1e-2. */
function _cavityMeasured(off: number, gaps: number): void {
  const props = Part.prototype._props
  mock.method(Part.prototype, '_props', function (this: Part, accuracy: number | null = null) {
    const p = props.call(this, accuracy)
    return Math.abs(p.volume - 2000) < 1e-6 ? { ...p, volume: p.volume + off, gaps } : p
  })
}

test('cavity within the gaps of its faces is a void region', (t) => {
  // 0.5 mm3 off: beyond the 1e-6 of the solid's volume the import asked (0.024), so both void builds
  // were refused and the cavities were subtracted (which failed on the motor after 18 s with "the
  // operands may touch"); within 2 x the gaps (4.0) it is the void region.
  const text = _blockWithCavity()
  _cavityMeasured(0.5, 1e-3)
  mock.method(Part.prototype, 'cut', () => {
    throw new Error('the cavity was subtracted')
  })
  t.after(() => mock.restoreAll())
  const part = fromStep(text) as Part
  assert.equal(part.faces().length, 12)
  approx(part.volume, 24000 - 2000, 1e-9)
})

test('cavity turned the wrong way is not taken', (t) => {
  // gaps so large that both orientations lie within the tolerance (2 x 0.6 x 2000 = 2400): the one
  // turned the wrong way adds the cavity, 4000 off, which is further from the right volume than from
  // the wrong one, and is refused; the right one (0 off) is taken.
  const text = _blockWithCavity()
  _cavityMeasured(0.0, 0.6)
  t.after(() => mock.restoreAll())
  const part = fromStep(text) as Part
  approx(part.volume, 22000, 1e-9)
  assert.ok(part.isValid())
})

test('cavity that cannot be built names the body', (t) => {
  const text = _blockWithCavity()
  _cavityMeasured(500.0, 0.0) // no void build is close enough: the Boolean decides
  mock.method(Part.prototype, 'cut', () => {
    throw new KernelError('cut', 'SM_ERR', 'SM_ERR', 'the operands may touch')
  })
  t.after(() => mock.restoreAll())
  assert.throws(
    () => fromStep(text, { strict: true }),
    (e: unknown) =>
      e instanceof ModelingError &&
      /body 'block' \(#\d+, product 'cavity'\): its cavities could not be built, neither as void regions nor by subtracting them \(cut failed/.test(e.message),
  )
})

// -- I5: faces that do not share their edges -----------------------------------------------------------
test('faces that share no edges are stitched', () => {
  const reference = Box(20, 10, 10).cut(Cylinder(3, 20))
  const text = _perFace(toStep(reference.named('block')), 0.0)
  const raw = fromStep(text, { heal: false }) as Part
  assert.ok(!raw.isValid())
  assert.equal(raw.edges().length, 28) // each face with its own edges, as in the file
  const [part, said] = warnings(() => fromStep(text) as Part)
  assert.ok(part.isValid())
  assert.deepEqual([part.faces().length, part.edges().length], [7, 14])
  approx(part.volume, reference.volume, 1e-9)
  assert.ok(said.some((m) => /faces of body 'block' \(#\d+, product 'part'\) did not share their edges; stitched them/.test(m)), said.join('\n'))
})

for (const gap of [1e-4, 1e-3]) {
  test(`faces with gaps of ${gap} between them are stitched`, () => {
    // every oriented edge with edges and vertices of its own, the vertices up to `gap` off (the
    // kernel's stitch joins them; the healer then gives the hole's face the seam it lacks)
    const text = _unshared(toStep(Box(20, 10, 10).cut(Cylinder(3, 20)).named('block')), gap)
    const [part, said] = warnings(() => fromStep(text) as Part)
    assert.ok(part.isValid())
    approx(part.volume, 2000 - Math.PI * 90, 20 * gap)
    assert.equal(said.length, 1)
    assert.match(said[0], /stitched them, closing gaps of up to/)
  })
}

test('planar faces with gaps are stitched', () => {
  const text = _perFace(toStep(Box(20, 10, 10).cut(Box(5, 5, 20)).named('pocket')), 1e-3)
  const [part] = warnings(() => fromStep(text) as Part)
  assert.ok(part.isValid())
  assert.deepEqual([part.faces().length, part.edges().length], [10, 24])
  approx(part.volume, 1750, 1e-3)
})

test('body that cannot be repaired says so', () => {
  // the hole's face with its vertices 1e-3 off its seam: stitched, it still covers nothing
  const text = _perFace(toStep(Box(20, 10, 10).cut(Cylinder(3, 20)).named('block')), 1e-3)
  const [part, said] = warnings(() => fromStep(text) as Part)
  assert.ok(!part.isValid())
  assert.ok(said.some((m) => /body 'block' \(#\d+, product 'part'\) is not a valid solid \(.*\); heal and stitching could not repair it/.test(m)), said.join('\n'))
})

test('sheet whose faces share no edges is sewn', () => {
  const box = Box(10, 10, 10)
  const sheet = stitch(box.faces().top()[0], box.faces().sortBy(X).at(-1)!) as Shell
  assert.deepEqual([sheet.faces().length, sheet.edges().length], [2, 7])
  const text = _perFace(toStep(sheet.named('sheet')), 1e-4)
  assert.equal((fromStep(text, { heal: false }) as Shell).edges().length, 8)
  const [back, said] = warnings(() => fromStep(text) as Shell)
  assert.ok(back instanceof Shell)
  assert.deepEqual([back.faces().length, back.edges().length], [2, 7])
  assert.ok(said.some((m) => m.includes('stitched 1 edges')), said.join('\n'))
})

// -- I6: one body that cannot be read --------------------------------------------------------------------
function _twoBodies(broken = true): [string, string] {
  let text = toStep([Box(10, 10, 10).named('a'), Box(5, 5, 5).cut(Cylinder(1, 10)).translate([20, 0, 0]).named('b')], { name: 'two' })
  const circles = [...text.matchAll(/#(\d+)=CIRCLE\(/g)].map((m) => m[1])
  const last = circles[circles.length - 1]
  // body b's last circle becomes a curve the reader does not know
  if (broken) text = text.replace(`#${last}=CIRCLE(`, `#${last}=OFFSET_CURVE_3D(`)
  return [text, last]
}

test('body that cannot be read is left out', () => {
  const [text, entity] = _twoBodies()
  const [part, said] = warnings(() => fromStep(text) as Part)
  assert.ok(part instanceof Part && part.name === 'a')
  approx(part.volume, 1000, 1e-9)
  assert.equal(said.length, 1)
  assert.match(
    said[0],
    new RegExp(`left out body 'b' \\(#\\d+, product 'two'\\): curve type OFFSET_CURVE_3D \\(#${entity}\\), which is not supported`),
  )
})

test('strict import throws for a body that cannot be read', () => {
  const [text, entity] = _twoBodies()
  const pattern = new RegExp(`body 'b' \\(#\\d+, product 'two'\\): curve type OFFSET_CURVE_3D \\(#${entity}\\)`)
  assert.throws(() => fromStep(text, { strict: true }), (e: unknown) => e instanceof ModelingError && pattern.test(e.message))
  assert.throws(() => fromStepModel(text, { strict: true }), (e: unknown) => e instanceof ModelingError && pattern.test(e.message))
})

test('readStep lists the bodies left out', () => {
  const [text, entity] = _twoBodies()
  const [model] = warnings(() => fromStepModel(text))
  assert.deepEqual(
    model.bodies.map((b) => b.name),
    ['a'],
  )
  assert.equal(model.skipped.length, 1)
  assert.match(model.skipped[0], new RegExp(`^body 'b' \\(#\\d+, product 'two'\\): curve type OFFSET_CURVE_3D \\(#${entity}\\), which is not supported$`))
  assert.equal(model.toString(), 'StepModel(1 bodies, 0 frames, 0 curves, 0 points, 1 skipped)')
})

test('body the kernel cannot build is left out', (t) => {
  const [text] = _twoBodies(false)
  const build = ext.build_brep
  mock.method(ext, 'build_brep', (faces: unknown[], ...rest: unknown[]) => {
    if (faces.length !== 6) throw new Error('build_brep failed: SM_ERR')
    return build(faces, ...rest)
  })
  t.after(() => mock.restoreAll())
  const [part, said] = warnings(() => fromStep(text) as Part)
  assert.equal(part.name, 'a')
  assert.match(said.join('\n'), /left out body 'b' \(#\d+, product 'two'\): import STEP failed \(SM_ERR\)/)
})

test('file none of whose bodies can be read throws', () => {
  const text = toStep(Cylinder(2, 5).named('c')).replaceAll('CIRCLE(', 'OFFSET_CURVE_3D(')
  warnings(() =>
    assert.throws(
      () => fromStep(text),
      (e: unknown) => e instanceof ModelingError && /no body of the file could be read: body 'c'/.test(e.message),
    ),
  )
})

// -- I7: instances of a product --------------------------------------------------------------------------
/** Two instances of one part in an assembly built the way AutoCAD writes it (see
 * step_import.test.ts). */
function _assemblyLikeAutocad(dir: string): string {
  const part = join(dir, 'part.step')
  exportStep(Box(20, 10, 4).named('plate'), part)
  const lines = readFileSync(part, 'utf8').split('DATA;\n')[1].split('ENDSEC;')[0].split('\n').filter((ln) => ln !== '')
  const drop = ['APPLICATION_', 'PRODUCT', 'SHAPE_DEFINITION_REPRESENTATION']
  const after = (ln: string) => ln.slice(ln.indexOf('=') + 1)
  const geometry = lines.filter((ln) => !drop.some((d) => after(ln).slice(0, 40).includes(d)))
  const absr = (lines.find((ln) => ln.includes('ADVANCED_BREP_SHAPE_REPRESENTATION')) as string).split('=')[0]
  const ctx = (lines.find((ln) => ln.includes('GEOMETRIC_REPRESENTATION_CONTEXT')) as string).split('=')[0]
  const placement = (n: number, origin: string, xDir: string): string[] => [
    `#${n}=CARTESIAN_POINT('',(${origin}));`,
    `#${n + 1}=DIRECTION('',(0.,0.,1.));`,
    `#${n + 2}=DIRECTION('',(${xDir}));`,
    `#${n + 3}=AXIS2_PLACEMENT_3D('',#${n},#${n + 1},#${n + 2});`,
  ]
  const product = (n: number, name: string, repItems: string): string[] => [
    `#${n}=PRODUCT('${name}','${name}','',(#1001));`,
    `#${n + 1}=PRODUCT_DEFINITION_FORMATION('','',#${n});`,
    `#${n + 2}=PRODUCT_DEFINITION('','',#${n + 1},#1002);`,
    `#${n + 3}=SHAPE_REPRESENTATION('',(${repItems}),${ctx});`,
    `#${n + 4}=PRODUCT_DEFINITION_SHAPE('','',#${n + 2});`,
    `#${n + 5}=SHAPE_DEFINITION_REPRESENTATION(#${n + 4},#${n + 3});`,
  ]
  const instance = (n: number, at: number): string[] => [
    `#${n}=ITEM_DEFINED_TRANSFORMATION('','',#1006,#${at});`,
    `#${n + 1}=(REPRESENTATION_RELATIONSHIP(' ',$,#1023,#1013)REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${n})SHAPE_REPRESENTATION_RELATIONSHIP());`,
    `#${n + 2}=NEXT_ASSEMBLY_USAGE_OCCURRENCE('','','',#1012,#1022,$);`,
    `#${n + 3}=PRODUCT_DEFINITION_SHAPE('','',#${n + 2});`,
    `#${n + 4}=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#${n + 1},#${n + 3});`,
  ]
  const e = [
    ...geometry,
    "#1000=APPLICATION_CONTEXT('automotive design');",
    "#1001=PRODUCT_CONTEXT('',#1000,'mechanical');",
    "#1002=PRODUCT_DEFINITION_CONTEXT('part definition',#1000,'design');",
    ...placement(1003, '0.,0.,0.', '1.,0.,0.'),
    ...product(1010, 'ASM', '#1006,#1033,#1043'),
    ...product(1020, 'PLATE', '#1006'),
    `#1026=SHAPE_REPRESENTATION_RELATIONSHIP('','',${absr},#1023);`,
    ...placement(1030, '90.,75.,10.', '1.,0.,0.'),
    ...placement(1040, '-50.,20.,0.', '0.,1.,0.'),
    ...instance(1050, 1033),
    ...instance(1060, 1043),
  ]
  const head =
    "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\n" +
    "FILE_NAME('asm','2026-01-01T00:00:00',(''),(''),'','','');\n" +
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n"
  return `${head}${e.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`
}

test('instances of a product are built once', (t) => {
  const text = _assemblyLikeAutocad(tmpPath())
  const build = ext.build_brep
  const calls = mock.method(ext, 'build_brep', (...args: unknown[]) => build(...args))
  t.after(() => mock.restoreAll())
  const parts = [...(fromStep(text) as ShapeList<Part>)].sort((p, q) => p.bbox().min.x - q.bbox().min.x)
  assert.equal(calls.mock.callCount(), 1) // (two instances)
  const [a, b] = [parts[0].bbox(), parts[1].bbox()]
  const near = (v: { toArray(): number[] }, w: number[]) => v.toArray().forEach((x, i) => approx(x, w[i], 0, 1e-6))
  near(a.min, [-55, 10, -2])
  near(a.max, [-45, 30, 2])
  near(b.min, [80, 70, 8])
  near(b.max, [100, 80, 12])
  assert.deepEqual(
    parts.map((p) => p.name),
    ['plate', 'plate'],
  )
  for (const p of parts) {
    assert.ok(p.isValid())
    approx(p.volume, 800, 1e-9)
  }
})

// -- I8: the checks of a shell ------------------------------------------------------------------------------
test('import integrates each shell once', (t) => {
  // _positive and _sound each asked the kernel for the volume, and isValid() once more: on a part of
  // 2079 faces 1.9 of 8.2 s. Now once per built shell.
  const box = Box(80, 60, 10)
  const plate = box.fillet(box.edges().parallelTo(Z), 8).cut(Cylinder(4, 20))
  const text = toStep(plate)
  const calls = mock.method(Part.prototype, '_kernelProps')
  t.after(() => mock.restoreAll())
  const part = fromStep(text) as Part
  assert.deepEqual(
    calls.mock.calls.map((c) => c.arguments[0]),
    [1e-4],
  )
  approx(part.volume, plate.volume, 1e-9)
})

// -- I9: the parameter domains of imported faces ----------------------------------------------------------
test('imported faces have a point inside', () => {
  // small patches of a torus: in the torus' whole parameter domain the kernel's search for a point
  // inside them found none, and Face.interiorPoint() and exportStep threw a raw Error
  const patch = Torus(10, 3).intersect(Box(1, 1, 1).translate([12.8, 0.3, 0]))
  const back = fromStep(toStep(patch)) as Part
  const tori = back.faces().filter((f) => f.geomType === 'torus')
  assert.equal(tori.length, 4)
  for (const f of tori) {
    assert.ok(back.distanceTo(f.interiorPoint()) < 1e-6) // on the part's boundary
    const [[, v0], [, v1]] = k.face_uv_domain(f._f)
    assert.ok(v1 - v0 < 180) // the face's own domain, not the torus' 360 degrees
  }
  approx((fromStep(toStep(back)) as Part).volume, patch.volume, 1e-7)
})

test('fillet size check does not leak kernel errors', () => {
  // The size check measures how far points of a rounded edge are from the other edges of its faces.
  // On this body the kernel finds no closest point on one of them, and the check threw a raw Error
  // (SmApiEdgeClosestPoint failed) instead of leaving that pair out.
  const path = new URL('../../third_party/usd-brep/TestFiles/pt_TestFiles/Fillet/fillet1019.smb', import.meta.url).pathname
  if (!existsSync(path)) return
  const part = load(path) as Part
  // (the edges by their ends: their centers cost seconds here)
  const between = (a: number[], b: number[]) => {
    const off = (e: Edge) => e.start.distanceTo(a) + e.end.distanceTo(b)
    return part.edges().reduce((x, y) => (off(x) <= off(y) ? x : y))
  }
  const edge = between([-24.917, 24.917, 5.523], [-19.856, 25.4, 0])
  const other = between([-24.917, -19.856, 5.523], [-20.337, -25.398, 0.023])
  assert.throws(
    () => other.distanceTo([-22.81907097071722, 25.316566421632405, 0.9536501645481591]),
    (e: unknown) => e instanceof KernelError && /distance failed/.test(e.message),
  )
  try {
    part.fillet(new ShapeList(edge), 0.2)
  } catch (e) {
    assert.ok(e instanceof ModelingError, String(e)) // (the kernel cannot round it: a KernelError says so)
  }
})

// -- I10: assemblies ---------------------------------------------------------------------------------------------
function _parts(): [Part, Part, Part] {
  const bracket = Box(60, 40, 8).cut(Cylinder(4, 10)).named('bracket').colored('steelblue')
  const cover = Box(60, 40, 2).translate([0, 0, 10]).named('Größe').colored('#d9925a')
  const bolt = Cylinder(2, 10).translate([20, 10, 0]).named('bolt')
  return [bracket, cover, bolt]
}

test('toStep writes an assembly of named products', () => {
  const [bracket, cover, bolt] = _parts()
  const text = toStep([bracket, cover, bolt, bolt], { assembly: true, name: 'fixture' })
  assert.deepEqual(
    [...text.matchAll(/=PRODUCT\('([^']*)'/g)].map((m) => m[1]),
    ['fixture', 'bracket', 'Gr\\X2\\00F600DF\\X0\\e', 'bolt'],
  )
  assert.equal(text.split('NEXT_ASSEMBLY_USAGE_OCCURRENCE(').length - 1, 4)
  assert.equal(text.split('CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(').length - 1, 4)
  assert.equal(text.split('MANIFOLD_SOLID_BREP(').length - 1, 3) // the bolt once, placed twice
  const back = fromStep(text) as ShapeList<Part>
  assert.deepEqual(
    back.map((p) => p.name),
    ['bracket', 'Größe', 'bolt', 'bolt'],
  )
  ;[bracket, cover, bolt, bolt].forEach((q, i) => {
    approx(back[i].volume, q.volume, 1e-9)
    back[i].bbox().min.toArray().forEach((x, j) => approx(x, q.bbox().min.toArray()[j], 0, 1e-9))
  })
  const color = back[0].color as number[]
  ;[70 / 255, 130 / 255, 180 / 255].forEach((c, i) => approx(color[i], c, 1e-9))
  assert.equal(back[3].color, null)
})

test('assembly in inches and with sheets', () => {
  const [bracket] = _parts()
  const skin = Box(20, 20, 1).faces().top()[0].toShell().translate([0, 0, 30]).named('skin')
  const text = toStep([bracket, skin], { assembly: true, unit: 'inch' })
  assert.ok(text.includes("MANIFOLD_SURFACE_SHAPE_REPRESENTATION('skin'"))
  const back = fromStep(text) as ShapeList<Part | Shell>
  assert.deepEqual(
    back.map((b) => b.constructor.name),
    ['Part', 'Shell'],
  )
  approx((back[0] as Part).volume, bracket.volume, 1e-9)
  approx(back[1].bbox().min.z, 30.5, 0, 1e-9)
})

test('one product stays the default', () => {
  const [bracket, cover] = _parts()
  const text = toStep([bracket, cover])
  assert.equal(text.split('=PRODUCT(').length - 1, 1)
  assert.ok(!text.includes('NEXT_ASSEMBLY_USAGE_OCCURRENCE'))
})

test('step names keep their characters', () => {
  const dir = tmpPath()
  const path = join(dir, 'names.step')
  exportStep([Box(1, 1, 1).named("a'b\\c Bügel 😀"), Box(1, 1, 1).translate([3, 0, 0]).named('部品')], path)
  const text = readFileSync(path, 'utf8')
  assert.ok([...text].every((c) => c === '\n' || (c >= ' ' && c <= '~')))
  assert.deepEqual(
    (importStep(path) as ShapeList<Part>).map((p) => p.name),
    ["a'b\\c Bügel 😀", '部品'],
  )
})

// -- X3: names in USD --------------------------------------------------------------------------------------------
test('usd names of any characters round trip', () => {
  const names = ['Größe', 'café', '部品', 'Bracket #1 (left)', 'quote " back \\ slash', 'plain_name', '1st']
  const parts = names.map((n, i) => Box(1, 1, 1).translate([3 * i, 0, 0]).named(n))
  const text = toUsd(parts)
  const prims = [...text.matchAll(/def BrepArray "([^"]*)"/g)].map((m) => m[1])
  assert.deepEqual(prims, ['Gr__e', 'caf_', '__', 'Bracket__1__left_', 'quote___back___slash', 'plain_name', '_1st'])
  assert.ok(text.includes('displayName = "Größe"') && text.includes('displayName = "quote \\" back \\\\ slash"'))
  assert.ok(!text.includes('displayName = "plain_name"')) // (a name that is a prim name needs none)
  assert.deepEqual(
    (fromUsd(text) as ShapeList<Part>).map((b) => b.name),
    names,
  )
})

test('usd names that map to one prim name stay apart', () => {
  const text = toUsd([Box(1, 1, 1).named('部品'), Box(1, 1, 1).translate([3, 0, 0]).named('名前')], { mesh: false })
  assert.deepEqual(
    [...text.matchAll(/def BrepArray "([^"]*)"/g)].map((m) => m[1]),
    ['__', '___1'],
  )
  assert.deepEqual(
    (fromUsd(text) as ShapeList<Part>).map((b) => b.name),
    ['部品', '名前'],
  )
})
