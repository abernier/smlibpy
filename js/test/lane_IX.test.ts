// tests/test_lane_IX.py: lane IX of the kernel plan (ai/plan/kernel-deep-dive.md), STEP import and
// export, USD names. I3 O-rings, I4 cavities within the gaps of their faces, I5 stitching faces
// that do not share their edges, I6 one unreadable body, I7 assembly instances built once, I8 one
// integration per shell, I9 faces' parameter domains, I10 assemblies in exportStep, X3 non-ASCII
// names in USD, I11 offset surfaces in exportStep, I12 curves, points and coordinate systems in
// exportStep, I13 the STEP uncertainty in any unit, X5 analytic edges in USD, X7 USD bodies that
// cannot be read, I14 IGES import, X9 SMLib part files (.smp) with names, colors and curves, X10 empty
// bodies, X11 files in memory, X12 USD material bindings, X13 bodies of mixed dimension.
import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Align,
  Box,
  CenterArc,
  Cone,
  Cylinder,
  Edge,
  EllipticalArc,
  Line,
  Location,
  ModelingError,
  Part,
  Plane,
  Polygon,
  Shell,
  ShapeList,
  Sphere,
  Spline,
  StepCurve,
  StepFrame,
  StepPoint,
  Torus,
  Vector,
  Vertex,
  Wire,
  X,
  Y,
  Z,
  exportStep,
  fromStep,
  fromStepModel,
  fromIges,
  fromUsd,
  importIges,
  importStep,
  importUsd,
  load,
  setWarningHandler,
  stitch,
  tessellate,
  toStep,
  toUsd,
  Circle,
  Rectangle,
  DEFAULT_FONT,
  Location as _Location,
  Text,
  exportFile,
  exportGlb,
  exportObj,
  exportStl,
  exportUsd,
  fromSmb,
  fromSmp,
  fromStl,
  loadFont,
  save,
  toGlb,
  toObj,
  toSmb,
  toSmp,
  toStl,
} from '../src/index.ts'
import { Axis, Ellipse, exportBrep, extrude, fromBrep, importBrep, loft, makeFace, toBrep } from '../src/index.ts'
import { KernelError, ext, k } from '../src/kernel.ts'
import { interpret, parse } from '../src/step_reader.ts'
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
  if (broken) text = text.replace(`#${last}=CIRCLE(`, `#${last}=CLOTHOID(`)
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
    new RegExp(`left out body 'b' \\(#\\d+, product 'two'\\): curve type CLOTHOID \\(#${entity}\\), which is not supported`),
  )
})

test('strict import throws for a body that cannot be read', () => {
  const [text, entity] = _twoBodies()
  const pattern = new RegExp(`body 'b' \\(#\\d+, product 'two'\\): curve type CLOTHOID \\(#${entity}\\)`)
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
  assert.match(model.skipped[0], new RegExp(`^body 'b' \\(#\\d+, product 'two'\\): curve type CLOTHOID \\(#${entity}\\), which is not supported$`))
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
  const text = toStep(Cylinder(2, 5).named('c')).replaceAll('CIRCLE(', 'CLOTHOID(')
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

// -- I11: offset surfaces ------------------------------------------------------------------------------------
const _PT = new URL('../../third_party/usd-brep/TestFiles/pt_TestFiles/', import.meta.url).pathname

function _kinds(body: Part | Shell): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of ext.brep_dump(body._brep, false).faces) out[f.kind] = (out[f.kind] ?? 0) + 1
  return out
}

/** A STEP text with the first surface that matches `pattern` replaced by an OFFSET_SURFACE of the
 * basis `make(match)` gives as `[entity, distance]`, written as other CAD systems write them. */
