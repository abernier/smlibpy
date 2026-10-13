// tests/test_step_import.py
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Axis,
  Box,
  Circle,
  Cone,
  Cylinder,
  GridLocations,
  ModelingError,
  Part,
  Rectangle,
  Sphere,
  Torus,
  Z,
  exportStep,
  fromStep,
  importStep,
  load,
  loft,
  revolve,
  toStep,
  type ShapeList,
} from '../src/index.ts'
import { toHex } from '../src/colors.ts'
import { _pyRepr } from '../src/step.ts'
import { approx } from './_approx.ts'

function tmpPath(): string {
  return mkdtempSync(join(tmpdir(), 'smlibjs-step-'))
}

function plate(): Part {
  let p = Box(80, 60, 10)
  p = p.fillet(p.edges().parallelTo(Z), 8)
  p = p.cut(GridLocations(60, 40, 2, 2).mul(Cylinder(4, 20)))
  return p.named('plate').colored('steelblue')
}

// (Python's str of a float, so the files below read as Python writes them)
const f = _pyRepr
const radians = (deg: number) => deg * (Math.PI / 180)

const shapes: [string, (() => Part) | null][] = [
  ['plate', null],
  ['sphere', () => Sphere(10)],
  ['torus', () => Torus(20, 5)],
  ['cone', () => Cone(10, 0, 15)],
  ['hollow', () => Box(20, 20, 20).cut(Sphere(5))],
  ['g2', () => Box(30, 20, 10).fillet(Box(30, 20, 10).edges(), 2, { continuity: 'G2' })],
  ['loft', () => loft([Rectangle(20, 20), Circle(8).translate(0, 0, 20)]) as Part],
  ['revolved', () => revolve(Rectangle(4, 10).translate(12, 0), Axis.Y, 270) as Part],
]
for (const [name, make] of shapes) {
  test(`step roundtrip [${name}]`, () => {
    const shape = make === null ? plate() : make()
    const path = join(tmpPath(), `${name}.step`)
    exportStep(shape, path)
    const back = importStep(path)
    assert.ok(back instanceof Part && back.isValid())
    approx(back.volume, shape.volume, 1e-6)
    assert.equal(back.faces().length, shape.faces().length)
  })
}

test('step keeps names, colors and parts', () => {
  const p = plate()
  const cover = Box(80, 60, 2).translate(0, 0, 12).named('cover').colored('#d9925a')
  const path = join(tmpPath(), 'assembly.step')
  exportStep([p, cover], path)
  const back = load(path) as ShapeList<Part>
  assert.deepEqual(
    back.map((b) => b.name),
    ['plate', 'cover'],
  )
  assert.equal(toHex(back[0].color as string), toHex(p.color as string))
  approx(back[1].bbox().min.z, 11) // boxes are centered
})

