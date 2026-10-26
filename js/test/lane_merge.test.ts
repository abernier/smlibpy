// Where the lanes of the kernel review meet (the merge of BT, FO, S, C, U, DA, IX, M and WN into
// fix/kernel-review): a fillet of a part read from a file runs in the probe worker (WN's
// `_isolatedValue`, FO's fillet executive) and still brings back the colors and names of its faces
// and where they came from (BT's T3 and T5, carried in the worker's answer); the file functions know
// every format the lanes added (.brep, .smp, .svg). Ported from tests/test_lane_merge.py.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Box, Cylinder, Part, drawingViews, fromFile, fromSmb, toFile, toSmb } from '../src/index.ts'
import { GUARD_SECONDS, setGuardSeconds } from '../src/defeature.ts'
import { approx } from './_approx.ts'

// biome-ignore lint: internal fields, for the checks
type Any = any

function painted(part: Part): Part {
  return part.colored('gold', { faces: part.faces().top() }).named('seal', { faces: part.faces().bottom() })
}

function own(part: Part): string[] {
  return part
    .faces()
    .filter((f) => f.color !== null || f.name !== null)
    .map((f) => JSON.stringify([f.geomType, f.color, f.name]))
    .sort()
}

test('fillets of imported parts keep the colors, names and history of their faces', () => {
  const made = painted(Box(60, 40, 8).cut(Cylinder(5, 20)))
  const read = painted(fromSmb(toSmb(made)) as Part)
  assert.equal((read as Any)._h.imported, true)
  assert.equal((made as Any)._h.imported, false)
  const here = made.fillet(made.edges().top(), 1)
  const there = read.fillet(read.edges().top(), 1) // (in the probe worker)
  const seconds = GUARD_SECONDS
  setGuardSeconds(0)
  let local: Part
  try {
    local = read.fillet(read.edges().top(), 1) // (in this kernel)
  } finally {
    setGuardSeconds(seconds)
  }
  for (const r of [there, local]) {
    assert.deepEqual(own(r), own(read))
    approx(r.volume, here.volume, 1e-9)
    assert.ok(r.isValid())
    assert.equal(r.faces().newSince(read).length, 5)
    assert.equal(r.faces().derivedFrom(read.faces().top()).length, 1)
  }
  assert.deepEqual(own(here), own(read))
  assert.equal(here.faces().newSince(made).length, 5)
})

test('every file type of the lanes', () => {
  const part = Box(20, 10, 5).cut(Cylinder(2, 10))
  for (const suffix of ['brep', 'smp']) {
    const back = fromFile(toFile(part, `part.${suffix}`) as Any, `part.${suffix}`) as Part
    assert.ok(back instanceof Part)
    assert.equal((back as Any)._h.imported, true)
    approx(back.volume, part.volume, 1e-12)
  }
  assert.ok(String(toFile(drawingViews(part), 'views.svg')).startsWith('<?xml'))
  assert.throws(() => toFile(part, 'part.svg'), /draws 2D shapes, not a Part/)
  assert.throws(() => toFile(part, 'part.xyz'), /use \.step, \.stl, \.glb, \.gltf, \.obj, \.smb, \.smp, \.dxf, \.svg, \.usda or \.brep/)
  assert.throws(() => fromFile('<svg/>', 'views.svg'), /fromFile reads \.step, \.stp, \.igs, \.iges, \.stl, \.smb, \.smp, \.dxf, \.usda and \.brep/)
})