function _offsetOf(text: string, pattern: string, make: (m: RegExpMatchArray) => [string, number]): string {
  const [head, rest] = text.split('DATA;\n', 2)
  const [data, tail] = rest.split('ENDSEC;', 2)
  const n = Math.max(...Array.from(data.matchAll(/^#(\d+)=/gm), (m) => Number(m[1])))
  const m = data.match(new RegExp(`^#(\\d+)=${pattern};$`, 'm'))!
  const [basis, distance] = make(m)
  const body = data.replace(m[0], `#${m[1]}=OFFSET_SURFACE('',#${n + 1},${distance.toFixed(6)},.F.);`)
  return `${head}DATA;\n${body}#${n + 1}=${basis};\nENDSEC;${tail}`
}

const _CYL = String.raw`CYLINDRICAL_SURFACE\('',#(\d+),([-\d.E]+)\)`
const _cylinderOffset =
  (r0: number, d: number) =>
  (m: RegExpMatchArray): [string, number] => [`CYLINDRICAL_SURFACE('',#${m[2]},${r0.toFixed(6)})`, d]
const _OFFSETS: Record<string, [() => Part, string, (m: RegExpMatchArray) => [string, number]]> = {
  // a cylinder of radius 10 as an offset of radius 8 out (+2) and of 12 in (-2), the hole of a block
  // (its face points to the axis) as one of radius 3 and 5, a torus' tube, a cone, a sphere patch
  'cylinder out': [() => Cylinder(10, 20), _CYL, _cylinderOffset(8, 2)],
  'cylinder in': [() => Cylinder(10, 20), _CYL, _cylinderOffset(12, -2)],
  'hole out': [() => Box(20, 20, 10).cut(Cylinder(4, 10)), _CYL, _cylinderOffset(3, 1)],
  'hole in': [() => Box(20, 20, 10).cut(Cylinder(4, 10)), _CYL, _cylinderOffset(5, -1)],
  torus: [
    () => Torus(20, 5),
    String.raw`TOROIDAL_SURFACE\('',#(\d+),([-\d.E]+),([-\d.E]+)\)`,
    (m) => [`TOROIDAL_SURFACE('',#${m[2]},${m[3]},6.)`, -1],
  ],
  cone: [
    () => Cone(10, 5, 20),
    String.raw`CONICAL_SURFACE\('',#(\d+),([-\d.E]+),([-\d.E]+)\)`,
    (m) => [`CONICAL_SURFACE('',#${m[2]},${(Number(m[3]) - 1 / Math.cos(Number(m[4]))).toPrecision(17)},${m[4]})`, 1],
  ],
  'sphere patch': [
    () => Sphere(12).intersect(Box(10, 10, 10, { align: Align.MIN })),
    String.raw`SPHERICAL_SURFACE\('',#(\d+),([-\d.E]+)\)`,
    (m) => [`SPHERICAL_SURFACE('',#${m[2]},10.)`, 2],
  ],
}

for (const [name, [make, pattern, basis]] of Object.entries(_OFFSETS)) {
  test(`offset surfaces are written as offset surfaces (${name})`, () => {
    // An offset surface went to NURBS with its whole body (toNurbs fits offsets loosely). It is
    // written as OFFSET_SURFACE of its basis now, the distance turned where STEP's normal of the
    // basis runs against the kernel's (the hole, the torus' inner side).
    const plain = make()
    const part = fromStep(_offsetOf(toStep(plain), pattern, basis)) as Part
    assert.ok(part.isValid())
    assert.equal(_kinds(part).offset, 1)
    approx(part.volume, plain.volume, 1e-7 * plain.volume)
    const text = toStep(part)
    assert.equal(text.split('OFFSET_SURFACE(').length - 1, 1)
    assert.ok(!text.includes('B_SPLINE_SURFACE')) // (the basis analytic)
    const back = fromStep(text) as Part
    assert.ok(back.isValid())
    assert.deepEqual(_kinds(back), _kinds(part))
    approx(back.volume, part.volume, 1e-9 * part.volume)
    approx(back.area, part.area, 1e-9 * part.area)
  })
}

test('offset planes are written as offset surfaces', () => {
  // every face of a block as an offset of a parallel plane, some outward, some inward
  let text = toStep(Box(20, 10, 6))
  const planes = [...text.matchAll(/^#(\d+)=PLANE\('',#(\d+)\);$/gm)]
  planes.forEach((m, i) => {
    const ax = text.match(new RegExp(`^#${m[2]}=AXIS2_PLACEMENT_3D\\('',#(\\d+),#(\\d+),#(\\d+)\\);$`, 'm'))!
    const coords = (id: string, kind: string) =>
      text.match(new RegExp(`^#${id}=${kind}\\('',\\(([^)]*)\\)\\);$`, 'm'))![1].split(',').map(Number)
    const p = coords(ax[1], 'CARTESIAN_POINT')
    const z = coords(ax[2], 'DIRECTION')
    const d = i % 2 ? 1.5 : -2.5
    const q = p.map((c, k) => (c - d * z[k]).toPrecision(17)).join(',')
    const n = 10000 + 3 * i
    text = text.replace(
      m[0],
      `#${m[1]}=OFFSET_SURFACE('',#${n + 2},${d.toFixed(1)},.F.);\n#${n}=CARTESIAN_POINT('',(${q}));\n` +
        `#${n + 1}=AXIS2_PLACEMENT_3D('',#${n},#${ax[2]},#${ax[3]});\n#${n + 2}=PLANE('',#${n + 1});`,
    )
  })
  const part = fromStep(text) as Part
  assert.ok(part.isValid())
  assert.deepEqual(_kinds(part), { offset: 6 })
  approx(part.volume, 1200, 1e-9)
  const again = toStep(part)
  assert.equal(again.split('OFFSET_SURFACE(').length - 1, 6)
  const back = fromStep(again) as Part
  assert.ok(back.isValid())
  assert.deepEqual(_kinds(back), { offset: 6 })
  approx(back.volume, 1200, 1e-9)
})

for (const unit of ['mm', 'inch']) {
  test(`offset fillets of smb files round trip (${unit})`, () => {
    // vase.smb: four fillets on offset surfaces. The whole body went to NURBS: the volume changed by
    // 7.7e-3 and the planes came back as B-splines (11 B-spline faces), without a warning. Now the
    // faces keep their types, and the volume changes by what re-trimming the fillets costs.
    const path = `${_PT}Fillet/vase.smb`
    if (!existsSync(path)) return
    const vase = load(path) as Part
    assert.deepEqual(_kinds(vase), { bspline: 4, plane: 3, offset: 4 })
    const [text, said] = warnings(() => toStep(vase, { unit }))
    assert.deepEqual(said, []) // (no conversion, no warning)
    assert.equal(text.split('OFFSET_SURFACE(').length - 1, 4)
    const back = fromStep(text) as Part
    assert.ok(back.isValid())
    assert.deepEqual(_kinds(back), _kinds(vase))
    approx(back.volume, vase.volume, 1e-6 * vase.volume) // (0.4: 7.7e-3)
  })
}

test('bodies STEP cannot hold exactly are converted with a warning', (t) => {
  // A face STEP cannot hold as the kernel has it (here: an offset whose basis the dump does not
  // give) sends the body to NURBS, now with a warning.
  const path = `${_PT}Fillet/vase2.smb`
  if (!existsSync(path)) return
  const vase = (load(path) as Part).named('vase')
  const dump = ext.brep_dump
  mock.method(ext, 'brep_dump', (brep: number, geometry: boolean) => {
    const d = dump(brep, geometry)
    if (geometry) for (const f of d.faces) if (f.surface.kind === 'offset') delete f.surface.basis
    return d
  })
  t.after(() => mock.restoreAll())
  const [text, said] = warnings(() => toStep(vase))
  mock.restoreAll()
  assert.match(
    said.join('\n'),
    /export STEP: 'vase' has 4 faces on an offset of a surface of kind 'unknown', which STEP cannot hold .* written converted to NURBS/,
  )
  assert.ok(!text.includes('OFFSET_SURFACE'))
  const back = fromStep(text) as Part
  assert.ok(back.isValid())
  assert.equal(_kinds(back).offset, undefined)
  warnings(() => approx(back.volume, vase.volume, 1e-2 * vase.volume)) // (the approximated faces leave gaps)
})

test('imported cylinders are written as cylinders', () => {
  // The importer builds STEP cylinders as the kernel's cylinders, which the writer wrote as rational
  // B-splines (SMLib's own cylinders are cones of angle 0): a read and written file lost them.
  const part = fromStep(toStep(Box(20, 20, 10).cut(Cylinder(4, 10)))) as Part
  assert.deepEqual(_kinds(part), { plane: 6, cylinder: 1 })
  const text = toStep(part)
  assert.equal(text.split('CYLINDRICAL_SURFACE(').length - 1, 1)
  assert.ok(!text.includes('B_SPLINE_SURFACE'))
  const back = fromStep(text) as Part
  assert.deepEqual(_kinds(back), { plane: 6, cylinder: 1 })
  approx(back.volume, 20 * 20 * 10 - Math.PI * 16 * 10, 1e-9 * 4000)
  approx(back.faces().cylinders()[0].radius, 4, 1e-9)
})

// -- I12: curves, points and coordinate systems --------------------------------------------------------------
function _wireframeItems(): Any[] {
  const spline = Spline([
    [0, 0, 0],
    [5, 5, 2],
    [10, 0, 4],
    [15, 3, 0],
  ])
  const wire = new Wire([Line([0, 0, 0], [10, 0, 0]), Line([10, 0, 0], [10, 10, 0]), CenterArc([5, 10], 5, 0, 180)])
  const box = Box(10, 10, 10).named('box').colored('red')
  return [
    box,
    new StepCurve('cut', spline, '', [1, 0, 0]),
    Line([0, 0, 0], [10, 0, 0]),
    CenterArc([0, 0], 5, 30, 120).reversed(),
    EllipticalArc([0, 0], 6, 3, 10, 200),
    wire,
    box.edges().sortBy(Z)[0],
    CenterArc([0, 0], 4, 90, 360),
    new StepPoint('P1', new Vector(1, 2, 3), '', [0, 1, 0]),
    new Vertex(4, 5, 6),
    new Vector(7, 8, 9),
    new StepFrame('MCS', new Plane([1, 2, 3], [0, 1, 0], [1, 0, 0])),
    Plane.XZ,
  ]
}

for (const unit of ['mm', 'inch']) {
  test(`exportStep writes curves, points and frames (${unit})`, () => {
    // exportStep(Line(...)) threw "'Edge' object is not iterable"; readStep reads curves, points and
    // coordinate systems, but nothing wrote them.
    const items = _wireframeItems()
    const path = join(tmpPath(), 'wire.step')
    exportStep(items, path, { unit })
    const text = readFileSync(path, 'utf8')
    assert.ok(text.includes('GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION') && text.includes('GEOMETRIC_CURVE_SET'))
    assert.ok(text.includes("CONSTRUCTIVE_GEOMETRY_REPRESENTATION_RELATIONSHIP('supplemental geometry'"))
    const model = fromStepModel(text)
    assert.equal(String(model), 'StepModel(1 bodies, 2 frames, 7 curves, 3 points)')
    approx((model.bodies[0] as Part).volume, 1000, 1e-9)
    assert.equal(model.bodies[0].name, 'box')
    const curves = model.curves
    assert.deepEqual(
      curves.map((c) => c.name),
      ['cut', '', '', '', '', '', ''],
    )
    assert.ok(curves.every((c) => c.product === 'wire'))
    assert.deepEqual(curves[0].color, [1, 0, 0])
    assert.equal(curves[1].color, null)
    const originals = items.slice(1, 8).map((x) => (x instanceof StepCurve ? x.shape : x)) as (Edge | Wire)[]
    curves.forEach((c, i) => {
      const e = originals[i]
      assert.equal(c.shape.constructor, e.constructor)
      approx(c.shape.length, e.length, 1e-9 * e.length)
      assert.ok(c.shape.start.distanceTo(e.start) < 1e-9 && c.shape.end.distanceTo(e.end) < 1e-9)
      assert.ok(c.shape.pointAt(0.3).distanceTo(e.pointAt(0.3)) < 1e-7)
    })
    assert.equal((curves[4].shape as Wire).edges()[0].geomType, 'line')
    assert.equal((curves[3].shape as Edge).geomType, 'ellipse')
    assert.ok(curves[6].shape.isClosed)
    approx((curves[6].shape as Edge).radius, 4, 1e-9)
    const [p1, p2, p3] = model.points
    assert.equal(p1.name, 'P1')
    assert.ok(p1.point.isClose([1, 2, 3]))
    assert.deepEqual(p1.color, [0, 1, 0])
    assert.ok(p2.name === '' && p2.point.isClose([4, 5, 6]) && p3.point.isClose([7, 8, 9]))
    const [mcs, xz] = model.frames
    assert.equal(mcs.name, 'MCS')
    assert.ok(model.frame('MCS').equals(new Plane([1, 2, 3], [0, 1, 0], [1, 0, 0])))
    assert.ok(xz.name === '' && xz.plane.equals(Plane.XZ))
  })
}

test('exportStep writes a StepModel back', () => {
  // A readStep -> exportStep round trip lost everything that is not a body.
  const model = fromStepModel(toStep(_wireframeItems().slice(0, 9), { name: 'TOOL' }))
  assert.equal(String(model), 'StepModel(1 bodies, 0 frames, 7 curves, 1 points)')
  for (const assembly of [false, true]) {
    const again = fromStepModel(toStep(model, { name: 'KIT', assembly }))
    assert.equal(String(again), String(model))
    approx((again.bodies[0] as Part).volume, 1000, 1e-9)
    assert.deepEqual(
      again.curves.map((c) => [c.name, c.color, c.product]),
      model.curves.map((c) => [c.name, c.color, 'KIT']),
    )
    again.curves.forEach((c, i) => {
      approx(c.shape.length, model.curves[i].shape.length, 1e-9)
      assert.ok(c.shape.end.distanceTo(model.curves[i].shape.end) < 1e-9)
    })
    assert.ok(again.points[0].point.isClose(model.points[0].point))
  }
})

test('exportStep writes wireframe alone', () => {
  const model = fromStepModel(toStep([new StepCurve('path', Line([0, 0, 0], [0, 0, 10])), Plane.XY.offset(5)]))
  assert.equal(String(model), 'StepModel(0 bodies, 1 frames, 1 curves, 0 points)')
  approx(model.curves[0].shape.length, 10, 1e-12)
  assert.ok(model.frames[0].plane.origin.isClose([0, 0, 5]))
  // (a frame alone: a shape without items)
  assert.ok(fromStepModel(toStep(new StepFrame('CSW', Plane.YZ))).frame('CSW').equals(Plane.YZ))
  assert.throws(() => toStep([]), /nothing to write/)
})

test('exportStep assembly puts wireframe with its body', () => {
  const bracket = Box(60, 40, 8).named('bracket')
  const cover = Box(60, 40, 2).translate([0, 0, 10]).named('cover')
  const mcs = new StepFrame('MCS', new Plane([0, 0, 4]), 'bracket')
  const edge = new StepCurve('rim', Line([0, 0, 12], [60, 0, 12]), 'cover')
  const loose = new StepPoint('ref', new Vector(1, 1, 1))
  const model = fromStepModel(toStep([bracket, cover, mcs, edge, loose], { assembly: true, name: 'kit' }))
  assert.deepEqual(
    model.bodies.map((b) => b.name),
    ['bracket', 'cover'],
  )
  assert.deepEqual([model.frames[0].product, model.curves[0].product, model.points[0].product], ['bracket', 'cover', 'kit'])
  assert.ok(model.frame('MCS', 'bracket').origin.isClose([0, 0, 4]))
})

test('exportStep still refuses what it cannot write', () => {
  assert.throws(() => toStep(tessellate(Box(1, 1, 1))), (e: unknown) => e instanceof TypeError && /cannot write a Mesh to STEP/.test(e.message))
  assert.throws(() => toStep(new Location([1, 2, 3]) as never), (e: unknown) => e instanceof TypeError && /cannot write a Location to STEP/.test(e.message))
})

// -- I13: the uncertainty ------------------------------------------------------------------------------------
for (const [unit, perMm] of [
  ['mm', 1],
  ['cm', 0.1],
  ['m', 0.001],
  ['um', 1000],
  ['inch', 1 / 25.4],
] as [string, number][]) {
  test(`step uncertainty is the same length in any unit (${unit})`, () => {
    // 1e-7 was written in the file's unit: 1e-4 mm in a file in meters, 2.5e-6 mm in inches.
    const text = toStep(Box(1, 1, 1), { unit })
    const value = Number(text.match(/UNCERTAINTY_MEASURE_WITH_UNIT\(LENGTH_MEASURE\(([^)]*)\)/)![1])
    approx(value, 1e-7 * perMm, 1e-14 * value)
    const [[body]] = interpret(parse(text))
    approx(body.uncertainty as number, 1e-7, 1e-19) // (mm, as the reader converts it)
  })
}

// -- X5: analytic edges in USD ------------------------------------------------------------------------------
const _DATA = new URL('../../tests/data/', import.meta.url).pathname
const _USD_FILES = new URL('../../third_party/usd-brep/TestFiles/', import.meta.url).pathname

function _edgeKinds(body: Part | Shell): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of body.edges()) out[e.geomType] = (out[e.geomType] ?? 0) + 1
  return out
}

const _ROUND_TRIPS: [string, () => Part][] = [
  ['drilled', () => Box(20, 20, 10).cut(Cylinder(4, 20))],
  ['rounded', () => Box(20, 20, 10).fillet(Box(20, 20, 10).edges(), 2)],
  ['slanted', () => Cylinder(5, 30).cut(Box(40, 40, 40).rotate(Y, 30).translate([0, 0, 25]))], // (ellipses)
  ['chamfered', () => Box(20, 20, 10).chamfer(Box(20, 20, 10).edges().parallelTo(Z), 2)], // (straight B-splines)
]
for (const [name, make] of _ROUND_TRIPS) {
  test(`usd round trip keeps line, circle and ellipse edges (${name})`, () => {
    // Every edge was written as a B-spline: circles() came back empty, Edge.radius threw and STEP
    // wrote B-splines. Lines, circles and ellipses are written as the schema's analytic curves.
    const part = make()
    const text = toUsd(part.named(name), { mesh: false })
    const back = fromUsd(text) as Part
    assert.deepEqual(_edgeKinds(back), _edgeKinds(part))
    approx(back.volume, part.volume, 1e-12 * part.volume)
    assert.ok(back.isValid())
    assert.ok(back.bbox().max.equals(part.bbox().max))
    const radii = (p: Part) => p.edges().circles().map((e) => e.radius).sort((a, b) => a - b)
    assert.deepEqual(radii(back).map((r) => Math.round(r * 1e9)), radii(part).map((r) => Math.round(r * 1e9)))
    for (const [kind, api] of [['line', 'Line'], ['circle', 'Circle'], ['ellipse', 'Ellipse']]) {
      if (kind in _edgeKinds(part)) assert.ok(text.includes(`BrepCurve3d${api}API:edge3d${api}`), kind)
    }
    const step = toStep(back)
    const before = toStep(part)
    for (const entity of ['LINE(', 'CIRCLE(', 'ELLIPSE(']) assert.equal(step.split(entity).length, before.split(entity).length, entity)
  })
}

test('usd edges of curved b-spline faces stay b-splines', () => {
  // (a circle on a face the file has as a B-spline surface: its UV curve follows the B-spline's
  // parameters, which the schema's circle does not keep). The side is a surface of revolution of a
  // spline: revolves of lines and arcs give cylinders and cones now (lane S: S4).
  const outline = new Wire([Line([0, 0], [10, 0]), Spline([10, 0], [8, 6], [10, 12]), Line([10, 12], [0, 12]), Line([0, 12], [0, 0])])
  const part = makeFace(outline).revolve(Y)
  const back = fromUsd(toUsd(part, { mesh: false })) as Part
  approx(back.volume, part.volume, 1e-12 * part.volume)
  assert.ok(back.isValid())
  assert.deepEqual([...new Set(back.faces().map((f) => f.geomType))].sort(), ['bspline', 'plane'])
  assert.deepEqual(_edgeKinds(part), { circle: 2 })
  assert.deepEqual(_edgeKinds(back), { bspline: 2 })
})

test('usd reads lines and circles of b-spline edges', () => {
  // usd-brep and Omniverse write every edge as a B-spline: those that are lines, or circles on faces of
  // analytic surfaces, come back as lines and circles (smlibpy 0.4 wrote this block so, its lines
  // B-splines 2.5 km long)
  const back = importUsd(join(_DATA, 'usd_bspline_edges.usda')) as Part
  assert.deepEqual(_edgeKinds(back), { line: 12, circle: 2 })
  assert.deepEqual(back.edges().circles().map((e) => Math.round(e.radius * 1e9) / 1e9), [4, 4])
  approx(back.volume, 20 * 20 * 10 - Math.PI * 16 * 10, 1e-12 * 4000)
  assert.ok(back.isValid())
  assert.ok(back.bbox().max.equals(new Vector(10, 10, 5)))
})

test('usd-brep files get their lines back', { skip: !existsSync(_USD_FILES) }, () => {
  const cube = importUsd(join(_USD_FILES, 'brep_validator', 'Cube.usda')) as Part
  assert.deepEqual(_edgeKinds(cube), { line: 12 })
  assert.ok(cube.isValid())
  // (OpenCASCADE's cylinder of B-spline faces: its circles stay B-splines, its volume pi * 9 * 10)
  const [cylinder] = warnings(() => importUsd(join(_USD_FILES, 'usd_TestFiles', 'test_wireEdgeTopology_absent.usda'), { units: 'mm' }) as Part)
  assert.deepEqual(_edgeKinds(cylinder), { line: 2, bspline: 4 })
  approx(cylinder.volume, Math.PI * 90, 1e-6 * 300)
  assert.ok(cylinder.isValid())
})

// -- X7: USD bodies that cannot be read ---------------------------------------------------------------------
function _threeBodies(): string {
  // a box, a cylinder whose face range turns 60 radians (the kernel cannot build it) and a sphere of
  // radius 0 (malformed), in a file another tool wrote (checked)
  let text = toUsd(
    [Box(2, 3, 4).named('a'), Cylinder(4, 10).translate([10, 0, 0]).named('c'), Sphere(3).translate([20, 0, 0]).named('s')],
    { mesh: false },
  )
  text = text.replace('string source = "smlibpy"', 'string source = "x"')
  text = text.replace('face:range = [(0, 0), (6.283185307179586, 10), ', 'face:range = [(0, 0), (60, 10), ')
  return text.replace(/(uniform double\[\] brep:surface:sphere:radius = \[)[^\]]+(\])/, '$10$2')
}

test('usd body the kernel cannot build is named in the message', () => {
  // String(KernelError) was "fromUsd failed (SM_ERR_INVALID_INPUT)", the body only in .detail
  assert.throws(
    () => fromUsd(_threeBodies(), { strict: true }),
    (e: unknown) =>
      e instanceof KernelError &&
      e.message.includes('body 0 of the BrepArray "/World/c" could not be built') &&
      e.message.includes('strict: false') &&
      e.message.split('SM_ERR_INVALID_INPUT').length === 2 &&
      e.status === 'SM_ERR_INVALID_INPUT',
  )
})

test('usd import leaves out what cannot be read (strict: true throws)', () => {
  const [back, said] = warnings(() => fromUsd(_threeBodies()) as Part)
  assert.ok(back instanceof Part && back.name === 'a')
  approx(back.volume, 24, 1e-9)
  assert.deepEqual(said, [
    'fromUsd: body 0 of the BrepArray "/World/c" could not be built (SM_ERR_INVALID_INPUT); it is left out',
    'fromUsd: body 0 of the BrepArray "/World/s" is malformed: face 0: the sphere\'s radius is 0, not positive (BA.481); it is left out',
  ])
})

test('usd import takes the bodies of one prim apart', { skip: !existsSync(_USD_FILES) }, () => {
  // usd-brep's own case: one BrepArray of several bodies, one of them broken (here the first face of
  // the second of its two cubes gets a weight of 0, BA.440)
  const text = readFileSync(join(_USD_FILES, 'brep_validator', 'CubeBrepArray.usda'), 'utf-8')
  const m = /(brep:surface:nurb:weights = \[)([^\]]*)\]/.exec(text)!
  const values = m[2].split(', ')
  values[Math.floor(values.length / 2)] = '0'
  const start = m.index + m[1].length
  const broken = text.slice(0, start) + values.join(', ') + text.slice(start + m[2].length)
  assert.throws(() => fromUsd(broken, { strict: true }), /body 1, face 0: its NURBS surface has a weight of 0/)
  const [back, said] = warnings(() => fromUsd(broken) as Part)
  assert.ok(back instanceof Part && back.name === 'brepArray' && back.isValid())
  approx(back.volume, (warnings(() => fromUsd(text))[0] as ShapeList<Part>)[0].volume, 1e-9)
  assert.deepEqual(said.filter((w) => w.includes('left out')), [ // (and the reference to a file of materials it lacks)
    'fromUsd: body 1 of the BrepArray "/World/brepArray" is malformed: face 0: its NURBS surface has a weight of 0, not positive (BA.440); it is left out',
  ])
})

test('usd import of nothing readable throws', () => {
  const text = toUsd(Sphere(3).named('s'), { mesh: false }).replace(/(uniform double\[\] brep:surface:sphere:radius = \[)[^\]]+(\])/, '$10$2')
  assert.throws(() => fromUsd(text), (e: unknown) => e instanceof ModelingError && /no body of the file can be read: body 0 of the BrepArray "\/World\/s" is malformed/.test(e.message))
  assert.throws(() => fromUsd(text, { strict: true }), /the BrepArray "\/World\/s" is malformed: body 0, face 0/)
})