const units: [string, number][] = [
  ['inch', 25.4],
  ['cm', 10.0],
  ['m', 1000.0],
  ['um', 0.001],
]
for (const [unit, mm] of units) {
  test(`step writes coordinates in the declared unit [${unit}]`, () => {
    const path = join(tmpPath(), `${unit}.step`)
    exportStep(Box(1, 2, 3).translate(25.4, 0, 0), path, { unit })
    const text = readFileSync(path, 'utf8')
    const xs = [...text.matchAll(/CARTESIAN_POINT\('',\(([^,]+),/g)].map((m) => Number(m[1]))
    approx(Math.max(...xs), 25.9 / mm, 1e-12) // the corner at x = 25.9 mm
    const back = importStep(path) as Part // converted back to mm
    approx(back.volume, 6, 1e-9)
    approx(back.bbox().max.x, 25.9, 1e-12)
  })
}

/** A minimal AP214 file in millimeters around the numbered entities. */
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

/** Radius 10, height 20. `seamAt` null: the side face is bounded by its two circles only (as NX
 * writes it), otherwise by a seam line at that angle. */
function _cylinder(seamAt: number | null): string {
  const e = [
    "#1=CARTESIAN_POINT('',(0.,0.,0.));",
    "#2=DIRECTION('',(0.,0.,1.));",
    "#3=DIRECTION('',(1.,0.,0.));",
    "#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);",
    "#5=CARTESIAN_POINT('',(0.,0.,20.));",
    "#6=AXIS2_PLACEMENT_3D('',#5,#2,#3);",
    "#7=CYLINDRICAL_SURFACE('',#4,10.);",
    "#8=PLANE('',#4);",
    "#9=PLANE('',#6);",
  ]
  const a = radians(seamAt || 0.0)
  const [x, y] = [10 * Math.cos(a), 10 * Math.sin(a)]
  // circles start at their vertex: give them a reference direction pointing there
  e.push(
    `#10=DIRECTION('',(${f(Math.cos(a))},${f(Math.sin(a))},0.));`,
    "#11=AXIS2_PLACEMENT_3D('',#1,#2,#10);",
    "#12=AXIS2_PLACEMENT_3D('',#5,#2,#10);",
    "#13=CIRCLE('',#11,10.);",
    "#14=CIRCLE('',#12,10.);",
    `#15=CARTESIAN_POINT('',(${f(x)},${f(y)},0.));`,
    `#16=CARTESIAN_POINT('',(${f(x)},${f(y)},20.));`,
    "#17=VERTEX_POINT('',#15);",
    "#18=VERTEX_POINT('',#16);",
    "#19=EDGE_CURVE('',#17,#17,#13,.T.);",
    "#20=EDGE_CURVE('',#18,#18,#14,.T.);",
    // bottom (normal -z): the circle backwards; top (normal +z): forwards
    "#21=ORIENTED_EDGE('',*,*,#19,.F.);",
    "#22=EDGE_LOOP('',(#21));",
    "#23=FACE_OUTER_BOUND('',#22,.T.);",
    "#24=ADVANCED_FACE('',(#23),#8,.F.);",
    "#25=ORIENTED_EDGE('',*,*,#20,.T.);",
    "#26=EDGE_LOOP('',(#25));",
    "#27=FACE_OUTER_BOUND('',#26,.T.);",
    "#28=ADVANCED_FACE('',(#27),#9,.T.);",
    "#29=ORIENTED_EDGE('',*,*,#19,.T.);",
    "#30=ORIENTED_EDGE('',*,*,#20,.F.);",
  )
  if (seamAt === null) {
    e.push(
      "#31=EDGE_LOOP('',(#29));",
      "#32=EDGE_LOOP('',(#30));",
      "#33=FACE_BOUND('',#31,.T.);",
      "#34=FACE_BOUND('',#32,.T.);",
      "#35=ADVANCED_FACE('',(#33,#34),#7,.T.);",
    )
  } else {
    e.push(
      "#40=DIRECTION('',(0.,0.,1.));",
      "#41=VECTOR('',#40,1.);",
      "#42=LINE('',#15,#41);",
      "#43=EDGE_CURVE('',#17,#18,#42,.T.);",
      "#44=ORIENTED_EDGE('',*,*,#43,.T.);",
      "#45=ORIENTED_EDGE('',*,*,#43,.F.);",
      "#31=EDGE_LOOP('',(#29,#44,#30,#45));",
      "#33=FACE_OUTER_BOUND('',#31,.T.);",
      "#35=ADVANCED_FACE('',(#33),#7,.T.);",
    )
  }
  e.push("#98=CLOSED_SHELL('',(#24,#28,#35));", "#99=MANIFOLD_SOLID_BREP('cylinder',#98);")
  return _step(e)
}

for (const seamAt of [null, 0.0, 180.0, 117.0]) {
  test(`step periodic faces with and without seam [${seamAt}]`, () => {
    const path = join(tmpPath(), 'cylinder.step')
    writeFileSync(path, _cylinder(seamAt))
    const part = importStep(path) as Part
    assert.ok(part.isValid())
    approx(part.volume, Math.PI * 100 * 20, 1e-6)
    const side = part.faces().cylinders()[0]
    approx(side.area, 2 * Math.PI * 10 * 20, 1e-6)
  })
}

test('step cone tip given by a vertex', () => {
  // A cone face bounded by its base circle and the apex as a vertex loop (NX).
  const e = [
    "#1=CARTESIAN_POINT('',(0.,0.,0.));",
    "#2=DIRECTION('',(0.,0.,-1.));",
    "#3=DIRECTION('',(1.,0.,0.));",
    "#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);",
    `#5=CONICAL_SURFACE('',#4,10.,${f(Math.atan(0.5))});`,
    "#6=PLANE('',#4);",
    "#7=CIRCLE('',#4,10.);",
    "#8=CARTESIAN_POINT('',(10.,0.,0.));",
    "#9=VERTEX_POINT('',#8);",
    "#10=EDGE_CURVE('',#9,#9,#7,.T.);",
    "#11=CARTESIAN_POINT('',(0.,0.,20.));",
    "#12=VERTEX_POINT('',#11);",
    // base plane: its normal is -z already, the circle runs counterclockwise about it
    "#13=ORIENTED_EDGE('',*,*,#10,.T.);",
    "#14=EDGE_LOOP('',(#13));",
    "#15=FACE_OUTER_BOUND('',#14,.T.);",
    "#16=ADVANCED_FACE('',(#15),#6,.T.);",
    "#17=ORIENTED_EDGE('',*,*,#10,.F.);",
    "#18=EDGE_LOOP('',(#17));",
    "#19=FACE_OUTER_BOUND('',#18,.T.);",
    "#20=VERTEX_LOOP('',#12);",
    "#21=FACE_BOUND('',#20,.T.);",
    "#22=ADVANCED_FACE('',(#19,#21),#5,.T.);",
    "#98=CLOSED_SHELL('',(#16,#22));",
    "#99=MANIFOLD_SOLID_BREP('cone',#98);",
  ]
  const path = join(tmpPath(), 'cone.step')
  writeFileSync(path, _step(e))
  const part = importStep(path) as Part
  assert.ok(part.isValid())
  approx(part.volume, (Math.PI * 100 * 20) / 3, 1e-6)
})

test('step reports files without bodies', () => {
  const path = join(tmpPath(), 'empty.step')
  writeFileSync(path, _step(["#99=CARTESIAN_POINT('',(0.,0.,0.));"]))
  assert.throws(() => importStep(path), (e: unknown) => e instanceof ModelingError && /no B-rep/.test(e.message))
})

// Files written by another kernel (OpenCASCADE puts seams and orientations its own way), made
// with Python's OCP, which JavaScript does not have.
for (const name of ['box_with_hole', 'sphere', 'torus', 'cone', 'bspline']) {
  test(`step from opencascade [${name}]`, { skip: 'needs OpenCASCADE (OCP), which smlibjs has no binding for' }, () => {})
}

/** Two instances of one part in an assembly built the way AutoCAD writes it: the identity
 * placement is listed in the root's representation and in the part's, and every
 * ITEM_DEFINED_TRANSFORMATION names it first (CAx-IF: item 1 in the child). */
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
    ...placement(1003, '0.,0.,0.', '1.,0.,0.'), // #1006: identity
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

test('step assembly placement listed in both representations', () => {
  const dir = tmpPath()
  const path = join(dir, 'asm.step')
  writeFileSync(path, _assemblyLikeAutocad(dir))
  const parts = [...(importStep(path) as ShapeList<Part>)].sort((p, q) => p.bbox().min.x - q.bbox().min.x)
  assert.equal(parts.length, 2)
  const [a, b] = [parts[0].bbox(), parts[1].bbox()]
  const near = (actual: number[], expected: number[]) => expected.forEach((v, i) => approx(actual[i], v, 0, 1e-6))
  // the second instance is turned 90 degrees about Z and sits at (-50, 20, 0)
  near(a.min.toArray(), [-55, 10, -2])
  near(a.max.toArray(), [-45, 30, 2])
  near(b.min.toArray(), [80, 70, 8])
  near(b.max.toArray(), [100, 80, 12])
})

test('step unnamed solid takes the product name', () => {
  const path = join(tmpPath(), 'widget.step')
  exportStep(Box(5, 5, 5), path)
  const text = readFileSync(path, 'utf8')
  assert.ok(text.includes("MANIFOLD_SOLID_BREP('widget'") && text.includes("PRODUCT('widget','widget'"))
  writeFileSync(path, text.replace("MANIFOLD_SOLID_BREP('widget'", "MANIFOLD_SOLID_BREP(''").replace("PRODUCT('widget','widget'", "PRODUCT('W-1','Widget'"))
  assert.equal((importStep(path) as Part).name, 'Widget')
})

// smlibjs's in-memory pair (no Python counterpart): the text of a file, and a file's contents
test('toStep and fromStep work in memory', () => {
  const p = plate()
  const text = toStep(p)
  assert.ok(text.includes("MANIFOLD_SOLID_BREP('plate'") && text.includes("PRODUCT('part','part'"))
  for (const data of [text, new TextEncoder().encode(text)]) {
    const back = fromStep(data) as Part
    assert.ok(back instanceof Part && back.isValid())
    approx(back.volume, p.volume, 1e-6)
    assert.equal(back.name, 'plate')
  }
  assert.ok(toStep(Box(1, 2, 3), { name: 'gauge' }).includes("MANIFOLD_SOLID_BREP('gauge'"))
})
