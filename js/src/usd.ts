// USD files of exact bodies.
//
// NVIDIA's usd-brep stores B-reps in USD as BrepArray prims (its omniSolid schema): the topology
// and the exact geometry of each body as arrays, which USD tools with that schema (usd-brep, its
// usdview plugin, Omniverse) read as solids. Other USD tools and viewers do not draw them, so each
// body is written as a Mesh prim too. smlibwasm writes and reads them as .usda text with usd-brep's
// own conversion (compiled in, without OpenUSD). Binary USD (.usdc, .usdz) is not written or read:
// OpenUSD's usdcat converts between text and .usdc, usdzip packs a .usdz.

import { _opts, _warn, ext, kernelCall } from './kernel.ts'
import { toRgb } from './colors.ts'
import { Mesh, tessellate } from './mesh.ts'
import { Part, Shell, ShapeList } from './shapes.ts'
import { _DEFAULT_COLORS, _fs, _items } from './exporters.ts'
import { _MM_PER_UNIT } from './step.ts'

// biome-ignore lint: kernel results are plain JSON
type Any = any

// what to do instead of writing binary USD
const BINARY: Record<string, string> = {
  '.usdc':
    "write a .usda and convert it with usdcat (usdcat out.usda -o out.usdc), or in Python with OpenUSD: Sdf.Layer.FindOrOpen('out.usda').Export('out.usdc')",
  '.usdz':
    "write a .usda and pack it with usdzip (usdzip out.usdz out.usda), or in Python with OpenUSD: UsdUtils.CreateNewUsdzPackage('out.usda', 'out.usdz')",
}

/** How a USD file is written: `mesh` (default true) writes a Mesh prim (`<name>_mesh`) of each body,
 * which is what USD viewers draw, with `tolerance`, `angle` and `maxEdge` as in `tessellate`; false writes the
 * exact B-reps alone, for usd-brep and Omniverse, which draw BrepArray prims themselves and would
 * show each body twice. */
export interface UsdExportOptions {
  mesh?: boolean
  tolerance?: number | null
  angle?: number
  maxEdge?: number | null
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
    } else if (options.mesh ?? true) {
      items.push([(it as Any)._brep, name, rgb, ..._meshArrays(tessellate(it, options.tolerance ?? null, options.angle ?? 15, { maxEdge: options.maxEdge ?? null }))])
    } else {
      items.push([(it as Any)._brep, name, rgb, null, null, null])
    }
  })
  return items
}

/**
 * The text of a USD file (.usda) of parts, sheets and meshes: each body a BrepArray prim under
 * /World, its exact B-rep with its name and color, and a Mesh prim of it (`<name>_mesh`), which is
 * what USD viewers draw; meshes Mesh prims. The stage is in millimeters (metersPerUnit 0.001) with
 * Z up.
 */
export function toUsd(shapes: unknown, options: UsdExportOptions = {}): string {
  _opts('toUsd', options)
  const items = _usdItems(shapes, options)
  if (!items.length) throw new RangeError('toUsd: nothing to write')
  return kernelCall('toUsd', () => ext.usd_text(items, 'Z', 0.001))
}

/** Write parts, sheets and meshes to a USD file (.usda, or .usd as text); see `toUsd`. */
export function exportUsd(shapes: unknown, path: string, options: UsdExportOptions = {}): void {
  _opts('exportUsd', options)
  const p = String(path)
  const dot = p.lastIndexOf('.')
  const ext_ = dot > Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) ? p.slice(dot).toLowerCase() : ''
  if (ext_ in BINARY) throw new RangeError(`exportUsd writes text USD (.usda, .usd), not ${ext_}: ${BINARY[ext_]}`)
  _fs().writeFileSync(p, toUsd(shapes, options))
}

/** How a USD stage is read: `heal` runs the kernel's import healer on the bodies; `units` is the
 * stage's unit ("mm", "cm", "m", "um" or "inch") in place of its metersPerUnit (left out: the
 * stage's metersPerUnit; a stage that has none is taken as millimeters, where USD itself takes
 * centimeters); `placement` (default true) places the bodies as the stage does (the xformOps of
 * their prims and of the prims above them, a Y-up stage turned to Z up), false leaves each body where
 * its prim has it; `check` (default true) checks each body with the kernel before anything measures
 * it (not those smlibwasm wrote): gaps of more than 1e-3 of its size throw a RangeError, smaller ones
 * give a warning. */
export interface UsdImportOptions {
  heal?: boolean
  units?: string | null
  placement?: boolean
  check?: boolean
}

/** fromUsd's options: those of `UsdImportOptions`, and `resolve(asset, from)`, which gives the text
 * of a layer the stage names (a subLayer, a reference or a payload: `asset` as written, `from` the
 * name of the layer that names it, "" for the text given; a relative asset is taken from the
 * directory of `from`), or null if it has none. Without it, such layers are not read (a warning
 * names them). */
export interface UsdReadOptions extends UsdImportOptions {
  resolve?: ((asset: string, from: string) => string | Uint8Array | null | undefined) | null
}

type Layers = [string, string, Record<string, string>, Record<string, string>][]

function _text(data: string | Uint8Array): string {
  return typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data)
}