// -- I14: IGES import ---------------------------------------------------------------------------------------
// The files in tests/data/iges were written by OpenCASCADE 8.0 (IGESControl_Writer) from smlibpy parts:
// block_brep.igs as a solid B-rep (186), the others as trimmed surfaces (144), the way most CAD systems
// write IGES; block_faces_inch.igs in inches.
const _IGES = join(_DATA, 'iges')
const DEP = '00010000' // (the status of an entity that is part of another)
type IgesEntity = { type: number; params: (number | string | [string, number])[]; form?: number; transform?: [string, number]; color?: [string, number] | number; status?: string; label?: string }

/** An IGES file of entities; ['@', i] in params, transform or color points at entity i (a color: its
 * definition). */
function _iges(entities: IgesEntity[], unit = 2, resolution = 1e-7): string {
  const value = (v: number | string | [string, number]): string => {
    if (Array.isArray(v)) return String(2 * v[1] + 1)
    if (typeof v === 'string') return `${v.length}H${v}`
    return String(v)
  }
  const lines = (text: string, letter: string, width = 72): string[] => {
    const out: string[] = []
    for (let i = 0; i < Math.max(text.length, 1); i += width) out.push(text.slice(i, i + width).padEnd(width) + letter)
    return out
  }
  const g = `${['1H,', '1H;', '4Htest', '8Htest.igs', '4Htest', '4Htest', '32', '38', '6', '308', '15', '4Htest', '1.', String(unit), unit === 2 ? '2HMM' : '4HINCH', '1', '0.01', '15H20260101.000000', String(resolution), '100.', '4Htest', '4Htest', '11', '0', '15H20260101.000000'].join(',')};`
  const D: string[] = []
  const P: string[] = []
  entities.forEach((e, i) => {
    const text = `${[String(e.type), ...e.params.map(value)].join(',')};`
    const chunks: string[] = []
    for (let k = 0; k < text.length; k += 64) chunks.push(text.slice(k, k + 64))
    const start = P.length + 1
    for (const c of chunks) P.push(`${c.padEnd(64)} ${String(2 * i + 1).padStart(7)}P`)
    const col = Array.isArray(e.color) ? `-${value(e.color)}` : String(e.color ?? 0)
    const tr = e.transform ? value(e.transform) : '0'
    D.push([e.type, start, 0, 0, 0, 0, tr, 0].map((x) => String(x).padStart(8)).join('') + (e.status ?? '00000000').padStart(8) + 'D')
    D.push([e.type, 0, col, chunks.length, e.form ?? 0, '', ''].map((x) => String(x).padStart(8)).join('') + (e.label ?? '').padStart(8) + '0'.padStart(8) + 'D')
  })
  const sections = [lines('smlibpy test', 'S'), lines(g, 'G'), D, P]
  const numbered = sections.flatMap((sec) => sec.map((line, k) => line + String(k + 1).padStart(7)))
  const counts = `S${String(sections[0].length).padStart(7)}G${String(sections[1].length).padStart(7)}D${String(D.length).padStart(7)}P${String(P.length).padStart(7)}`
  return `${[...numbered, `${counts.padEnd(72)}T${'1'.padStart(7)}`].join('\n')}\n`
}
function _line(a: number[], b: number[]): IgesEntity {
  return { type: 110, params: [...a, ...b], status: DEP }
}

