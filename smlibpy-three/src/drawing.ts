// 2D drawings of parts: views with their visible and hidden lines, laid out side by side as
// projections are arranged on a sheet, as smlibpy's drawing_views draws them. The views lie in the
// XY plane, as sketches do: a drawing's 2D point (u, v) is three's (u, v, 0), so three's default
// camera (from +Z) shows the sheet as it is drawn, and the front view lies where the parts' front
// is. DXFExporter and SVGExporter (files.ts) write them. (The kernel names its views for Z up: it
// draws the parts turned onto render's stage.)
import * as THREE from 'three'
import { box3, call, describe, sm, vec } from './kernel.ts'
import { Body, curveOf, BrepEdge, isObject3D, operand, ShapeList } from './shapes.ts'
import { STAGE, staged } from './render.ts'

const UNSTAGE = STAGE.clone().transpose()

/** The views of a drawing, by where they look from, in three's axes: 'front' from +Z (towards
 * three's default camera), 'back' from -Z, 'top' from +Y, 'bottom' from -Y, 'left' from -X,
 * 'right' from +X. */
export type ViewName = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right'

/** How drawingViews draws. */
export interface DrawingViewsOptions {
  /** 'first-angle' (ISO, the default: the view from above goes below the front view, the view from
   * the left to its right) or 'third-angle' (ASME: the view from above goes above it, the view from
   * the left to its left). The back view goes at the far right. */
  projection?: 'first-angle' | 'third-angle'
  /** Draw the hidden lines (default true); false leaves each view's `hidden` empty. */
  hidden?: boolean
  /** Draw the edges where faces meet tangentially (the lines where fillets start); default false. */
  tangentEdges?: boolean
  /** The space between the views, in model units (default: a fifth of the parts' largest extent). */
  gap?: number | null
}

/**
 * One view of a drawing (see `drawingViews`): its name, the direction it looks from, and its lines.
 * The lines are edges of their own (THREE.Lines) in the XY plane, at the drawing's 2D coordinates:
 * the sheet's (u, v) is three's (u, v, 0), and three's default camera shows them as the sheet has
 * them.
 * DXFExporter writes views on the layers VISIBLE and HIDDEN (hidden lines dashed), SVGExporter as
 * paths (hidden ones dashed), each line where the scene shows it.
 */
export class DrawingView {
  /** Where the view looks from: 'front', 'back', 'top', 'bottom', 'left' or 'right'. */
  readonly name: ViewName
  /** The direction it looks from (from the parts towards the viewer), in three's axes: (0, 0, 1)
   * for the front view, (0, 1, 0) for the top view. */
  readonly direction: THREE.Vector3
  /** The lines seen from there. */
  readonly visible: ShapeList<BrepEdge>
  /** The lines the parts hide (drawn dashed). */
  readonly hidden: ShapeList<BrepEdge>

  constructor(name: ViewName, direction: THREE.Vector3Like, visible: Iterable<BrepEdge>, hidden: Iterable<BrepEdge>) {
    this.name = name
    this.direction = new THREE.Vector3(direction.x, direction.y, direction.z)
    this.visible = ShapeList.from(visible) as ShapeList<BrepEdge>
    this.hidden = ShapeList.from(hidden) as ShapeList<BrepEdge>
  }

  /** The box around the view's lines, where they are (in the XY plane: its z extent is 0); empty
   * for a view without lines. */
  bbox(target: THREE.Box3 = new THREE.Box3()): THREE.Box3 {
    if (!this.visible.length && !this.hidden.length) return target.makeEmpty()
    return call(() => box3(kernelView(this).bbox(), target))
  }
}

/** @internal
 * The kernel's view for a DrawingView: its lines where the scene shows them. */
export function kernelView(view: DrawingView): sm.DrawingView {
  const lines = (edges: readonly BrepEdge[]) => sm.ShapeList.from(edges.map((e) => operand(e, null, 'a drawing view') as sm.Edge)) as sm.ShapeList<sm.Edge>
  return new sm.DrawingView(view.name, vec(view.direction.clone().applyMatrix4(STAGE)), lines(view.visible), lines(view.hidden))
}

/**
 * The views of parts for a 2D drawing, laid out in the XY plane as a sheet arranges them: the front
 * view where the parts' front is, the others beside it (see `projection`), the
 * views of the front row sharing its height, those of its column its width.
 *
 * - `parts`: a part or shell, objects that hold them (their visible bodies), or a list of them:
 *   each where the scene shows it, drawn together, each body hiding the lines of the others behind
 *   it (bodies that overlap are not cut where they meet).
 * - `views`: the views by where they look from (see `ViewName`); the front view's sheet is three's
 *   x to the right and y up, the top view's x to the right and -z up, the right view's -z to the
 *   right and y up.
 *
 * Write them with DXFExporter or SVGExporter, or add their lines to a scene.
 */
export function drawingViews(
  parts: Body | THREE.Object3D | Iterable<Body | THREE.Object3D>,
  views: ViewName | readonly ViewName[] = ['front', 'top', 'left'],
  options: DrawingViewsOptions = {},
): DrawingView[] {
  const bodies = bodiesOf(parts)
  if (!bodies.length) throw new RangeError('drawingViews: nothing to draw: give parts or shells, or objects that hold them')
  const names = typeof views === 'string' ? views : [...views]
  return call(() => {
    const kernel = bodies.map((b) => staged(b) as sm.Part | sm.Shell)
    const drawn = sm.drawingViews(kernel.length === 1 ? kernel[0] : kernel, names, options)
    const lines = (edges: Iterable<sm.Edge>) => [...edges].map((e) => curveOf(e) as BrepEdge)
    const direction = (d: sm.Vector) => new THREE.Vector3(d.x, d.y, d.z).applyMatrix4(UNSTAGE)
    return drawn.map((v) => new DrawingView(v.name as ViewName, direction(v.direction), lines(v.visible), lines(v.hidden)))
  })
}

/** The bodies to draw: bodies given, and the visible bodies under the other objects given. */
function bodiesOf(parts: unknown): Body[] {
  const out: Body[] = []
  const visit = (o: THREE.Object3D, given: boolean) => {
    if (!given && !o.visible) return
    if (o instanceof Body) out.push(o)
    for (const child of o.children) visit(child, false)
  }
  const items = isObject3D(parts) ? [parts] : parts !== null && typeof parts === 'object' && Symbol.iterator in parts ? [...(parts as Iterable<unknown>)] : [parts]
  for (const o of items) {
    if (!isObject3D(o)) throw new TypeError(`drawingViews draws parts and shells, not ${describe(o)}`)
    visit(o, true)
  }
  return out
}
