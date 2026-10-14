// USD files of exact bodies.
//
// NVIDIA's usd-brep stores B-reps in USD as BrepArray prims (its omniSolid schema): the topology
// and the exact geometry of each body as arrays, which USD tools with that schema (usd-brep, its
// usdview plugin, Omniverse) read as solids. smlibwasm writes and reads them as .usda text with
// usd-brep's own conversion (compiled in, without OpenUSD). Binary USD (.usdc, .usdz) is not
// written or read: usdcat converts between text and binary.

import { ext, kernelCall } from './kernel.ts'
import { toRgb } from './colors.ts'
import { Mesh, tessellate } from './mesh.ts'
import { Part, Shell, ShapeList } from './shapes.ts'
import { _DEFAULT_COLORS, _fs, _items } from './exporters.ts'

// biome-ignore lint: kernel results are plain JSON
type Any = any

const BINARY = ['.usdc', '.usdz']

/** How a USD file is written: `mesh` adds a Mesh prim (`<name>_mesh`) of each body, for USD tools
 * that do not read B-reps (most viewers); `tolerance` and `angle` as in `tessellate`. */
export interface UsdExportOptions {
  mesh?: boolean
  tolerance?: number | null
  angle?: number
}

function _meshArrays(m: Mesh): [Float64Array, Uint32Array, Float32Array | null] {
  return [m.vertices, m.triangles, m.normals]
}

function _usdItems(shapes: unknown, options: UsdExportOptions): Any[] {
  const items: Any[] = []
  _items(shapes).forEach((it, i) => {
    const color = (it as Any).color || _DEFAULT_COLORS[i % _DEFAULT_COLORS.length]
    const rgb = Array.from(toRgb(color), Number)
    const name = (it as Any).name || (it instanceof Mesh ? 'mesh' : 'body')
    if (it instanceof Mesh) {
      items.push([null, name, rgb, ..._meshArrays(it)])
    } else if (options.mesh) {
      items.push([(it as Any)._brep, name, rgb, ..._meshArrays(tessellate(it, options.tolerance ?? null, options.angle ?? 15))])
    } else {
      items.push([(it as Any)._brep, name, rgb, null, null, null])
    }
  })
  return items
}

/**
 * The text of a USD file (.usda) of parts, sheets and meshes: each body a BrepArray prim under
 * /World, its exact B-rep, with its name and color; meshes Mesh prims. The stage is in millimeters
 * (metersPerUnit 0.001) with Z up.
 */
export function toUsd(shapes: unknown, options: UsdExportOptions = {}): string {
  const items = _usdItems(shapes, options)
  if (!items.length) throw new RangeError('toUsd: nothing to write')
  return kernelCall('toUsd', () => ext.usd_text(items, 'Z', 0.001))
}

/** Write parts, sheets and meshes to a USD file (.usda, or .usd as text); see `toUsd`. */
export function exportUsd(shapes: unknown, path: string, options: UsdExportOptions = {}): void {
  const p = String(path)
  const dot = p.lastIndexOf('.')
  const ext_ = dot > Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) ? p.slice(dot).toLowerCase() : ''
  if (BINARY.includes(ext_)) {
    throw new RangeError(`exportUsd writes text USD (.usda, .usd), not ${ext_}; convert it with usdcat (usdcat out.usda -o out${ext_})`)
  }
  _fs().writeFileSync(p, toUsd(shapes, options))
}

/**
 * The bodies of the BrepArray prims of a USD text (.usda): a single Part (or Shell, for a body
 * that encloses no volume) when it holds one body, otherwise a ShapeList of them, named and
 * colored as their prims. Lengths are taken as they are (smlibwasm writes millimeters). `heal`
 * runs the kernel's import healer on them. A malformed BrepArray throws a RangeError that says
 * what is wrong.
 */
export function fromUsd(data: string | Uint8Array, options: { heal?: boolean } = {}): Part | Shell | ShapeList<Part | Shell> {
  const text = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data)
  const found: [number, string, Float64Array | null][] = kernelCall('fromUsd', () => ext.usd_read(text, options.heal ?? false))
  if (!found.length) throw new RangeError('the USD file holds no BrepArray prims (bodies)')
  const out = new ShapeList<Part | Shell>()
  for (const [brep, name, color] of found) {
    // a part when it encloses a volume (one cell or more, see Part.merge), else a sheet
    const regions: { infinite: boolean; void: boolean }[] = ext.brep_dump(brep, false).regions
    const solid = regions.some((r) => !r.infinite && !r.void)
    const c = color ? (Array.from(color) as [number, number, number]) : null
    out.push(solid ? Part._wrap(brep, { name, color: c }) : Shell._wrap(brep, { name, color: c }))
  }
  return out.length === 1 ? out[0] : out
}

/** Read the bodies of the BrepArray prims of a USD text file (.usda, .usd); see `fromUsd`. */
export function importUsd(path: string, options: { heal?: boolean } = {}): Part | Shell | ShapeList<Part | Shell> {
  return fromUsd(_fs().readFileSync(String(path)), options)
}