/** A bounded plane (108) z = 0 whose boundary is a composite (102) of the curves. */
function _boundedPlane(curves: IgesEntity[], extra: Partial<IgesEntity> = {}): IgesEntity[] {
  return [
    { type: 108, form: 1, params: [0, 0, 1, 0, ['@', 1], 0, 0, 0, 0], ...extra },
    { type: 102, params: [curves.length, ...curves.map((_, i) => ['@', 2 + i] as [string, number])], status: DEP },
    ...curves,
  ]
}

function _square(clockwise = false): IgesEntity[] {
  let pts = [
    [0, 0, 0],
    [10, 0, 0],
    [10, 5, 0],
    [0, 5, 0],
  ]
  if (clockwise) pts = pts.reverse()
  return pts.map((p, i) => _line(p, pts[(i + 1) % 4]))
}

/** Entities moved by `n` places in a list: their pointers too. */
function _shifted(entities: IgesEntity[], n: number): IgesEntity[] {
  return entities.map((e) => ({ ...e, params: e.params.map((v) => (Array.isArray(v) ? (['@', v[1] + n] as [string, number]) : v)) }))
}

test('iges solid brep object', () => {
  // a manifold solid B-rep object (186): its faces share their edges as the file has them
  const part = importIges(join(_IGES, 'block_brep.igs')) as Part
  assert.ok(part instanceof Part && part.isValid())
  approx(part.volume, 4000 - Math.PI * 160, 1e-12 * 4000)
  assert.deepEqual(part.faces().map((f) => f.geomType).sort(), ['cylinder', ...Array(6).fill('plane')])
  assert.deepEqual(part.edges().map((e) => e.geomType).sort(), [...Array(2).fill('circle'), ...Array(12).fill('line')])
  approx((load(join(_IGES, 'block_brep.igs')) as Part).volume, part.volume, 1e-9)
})

for (const [name, volume, faces] of [
  ['block_faces_inch.igs', 4000 - Math.PI * 160, 7], // (mirrored surfaces of revolution, inches)
  ['torus_faces.igs', 2 * Math.PI ** 2 * 40, 1], // (its seams: two closed curves, each used twice)
  ['vase_faces.igs', 934.8130160051498, 3], // (a B-spline revolved; OpenCASCADE's volume)
] as [string, number, number][]) {
  test(`iges trimmed surfaces are stitched into solids (${name})`, () => {
    const part = importIges(join(_IGES, name)) as Part
    assert.ok(part instanceof Part && part.isValid() && part.faces().length === faces)
    approx(part.volume, volume, 1e-8 * volume) // (the inch file has 10 digits)
  })
}

test('iges block faces keep their surfaces and edges', () => {
  const part = importIges(join(_IGES, 'block_faces_inch.igs')) as Part
  assert.deepEqual(part.faces().map((f) => f.geomType).sort(), ['cylinder', ...Array(6).fill('plane')])
  assert.deepEqual(part.edges().map((e) => e.geomType).sort(), [...Array(2).fill('circle'), ...Array(12).fill('line')])
  part.bbox().max.toArray().forEach((c, i) => approx(c, [10, 10, 5][i], 1e-6))
})

test('iges curves of every kind bound faces', () => {
  const area = (ents: IgesEntity[]): number => (fromIges(_iges(ents)) as Shell).area
  // a parabola (104 form 3) y = x^2 / 4 closed by a line: area 8/3
  const par: IgesEntity = { type: 104, form: 3, params: [0.25, 0, 0, 0, -1, 0, 0, -2, 1, 2, 1], status: DEP }
  approx(area(_boundedPlane([par, _line([2, 1, 0], [-2, 1, 0])])), 8 / 3, 1e-9)
  // half an ellipse (104 form 1) turned by 30 degrees, from its equation: area 4 pi
  const c = Math.cos(Math.PI / 6)
  const s = Math.sin(Math.PI / 6)
  const [A, B, C] = [(c * c) / 16 + (s * s) / 4, (2 * c * s) / 16 - (2 * s * c) / 4, (s * s) / 16 + (c * c) / 4]
  const ell: IgesEntity = { type: 104, form: 1, params: [A, B, C, 0, 0, -1, 0, 4 * c, 4 * s, -4 * c, -4 * s], status: DEP }
  approx(area(_boundedPlane([ell, _line([-4 * c, -4 * s, 0], [4 * c, 4 * s, 0])])), 4 * Math.PI, 1e-6 * 4 * Math.PI)
  // a hyperbola (104 form 2) x^2 - y^2 = 1 cut by x = cosh 1: area sinh 1 cosh 1 - 1
  const [ch, sh] = [Math.cosh(1), Math.sinh(1)]
  const hyp: IgesEntity = { type: 104, form: 2, params: [1, 0, -1, 0, 0, -1, 0, ch, -sh, ch, sh], status: DEP }
  approx(area(_boundedPlane([hyp, _line([ch, sh, 0], [ch, -sh, 0])])), sh * ch - 1, 1e-9)
  // a linear path (106 form 12): a triangle of area 9
  const tri: IgesEntity = { type: 106, form: 12, params: [2, 4, 0, 0, 0, 6, 0, 0, 0, 3, 0, 0, 0, 0], status: DEP }
  approx(area(_boundedPlane([tri])), 9, 1e-9)
  // a parametric spline (112) y = 4x - x^2 over [0, 4]: area 32/3
  const spl: IgesEntity = { type: 112, params: [3, 1, 2, 1, 0, 4, 0, 1, 0, 0, 0, 4, -1, 0, 0, 0, 0, 0, ...Array(12).fill(0)], status: DEP }
  approx(area(_boundedPlane([spl, _line([4, 0, 0], [0, 0, 0])])), 32 / 3, 1e-9)
})

test('iges surfaces of every kind', () => {
  const area = (ents: IgesEntity[]): number => (fromIges(_iges(ents)) as Shell).area
  // an untrimmed B-spline surface (128) on its own, and as a trimmed surface of all of itself
  const bilinear: IgesEntity = { type: 128, params: [1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 10, 0, 0, 0, 20, 0, 10, 20, 0, 0, 1, 0, 1] }
  approx(area([bilinear]), 200, 1e-9)
  approx(area([{ type: 144, params: [['@', 1], 0, 0, 0] }, { ...bilinear, status: DEP }]), 200, 1e-9)
  // a parametric spline surface (114): one bicubic patch, the plane x = 10 s, y = 20 t
  const coef = Array(48).fill(0)
  coef[1] = 10
  coef[16 + 4] = 20
  approx(area([{ type: 114, params: [3, 1, 1, 1, 0, 1, 0, 1, ...coef, ...Array(144).fill(0)] }]), 200, 1e-9)
  // a bounded surface (143) with a boundary (141) one of whose curves runs the other way (sense 2)
  const sq = [
    [0, 0, 0],
    [10, 0, 0],
    [10, 5, 0],
    [0, 5, 0],
  ]
  const bounded: IgesEntity[] = [
    { type: 143, params: [0, ['@', 1], 1, ['@', 2]] },
    { type: 108, params: [0, 0, 1, 0, 0, 0, 0, 0, 0], status: DEP },
    { type: 141, params: [0, 0, ['@', 1], 4, ['@', 3], 1, 0, ['@', 4], 2, 0, ['@', 5], 1, 0, ['@', 6], 1, 0], status: DEP },
    _line(sq[0], sq[1]),
    _line(sq[2], sq[1]),
    _line(sq[2], sq[3]),
    _line(sq[3], sq[0]),
  ]
  approx(area(bounded), 50, 1e-9)
})

