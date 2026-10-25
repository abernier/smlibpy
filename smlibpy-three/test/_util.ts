// Helpers of the tests: comparisons within a tolerance, and a raycaster from a point along a direction.
import assert from 'node:assert/strict'
import * as THREE from 'three'

export function close(actual: number, expected: number, tol = 1e-6, what = ''): void {
  assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} is not within ${tol} of ${expected}`)
}

export function closeVector(actual: THREE.Vector3Like, expected: THREE.Vector3Like, tol = 1e-6, what = ''): void {
  const d = Math.hypot(actual.x - expected.x, actual.y - expected.y, actual.z - expected.z)
  assert.ok(d <= tol, `${what} (${actual.x}, ${actual.y}, ${actual.z}) is ${d} from (${expected.x}, ${expected.y}, ${expected.z})`)
}

export function closeBox(actual: THREE.Box3, expected: THREE.Box3, tol = 1e-6, what = ''): void {
  closeVector(actual.min, expected.min, tol, `${what} min`)
  closeVector(actual.max, expected.max, tol, `${what} max`)
}

export const box = (min: [number, number, number], max: [number, number, number]) => new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max))

/** A raycaster from `origin` along `direction` (normalized). */
export function ray(origin: [number, number, number], direction: [number, number, number], threshold = 1): THREE.Raycaster {
  const r = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize())
  r.params.Line.threshold = threshold
  return r
}

export const Y = new THREE.Vector3(0, 1, 0)
