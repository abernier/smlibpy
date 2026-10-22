// tests/test_step_import.py
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
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
  EllipticalArc,
  GridLocations,
  ModelingError,
  Part,
  Rectangle,
  Sphere,
  StepModel,
  Torus,
  Wire,
  Z,
  exportStep,
  fromStep,
  fromStepModel,
  importStep,
  load,
  loft,
  readStep,
  revolve,
  toStep,
  type ShapeList,
  type Shell,
} from '../src/index.ts'
import { toHex } from '../src/colors.ts'
import { _pyRepr } from '../src/step.ts'
import { KernelError, k } from '../src/kernel.ts'
import { approx } from './_approx.ts'

function tmpPath(): string {
  return mkdtempSync(join(tmpdir(), 'smlibwasm-step-'))
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
  return _step(_cylinderEntities(seamAt))
}

function _cylinderEntities(seamAt: number | null): string[] {
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
  return e
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
  test(`step from opencascade [${name}]`, { skip: 'needs OpenCASCADE (OCP), which smlibwasm has no binding for' }, () => {})
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

// -- faces NX writes: extruded ellipses, periodic faces without seams ----------------------------
/** Semi-axes 6 and 3, height 10: the side face is a SURFACE_OF_LINEAR_EXTRUSION of an ELLIPSE,
 * bounded by its two ellipses only (as NX writes small roundings). */
function _ellipticCylinder(): string {
  const e = [
    "#1=CARTESIAN_POINT('',(0.,0.,0.));",
    "#2=DIRECTION('',(0.,0.,1.));",
    "#3=DIRECTION('',(1.,0.,0.));",
    "#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);",
    "#5=CARTESIAN_POINT('',(0.,0.,10.));",
    "#6=AXIS2_PLACEMENT_3D('',#5,#2,#3);",
    "#7=ELLIPSE('',#4,6.,3.);",
    "#8=ELLIPSE('',#6,6.,3.);",
    "#9=VECTOR('',#2,10.);",
    "#10=SURFACE_OF_LINEAR_EXTRUSION('',#7,#9);",
    "#11=PLANE('',#4);",
    "#12=PLANE('',#6);",
    "#13=CARTESIAN_POINT('',(6.,0.,0.));",
    "#14=CARTESIAN_POINT('',(6.,0.,10.));",
    "#15=VERTEX_POINT('',#13);",
    "#16=VERTEX_POINT('',#14);",
    "#17=EDGE_CURVE('',#15,#15,#7,.T.);",
    "#18=EDGE_CURVE('',#16,#16,#8,.T.);",
    "#21=ORIENTED_EDGE('',*,*,#17,.F.);",
    "#22=EDGE_LOOP('',(#21));",
    "#23=FACE_OUTER_BOUND('',#22,.T.);",
    "#24=ADVANCED_FACE('',(#23),#11,.F.);",
    "#25=ORIENTED_EDGE('',*,*,#18,.T.);",
    "#26=EDGE_LOOP('',(#25));",
    "#27=FACE_OUTER_BOUND('',#26,.T.);",
    "#28=ADVANCED_FACE('',(#27),#12,.T.);",
    "#29=ORIENTED_EDGE('',*,*,#17,.T.);",
    "#30=ORIENTED_EDGE('',*,*,#18,.F.);",
    "#31=EDGE_LOOP('',(#29));",
    "#32=EDGE_LOOP('',(#30));",
    "#33=FACE_BOUND('',#31,.T.);",
    "#34=FACE_BOUND('',#32,.T.);",
    "#35=ADVANCED_FACE('',(#33,#34),#10,.T.);",
    "#98=CLOSED_SHELL('',(#24,#28,#35));",
    "#99=MANIFOLD_SOLID_BREP('ellipse',#98);",
  ]
  return _step(e)
}

test('step extruded ellipse', () => {
  const path = join(tmpPath(), 'ellipse.step')
  writeFileSync(path, _ellipticCylinder())
  const part = importStep(path) as Part
  assert.ok(part.isValid())
  approx(part.volume, Math.PI * 6 * 3 * 10, 1e-6)
  const sides = part.faces().filter((face) => face.geomType === 'extrusion')
  assert.equal(sides.length, 1)
  const perimeter = EllipticalArc([0, 0], 6, 3).length
  approx(sides[0].area, perimeter * 10, 1e-6)
  approx(part.mesh().volume, part.volume, 2e-2)
})

/** A cylinder face bounded by a circle at one end and two arcs at the other, without a seam edge
 * (NX writes a shank with a flat so): the kernel needs the seam added. With `solid` false, the
 * cylinder face alone as a surface model. */
function _band(solid: boolean): string[] {
  const e = [
    "#1=CARTESIAN_POINT('',(0.,0.,0.));",
    "#2=DIRECTION('',(0.,0.,1.));",
    "#3=DIRECTION('',(1.,0.,0.));",
    "#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);",
    "#5=CARTESIAN_POINT('',(0.,0.,20.));",
    "#6=AXIS2_PLACEMENT_3D('',#5,#2,#3);",
    "#7=CYLINDRICAL_SURFACE('',#4,10.);",
  ]
  if (solid) e.push("#8=PLANE('',#4);", "#9=PLANE('',#6);")
  e.push(
    "#10=CIRCLE('',#4,10.);",
    "#11=CIRCLE('',#6,10.);",
    "#12=CARTESIAN_POINT('',(10.,0.,0.));",
    "#13=VERTEX_POINT('',#12);",
    "#14=CARTESIAN_POINT('',(10.,0.,20.));",
    "#15=VERTEX_POINT('',#14);",
    "#16=CARTESIAN_POINT('',(-10.,0.,20.));",
    "#17=VERTEX_POINT('',#16);",
    "#18=EDGE_CURVE('',#13,#13,#10,.T.);",
    "#19=EDGE_CURVE('',#15,#17,#11,.T.);",
    "#20=EDGE_CURVE('',#17,#15,#11,.T.);",
  )
  if (solid) {
    e.push(
      "#21=ORIENTED_EDGE('',*,*,#18,.F.);",
      "#22=EDGE_LOOP('',(#21));",
      "#23=FACE_OUTER_BOUND('',#22,.T.);",
      "#24=ADVANCED_FACE('',(#23),#8,.F.);",
      "#25=ORIENTED_EDGE('',*,*,#19,.T.);",
      "#26=ORIENTED_EDGE('',*,*,#20,.T.);",
      "#27=EDGE_LOOP('',(#25,#26));",
      "#28=FACE_OUTER_BOUND('',#27,.T.);",
      "#29=ADVANCED_FACE('',(#28),#9,.T.);",
    )
  }
  e.push(
    "#30=ORIENTED_EDGE('',*,*,#18,.T.);",
    "#31=EDGE_LOOP('',(#30));",
    "#32=FACE_BOUND('',#31,.T.);",
    "#33=ORIENTED_EDGE('',*,*,#20,.F.);",
    "#34=ORIENTED_EDGE('',*,*,#19,.F.);",
    "#35=EDGE_LOOP('',(#33,#34));",
    "#36=FACE_BOUND('',#35,.T.);",
    "#37=ADVANCED_FACE('',(#32,#36),#7,.T.);",
  )
  if (solid) e.push("#98=CLOSED_SHELL('',(#24,#29,#37));", "#99=MANIFOLD_SOLID_BREP('band',#98);")
  else e.push("#97=OPEN_SHELL('',(#37));", "#99=SHELL_BASED_SURFACE_MODEL('band',(#97));")
  return e
}

test('step cylinder band ending in an open loop', () => {
  const path = join(tmpPath(), 'band.step')
  writeFileSync(path, _step(_band(true)))
  const part = importStep(path) as Part
  assert.ok(part.isValid())
  const props = part._props()
  for (const v of props.field_volumes) approx(v, Math.PI * 100 * 20, 1e-6)
  approx(part.faces().cylinders()[0].area, 2 * Math.PI * 10 * 20, 1e-6)
  approx(part.mesh().volume, part.volume, 2e-2)
})

test('step cylinder band sheet gets its seam', () => {
  // The band above as a sheet (a surface model of the cylinder face alone): it gets the seam as
  // well, without the checks a solid has to pass.
  const path = join(tmpPath(), 'band_sheet.step')
  writeFileSync(path, _step(_band(false)))
  const sheet = importStep(path) as Shell
  assert.ok(!(sheet instanceof Part))
  const area = 2 * Math.PI * 10 * 20
  approx(sheet.area, area, 1e-6)
  approx(sheet.mesh().area, area, 1e-2)
})

function _torusEntities(R: number, r: number): string[] {
  return [
    "#1=CARTESIAN_POINT('',(0.,0.,0.));",
    "#2=DIRECTION('',(0.,0.,1.));",
    "#3=DIRECTION('',(1.,0.,0.));",
    "#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);",
    `#5=TOROIDAL_SURFACE('',#4,${f(R)},${f(r)});`,
  ]
}

test('step torus patch across the outer equator', () => {
  // A torus face over u in [0, 90] and v in [-45, 45] degrees: it crosses v = 0, where the
  // kernel's torus has its seam around the tube.
  const [R, r, v] = [20.0, 5.0, Math.PI / 4]
  const [s, c] = [Math.sin(v), Math.cos(v)]
  const e = [
    ..._torusEntities(R, r),
    `#10=CARTESIAN_POINT('',(${f(R + r * c)},0.,${f(-r * s)}));`,
    `#11=CARTESIAN_POINT('',(0.,${f(R + r * c)},${f(-r * s)}));`,
    `#12=CARTESIAN_POINT('',(0.,${f(R + r * c)},${f(r * s)}));`,
    `#13=CARTESIAN_POINT('',(${f(R + r * c)},0.,${f(r * s)}));`,
    "#14=VERTEX_POINT('',#10);",
    "#15=VERTEX_POINT('',#11);",
    "#16=VERTEX_POINT('',#12);",
    "#17=VERTEX_POINT('',#13);",
    // the parallels v = -45 and v = 45
    `#20=CARTESIAN_POINT('',(0.,0.,${f(-r * s)}));`,
    "#21=AXIS2_PLACEMENT_3D('',#20,#2,#3);",
    `#22=CIRCLE('',#21,${f(R + r * c)});`,
    `#23=CARTESIAN_POINT('',(0.,0.,${f(r * s)}));`,
    "#24=AXIS2_PLACEMENT_3D('',#23,#2,#3);",
    `#25=CIRCLE('',#24,${f(R + r * c)});`,
    // the meridians u = 0 and u = 90 (tube circles; their angle runs against v)
    `#30=CARTESIAN_POINT('',(${f(R)},0.,0.));`,
    "#31=DIRECTION('',(0.,1.,0.));",
    "#32=AXIS2_PLACEMENT_3D('',#30,#31,#3);",
    `#33=CIRCLE('',#32,${f(r)});`,
    `#34=CARTESIAN_POINT('',(0.,${f(R)},0.));`,
    "#35=DIRECTION('',(-1.,0.,0.));",
    "#36=DIRECTION('',(0.,1.,0.));",
    "#37=AXIS2_PLACEMENT_3D('',#34,#35,#36);",
    `#38=CIRCLE('',#37,${f(r)});`,
    "#40=EDGE_CURVE('',#14,#15,#22,.T.);",
    "#41=EDGE_CURVE('',#15,#16,#38,.F.);",
    "#42=EDGE_CURVE('',#16,#17,#25,.F.);",
    "#43=EDGE_CURVE('',#17,#14,#33,.T.);",
    "#44=ORIENTED_EDGE('',*,*,#40,.T.);",
    "#45=ORIENTED_EDGE('',*,*,#41,.T.);",
    "#46=ORIENTED_EDGE('',*,*,#42,.T.);",
    "#47=ORIENTED_EDGE('',*,*,#43,.T.);",
    "#48=EDGE_LOOP('',(#44,#45,#46,#47));",
    "#49=FACE_OUTER_BOUND('',#48,.T.);",
    "#50=ADVANCED_FACE('',(#49),#5,.T.);",
    "#97=OPEN_SHELL('',(#50));",
    "#99=SHELL_BASED_SURFACE_MODEL('patch',(#97));",
  ]
  const path = join(tmpPath(), 'patch.step')
  writeFileSync(path, _step(e))
  const sheet = importStep(path) as Shell
  const area = (r * (R * 2 * v + r * 2 * s) * Math.PI) / 2
  approx(sheet.area, area, 1e-6)
  approx(sheet.mesh().area, area, 1e-2)
})

test('step half torus bounded by its tube circles', () => {
  // A torus face bounded by two tube circles only: it runs all the way around the tube and needs a
  // seam edge along it.
  const [R, r] = [20.0, 5.0]
  const e = [
    ..._torusEntities(R, r),
    "#6=DIRECTION('',(0.,1.,0.));",
    "#7=DIRECTION('',(0.,-1.,0.));",
    `#10=CARTESIAN_POINT('',(${f(R)},0.,0.));`,
    "#11=AXIS2_PLACEMENT_3D('',#10,#6,#3);",
    `#12=CIRCLE('',#11,${f(r)});`,
    `#13=CARTESIAN_POINT('',(${f(R + r)},0.,0.));`,
    "#14=VERTEX_POINT('',#13);",
    "#15=EDGE_CURVE('',#14,#14,#12,.T.);",
    `#20=CARTESIAN_POINT('',(${f(-R)},0.,0.));`,
    "#21=DIRECTION('',(-1.,0.,0.));",
    "#22=AXIS2_PLACEMENT_3D('',#20,#6,#21);",
    `#23=CIRCLE('',#22,${f(r)});`,
    `#24=CARTESIAN_POINT('',(${f(-R - r)},0.,0.));`,
    "#25=VERTEX_POINT('',#24);",
    "#26=EDGE_CURVE('',#25,#25,#23,.T.);",
    "#30=AXIS2_PLACEMENT_3D('',#10,#7,#3);",
    "#31=PLANE('',#30);",
    "#32=ORIENTED_EDGE('',*,*,#15,.T.);",
    "#33=EDGE_LOOP('',(#32));",
    "#34=FACE_OUTER_BOUND('',#33,.T.);",
    "#35=ADVANCED_FACE('',(#34),#31,.T.);",
    "#40=AXIS2_PLACEMENT_3D('',#20,#7,#21);",
    "#41=PLANE('',#40);",
    "#42=ORIENTED_EDGE('',*,*,#26,.T.);",
    "#43=EDGE_LOOP('',(#42));",
    "#44=FACE_OUTER_BOUND('',#43,.T.);",
    "#45=ADVANCED_FACE('',(#44),#41,.T.);",
    "#50=ORIENTED_EDGE('',*,*,#15,.F.);",
    "#51=EDGE_LOOP('',(#50));",
    "#52=FACE_BOUND('',#51,.T.);",
    "#53=ORIENTED_EDGE('',*,*,#26,.F.);",
    "#54=EDGE_LOOP('',(#53));",
    "#55=FACE_BOUND('',#54,.T.);",
    "#56=ADVANCED_FACE('',(#52,#55),#5,.T.);",
    "#98=CLOSED_SHELL('',(#35,#45,#56));",
    "#99=MANIFOLD_SOLID_BREP('half torus',#98);",
  ]
  const path = join(tmpPath(), 'half_torus.step')
  writeFileSync(path, _step(e))
  const part = importStep(path) as Part
  assert.ok(part.isValid())
  for (const vol of part._props().field_volumes) approx(vol, Math.PI * r * r * Math.PI * R, 1e-6)
})

test('step extrusion whose generator rises along it', () => {
  // An extrusion along z of a B-spline that itself climbs 10 in z: the face's height above the
  // generator is not its height above the generator's first pole.
  const e = [
    "#1=CARTESIAN_POINT('',(0.,0.,0.));",
    "#2=DIRECTION('',(0.,0.,1.));",
    "#3=DIRECTION('',(1.,0.,0.));",
    "#5=CARTESIAN_POINT('',(10.,0.,10.));",
    "#6=B_SPLINE_CURVE_WITH_KNOTS('',1,(#1,#5),.UNSPECIFIED.,.F.,.F.,(2,2),(0.,1.),.UNSPECIFIED.);",
    "#7=VECTOR('',#2,1.);",
    "#8=SURFACE_OF_LINEAR_EXTRUSION('',#6,#7);",
    "#10=CARTESIAN_POINT('',(2.,0.,20.));",
    "#11=CARTESIAN_POINT('',(2.,0.,26.));",
    "#12=CARTESIAN_POINT('',(8.,0.,26.));",
    "#13=CARTESIAN_POINT('',(8.,0.,20.));",
    "#14=VERTEX_POINT('',#10);",
    "#15=VERTEX_POINT('',#11);",
    "#16=VERTEX_POINT('',#12);",
    "#17=VERTEX_POINT('',#13);",
    "#20=LINE('',#10,#7);",
    "#21=LINE('',#11,#23);",
    "#22=LINE('',#12,#24);",
    "#23=VECTOR('',#3,1.);",
    "#24=VECTOR('',#25,1.);",
    "#25=DIRECTION('',(0.,0.,-1.));",
    "#26=LINE('',#13,#27);",
    "#27=VECTOR('',#28,1.);",
    "#28=DIRECTION('',(-1.,0.,0.));",
    "#30=EDGE_CURVE('',#14,#15,#20,.T.);",
    "#31=EDGE_CURVE('',#15,#16,#21,.T.);",
    "#32=EDGE_CURVE('',#16,#17,#22,.T.);",
    "#33=EDGE_CURVE('',#17,#14,#26,.T.);",
    "#34=ORIENTED_EDGE('',*,*,#30,.T.);",
    "#35=ORIENTED_EDGE('',*,*,#31,.T.);",
    "#36=ORIENTED_EDGE('',*,*,#32,.T.);",
    "#37=ORIENTED_EDGE('',*,*,#33,.T.);",
    "#38=EDGE_LOOP('',(#34,#35,#36,#37));",
    "#39=FACE_OUTER_BOUND('',#38,.T.);",
    "#40=ADVANCED_FACE('',(#39),#8,.T.);",
    "#97=OPEN_SHELL('',(#40));",
    "#99=SHELL_BASED_SURFACE_MODEL('sheet',(#97));",
  ]
  const path = join(tmpPath(), 'rising.step')
  writeFileSync(path, _step(e))
  approx((importStep(path) as Shell).area, 36.0, 1e-9)
})

// -- closed B-spline surfaces, flipped faces and cavities (files from tool catalogs) -------------
type P3 = [number, number, number]

/** STEP entities numbered from #100 as they are added (the body is #99, see _step). */
class _Entities {
  lines: string[] = []

  add(text: string): string {
    const ref = `#${100 + this.lines.length}`
    this.lines.push(`${ref}=${text};`)
    return ref
  }

  point(x: number, y: number, z: number): string {
    return this.add(`CARTESIAN_POINT('',(${f(x)},${f(y)},${f(z)}))`)
  }

  vertex(x: number, y: number, z: number): string {
    return this.add(`VERTEX_POINT('',${this.point(x, y, z)})`)
  }

  axis(origin: P3, z: P3 = [0.0, 0.0, 1.0], x: P3 | null = null): string {
    const zd = this.add(`DIRECTION('',(${f(z[0])},${f(z[1])},${f(z[2])}))`)
    if (x === null) return this.add(`AXIS2_PLACEMENT_3D('',${this.point(...origin)},${zd},$)`)
    const xd = this.add(`DIRECTION('',(${f(x[0])},${f(x[1])},${f(x[2])}))`)
    return this.add(`AXIS2_PLACEMENT_3D('',${this.point(...origin)},${zd},${xd})`)
  }

  line(a: string, b: string, pa: P3, pb: P3): string {
    const d = pa.map((p, i) => pb[i] - p)
    const n = Math.sqrt(d.reduce((sum, c) => sum + c * c, 0))
    const direction = this.add(`DIRECTION('',(${f(d[0] / n)},${f(d[1] / n)},${f(d[2] / n)}))`)
    const line = this.add(`LINE('',${this.point(...pa)},${this.add(`VECTOR($,${direction},${f(n)})`)})`)
    return this.add(`EDGE_CURVE('',${a},${b},${line},.T.)`)
  }

  /** Counterclockwise about +z around the z axis, at height z. */
  arc(a: string, b: string, z: number, r: number): string {
    const circle = this.add(`CIRCLE('',${this.axis([0, 0, z], [0.0, 0.0, 1.0], [1, 0, 0])},${f(r)})`)
    return this.add(`EDGE_CURVE('',${a},${b},${circle},.T.)`)
  }

  plane(origin: P3, normal: P3 = [0.0, 0.0, 1.0]): string {
    return this.add(`PLANE('',${this.axis(origin, normal)})`)
  }

  solid(name: string, faces: string[]): string {
    const shell = this.add(`CLOSED_SHELL('',(${faces.join(',')}))`)
    return this.step(`MANIFOLD_SOLID_BREP('${name}',${shell})`)
  }

  face(surface: string, sameSense: boolean, ...loops: [string, boolean][][]): string {
    const bounds: string[] = []
    loops.forEach((loop, i) => {
      const uses = loop.map(([e, fwd]) => this.add(`ORIENTED_EDGE('',*,*,${e},${fwd ? '.T.' : '.F.'})`)).join(',')
      const kind = i === 0 ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'
      const loopRef = this.add(`EDGE_LOOP('',(${uses}))`)
      bounds.push(this.add(`${kind}('',${loopRef},.T.)`))
    })
    return this.add(`ADVANCED_FACE('',(${bounds.join(',')}),${surface},${sameSense ? '.T.' : '.F.'})`)
  }

  /** A cylinder about z as a closed rational B-spline surface (u around, v up), its seam at the
   * angle `seam` in degrees. */
  bsplineCylinder(r: number, h: number, seam: number): string {
    const rows: string[] = []
    const weights: string[] = []
    for (let k = 0; k < 9; k++) {
      const a = radians(seam + 45 * k)
      const g = k % 2 === 0 ? 1.0 : Math.sqrt(2)
      const [x, y] = [r * g * Math.cos(a), r * g * Math.sin(a)]
      rows.push(`(${this.point(x, y, 0)},${this.point(x, y, h)})`)
      const w = k % 2 === 0 ? 1.0 : Math.sqrt(0.5)
      weights.push(`(${f(w)},${f(w)})`)
    }
    return this.add(
      `(BOUNDED_SURFACE()B_SPLINE_SURFACE(2,1,(${rows.join(',')}),.UNSPECIFIED.,.T.,.F.,.F.)` +
        'B_SPLINE_SURFACE_WITH_KNOTS((3,2,2,2,3),(2,2),(0.,0.25,0.5,0.75,1.),(0.,1.),.UNSPECIFIED.)' +
        `GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_SURFACE((${weights.join(',')}))` +
        "REPRESENTATION_ITEM('')SURFACE())",
    )
  }

  step(body: string): string {
    return _step([...this.lines, `#99=${body};`])
  }
}

/** The solid between the arc from a0 to a1 degrees (radius 10, height 10) and its chord, the
 * curved face on a closed B-spline cylinder with its seam at `seam`. `slitAt`: the curved face's
 * loop also runs up a cut half way at that angle and back down. */
function _segmentOnBspline(a0: number, a1: number, seam: number, slitAt: number | null = null): string {
  const [r, h, s] = [10.0, 10.0, new _Entities()]
  const at = (a: number): [number, number] => [r * Math.cos(radians(a)), r * Math.sin(radians(a))]
  const [p0, p1] = [at(a0), at(a1)]
  const [v0b, v1b] = [s.vertex(...p0, 0), s.vertex(...p1, 0)]
  const [v0t, v1t] = [s.vertex(...p0, h), s.vertex(...p1, h)]
  const [top, chordT, chordB] = [s.arc(v0t, v1t, h, r), s.line(v1t, v0t, [...p1, h], [...p0, h]), s.line(v1b, v0b, [...p1, 0], [...p0, 0])]
  const [up0, up1] = [s.line(v0b, v0t, [...p0, 0], [...p0, h]), s.line(v1b, v1t, [...p1, 0], [...p1, h])]
  let bottom: [string, boolean][]
  let cut: [string, boolean][]
  if (slitAt === null) {
    bottom = [[s.arc(v0b, v1b, 0, r), true]]
    cut = []
  } else {
    const q = at(slitAt)
    const [vs, vc] = [s.vertex(...q, 0), s.vertex(...q, h / 2)]
    bottom = [
      [s.arc(v0b, vs, 0, r), true],
      [s.arc(vs, v1b, 0, r), true],
    ]
    const slit = s.line(vs, vc, [...q, 0], [...q, h / 2])
    cut = [
      [slit, true],
      [slit, false],
    ]
  }
  const m = radians((a0 + a1) / 2)
  return s.solid('segment', [
    s.face(s.bsplineCylinder(r, h, seam), true, [...bottom.slice(0, 1), ...cut, ...bottom.slice(1), [up1, true], [top, false], [up0, false]]),
    s.face(s.plane([0, 0, 0]), false, [...[...bottom].reverse().map(([e]): [string, boolean] => [e, false]), [chordB, false]]),
    s.face(s.plane([0, 0, h]), true, [
      [top, true],
      [chordT, true],
    ]),
    s.face(s.plane([...p0, 0], [-Math.cos(m), -Math.sin(m), 0]), true, [
      [chordB, true],
      [up0, true],
      [chordT, false],
      [up1, false],
    ]),
  ])
}

function _segmentVolume(a0: number, a1: number): number {
  const t = radians(a1 - a0)
  return ((10.0 * 100) / 2) * (t - Math.sin(t))
}

for (const [a0, a1, seam] of [
  [-90, 90, 0],
  [-60, 150, 30],
  [0, 180, 0],
  [10, 170, 0],
  [200, 350, 300],
]) {
  test(`step face across the seam of a closed bspline [${a0}, ${a1}, ${seam}]`, () => {
    // A face on a closed B-spline surface that lies across the surface's seam, without an edge
    // there: the kernel trims it the wrong way round unless the seam is moved off it.
    const path = join(tmpPath(), 'segment.step')
    writeFileSync(path, _segmentOnBspline(a0, a1, seam))
    const part = importStep(path) as Part
    assert.ok(part.isValid())
    approx(part.volume, _segmentVolume(a0, a1), 1e-6)
    const curved = part.faces().sortBy((face) => -face.area)[0]
    approx(curved.area, 10 * radians(a1 - a0) * 10, 1e-6)
    approx(part.mesh().volume, part.volume, 1e-2)
  })
}

test('step slit into a face on a closed bspline', () => {
  // A loop that runs up a cut into the face and back (a broken file): on a closed surface it looks
  // like a seam, but the rest of the loop does not go around the surface.
  const path = join(tmpPath(), 'slit.step')
  writeFileSync(path, _segmentOnBspline(-90, 90, 0, 0))
  const part = importStep(path) as Part
  assert.ok(part.isValid())
  approx(part.volume, _segmentVolume(-90, 90), 1e-6)
  approx(part.area, 10 * Math.PI * 10 + 2 * 50 * Math.PI + 200, 1e-6)
})

test('step bspline tube bounded by two circles', () => {
  // A closed B-spline face bounded by a circle at each end and no seam edge (the hub of an
  // impeller): it needs the seam the kernel adds.
  const [r, h, s] = [10.0, 10.0, new _Entities()]
  const [vb, vt] = [s.vertex(r, 0, 0), s.vertex(r, 0, h)]
  const [bottom, top] = [s.arc(vb, vb, 0, r), s.arc(vt, vt, h, r)]
  const path = join(tmpPath(), 'tube.step')
  writeFileSync(
    path,
    s.solid('tube', [
      s.face(s.bsplineCylinder(r, h, 0), true, [[bottom, true]], [[top, false]]),
      s.face(s.plane([0, 0, 0]), false, [[bottom, false]]),
      s.face(s.plane([0, 0, h]), true, [[top, true]]),
    ]),
  )
  const part = importStep(path) as Part
  assert.ok(part.isValid())
  approx(part.volume, Math.PI * r * r * h, 1e-6)
  approx(part.mesh().volume, part.volume, 1e-2)
})

test('step face flagged against its loops', () => {
  // A face whose same_sense flag disagrees with its loops (and so with its neighbours): the loops
  // decide, as they do in the other readers.
  const path = join(tmpPath(), 'box.step')
  exportStep(Box(10, 20, 30), path)
  let text = readFileSync(path, 'utf8')
  const faces = [...text.matchAll(/(#\d+)=ADVANCED_FACE\('[^']*',\([^)]*\),#\d+,\.(T|F)\.\)/g)]
  const [, ref, flag] = faces[0]
  const flipped = ({ T: 'F', F: 'T' } as Record<string, string>)[flag]
  text = text.replace(new RegExp(`(${ref}=ADVANCED_FACE\\('[^']*',\\([^)]*\\),#\\d+,)\\.${flag}\\.\\)`, 'g'), `$1.${flipped}.)`)
  writeFileSync(path, text)
  const part = importStep(path) as Part
  assert.ok(part.isValid())
  approx(part.volume, 6000, 1e-9)
  approx(part.area, 2 * (200 + 300 + 600), 1e-9)
})

/** The closed shell of an axis-aligned box, faces pointing out of it. */
function _box(s: _Entities, lo: P3, hi: P3): string {
  const c: P3[] = []
  for (const z of [lo[2], hi[2]]) for (const y of [lo[1], hi[1]]) for (const x of [lo[0], hi[0]]) c.push([x, y, z])
  const v = c.map((p) => s.vertex(...p))
  const edges = new Map<string, string>()
  const edge = (i: number, j: number): [string, boolean] => {
    const back = edges.get(`${j},${i}`)
    if (back !== undefined) return [back, false]
    const e = edges.get(`${i},${j}`) ?? s.line(v[i], v[j], c[i], c[j])
    edges.set(`${i},${j}`, e)
    return [e, true]
  }
  // each face's corners counterclockwise seen from outside, and its outward normal
  const quads: [number[], P3][] = [
    [[0, 2, 3, 1], [0, 0, -1]],
    [[4, 5, 7, 6], [0, 0, 1]],
    [[0, 1, 5, 4], [0, -1, 0]],
    [[2, 6, 7, 3], [0, 1, 0]],
    [[0, 4, 6, 2], [-1, 0, 0]],
    [[1, 3, 7, 5], [1, 0, 0]],
  ]
  const faces: string[] = []
  for (const [q, n] of quads) {
    faces.push(
      s.face(
        s.plane(c[q[0]], n),
        true,
        [0, 1, 2, 3].map((k) => edge(q[k], q[(k + 1) % 4])),
      ),
    )
  }
  return s.add(`CLOSED_SHELL('',(${faces.join(',')}))`)
}

test('step solid with a cavity', () => {
  // BREP_WITH_VOIDS: the cavity is a void region inside the solid, as the file has it (the Boolean
  // difference fails where a cavity comes close to the outside).
  const s = new _Entities()
  const outer = _box(s, [0, 0, 0], [40, 30, 20])
  const cavity = s.add(`ORIENTED_CLOSED_SHELL('',*,${_box(s, [10, 10, 5], [30, 20, 15])},.F.)`)
  const path = join(tmpPath(), 'cavity.step')
  writeFileSync(path, s.step(`BREP_WITH_VOIDS('block',${outer},(${cavity}))`))
  const part = importStep(path) as Part
  assert.ok(part.isValid())
  assert.equal(part.faces().length, 12)
  approx(part.volume, 40 * 30 * 20 - 20 * 10 * 10, 1e-9)
  approx(part.area, 2 * (1200 + 800 + 600) + 2 * (200 + 200 + 100), 1e-9)
})

/** A puck of radius 10 and height 10 whose bottom edge is rounded with radius 2 by a torus face,
 * with the bound of one face (`flagged`) marked reversed against the loop it holds. */
function _puck(flagged: string, axisDown: boolean): string {
  const s = new _Entities()
  const [R, h, rf] = [10.0, 10.0, 2.0]
  const [vTop, vMid, vBot] = [s.vertex(R, 0, h), s.vertex(R, 0, rf), s.vertex(R - rf, 0, 0)]
  const [cTop, cMid, cBot] = [s.arc(vTop, vTop, h, R), s.arc(vMid, vMid, rf, R), s.arc(vBot, vBot, 0, R - rf)]
  const seam = s.line(vMid, vTop, [R, 0, rf], [R, 0, h])
  const tube = s.add(`CIRCLE('',${s.axis([R - rf, 0, rf], [0, 1, 0], [1, 0, 0])},${f(rf)})`)
  const tubeSeam = s.add(`EDGE_CURVE('',${vMid},${vBot},${tube},.T.)`) // down from the side to the bottom
  const torus = s.add(
    `TOROIDAL_SURFACE('',${s.axis([0, 0, rf], [0, 0, axisDown ? -1 : 1], [1, 0, 0])},${f(R - rf)},${f(rf)})`,
  )
  const faces: Record<string, string> = {
    top: s.face(s.plane([0, 0, h]), true, [[cTop, true]]),
    side: s.face(s.add(`CYLINDRICAL_SURFACE('',${s.axis([0, 0, 0], [0, 0, 1], [1, 0, 0])},${f(R)})`), true, [
      [cMid, true],
      [seam, true],
      [cTop, false],
      [seam, false],
    ]),
    bottom: s.face(s.plane([0, 0, 0], [0, 0, -1]), true, [[cBot, false]]),
    fillet: s.face(torus, true, [
      [cMid, false],
      [tubeSeam, true],
      [cBot, true],
      [tubeSeam, false],
    ]),
  }
  const face = s.lines.find((line) => line.startsWith(`${faces[flagged]}=`)) as string
  const bound = (/ADVANCED_FACE\('',\((#\d+)/.exec(face) as RegExpExecArray)[1]
  const i = s.lines.findIndex((line) => line.startsWith(`${bound}=`))
  s.lines[i] = s.lines[i].replace(',.T.);', ',.F.);')
  return s.solid('puck', Object.values(faces))
}

for (const [flagged, axisDown] of [
  ['fillet', true],
  ['fillet', false],
  ['bottom', true],
] as [string, boolean][]) {
  test(`step face bound flagged against its neighbours [${flagged}, ${axisDown}]`, () => {
    // A face whose bound is flagged reversed, so that its loop uses the edges it shares the same
    // way round as its neighbours do (issue #3: the fillets of a hole in a file from another
    // kernel). The neighbours decide: on the torus the loop would bound the rest of the tube.
    const path = join(tmpPath(), 'puck.step')
    writeFileSync(path, _puck(flagged, axisDown))
    const part = importStep(path) as Part
    const [R, h, rf] = [10.0, 10.0, 2.0]
    const corner = rf * rf * (1 - Math.PI / 4) // the cross-section the rounding takes away, and its centroid
    const centroid = R - (rf * (10 - 3 * Math.PI)) / (3 * (4 - Math.PI))
    assert.ok(part.isValid())
    assert.equal(part.faces().length, 4)
    approx(part.volume, Math.PI * R * R * h - corner * 2 * Math.PI * centroid, 1e-9)
    const fillet = 2 * Math.PI * rf * (((R - rf) * Math.PI) / 2 + rf) // a quarter of the tube, the outer one
    approx(part.area, Math.PI * (R * R + 2 * R * (h - rf) + (R - rf) ** 2) + fillet, 1e-9)
  })
}

// -- readStep: coordinate systems, curves and points --------------------------------------------
/** An assembly ASM holding the product TOOL 100 up: TOOL has the cylinder as its body, the
 * coordinate system MCS (and a hidden one), and a curve set with a red B-spline, an arc, a
 * composite path and the point CRP (NX and tool catalogs write tools so). */
function _toolWithSupplementalGeometry(): string {
  const e = [
    ..._cylinderEntities(0.0),
    "#100=APPLICATION_CONTEXT('automotive design');",
    "#101=PRODUCT_CONTEXT('',#100,'mechanical');",
    "#102=PRODUCT_DEFINITION_CONTEXT('part definition',#100,'design');",
    "#110=PRODUCT('ASM','ASM','',(#101));",
    "#111=PRODUCT_DEFINITION_FORMATION('','',#110);",
    "#112=PRODUCT_DEFINITION('design','',#111,#102);",
    "#113=PRODUCT_DEFINITION_SHAPE('','',#112);",
    "#114=SHAPE_REPRESENTATION('ASM',(#4,#130),#903);",
    "#115=SHAPE_DEFINITION_REPRESENTATION(#113,#114);",
    "#120=PRODUCT('TOOL','TOOL','',(#101));",
    "#121=PRODUCT_DEFINITION_FORMATION('','',#120);",
    "#122=PRODUCT_DEFINITION('design','',#121,#102);",
    "#123=PRODUCT_DEFINITION_SHAPE('','',#122);",
    "#124=SHAPE_REPRESENTATION('TOOL',(#4),#903);",
    "#125=SHAPE_DEFINITION_REPRESENTATION(#123,#124);",
    "#126=NEXT_ASSEMBLY_USAGE_OCCURRENCE('1','','',#112,#122,$);",
    "#127=PRODUCT_DEFINITION_SHAPE('','',#126);",
    "#128=(REPRESENTATION_RELATIONSHIP('','',#124,#114)REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#129)" + 'SHAPE_REPRESENTATION_RELATIONSHIP());',
    "#129=ITEM_DEFINED_TRANSFORMATION('','',#4,#130);",
    "#131=CARTESIAN_POINT('',(0.,0.,100.));",
    "#130=AXIS2_PLACEMENT_3D('',#131,#2,#3);",
    '#132=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#128,#127);',
    "#133=SHAPE_REPRESENTATION_RELATIONSHIP('','',#124,#904);",
    // supplemental geometry: MCS at the top of the cylinder, a hidden helper at z = 5
    "#140=CONSTRUCTIVE_GEOMETRY_REPRESENTATION('supplemental geometry',(#141,#144),#903);",
    "#142=CARTESIAN_POINT('',(0.,0.,20.));",
    "#143=DIRECTION('',(0.,1.,0.));",
    "#141=AXIS2_PLACEMENT_3D('MCS',#142,#2,#143);",
    "#145=CARTESIAN_POINT('',(0.,0.,5.));",
    "#144=AXIS2_PLACEMENT_3D('',#145,#2,#3);",
    "#146=CONSTRUCTIVE_GEOMETRY_REPRESENTATION_RELATIONSHIP('supplemental geometry','',#124,#140);",
    "#147=PRESENTATION_LAYER_ASSIGNMENT('180','',(#144));",
    '#148=INVISIBILITY((#147));',
    // wireframe: a curve set
    "#150=GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION('TOOL',(#151),#903);",
    "#151=GEOMETRIC_CURVE_SET('',(#152,#160,#170,#155));",
    "#153=CARTESIAN_POINT('',(0.,0.,0.));",
    "#154=CARTESIAN_POINT('',(3.,4.,0.));",
    "#152=B_SPLINE_CURVE_WITH_KNOTS('CUTTING EDGE LINE',1,(#153,#154),.UNSPECIFIED.,.F.,.F.,(2,2),(0.,1.)," + '.UNSPECIFIED.);',
    "#155=CARTESIAN_POINT('CRP',(1.,2.,3.));",
    "#161=CIRCLE('',#4,10.);",
    `#160=TRIMMED_CURVE('ARC',#161,(PARAMETER_VALUE(0.)),(PARAMETER_VALUE(${f(Math.PI / 2)})),.T.,.PARAMETER.);`,
    "#175=VECTOR('',#3,1.);",
    "#176=LINE('',#1,#175);",
    "#177=CARTESIAN_POINT('',(10.,0.,0.));",
    "#173=TRIMMED_CURVE('',#176,(#1),(#177),.T.,.CARTESIAN.);",
    "#178=VECTOR('',#143,1.);",
    "#179=LINE('',#177,#178);",
    "#174=TRIMMED_CURVE('',#179,(PARAMETER_VALUE(0.)),(PARAMETER_VALUE(10.)),.T.,.PARAMETER.);",
    '#171=COMPOSITE_CURVE_SEGMENT(.CONTINUOUS.,.T.,#173);',
    '#172=COMPOSITE_CURVE_SEGMENT(.CONTINUOUS.,.T.,#174);',
    "#170=COMPOSITE_CURVE('PATH',(#171,#172),.F.);",
    "#156=SHAPE_REPRESENTATION_RELATIONSHIP('','',#124,#150);",
    "#190=STYLED_ITEM('',(#191),#152);",
    '#191=PRESENTATION_STYLE_ASSIGNMENT((#192));',
    "#192=CURVE_STYLE('',#193,POSITIVE_LENGTH_MEASURE(1.),#194);",
    "#193=DRAUGHTING_PRE_DEFINED_CURVE_FONT('continuous');",
    "#194=COLOUR_RGB('',1.,0.,0.);",
  ]
  return _step(e)
}

/** pytest.approx of points: each coordinate within `rel` of the expected one (or `abs`). */
function near(actual: { toArray(): number[] }, expected: number[], rel = 1e-6, abs = 1e-12): void {
  const a = actual.toArray()
  expected.forEach((v, i) => approx(a[i], v, rel, abs))
}

test('readStep reads coordinate systems, curves and points', () => {
  const path = join(tmpPath(), 'tool.step')
  writeFileSync(path, _toolWithSupplementalGeometry())
  const model = readStep(path)
  assert.equal(String(model), 'StepModel(1 bodies, 1 frames, 3 curves, 1 points)')
  assert.equal(model.bodies.length, 1)
  const body = model.bodies[0] as Part
  approx(body.volume, Math.PI * 100 * 20, 1e-6)
  approx(body.bbox().min.z, 100, 0, 1e-9) // placed by the assembly
  // the coordinate system, at its place in the assembly; the hidden one is left out
  assert.equal(model.frames.length, 1)
  const mcs = model.frames[0]
  assert.deepEqual([mcs.name, mcs.product], ['MCS', 'TOOL'])
  near(mcs.plane.origin, [0, 0, 120])
  near(mcs.plane.xDir, [0, 1, 0])
  assert.ok(model.frame('MCS').equals(mcs.plane) && model.frame('MCS', 'TO').equals(mcs.plane))
  assert.throws(
    () => model.frame('PCS'),
    (e: unknown) => e instanceof RangeError && /no coordinate system 'PCS'.*'MCS'/.test(e.message),
  )
  // the curves: a red B-spline, a quarter circle, and a path of two lines as a wire
  assert.equal(model.curves.length, 3)
  const [line, arc, path_] = model.curves
  assert.deepEqual([line.name, line.product, line.color], ['CUTTING EDGE LINE', 'TOOL', [1.0, 0.0, 0.0]])
  approx(line.shape.length, 5)
  near(line.shape.start, [0, 0, 100])
  approx(arc.shape.length, 5 * Math.PI)
  near(arc.shape.end, [0, 10, 100], 0, 1e-9)
  assert.ok(path_.shape instanceof Wire)
  approx(path_.shape.length, 20)
  near(path_.shape.end, [10, 10, 100], 0, 1e-9)
  assert.equal(model.points.length, 1)
  const crp = model.points[0]
  assert.equal(crp.name, 'CRP')
  near(crp.point, [1, 2, 103])
  // importStep reads the same file for its body alone
  approx((importStep(path) as Part).volume, body.volume)
})

// smlibwasm's in-memory pair (no Python counterpart): the text of a file, and a file's contents
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

test('fromStepModel reads in memory what readStep reads from a file', () => {
  const text = _toolWithSupplementalGeometry()
  const path = join(tmpPath(), 'tool.step')
  writeFileSync(path, text)
  const fromFile = readStep(path)
  for (const data of [text, new TextEncoder().encode(text)]) {
    const model = fromStepModel(data)
    assert.ok(model instanceof StepModel)
    assert.equal(String(model), String(fromFile))
    assert.deepEqual(
      model.frames.map((fr) => [fr.name, fr.product, String(fr.plane)]),
      fromFile.frames.map((fr) => [fr.name, fr.product, String(fr.plane)]),
    )
    assert.deepEqual(
      model.curves.map((c) => [c.name, String(c.shape)]),
      fromFile.curves.map((c) => [c.name, String(c.shape)]),
    )
    assert.ok(model.points[0].equals(fromFile.points[0]))
  }
  assert.throws(() => fromStepModel(42 as unknown as string), (e: unknown) => e instanceof TypeError && /fromStepModel takes/.test(e.message))
})

// -- edges off their faces, faces that share nothing, shared vertices, seam checks -------------------
/** A STEP text with the origin of every PLANE moved by `shift` along x, y and z, its edges and
 * vertices left where they are: edges that lie off their faces, as low-precision writers leave them. */
function planesMoved(text: string, shift: number): string {
  const axes = new Set(Array.from(text.matchAll(/=PLANE\('',#(\d+)\)/g), (m) => m[1]))
  const origins = new Set(Array.from(text.matchAll(/#(\d+)=AXIS2_PLACEMENT_3D\('',#(\d+),/g)).filter((m) => axes.has(m[1])).map((m) => m[2]))
  return text.replace(/#(\d+)=CARTESIAN_POINT\('',\(([^)]*)\)\);/g, (all, id, xyz) =>
    origins.has(id) ? `#${id}=CARTESIAN_POINT('',(${xyz.split(',').map((c: string) => f(Number(c) + shift)).join(',')}));` : all,
  )
}

test('step edges off their faces keep their convexity', () => {
  // The edges of an L-shaped block whose planes lie 6e-4 off its edges (the valve body's edges lie
  // 6.6e-4 off theirs): the convexity was read from two steps of 1e-4 x the length into a face,
  // which the gap swamped, and 9 of its 21 edges came out the wrong way. The kernel's outer angle
  // (SmEdge::CalcOuterAngle) does not look at the faces' distances.
  const block = Box(20, 20, 20).cut(Box(20, 20, 20).translate([10, 10, 10]))
  const moved = fromStep(planesMoved(toStep(block), 6e-4)) as Part
  assert.ok(moved.isValid())
  assert.deepEqual(moved.edges().map((e) => e.convexity).sort(), block.edges().map((e) => e.convexity).sort())
  assert.equal(moved.edges().concave().length, 3)
  assert.equal(moved.edges().convex().length, 18)
  assert.deepEqual(moved.edges().concave().map((e) => Math.round(e.dihedralAngle * 1e6) / 1e6), [270, 270, 270])
  // a box: 90 degrees through the material; a rounded edge's borders meet tangentially
  const box = Box(10, 10, 10)
  assert.deepEqual([...new Set(box.edges().map((e) => Math.round(e.dihedralAngle * 1e9) / 1e9))], [90])
  const rounded = box.fillet(box.edges().parallelTo(Z), 2)
  assert.equal(rounded.edges().smooth().length, 8)
  assert.ok(rounded.edges().smooth().every((e) => Math.abs(e.dihedralAngle - 180) < 1e-6))
  // where the kernel cannot tell (both sides of the edge the same kind of region): as before
  const merged = Box(10, 10, 10).merge(Box(10, 10, 10).translate([10, 0, 0]))
  assert.equal(merged.edges().convex().length, merged.edges().length)
  const sheet = box.faces().top()[0].toShell()
  assert.deepEqual(sheet.edges().map((e) => e.convexity), ['convex', 'convex', 'convex', 'convex'])
  assert.throws(() => sheet.edges()[0].dihedralAngle, (e: unknown) => e instanceof RangeError && /does not lie between two faces/.test(e.message))
})

/** A STEP text in which no two faces share an edge or a vertex: each ORIENTED_EDGE gets an
 * EDGE_CURVE and VERTEX_POINTs of its own, the points moved by up to `gap`. */
function unshared(text: string, gap: number): string {
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

test('faces of an import whose faces share nothing throw', () => {
  // Faces that share no edges, with vertex points up to 1e-3 off (low-precision writers): copying
  // one out of the body fell back to copying the body and removing the other faces, the removal
  // failed, and deleting the copy then read low memory here (natively the process died). Now such a
  // copy is kept, never freed, and the call throws KernelError. (A check of parity with smlibpy: the
  // module did not trap on that read, so this passed before as well; the crash is tested natively.)
  const part = fromStep(unshared(toStep(Box(20, 10, 10).cut(Cylinder(3, 20))), 1e-3)) as Part
  assert.ok(part instanceof Part && !part.isValid())
  for (const face of part.faces()) assert.throws(() => face.toShell(), (e: unknown) => e instanceof KernelError && /copy face failed/.test(e.message))
  approx(Box(10, 10, 10).cut(Cylinder(2, 20)).volume, 1000 - Math.PI * 40, 1e-9) // the kernel still works
})

test('step import makes one vertex per file vertex', () => {
  // The builder started each new edge without the file's vertices, and the kernel made a vertex for
  // every vertexuse a loop had not linked yet: a rounded box came back with 48 vertices for the
  // file's 24, its corners each twice, and 48 links in its loops between edges that end and start at
  // different vertices.
  const box = Box(40, 30, 20)
  const rounded = box.fillet(box.edges(), 3)
  const text = toStep(rounded)
  assert.equal(text.split('VERTEX_POINT(').length - 1, 24)
  const back = fromStep(text) as Part
  assert.equal(back.vertices().length, 24)
  assert.ok(back.isValid())
  approx(back.volume, rounded.volume, 1e-12)
  let broken = 0
  for (const face of back.faces())
    for (const loop of k.face_boundary_loops(face._f) as [number, boolean][][])
      loop.forEach(([e, fwd], i) => {
        const [e2, fwd2] = loop[(i + 1) % loop.length]
        const [s1, t1] = k.edge_vertices(e)
        const [s2, t2] = k.edge_vertices(e2)
        if ((fwd ? t1 : s1) !== (fwd2 ? s2 : t2)) broken++
      })
  assert.equal(broken, 0)
})

test('seam checks on import free their curves', () => {
  // The kernel's seam check (SmFace::HasSeamProblem), which every STEP import runs on every body,
  // copied the seam curve it made and lost the original: 2.9 KB per cylinder, more per torus, each
  // call (2000 checks of a torus and a cylinder took 28 MB). In a process of its own, so that what
  // other tests left does not count.
  const src = new URL('../src/', import.meta.url).href
  const code = `
    import { Cylinder, Torus } from '${src}index.ts'
    import { ext } from '${src}kernel.ts'
    const ring = Torus(10, 2).fuse(Cylinder(3, 30))
    for (let i = 0; i < 50; i++) ext.seam_problems(ring._brep)
    globalThis.gc()
    const before = process.memoryUsage().rss
    for (let i = 0; i < 2000; i++) ext.seam_problems(ring._brep)
    globalThis.gc()
    console.log(Math.round((process.memoryUsage().rss - before) / 1048576))
  `
  const run = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 300_000 })
  assert.equal(run.status, 0, run.stderr)
  const grown = Number(run.stdout.trim())
  assert.ok(grown < 5, `2000 seam checks took ${grown} MB`) // was 28 MB
})