for (const backwards of [1, 0]) {
  test(`iges ruled surface (backwards ${backwards})`, () => {
    // a ruled surface (118) between a line and a straight B-spline of degree 2 (the strip from y = 0,
    // z = 0 to y = 5, z = 3: 10 x 5.83), trimmed by its four sides; the second curve given the other
    // way round with the flag that says so (or the same way without it): read without the flag, the
    // strip would be twisted
    let [a, b] = [
      [10, 5, 3],
      [0, 5, 3],
    ]
    if (!backwards) [a, b] = [b, a]
    const spline: IgesEntity = { type: 126, params: [2, 2, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, ...a, ...a.map((x, i) => (x + b[i]) / 2), ...b, 0, 1, 0, 0, 0], status: DEP }
    const corners = [
      [0, 0, 0],
      [10, 0, 0],
      [10, 5, 3],
      [0, 5, 3],
    ]
    const ents: IgesEntity[] = [
      { type: 144, params: [['@', 1], 1, 0, ['@', 4]] },
      { type: 118, form: 1, params: [['@', 2], ['@', 3], backwards, 0], status: DEP },
      _line([0, 0, 0], [10, 0, 0]),
      spline,
      { type: 142, params: [0, ['@', 1], 0, ['@', 5], 2], status: DEP },
      { type: 102, params: [4, ['@', 6], ['@', 7], ['@', 8], ['@', 9]], status: DEP },
      ...corners.map((p, i) => _line(p, corners[(i + 1) % 4])),
    ]
    const sheet = fromIges(_iges(ents)) as Shell
    approx(sheet.area, 10 * Math.sqrt(34), 1e-9 * 60)
  })
}

test('iges boundaries of either orientation', () => {
  // IGES does not hold writers to an orientation of a boundary: a hole whose loop runs the way the
  // outer loop does is still a hole, and an outer loop that runs clockwise still bounds the face
  const holed = (outer: IgesEntity[]): IgesEntity[] => [
    { type: 144, params: [['@', 1], 1, 1, ['@', 2], ['@', 8]] },
    { type: 108, params: [0, 0, 1, 0, 0, 0, 0, 0, 0], status: DEP },
    { type: 142, params: [0, ['@', 1], 0, ['@', 3], 2], status: DEP },
    { type: 102, params: [4, ['@', 4], ['@', 5], ['@', 6], ['@', 7]], status: DEP },
    ...outer,
    { type: 142, params: [0, ['@', 1], 0, ['@', 9], 2], status: DEP },
    { type: 100, params: [0, 5, 2.5, 6, 2.5, 6, 2.5], status: DEP }, // (counterclockwise)
  ]
  for (const outer of [_square(), _square(true)]) approx((fromIges(_iges(holed(outer))) as Shell).area, 50 - Math.PI, 1e-9)
})

test('iges names, colors, transforms and subfigures', () => {
  // a name property (406 form 15), a color definition (314) and a transformation in a transformation
  // (124: turned by 90 degrees about z and moved by 100 in x, then moved by 7 in z)
  const plate = _boundedPlane(_square(), { color: ['@', 7], transform: ['@', 8] })
  plate[0].params.push(0, 1, ['@', 6])
  plate.push(
    { type: 406, form: 15, params: [1, 'Deckel'], status: DEP },
    { type: 314, params: [100, 50, 0, 'ORANGE'], status: DEP },
    { type: 124, params: [0, -1, 0, 100, 1, 0, 0, 0, 0, 0, 1, 0], transform: ['@', 9], status: DEP },
    { type: 124, params: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 7], status: DEP },
  )
  const sheet = fromIges(_iges(plate)) as Shell
  assert.equal(sheet.name, 'Deckel')
  assert.deepEqual(sheet.color, [1, 0.5, 0])
  const box = sheet.bbox()
  box.min.toArray().forEach((c, i) => approx(c, [95, 0, 7][i], 1e-9))
  box.max.toArray().forEach((c, i) => approx(c, [100, 10, 7][i], 1e-9))
  // a subfigure (308) placed twice (408): moved, and moved and scaled by 2
  const sub: IgesEntity[] = [
    { type: 408, params: [['@', 2], 100, 0, 0, 1] },
    { type: 408, params: [['@', 2], 0, 100, 0, 2] },
    { type: 308, params: [0, 'PLATE', 1, ['@', 3]], status: '00020200' },
    ..._shifted(_boundedPlane(_square()), 3),
  ]
  sub[3].status = DEP
  const [a, b] = fromIges(_iges(sub)) as ShapeList<Shell>
  approx(a.area, 50, 1e-9)
  approx(b.area, 200, 1e-9)
  a.bbox().min.toArray().forEach((c, i) => approx(c, [100, 0, 0][i], 1e-9))
  b.bbox().max.toArray().forEach((c, i) => approx(c, [20, 110, 0][i], 1e-9))
})

test('iges parameter space boundary on a b-spline surface', () => {
  // a bilinear patch over [0, 10] x [0, 20] trimmed by a triangle given in its parameters only (its
  // corners (0, 0), (1, 0), (0, 1): half the patch)
  const patch: IgesEntity = {
    type: 128,
    params: [1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 10, 0, 0, 0, 20, 0, 10, 20, 0, 0, 1, 0, 1],
    status: DEP,
  }
  const uv = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ]
  const ents: IgesEntity[] = [
    { type: 144, params: [['@', 1], 1, 0, ['@', 2]] },
    patch,
    { type: 142, params: [1, ['@', 1], ['@', 3], 0, 1], status: DEP },
    { type: 102, params: [3, ['@', 4], ['@', 5], ['@', 6]], status: DEP },
    ...uv.map((p, i) => ({ ..._line(p, uv[(i + 1) % 3]), status: '00010500' })),
  ]
  const sheet = fromIges(_iges(ents)) as Shell
  approx(sheet.area, 100, 1e-6 * 100)
  sheet.bbox().max.toArray().forEach((c, i) => approx(c, [10, 20, 0][i], 1e-6))
})

test('iges what cannot be read is left out', () => {
  // a trimmed surface whose surface is no surface (a point, 116), and a good one
  const bad: IgesEntity[] = [
    { type: 144, params: [['@', 1], 1, 0, ['@', 2]], label: 'ODD' },
    { type: 116, params: [0, 0, 0], status: DEP },
    { type: 142, params: [0, ['@', 1], 0, ['@', 3], 2], status: DEP },
  ]
  const text = _iges([...bad, ..._shifted(_boundedPlane(_square()), 3)])
  const [sheet, said] = warnings(() => fromIges(text) as Shell)
  approx(sheet.area, 50, 1e-9)
  assert.deepEqual(said, ["import IGES: left out trimmed surface 'ODD' (DE 1): surface entity 116 (DE 3), which is not supported"])
  assert.throws(() => fromIges(text, { strict: true }), /import IGES: trimmed surface 'ODD' \(DE 1\): surface entity 116/)
  assert.throws(() => warnings(() => fromIges(_iges(bad))), /nothing in the file could be read: trimmed surface 'ODD'/)
})

test('iges files it does not read', () => {
  assert.throws(() => fromIges('not iges at all\n'), (e: unknown) => e instanceof RangeError && /not an IGES file/.test(e.message))
  const text = readFileSync(join(_IGES, 'torus_faces.igs'), 'latin1').replace('S0000001', 'B0000001')
  assert.throws(() => fromIges(text), /binary or compressed IGES/)
  assert.throws(() => fromIges(_iges([{ ..._line([0, 0, 0], [1, 0, 0]), status: '00000000' }])), /holds no solids or surfaces/)
  assert.throws(() => load('c.xyz'), /load reads .step, .stp, .igs, .iges/)
})


// -- X9: SMLib part files (.smp) -------------------------------------------------------------------------
// biome-ignore lint: the shapes read back are checked by their properties
type Any = any

function _partItems(): Any[] {
  const bracket = Box(20, 10, 6).cut(Cylinder(2, 10)).named('Größe bracket').colored('steelblue')
  const cells = Box(10, 10, 10).merge(Box(10, 10, 10).translate(5, 0, 0)).named('cells')
  const sheet = Rectangle(6, 4).named('plate').colored([0.1, 0.8, 0.2])
  const arc = CenterArc([0, 0], 3, 0, 90)
  const path = new Wire([Line([0, 0, 0], [5, 0, 0]), CenterArc([5, 2, 0], 2, -90, 180)])
  return [bracket, arc, cells, path, sheet]
}

for (const ascii of [true, false]) {
  test(`part file keeps bodies, names, colors, cells and curves (ascii: ${ascii})`, () => {
    // .smb holds one body without its name or color (ai/todo/files.md #15); the kernel's part container
    // holds several, with attributes
    const items = _partItems()
    const back = fromSmp(toSmp(items, { ascii })) as ShapeList<Any>
    assert.deepEqual(
      back.map((x: Any) => x.constructor.name),
      ['Part', 'Edge', 'Part', 'Wire', 'Shell'],
    )
    const [bracket, arc, cells, path, sheet] = back
    assert.equal(bracket.name, 'Größe bracket')
    assert.equal(sheet.name, 'plate')
    assert.equal(cells.name, 'cells')
    const rgb = [0.27450980392156865, 0.5098039215686274, 0.7058823529411765]
    for (let i = 0; i < 3; i++) approx(bracket.color[i], rgb[i], 1e-15)
    if (!ascii) assert.deepEqual(Array.from(bracket.color), rgb) // (binary: bit-exact; ASCII: 16 decimals)
    assert.deepEqual(Array.from(sheet.color), [0.1, 0.8, 0.2])
    assert.equal(cells.color, null)
    approx(bracket.volume, (items[0] as Part).volume, 1e-12)
    assert.ok(bracket.isValid())
    assert.equal(cells.cells().length, 3)
    approx(cells.volume, 1500, 1e-9)
    approx(sheet.area, 24, 1e-9)
    assert.equal(arc.geomType, 'circle')
    approx(arc.radius, 3, 1e-12)
    approx(arc.length, 1.5 * Math.PI, 1e-12)
    assert.deepEqual(
      path.edges().map((e: Edge) => e.geomType),
      ['line', 'circle'],
    )
    approx(path.length, 5 + 2 * Math.PI, 1e-12)
  })
}

