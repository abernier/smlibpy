// Machining setups: a part laid on a 3-axis router, its features sorted into the layers of a
// machining drawing, as smlibpy's machining_setup does. The part is taken where the scene shows it,
// "up" being three's +Y (the kernel's +Z on pictures' stage); the setup's part and layers lie in the
// setup's frame, the drawing in the XY plane as sketches do, the tool coming from +Z (towards
// three's default camera). DXFExporter writes the layers, each on the layer of its name.
import * as THREE from 'three'
import { call, describe, matrix4, sm, vec, vector3 } from './kernel.ts'
import { BrepFace, Part, ShapeList, Sketch, shapeFor, wrap } from './shapes.ts'
import { STAGE, staged } from './pictures.ts'

const UNSTAGE = STAGE.clone().transpose()

/** Why a setup leaves a feature to another one (see `MachiningSetup.elsewhere`). */
export type MachiningReason = 'opens below' | 'opens at the side' | 'enclosed' | 'not a prism along the tool'

/** What a setup leaves to another one: why, the direction a tool must come from instead (in the
 * setup's frame, or `null`), and the faces (of the setup's `part`). */
export type MachiningLeft = [why: MachiningReason, direction: THREE.Vector3 | null, faces: ShapeList<BrepFace>]

/** The options of `machiningSetup`. */
export interface MachiningSetupOptions {
  /** The direction of the scene (three's world) that becomes the drawing's x. Default: the
   * footprint's longest straight edge, laid along x at the bottom of the drawing (a board's long
   * side, with its grain); a footprint without one (a curved rail) lies along its principal axis. */
  xDir?: THREE.Vector3Like | THREE.Ray | null
  /** A text for the `LABEL` layer, at the footprint's centroid, with a grain arrow along x below
   * it; default none. */
  label?: string | null
  /** The label's capital height in model units; default a sixth of the footprint's shorter extent,
   * between 2 and 20. */
  labelSize?: number | null
}

/**
 * One setup of a part on a 3-axis machine (see `machiningSetup`).
 *
 * - `part`: the part in the setup's frame: resting on z = 0, the face the tool works from at
 *   z = `thickness`, its footprint in the positive quadrant of the XY plane.
 * - `matrix`: the setup's frame in three's world (smlibpy's `plane`, which a THREE.Plane cannot hold:
 *   it has no x direction): applied to `part` or to a layer, it puts it where the given part is in
 *   the scene.
 * - `thickness`: the part's extent along the tool: the stock's finished thickness.
 * - `layers`: sketches in the XY plane, one per layer, each named (its object's `name`, the layer
 *   DXFExporter writes it on): `OUTLINE` (the footprint's outer contours, the through cut),
 *   `THROUGH` (the holes through the part), `POCKET_D<depth>` (the pockets open on the top face, by
 *   depth from it: `POCKET_D15`, `POCKET_D7_5`) and `LABEL` (the label and the grain arrow, when a
 *   label is given).
 * - `elsewhere`: what this setup cannot cut, as `[why, direction, faces]` triples (see
 *   `MachiningLeft`): `'opens below'` (a pocket of the other face: turn the part over, direction
 *   (0, 0, -1)), `'opens at the side'` (a mortise in an edge: the direction the normal of the face it
 *   opens through), `'enclosed'` (a void; no direction) or `'not a prism along the tool'` (a face a
 *   vertical cutter cannot follow: a slope, a cove, an undercut; no direction).
 */
export class MachiningSetup {
  readonly part: Part
  readonly matrix: THREE.Matrix4
  readonly thickness: number
  readonly layers: Sketch[]
  readonly elsewhere: MachiningLeft[]

  constructor(part: Part, matrix: THREE.Matrix4, thickness: number, layers: Sketch[], elsewhere: MachiningLeft[]) {
    this.part = part
    this.matrix = matrix
    this.thickness = thickness
    this.layers = layers
    this.elsewhere = elsewhere
  }

  /** The sketch of one layer, or `null` when the setup has none of that name. */
  layer(name: string): Sketch | null {
    return this.layers.find((s) => s.name === name) ?? null
  }
}

/**
 * Lay a part on a 3-axis machine and sort its features into the layers of a machining drawing.
 *
 * - `part`: a `Part` of one solid, where the scene shows it.
 * - `direction`: where the tool comes from: a planar face of the part (the part rests on the
 *   opposite side and that face is worked), a ray or a vector of three's world (from the part
 *   towards the tool). Default: from above (three's +Y), the part as the scene stands it.
 * - `xDir`, `label`, `labelSize`: see `MachiningSetupOptions`.
 *
 * Returns a `MachiningSetup`: the part laid flat, its frame, the thickness, the layers (write them
 * with DXFExporter) and what the setup leaves for another one. The footprint is the union of the
 * part's cross-sections between its horizontal faces and of the shadows of its sloping planar
 * faces; a feature whose floor faces the tool and is open to it is a pocket, written at each of its
 * floors, its depth measured from the top face.
 *
 * Throws a TypeError for anything but a Part, and a RangeError for a part of several solids, a
 * curved face as the direction, an `xDir` along the tool or a `labelSize` that is not positive.
 */
export function machiningSetup(
  part: Part,
  direction: BrepFace | THREE.Ray | THREE.Vector3Like = { x: 0, y: 1, z: 0 },
  options: MachiningSetupOptions = {},
): MachiningSetup {
  if (!(part instanceof Part)) throw new TypeError(`machiningSetup lays out a Part, not ${describe(part)}`)
  const turned = (v: THREE.Vector3Like) => vec(new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(STAGE))
  const towards = direction instanceof BrepFace ? (staged(direction) as sm.Face) : turned(direction instanceof THREE.Ray ? direction.direction : direction)
  const o: Record<string, unknown> = { ...options }
  if (options.xDir != null) o.xDir = turned(options.xDir instanceof THREE.Ray ? options.xDir.direction : options.xDir)
  return call(() => {
    const setup = sm.machiningSetup(staged(part) as sm.Part, towards, o as sm.MachiningSetupOptions)
    const laid = wrap(setup.part) as Part
    laid.name = part.name
    const layers = setup.layers.map((s) => {
      const sketch = wrap(s) as Sketch
      sketch.name = s.name ?? ''
      return sketch
    })
    const elsewhere = setup.elsewhere.map(
      ([why, d, faces]): MachiningLeft => [why, d === null ? null : vector3(d), ShapeList.from(faces.map((f) => shapeFor(laid, f) as BrepFace)) as ShapeList<BrepFace>],
    )
    const matrix = matrix4(setup.plane.location).premultiply(UNSTAGE)
    return new MachiningSetup(laid, matrix, setup.thickness, layers, elsewhere)
  })
}
