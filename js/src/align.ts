// Alignment of new shapes relative to the origin.

import { type BoundBox, Vector } from './geometry.ts'

/**
 * How a new shape sits relative to the origin along an axis.
 *
 * `MIN` puts the shape's lower bound at the origin, `CENTER` centers it, `MAX` puts its upper
 * bound at the origin. Constructors take one value for all axes or one per axis:
 * `Box(10, 10, 2, { align: [Align.CENTER, Align.CENTER, Align.MIN] })` stands the box on the XY
 * plane.
 */
export const Align = { MIN: 'min', CENTER: 'center', MAX: 'max' } as const
export type Align = (typeof Align)[keyof typeof Align]

/** One alignment for all axes, or one per axis (null leaves an axis alone). */
export type AlignLike = Align | string | null | readonly (Align | string | null)[]

function _one(a: Align | string | null): Align | null {
  if (a == null) return null
  const v = a.toLowerCase()
  if (v !== 'min' && v !== 'center' && v !== 'max') throw new RangeError(`'${a}' is not a valid Align`)
  return v
}

/** Translation that aligns `box` as requested (axes beyond `dims` are left alone). */
export function alignmentOffset(box: BoundBox, align: AlignLike, dims = 3): Vector {
  if (align == null) return new Vector()
  let perAxis: (Align | null)[]
  if (typeof align === 'string') perAxis = new Array(dims).fill(_one(align))
  else {
    perAxis = align.map(_one)
    while (perAxis.length < 3) perAxis.push(null)
  }
  const lo = box.min.toArray()
  const hi = box.max.toArray()
  const out: number[] = []
  for (let i = 0; i < 3; i++) {
    const a = i < perAxis.length && i < dims ? perAxis[i] : null
    if (a === null) out.push(0)
    else if (a === 'min') out.push(-lo[i])
    else if (a === 'max') out.push(-hi[i])
    else out.push(-(lo[i] + hi[i]) / 2)
  }
  return new Vector(out)
}