test('part file written again is the same', () => {
  // the attributes go on copies and come off what is read (the first reading makes B-spline trim
  // curves that are lines lines, as for .smb files; then nothing changes)
  const once = toSmp([...(fromSmp(toSmp(_partItems(), { ascii: false })) as ShapeList<Any>)], { ascii: false })
  assert.deepEqual(toSmp([...(fromSmp(once) as ShapeList<Any>)], { ascii: false }), once)
  const count = /(\d+) \/\/ Total number of attributes/
  const text = new TextDecoder().decode(toSmp(_partItems()))
  const again = new TextDecoder().decode(toSmp([...(fromSmp(toSmp([...(fromSmp(text) as ShapeList<Any>)])) as ShapeList<Any>)]))
  assert.equal(count.exec(text)?.[1], '8')
  assert.equal(count.exec(again)?.[1], '8')
})

test('save and load part files', () => {
  const dir = tmpPath()
  const items = _partItems()
  save(items, join(dir, 'a.smp'))
  exportFile(items.slice(0, 1), join(dir, 'b.smp'))
  save(items, join(dir, 'c.smp'), { ascii: false })
  for (const name of ['a.smp', 'c.smp']) {
    const back = load(join(dir, name)) as Any
    assert.equal(back.length, 5)
    assert.equal(back[0].name, 'Größe bracket')
  }
  assert.equal((load(join(dir, 'b.smp')) as Any).name, 'Größe bracket') // (one item: the shape itself)
  assert.throws(() => save([items[0], items[2]], join(dir, 'x.smb')), /save them to an .smp file/)
  assert.throws(
    () => save(items[1], join(dir, 'x.smb')),
    (e: unknown) => e instanceof TypeError && /an .smb file holds one body, not an Edge: save curves to an .smp file/.test(e.message),
  )
})

test('part files written by both ports and by smlib', { skip: !existsSync(_USD_FILES) }, () => {
  // tests/data/parts.smp and parts_binary.smp were written by smlibpy
  for (const name of ['parts.smp', 'parts_binary.smp']) {
    const back = load(join(_DATA, name)) as Any
    assert.deepEqual(
      back.map((x: Any) => x.constructor.name),
      ['Part', 'Edge', 'Wire', 'Part'],
    )
    assert.equal(back[0].name, 'Größe')
    assert.deepEqual(Array.from(back[0].color), [0.2, 0.4, 0.6])
    approx(back[0].volume, 480, 1e-9)
    assert.equal(back[3].name, 'ball')
    approx(back[3].volume, (4 / 3) * Math.PI * 8, 1e-9)
    approx(back[2].length, 5 + 2 * Math.PI, 1e-12)
  }
  const two = load(`${_PT}ssi_plncyl1.smp`) as Any
  assert.equal(two.length, 2)
  assert.ok(two.every((b: unknown) => b instanceof Part || b instanceof Shell))
  const curves = load(`${_PT}cci_bug_rhino1.smp`) as Any
  assert.deepEqual(
    curves.map((x: Any) => x.constructor.name),
    ['Edge', 'Edge'],
  )
  approx(curves[1].length, 24, 1e-12)
})

test('part file errors', () => {
  assert.throws(() => toSmp(Box(1, 1, 1).mesh()), /an .smp file holds exact bodies and curves, not a Mesh/)
  assert.throws(() => toSmp(Box(1, 1, 1).vertices()[0]), /not a Vertex: exportStep writes points/)
  assert.throws(() => toSmp([]), /toSmp: nothing to write/)
  assert.throws(() => fromSmp(new TextEncoder().encode('hello')), (e: unknown) => e instanceof RangeError && /this is no SMLib part file/.test(e.message))
})

// -- X10: empty bodies -----------------------------------------------------------------------------------
function _empty(): Part {
  return Box(1, 1, 1).intersect(Box(1, 1, 1).translate(5, 0, 0))
}

test('empty body is not written to USD', () => {
  // mesh: true failed with "tessellate failed", mesh: false wrote a BrepArray with an inverted 1e20
  // extent and no shell (usd-brep's validator: BA.025, BA.030, BA.035, BA.701)
  const empty = _empty()
  assert.equal(empty.faces().length, 0)
  for (const mesh of [true, false]) {
    assert.throws(
      () => toUsd(empty, { mesh }),
      (e: unknown) => e instanceof RangeError && /toUsd: the Part is empty: it has no faces, edges or points/.test(e.message),
    )
  }
  assert.throws(() => exportUsd([Box(1, 1, 1), empty.named('gone')], join(tmpPath(), 'e.usda')), /exportUsd: the Part 'gone' is empty/)
})

test('empty body has no mesh', () => {
  const empty = _empty()
  assert.throws(() => tessellate(empty), (e: unknown) => e instanceof RangeError && /tessellate: the Part is empty: it has no faces to mesh/.test(e.message))
  for (const write of [toStl, toObj, toGlb]) assert.throws(() => write(empty), /is empty/)
  assert.throws(() => toStl([]), /toStl: nothing to write/)
})

// -- X11: files in memory (smlibwasm had them; the file functions are now written around them) -------------
test('in-memory functions give what the file functions write', () => {
  const dir = tmpPath()
  const part = Box(20, 10, 6).cut(Cylinder(2, 10)).named('bracket').colored('steelblue')
  exportStl(part, join(dir, 'p.stl'))
  assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'p.stl'))), toStl(part))
  exportObj(part, join(dir, 'p.obj'))
  assert.equal(readFileSync(join(dir, 'p.obj'), 'utf-8'), toObj(part))
  exportGlb(part, join(dir, 'p.glb'))
  assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'p.glb'))), toGlb(part))
  exportUsd(part, join(dir, 'p.usda'), { materials: true })
  assert.equal(readFileSync(join(dir, 'p.usda'), 'utf-8'), toUsd(part, { materials: true }))
  save(part, join(dir, 'p.smb'))
  assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'p.smb'))), toSmb(part))
  approx((fromSmb(toSmb(part, { ascii: false })) as Part).volume, part.volume, 1e-12)
  assert.equal(fromStl(toStl(part)).triangles.length, tessellate(part).triangles.length)
})

test('fonts from bytes', () => {
  const font = loadFont(DEFAULT_FONT)
  assert.equal(font, loadFont(DEFAULT_FONT))
  assert.equal(font.path, null)
  approx(Text('Hi 5', 5, { font: DEFAULT_FONT }).area, Text('Hi 5', 5).area, 1e-12)
  const woff = new Uint8Array(readFileSync(join(_DATA, 'test-quadratic.woff')))
  assert.equal(loadFont(woff).numGlyphs, loadFont(join(_DATA, 'test-quadratic.woff')).numGlyphs)
})

// -- X12: USD material bindings --------------------------------------------------------------------------
test('usd bodies take the color of their material', { skip: !existsSync(_USD_FILES) }, () => {
  // usd-brep's test files bind MDL materials with a UsdPreviewSurface fallback, defined in a layer they
  // reference; 0.4 read no color at all
  const d = join(_USD_FILES, 'brep_validator')
  const [a, b] = importUsd(join(d, 'CubeBrepArray.usda')) as ShapeList<Part>
  assert.deepEqual([Array.from(a.color as number[]), Array.from(b.color as number[])], [
    [0.3, 0.15, 0.07],
    [0.04, 0.22, 0.1],
  ])
  assert.deepEqual(Array.from((importUsd(join(d, 'CubeBrepMaterials.usda')) as Part).color as number[]), [0.3, 0.15, 0.07])
  assert.deepEqual(Array.from((importUsd(join(d, 'CubeAllMaterials.usda')) as Part).color as number[]), [0.3, 0.15, 0.07])
  assert.equal((importUsd(join(d, 'CubeFaceMaterials.usda')) as Part).color, null) // (materials of faces only)
  // fromUsd reads the referenced layer through resolve
  const cube = readFileSync(join(d, 'CubeBrepArray.usda'), 'utf-8')
  const asked: [string, string][] = []
  const [c] = fromUsd(cube, {
    resolve: (asset, from) => {
      asked.push([asset, from])
      return readFileSync(join(d, asset))
    },
  }) as ShapeList<Part>
  assert.deepEqual(asked, [['../usd_TestFiles/Materials.usda', '']])
  assert.deepEqual(Array.from(c.color as number[]), [0.3, 0.15, 0.07])
})

const _LOOKS = `
    def Scope "Looks"
    {
        def Material "Blue"
        {
            token outputs:surface.connect = </World/Looks/Blue/Preview.outputs:surface>
            def Shader "Preview"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = (0, 0, 1)
                token outputs:surface
            }
        }
        def Material "Grey"
        {
            token outputs:surface.connect = </World/Looks/Grey/Preview.outputs:surface>
            def Shader "Preview"
            {
                uniform token info:id = "UsdPreviewSurface"
                token outputs:surface
            }
        }
        def Material "Mdl"
        {
            token outputs:mdl:surface.connect = </World/Looks/Mdl/Shader.outputs:out>
            def Shader "Shader"
            {
                uniform token info:implementationSource = "sourceAsset"
                token outputs:out
            }
        }
        def Material "Graph"
        {
            color3f inputs:tint = (0.5, 0.25, 0.125)
            token outputs:surface.connect = </World/Looks/Graph/Nodes.outputs:surface>
            def NodeGraph "Nodes"
            {
                token outputs:surface.connect = </World/Looks/Graph/Nodes/Preview.outputs:surface>
                def Shader "Preview"
                {
                    uniform token info:id = "UsdPreviewSurface"
                    color3f inputs:diffuseColor.connect = </World/Looks/Graph.inputs:tint>
                    token outputs:surface
                }
            }
        }
    }
`

