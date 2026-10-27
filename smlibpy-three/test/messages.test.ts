// The kernel's messages in the package's words: its errors and warnings name the package's classes
// (BrepFace, Segment, Ball, ...) and three's types, place shapes with on() and transforms, and give
// angles in radians, as the API takes them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { ArcSlot, Circle, Rectangle, Trapezoid, setWarningHandler } from '../src/index.ts'
import { words } from '../src/kernel.ts'

test('angles in messages are radians: ranges, single values and the values the kernel got', () => {
  assert.throws(() => new Trapezoid(40, 15, 4), { name: 'RangeError', message: 'Trapezoid: leftAngle must be between 0 and π radians (got 4)' })
  assert.throws(() => new ArcSlot(10, 2, 7), { name: 'RangeError', message: 'ArcSlot: the angle is between 0 and 2π radians (got 7)' })
  assert.throws(() => new Rectangle(10, 10).extrude(5, { taper: 2 }), { name: 'RangeError', message: 'extrude: the taper must be between -π/2 and π/2 radians' })
  // (multiples of π by name, other angles to four digits; NURBS degrees are not angles)
  assert.equal(words('at 12.5 degrees the face would narrow to a point'), 'at 0.2182 radians the face would narrow to a point')
  assert.equal(words('an arc of 0°+90°'), 'an arc of 0 rad+π/2 rad')
  assert.equal(words('the angle must be between -180 and 180 degrees and not zero (got 400)'), 'the angle must be between -π and π radians and not zero (got 6.981)')
  assert.equal(words('twist must be a finite angle (degrees)'), 'twist must be a finite angle (radians)')
  assert.equal(words('fill: the patch meets a sheet at 19.5 degrees, not tangentially (at most 0.5); the sheets'), 'fill: the patch meets a sheet at 0.3403 radians, not tangentially (at most 0.008727 radians); the sheets')
  assert.equal(words('expected { degrees, knots, points, weights }'), 'expected { degrees, knots, points, weights }')
})

test("the kernel's classes and placements are named as the package names them", () => {
  assert.throws(() => new Rectangle(4, 10, { align: { x: 'min' } }).swing(new Circle(30)), {
    name: 'RangeError',
    message: /place it with \.on\(new THREE\.Matrix4\(\)\.makeRotationX\(Math\.PI \/ 2\)\)\)$/,
  })
  assert.equal(words('give a Part, Face or Edge; a Line is an Edge'), 'give a Part, BrepFace or BrepEdge; a Segment is a BrepEdge')
  assert.equal(words('a Sphere, a Triangle, a Font, a Vertex'), 'a Ball, a TriangleSketch, an OpenTypeFont, a BrepVertex')
  assert.equal(words("_Body.project() got an unexpected option 'mode'"), "Body.project() got an unexpected option 'mode'")
  assert.equal(words('unroll: axis must be an Axis'), 'unroll: axis must be a THREE.Ray')
  assert.equal(words("draw it with 2D points and place it with .on(plane)"), 'draw it with 2D points and place it with its transform or on()')
  assert.equal(words('for a plate on XY from z = 0 to t: new Axis([x, 0, t], [0, 1, 0])'), 'for a plate on XY from z = 0 to t: new THREE.Ray(new THREE.Vector3(x, 0, t), new THREE.Vector3(0, 1, 0))')
  // (three's names and the package's own stay)
  assert.equal(words('not a THREE.Line, a THREE.Sphere or a BrepFace'), 'not a THREE.Line, a THREE.Sphere or a BrepFace')
})

test("the kernel's warnings come in the package's words", () => {
  const said: string[] = []
  setWarningHandler((message) => said.push(message))
  try {
    // (a direction that nearly lies in the sketch plane, 0.0286 degrees off it, makes a thin solid, which the
    // kernel warns of)
    new Rectangle(10, 10).extrude(5, { direction: new THREE.Vector3(1, 0, 0.0005) })
  } finally {
    setWarningHandler(null)
  }
  assert.equal(said.length, 1)
  assert.match(said[0], /^extrude: the direction is 0\.000499\d* radians off the sketch plane/)
  // (and console.warn, without a handler, gets them so too)
  const warned: string[] = []
  const warn = console.warn
  console.warn = (message: string) => void warned.push(message)
  try {
    new Rectangle(10, 10).extrude(5, { direction: new THREE.Vector3(1, 0, 0.0005) })
  } finally {
    console.warn = warn
  }
  assert.equal(warned.length, 1)
  assert.match(warned[0], /radians off the sketch plane/)
})
