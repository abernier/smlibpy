// Exact files the way three reads and writes files: a loader (THREE.Loader: load, loadAsync,
// parse) and an exporter (parse), as GLTFLoader and STLExporter are. Meshes need nothing of this
// package: a body is a THREE.Mesh, so three's GLTFExporter, STLExporter and OBJExporter write its
// tessellation as they write any mesh.
//
// STEP files are Z up as smlibpy is: a part standing in three stands in the file, and the other
// way round.
import * as THREE from 'three'
import { call, location, sm } from './kernel.ts'
import { Body, Edge, kernelOf, kernelOfShape, Wire, wrap } from './shapes.ts'

/** Reads STEP files into a THREE.Group of their bodies (Part or Shell), named and colored as the
 * file has them. */
export class STEPLoader extends THREE.Loader<THREE.Group> {
  override load(url: string, onLoad: (group: THREE.Group) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void {
    const loader = new THREE.FileLoader(this.manager)
    loader.setPath(this.path)
    loader.setResponseType('arraybuffer')
    loader.setRequestHeader(this.requestHeader)
    loader.setWithCredentials(this.withCredentials)
    loader.load(
      url,
      (data) => {
        try {
          onLoad(this.parse(data as ArrayBuffer))
        } catch (e) {
          if (onError) onError(e)
          else console.error(e)
          this.manager.itemError(url)
        }
      },
      onProgress,
      onError,
    )
  }

  /** The bodies of a STEP file (its text or bytes). */
  parse(data: string | ArrayBuffer | Uint8Array): THREE.Group {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    const read = call(() => sm.fromStep(bytes))
    const bodies = read instanceof sm.ShapeList ? [...read] : [read]
    const group = new THREE.Group()
    for (const value of bodies) {
      const body = wrap(value)
      body.name = value.name ?? ''
      if (value.color !== null) {
        // (the file's colors are sRGB, three's material colors linear)
        const material = (body.material as THREE.MeshStandardMaterial).clone()
        const color = value.color
        if (typeof color === 'string') material.color.setStyle(color)
        else {
          const scale = color.some((c) => c > 1) ? 1 / 255 : 1
          material.color.setRGB(color[0] * scale, color[1] * scale, color[2] * scale, THREE.SRGBColorSpace)
        }
        body.material = material
      }
      group.add(body)
    }
    return group
  }
}

/** Options of STEPExporter. */
export interface STEPExporterOptions {
  /** The product's name (default 'part'). */
  name?: string
  /** Each body a product of its own, named as its object, in an assembly called `name`. */
  assembly?: boolean
  /** Leave out invisible objects (default true, as GLTFExporter does). */
  onlyVisible?: boolean
}

/** Writes the exact bodies and curves under an object (or several) to STEP, each where the scene
 * shows it, named by its object's name and colored by its material's color. */
export class STEPExporter {
  parse(input: THREE.Object3D | readonly THREE.Object3D[], options: STEPExporterOptions = {}): string {
    const onlyVisible = options.onlyVisible ?? true
    const items: sm.Shape[] = []
    const visit = (o: THREE.Object3D) => {
      if (onlyVisible && !o.visible) return
      if (o instanceof Body || ((o instanceof Edge || o instanceof Wire) && o.owner === null)) {
        o.updateWorldMatrix(true, false)
        let value: sm.Shape = o instanceof Body ? kernelOf(o) : kernelOfShape(o)
        if (!o.matrixWorld.equals(IDENTITY)) value = call(() => value.moved(location(o.matrixWorld)))
        if (o instanceof Body) {
          const body = value as sm.Part | sm.Shell
          let named = body.named(o.name || null)
          const color = colorOf(o.material)
          if (color !== null) named = named.colored(color)
          value = named
        }
        items.push(value)
      }
      for (const child of o.children) visit(child)
    }
    for (const o of Array.isArray(input) ? input : [input as THREE.Object3D]) visit(o)
    return call(() => sm.toStep(items, { name: options.name, assembly: options.assembly }))
  }
}

const IDENTITY = new THREE.Matrix4()

/** A material's color as sRGB hex, null without one. */
function colorOf(material: THREE.Material | THREE.Material[]): string | null {
  const m = Array.isArray(material) ? material[0] : material
  const color = (m as { color?: THREE.Color } | undefined)?.color
  return (color as THREE.Color | undefined)?.isColor ? `#${color!.getHexString(THREE.SRGBColorSpace)}` : null
}