/** The colors of two bodies (red "a", green "b") of a stage with the materials above, the
 * relationships given added to /World and to the two prims. */
function _bound(world = '', a = '', b = ''): number[][] {
  let text = toUsd([Box(10, 10, 10).named('a').colored([1, 0, 0]), Box(5, 5, 5).translate(20, 0, 0).named('b').colored([0, 1, 0])], {
    mesh: false,
  })
  text = text.replace('def Xform "World"\n{\n', `def Xform "World"\n{\n${world}${_LOOKS}`)
  for (const [name, rel] of [
    ['a', a],
    ['b', b],
  ]) {
    text = text.replace(new RegExp(`(def BrepArray "${name}" \\([^)]*\\)\\s*\\{\\n)`), (m) => m + rel)
  }
  return (fromUsd(text) as ShapeList<Part>).map((s) => Array.from(s.color as number[]))
}

test('usd material bindings as USD resolves them', () => {
  const [red, green, blue, grey] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0.18, 0.18, 0.18],
  ]
  assert.deepEqual(_bound(), [red, green]) // displayColor
  assert.deepEqual(_bound('', 'rel material:binding = </World/Looks/Blue>\n'), [blue, green])
  assert.deepEqual(_bound('', 'rel material:binding = <../Looks/Blue>\n'), [blue, green]) // (relative to the prim)
  assert.deepEqual(_bound('rel material:binding = </World/Looks/Blue>\n'), [blue, blue]) // from above
  // the prim's own binding before the one above it, unless that one is stronger than descendants
  assert.deepEqual(_bound('rel material:binding = </World/Looks/Blue>\n', 'rel material:binding = </World/Looks/Grey>\n'), [grey, blue])
  assert.deepEqual(
    _bound('rel material:binding = </World/Looks/Blue> (\n bindMaterialAs = "strongerThanDescendants"\n)\n', 'rel material:binding = </World/Looks/Grey>\n'),
    [blue, blue],
  )
  assert.deepEqual(_bound('', 'rel material:binding = </World/Looks/Grey>\nrel material:binding:preview = </World/Looks/Blue>\n'), [blue, green])
  assert.deepEqual(_bound('', 'rel material:binding = </World/Looks/Graph>\n'), [[0.5, 0.25, 0.125], green]) // node graph
  assert.deepEqual(_bound('', 'rel material:binding = </World/Looks/Mdl>\n'), [red, green]) // MDL alone: displayColor
  assert.deepEqual(_bound('', 'rel material:binding = </World/Looks/None>\n'), [red, green]) // no such material
})

test('usd material of a referenced layer is mapped onto its prim', () => {
  const mats =
    '#usda 1.0\n(\n    defaultPrim = "M"\n)\n\ndef Material "M"\n{\n    token outputs:surface.connect = </M/S.outputs:surface>\n' +
    '    def Shader "S"\n    {\n        uniform token info:id = "UsdPreviewSurface"\n        color3f inputs:diffuseColor = (0.25, 0.5, 0.75)\n' +
    '        token outputs:surface\n    }\n}\n'
  let text = toUsd(Box(10, 10, 10).named('a').colored([1, 0, 0]), { mesh: false })
  text = text.replace(
    'def Xform "World"\n{\n',
    'def Xform "World"\n{\n    def Scope "Looks"\n    {\n        def Material "Mat" (\n            prepend references = @lib/mats.usda@\n        )\n        {\n        }\n    }\n',
  )
  text = text.replace(/(def BrepArray "a" \([^)]*\)\s*\{\n)/, (m) => `${m}rel material:binding = </World/Looks/Mat>\n`)
  assert.deepEqual(Array.from((fromUsd(text, { resolve: () => mats }) as Part).color as number[]), [0.25, 0.5, 0.75])
})

test('toUsd writes materials', () => {
  const a = Box(10, 10, 10).named('a').colored('steelblue')
  const b = Sphere(3).translate(20, 0, 0).named('b').colored('steelblue')
  const c = Cylinder(2, 5).translate(40, 0, 0).named('Looks').colored([1, 0, 0])
  const text = toUsd([a, b, c], { materials: true })
  const count = (s: string) => text.split(s).length - 1
  assert.equal(count('def Material "'), 2) // (one per color)
  assert.ok(text.includes('def Material "a"') && text.includes('def Material "Looks"') && text.includes('def BrepArray "Looks_1"'))
  assert.equal(count('info:id = "UsdPreviewSurface"'), 2)
  assert.equal(count('rel material:binding = </World/Looks/a>'), 4) // (the BrepArrays and their meshes)
  assert.equal(count('"MaterialBindingAPI"'), 6)
  const back = fromUsd(text) as ShapeList<Part>
  assert.deepEqual(back[1].color, back[0].color)
  assert.deepEqual(Array.from(back[2].color as number[]), [1, 0, 0])
  assert.equal(back[2].name, 'Looks')
  assert.ok(!toUsd([a, b, c]).includes('Material')) // (without materials: as before)
})

// -- X13: bodies of mixed dimension ----------------------------------------------------------------------
const _MIXED: [string, string][] = [
  [
    'box_with_attached_wire_edge',
    'is a solid that also holds 1 wire edge (an edge of no face), so isValid() is false and modeling with it may fail; stitch(part.faces()) gives the solid alone',
  ],
  [
    'box_with_two_vertex_shells',
    'is a solid that also holds 2 points (vertices of no edge), so isValid() is false and modeling with it may fail; stitch(part.faces()) gives the solid alone',
  ],
  [
    'box_with_detached_sheet',
    'is a solid that also holds 1 face outside the solid (a sheet), so isValid() is false and modeling with it may fail; part.solids() takes the faces outside the solid apart',
  ],
  ['wire_edge', 'has no faces, only 1 wire edge (an edge of no face): it is read as a Shell without faces, whose edges() are its curves'],
]

for (const [name, said] of _MIXED) {
  test(`body of mixed dimension says what else it holds (${name})`, { skip: !existsSync(_USD_FILES) }, () => {
    // 0.4 gave a Part whose isValid() was false, from .smb and USD alike, and said nothing
    const [body, loaded] = warnings(() => load(join(_USD_FILES, 'usd_TestFiles', `${name}.smb`)) as Part | Shell)
    assert.deepEqual(loaded, [`load: the body ${said}`])
    const text = warnings(() => toUsd(body.named('x'), { mesh: false }))[0]
    const [back, read] = warnings(() => fromUsd(text) as Part)
    assert.deepEqual(read, [`fromUsd: 'x' ${said}`])
    if (name === 'box_with_attached_wire_edge') {
      assert.ok(!back.isValid())
      assert.ok((stitch(back.faces()) as Part).isValid())
    }
  })
}

test('sound bodies say nothing more', { skip: !existsSync(_USD_FILES) }, () => {
  for (const name of ['box', 'box_with_second_seven_face_box', 'boxes_share_one_vertex']) {
    assert.deepEqual(warnings(() => load(join(_USD_FILES, 'usd_TestFiles', `${name}.smb`)))[1], [])
  }
})

test('writers of bodies name what they cannot write', () => {
  const edge = Box(1, 1, 1).edges()[0]
  const vertex = Box(1, 1, 1).vertices()[0]
  // 0.4: "TypeError: 'Edge' object is not iterable"
  assert.throws(
    () => toUsd(edge),
    (e: unknown) => e instanceof TypeError && /toUsd writes parts, sheets, faces and meshes, not an Edge: exportStep and exportDxf write curves/.test(e.message),
  )
  assert.throws(() => toStl([Box(1, 1, 1), vertex]), /toStl writes parts, sheets, faces and meshes, not a Vertex: exportStep writes points/)
  assert.throws(() => toObj(new Wire([edge])), /toObj writes parts, sheets, faces and meshes, not a Wire/)
  assert.throws(() => toUsd(new _Location() as never), /not a Location/)
})


// ------------------------------------------------------------------------------------------------
// X14: OpenCASCADE .brep files (usd-brep's bridge, src/cpp/occt)

const _OCCT_BREPS = join(import.meta.dirname, '..', '..', 'third_party', 'usd-brep', 'TestFiles', 'occt_breps')
const _BREPS = join(import.meta.dirname, '..', '..', 'tests', 'data', 'brep')

function faceTypes(shape: Part | Shell): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of shape.faces()) out[f.geomType] = (out[f.geomType] ?? 0) + 1
  return out
}

// OpenCASCADE's figures of usd-brep's test files (as tests/test_lane_IX.py)
const OCCT_CORPUS: Record<string, [string, number, Record<string, number>]> = {
  box: ['Part', 24.0, { plane: 6 }],
  cone: ['Part', 21.991148575, { cone: 1, plane: 2 }],
  cylinder: ['Part', 28.274333882, { cylinder: 1, plane: 2 }],
  sphere: ['Part', 33.510321638, { sphere: 1 }],
  torus: ['Part', 113.697842701, { torus: 1 }],
  plate_with_hole: ['Shell', 20.858407346, { plane: 1 }],
  bezier_surface: ['Shell', 21.439261848, { bspline: 1 }],
  extrusion: ['Shell', 34.50528, { bspline: 1 }],
  sphere_natural: ['Shell', 50.265482457, { sphere: 1 }],
}