/** The layers of the stage whose root layer is `text` (named `root`): it and every layer the layers
 * name (subLayers, references, payloads), each read once through `read(asset, from)` (null: none),
 * which also says where it read it. Per layer [id, text, {asset: id of the layer read for it},
 * {asset: why none was read}]. */
function _layers(root: string, text: string, read: (asset: string, from: string) => [string, string | Uint8Array] | string | null): Layers {
  const layers = new Map<string, [string, Record<string, string>, Record<string, string>]>()
  const todo: [string, string][] = [[root, text]]
  while (todo.length) {
    const [id, body] = todo.pop()!
    if (layers.has(id)) continue
    const links: Record<string, string> = {}
    const missing: Record<string, string> = {}
    layers.set(id, [body, links, missing])
    const assets: string[] = kernelCall('fromUsd', () => ext.usd_assets(body))
    for (const asset of assets) {
      const found = read(asset, id)
      if (found === null || typeof found === 'string') {
        missing[asset] = found ?? 'it was not given'
        continue
      }
      const [target, data] = found
      links[asset] = target
      if (layers.has(target)) continue
      const t = _text(data)
      if (!t.startsWith('#usda')) {
        delete links[asset]
        missing[asset] = t.startsWith('PXR-USDC') || t.startsWith('PK') ? 'it is binary USD, which is not read' : 'it is not a .usda text'
        continue
      }
      todo.push([target, t])
    }
  }
  return [root, ...[...layers.keys()].filter((k) => k !== root)].map((k) => [k, ...layers.get(k)!] as Layers[number])
}

/** A path joined to the directory of another, '.' and '..' taken out (forward slashes). */
function _joined(from: string, asset: string): string {
  const out: string[] = []
  for (const p of (asset.startsWith('/') ? asset : from.replace(/[^\\/]*$/, '') + asset).split(/[\\/]/)) {
    if (p === '..' && out.length && out[out.length - 1] !== '..' && out[out.length - 1] !== '') out.pop()
    else if (p !== '.' && !(p === '' && out.length)) out.push(p)
  }
  return out.join('/')
}

function _stage(root: string, text: string, read: Parameters<typeof _layers>[2], options: UsdImportOptions, what: string): Part | Shell | ShapeList<Part | Shell> {
  let perUnit = 0
  if (options.units !== undefined && options.units !== null) {
    const u = _MM_PER_UNIT.get(options.units)
    if (u === undefined) throw new RangeError(`unknown unit '${options.units}'; use mm, cm, m, um or inch`)
    perUnit = u
  }
  const stage: { bodies: [number, string, Float64Array | null][]; warnings: string[]; unresolved: string[] } = kernelCall(what, () =>
    ext.usd_stage(_layers(root, text, read), options.heal ?? false, options.check ?? true, options.placement ?? true, perUnit),
  )
  const found = stage.bodies
  if (!found.length) throw new RangeError(`the USD file holds no BrepArray prims (bodies)${stage.unresolved.map((n) => `; ${n}`).join('')}`)
  for (const note of [...stage.warnings, ...stage.unresolved]) _warn(`${what}: ${note}`)
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

/**
 * The bodies of the BrepArray prims of a USD text (.usda): a single Part (or Shell, for a body
 * that encloses no volume) when it holds one body, otherwise a ShapeList of them, named and colored
 * as their prims (a body whose prim's name another prim has too is named by its prim's path). The
 * text is read as USD composes it: the layers it names (subLayers, references, payloads) come from
 * `resolve`; abstract (class), inactive and over-only prims hold no bodies. Lengths come out in
 * millimeters, the bodies placed as the stage has them (see `UsdImportOptions`). A malformed
 * BrepArray throws a RangeError that says what is wrong, in which body, face or edge, with the rule
 * of usd-brep's validator it breaks.
 */
export function fromUsd(data: string | Uint8Array, options: UsdReadOptions = {}): Part | Shell | ShapeList<Part | Shell> {
  _opts('fromUsd', options)
  const resolve = options.resolve
  const read = (asset: string, from: string): [string, string | Uint8Array] | string | null => {
    if (!resolve) return 'no resolve option was given to read it'
    const target = _joined(from, asset)
    const got = resolve(asset, from)
    return got === null || got === undefined ? `resolve gave nothing for it` : [target, got]
  }
  return _stage('', _text(data), read, options, 'fromUsd')
}

/** Read the bodies of the BrepArray prims of a USD text file (.usda, .usd), and the files it names
 * (subLayers, references, payloads) relative to the file that names them; see `fromUsd`. */
export function importUsd(path: string, options: UsdImportOptions = {}): Part | Shell | ShapeList<Part | Shell> {
  _opts('importUsd', options)
  const fs = _fs()
  const root = String(path)
  const read = (asset: string, from: string): [string, Uint8Array] | string => {
    if (asset.includes('://') || asset.includes('[')) return 'it is not a file path'
    const target = _joined(from, asset)
    try {
      return [target, fs.readFileSync(target)]
    } catch {
      return `there is no file ${target}`
    }
  }
  return _stage(root, _text(fs.readFileSync(root)), read, options, 'importUsd')
}
