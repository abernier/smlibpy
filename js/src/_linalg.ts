// The little linear algebra smlibpy takes from numpy: 3x3 symmetric eigen-decomposition (inertia,
// fitted planes) and the spread of point sets (collinear, coplanar).

/** A 3x3 matrix, row by row. */
export type Mat3 = number[]

/**
 * Eigenvalues (ascending) and unit eigenvectors of a symmetric 3x3 matrix, as numpy's eigh:
 * `vectors[i]` belongs to `values[i]`. Jacobi rotations, to full precision.
 */
export function eigh3(m: Mat3): { values: [number, number, number]; vectors: [number, number, number][] } {
  const a = m.slice()
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  for (let sweep = 0; sweep < 64; sweep++) {
    const off = Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[5])
    const scale = Math.abs(a[0]) + Math.abs(a[4]) + Math.abs(a[8])
    if (off <= 1e-300 || off <= 1e-17 * scale) break
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = a[p * 3 + q]
      if (apq === 0) continue
      const app = a[p * 3 + p]
      const aqq = a[q * 3 + q]
      const theta = (aqq - app) / (2 * apq)
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const c = 1 / Math.sqrt(t * t + 1)
      const s = t * c
      // A' = J^T A J with J the rotation in the (p, q) plane
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p]
        const akq = a[k * 3 + q]
        a[k * 3 + p] = c * akp - s * akq
        a[k * 3 + q] = s * akp + c * akq
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k]
        const aqk = a[q * 3 + k]
        a[p * 3 + k] = c * apk - s * aqk
        a[q * 3 + k] = s * apk + c * aqk
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p]
        const vkq = v[k * 3 + q]
        v[k * 3 + p] = c * vkp - s * vkq
        v[k * 3 + q] = s * vkp + c * vkq
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i * 4] - a[j * 4])
  const values = order.map((i) => a[i * 4]) as [number, number, number]
  const vectors = order.map((i) => [v[i], v[3 + i], v[6 + i]] as [number, number, number])
  return { values, vectors }
}

/** The mean of points given as [x, y, z]. */
export function mean3(points: readonly (readonly number[])[]): [number, number, number] {
  const c: [number, number, number] = [0, 0, 0]
  for (const p of points) {
    c[0] += p[0]
    c[1] += p[1]
    c[2] += p[2]
  }
  const n = Math.max(points.length, 1)
  return [c[0] / n, c[1] / n, c[2] / n]
}

/**
 * Singular values (descending) of the points less their mean, as numpy's
 * `svd(points - mean, compute_uv=False)`, and the right singular vectors (the directions of
 * most to least spread). One-sided Jacobi on the points themselves, so small singular values
 * keep their relative accuracy (the collinear and coplanar tests compare them to 1e-10 of the
 * largest).
 */
export function spread(points: readonly (readonly number[])[]): { values: number[]; directions: [number, number, number][] } {
  const c = mean3(points)
  const n = points.length
  const cols = [new Float64Array(n), new Float64Array(n), new Float64Array(n)]
  for (let r = 0; r < n; r++) for (let j = 0; j < 3; j++) cols[j][r] = points[r][j] - c[j]
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const dot = (a: Float64Array, b: Float64Array) => {
    let s = 0
    for (let r = 0; r < n; r++) s += a[r] * b[r]
    return s
  }
  for (let sweep = 0; sweep < 64; sweep++) {
    let rotated = false
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
      const alpha = dot(cols[i], cols[i])
      const beta = dot(cols[j], cols[j])
      const gamma = dot(cols[i], cols[j])
      if (gamma === 0 || Math.abs(gamma) <= 1e-17 * Math.sqrt(alpha * beta)) continue
      rotated = true
      const zeta = (beta - alpha) / (2 * gamma)
      const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta))
      const cs = 1 / Math.sqrt(1 + t * t)
      const sn = cs * t
      const a = cols[i]
      const b = cols[j]
      for (let r = 0; r < n; r++) {
        const x = a[r]
        const y = b[r]
        a[r] = cs * x - sn * y
        b[r] = sn * x + cs * y
      }
      for (let k = 0; k < 3; k++) {
        const x = v[k * 3 + i]
        const y = v[k * 3 + j]
        v[k * 3 + i] = cs * x - sn * y
        v[k * 3 + j] = sn * x + cs * y
      }
    }
    if (!rotated) break
  }
  const norms = cols.map((col) => Math.sqrt(dot(col, col)))
  const order = [0, 1, 2].sort((i, j) => norms[j] - norms[i])
  return {
    values: order.map((i) => norms[i]).slice(0, Math.min(n, 3)),
    directions: order.map((i) => [v[i], v[3 + i], v[6 + i]] as [number, number, number]),
  }
}

export function det3(m: Mat3): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
}