test('brep reads usd-brep test files', { skip: !existsSync(_OCCT_BREPS) }, () => {
  for (const [name, [kind, measure, types]] of Object.entries(OCCT_CORPUS)) {
    const [got] = warnings(() => importBrep(join(_OCCT_BREPS, `${name}.brep`)) as Part | Shell)
    assert.equal(got.constructor.name, kind, name)
    approx(kind === 'Part' ? (got as Part).volume : got.area, measure, kind === 'Part' ? 1e-8 : 1e-6)
    assert.deepEqual(faceTypes(got), types, name)
  }
  assert.deepEqual(new Set(fromBrep(readFileSync(join(_OCCT_BREPS, 'cylinder.brep'))).edges().map((e) => e.geomType)), new Set(['circle']))
})

test('brep cavities read as cavities', () => {
  // usd-brep's staging read both inside out (volume 9000, "Bad Inner shells"); OpenCASCADE: 7000
  for (const name of ['hollow', 'hollow_rev']) {
    const part = importBrep(join(_BREPS, `${name}.brep`)) as Part
    approx(part.volume, 7000, 1e-8)
    assert.ok(part.isValid())
    assert.equal(part.faces().length, 12)
  }
})

test('brep compounds, locations and binary files', () => {
  const want: [number, [number, number, number]][] = [
    [226.194671058, [50, 0, 4]],
    [226.194671058, [0, 60, 9]],
    [268.082573106, [-20, 0, 0]],
  ]
  for (const name of ['located', 'located_bin']) {
    const got = load(join(_BREPS, `${name}.brep`)) as ShapeList<Part>
    assert.ok(got instanceof ShapeList)
    assert.equal(got.length, 3)
    got.forEach((part, i) => {
      approx(part.volume, want[i][0], 1e-6)
      const c = part.center()
      ;[c.x, c.y, c.z].forEach((x, j) => approx(x, want[i][1][j], 1e-6, 1e-6))
    })
  }
  const torus = importBrep(join(_BREPS, 'torus_bin.brep')) as Part
  assert.deepEqual(faceTypes(torus), { torus: 1 })
  approx(torus.volume, 1776.528792196, 1e-6)
  const fillet = fromBrep(readFileSync(join(_BREPS, 'fillet_bin.brep'))) as Part
  assert.deepEqual(faceTypes(fillet), { plane: 6, cylinder: 12, sphere: 8 })
  approx(fillet.volume, 7804.696111127, 1e-6)
})

test('brep curves and points are named, not read', () => {
  const [got, said] = warnings(() => importBrep(join(_BREPS, 'mixed.brep')) as ShapeList<Part | Shell>)
  assert.deepEqual(said, ['importBrep: the file also holds 1 wire or edge outside faces, which are not read'])
  assert.deepEqual(got.map((x) => x.constructor.name), ['Part', 'Shell'])
  assert.throws(
    () => importBrep(join(_BREPS, 'wire_only.brep')),
    (e: unknown) => e instanceof RangeError && /importBrep: the file holds no solid, shell or face \(its shape is a wire, of curves\)/.test(e.message),
  )
})

test('brep malformed files throw', () => {
  const text = readFileSync(join(_BREPS, 'holed.brep'), 'utf8')
  assert.throws(() => fromBrep('ISO-10303-21;'), /fromBrep: this is not an OpenCASCADE .brep file/)
  assert.throws(() => fromBrep(text.slice(0, text.length / 2)), (e: unknown) => e instanceof RangeError && /fromBrep: the .brep file cannot be read/.test(e.message))
  const box = readFileSync(join(_OCCT_BREPS, 'box.brep'), 'utf8')
  const looped = box.replace('So\n\n1100000\n+2 0 *', 'So\n\n1100000\n+1 0 *')
  assert.notEqual(looped, box)
  assert.throws(() => fromBrep(looped), /fromBrep: the file is malformed: shape \d+ is made of shape \d+, which is not written before it/)
  assert.throws(() => fromBrep(3 as unknown as string), (e: unknown) => e instanceof TypeError && /fromBrep reads the contents of a .brep file as a string or bytes \(a Uint8Array or an ArrayBuffer\), not number/.test(e.message))
})

function brepShapes(): Record<string, Part> {
  const L = Box(30, 20, 10).fuse(Box(10, 20, 30).translate([-10, 0, 10]))
  return {
    holed: Box(20, 20, 10).cut(Cylinder(4, 20)),
    sphere: Sphere(5),
    torus: Torus(10, 3),
    cone_apex: Cone(5, 0, 8),
    hollow: Box(20, 20, 20).cut(Box(10, 10, 10)),
    sphere_cavity: Box(20, 20, 20).cut(Sphere(5)),
    concave_fillet: L.fillet(L.edges().concave(), 4),
    fillet: Box(20, 20, 10).fillet(Box(20, 20, 10).edges(), 2),
    capsule: Cylinder(5, 10).fuse(Sphere(5).translate([0, 0, 5])).fuse(Sphere(5).translate([0, 0, -5])),
    cross_cylinders: Cylinder(5, 30).cut(Cylinder(4, 30).rotate(X, 90)),
    revolve: Rectangle(5, 10).translate([10, 0, 0]).revolve(new Axis([0, 0, 0], [0, 1, 0])) as Part,
    loft: loft([Circle(5), Rectangle(8, 8).moved(new _Location([0, 0, 10]))]) as Part,
    ellipse_hole: Box(30, 20, 5).cut((extrude(Ellipse(6, 3), 10) as Part).translate([0, 0, -5])),
  }
}

test('brep written files read back', () => {
  // (0.4 had no .brep writer; usd-brep's own, as it was, gave OpenCASCADE a cavity of volume 9000 and
  // spheres, tori and concave fillets it took for invalid)
  for (const [name, shape] of Object.entries(brepShapes())) {
    const text = toBrep(shape)
    assert.ok(text.startsWith('DBRep_DrawableShape') && text.includes('CASCADE Topology V3'), name)
    const back = fromBrep(text) as Part
    approx(back.volume, shape.volume, 1e-9)
    const kept = Object.fromEntries(Object.entries(faceTypes(shape)).filter(([t]) => ['plane', 'cylinder', 'cone', 'sphere', 'torus'].includes(t)))
    assert.deepEqual(Object.fromEntries(Object.entries(faceTypes(back)).filter(([t]) => t in kept)), kept, name)
  }
  // a cavity's shell is forward, a sphere's poles get degenerate edges
  const solid = /\nSo\n\n\d+\n([^*]*)\*/.exec(toBrep(brepShapes().hollow)) as RegExpExecArray
  assert.ok(solid[1].trim().split(/\s+/).filter((_, i) => i % 2 === 0).every((r) => r.startsWith('+')))
  assert.equal(toBrep(Sphere(5)).match(/\nEd\n\S+ 1 1 1\n/g)?.length, 2)
  // files on disk
  const dir = tmpPath()
  const part = brepShapes().holed
  exportBrep(part, join(dir, 'a.brep'))
  exportFile(part, join(dir, 'b.brep'))
  assert.equal(readFileSync(join(dir, 'a.brep'), 'utf8'), readFileSync(join(dir, 'b.brep'), 'utf8'))
  approx((load(join(dir, 'b.brep')) as Part).volume, part.volume, 1e-12)
  assert.throws(() => exportFile(part, join(dir, 'c.brep'), { unit: 'mm' }), /exportBrep\(\) got an unexpected option 'unit' \(it takes no options\)/)
})

test('brep writes bodies and sheets into one compound', () => {
  const sheet = Box(10, 10, 10).faces().top()
  const back = fromBrep(toBrep([Box(5, 5, 5), Sphere(2).translate([20, 0, 0]), sheet])) as ShapeList<Part | Shell>
  assert.deepEqual(back.map((x) => x.constructor.name), ['Part', 'Part', 'Shell'])
  approx((back[1] as Part).volume, Sphere(2).volume, 1e-9)
  approx(back[2].area, 100, 1e-9)
})

test('brep writer refuses what it cannot write', () => {
  assert.throws(() => toBrep(Box(1, 1, 1).mesh()), (e: unknown) => e instanceof TypeError && /toBrep: a .brep file holds exact bodies, not a Mesh/.test(e.message))
  assert.throws(() => toBrep(Box(1, 1, 1).edges()[0]), (e: unknown) => e instanceof TypeError && /toBrep writes parts, sheets, faces and meshes, not an Edge/.test(e.message))
  assert.throws(() => toBrep([]), (e: unknown) => e instanceof RangeError && /toBrep: nothing to write/.test(e.message))
  assert.throws(
    () => toBrep(Box(2, 2, 2).intersect(Box(2, 2, 2).translate([10, 0, 0]))),
    (e: unknown) => e instanceof RangeError && /toBrep: the Part has no faces to write/.test(e.message),
  )
})

test('brep check of a curve with zero tangent', { skip: !existsSync(_OCCT_BREPS) }, () => {
  // usd-brep's extrusion with a zero direction: the kernel's check reads a curve's second derivative where
  // its first is zero (the SmCurve.cpp patch: it read past the two vectors it had evaluated)
  const text = readFileSync(join(_OCCT_BREPS, 'extrusion.brep'), 'utf8')
  const flat = text.replace('Surfaces 1\n6 0 0 1 \n', 'Surfaces 1\n6 0 0 0 \n')
  assert.notEqual(flat, text)
  assert.throws(
    () => fromBrep(flat),
    (e: unknown) => e instanceof RangeError && /fromBrep: the shape is broken: the kernel finds a gap of 4\.02 \(0\.487 of its size\) at edge 3/.test(e.message),
  )
})


test('importers take strict, and leave bodies out by default', () => {
  // USD took partial (the opposite default), .brep neither: one option on every importer now.
  const text = toUsd(Sphere(3).named('s'), { mesh: false }).replace(/(uniform double\[\] brep:surface:sphere:radius = \[)[^\]]+(\])/, '$10$2')
  assert.throws(() => fromUsd(text, { partial: true } as never), TypeError)
  assert.throws(() => fromUsd(text, { strict: true }), RangeError)
  approx((fromBrep(toBrep(Box(5, 5, 5)), { strict: true }) as Part).volume, 125, 1e-9)
})
