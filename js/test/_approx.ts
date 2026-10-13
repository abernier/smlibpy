// pytest.approx for the ported tests: equal within a relative tolerance (and 1e-12 absolute).
import assert from 'node:assert/strict'

export function approx(actual: number, expected: number, rel = 1e-6, abs = 1e-12): void {
  const tol = Math.max(rel * Math.abs(expected), abs)
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} is not ${expected} within ${tol}`)
}

/** Vectors (or anything with equals) equal within TOLERANCE. */
export function same(actual: { equals(o: unknown): boolean; toString(): string }, expected: unknown): void {
  assert.ok(actual.equals(expected), `${actual} is not ${String(expected)}`)
}

/** Gauss-Legendre nodes and weights on [-1, 1] (numpy's leggauss), by Newton's method. */
export function leggauss(n: number): [number[], number[]] {
  const x: number[] = []
  const w: number[] = []
  for (let i = 1; i <= n; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5))
    let dp = 0
    for (let it = 0; it < 100; it++) {
      let p0 = 1
      let p1 = z
      for (let k = 2; k <= n; k++) [p0, p1] = [p1, ((2 * k - 1) * z * p1 - (k - 1) * p0) / k]
      dp = (n * (z * p1 - p0)) / (z * z - 1)
      const dz = p1 / dp
      z -= dz
      if (Math.abs(dz) < 1e-16) break
    }
    x.push(z)
    w.push(2 / ((1 - z * z) * dp * dp))
  }
  return [x, w]
}
