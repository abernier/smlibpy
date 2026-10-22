// OpenCASCADE .brep files.
//
// .brep is the B-rep format of OpenCASCADE and of the tools built on it (build123d, CadQuery,
// FreeCAD's Part workbench): the exact topology and geometry of one shape (a solid, a shell, a face
// or a compound of them), as BRepTools::Write writes it (ASCII) or BinTools::Write (binary). It holds
// no names, colors or units (OpenCASCADE tools model in millimeters).
//
// smlibwasm reads and writes it with NVIDIA usd-brep's bridge to OpenCASCADE's format (compiled in,
// without OpenCASCADE): a shape's faces, edges and vertices with their exact planes, cylinders, cones,
// spheres, tori and B-splines, and the curves of its edges in the parameters of their faces that
// OpenCASCADE needs, made anew from the exact geometry.

import { _opts, _warn, ext, k, kernelCall } from './kernel.ts'
import { Mesh } from './mesh.ts'
import { type Part, type Shell, ShapeList, _typeName } from './shapes.ts'
import { _body, _fs, _items } from './exporters.ts'
import { _repr } from './step_reader.ts'

// biome-ignore lint: kernel results are plain JSON
type Any = any

/** How a .brep file is read: `heal` (default false) runs the kernel's import healer on the bodies;
 * `check` (default true) checks each body with the kernel before anything measures it: one whose
 * faces, edges and vertices leave gaps of more than 1e-3 of its size throws a RangeError, smaller
 * gaps give a warning. */
export interface BrepImportOptions {
  heal?: boolean
  check?: boolean
}

// (the kernel Breps of the parts and sheets of shapes)
function _breps(shapes: unknown, what: string): number[] {
  const out: number[] = []
  for (const it of _items(shapes, false, what)) {
    if (it instanceof Mesh)
      throw new TypeError(`${what}: a .brep file holds exact bodies, not a Mesh: write meshes with exportStl, exportObj or exportGlb`)
    const b = (it as Any)._brep
    if (k.brep_face_count(b) === 0) {
      const named = (it as Any).name ? ` ${_repr((it as Any).name)}` : ''
      throw new RangeError(`${what}: the ${_typeName(it)}${named} has no faces to write (a Boolean that left nothing?)`)
    }
    out.push(b)
  }
  if (!out.length) throw new RangeError(`${what}: nothing to write`)
  return out
}

function _renamed(e: unknown, what: string): unknown {
  if (e instanceof RangeError && e.message.startsWith('brep: ')) return new RangeError(`${what}: ${e.message.slice(6)}`)
  return e
}

function _text(shapes: unknown, what: string): string {
  const breps = _breps(shapes, what)
  try {
    return kernelCall(what, () => ext.occt_text(breps))
  } catch (e) {
    throw _renamed(e, what)
  }
}

/**
 * The text of an OpenCASCADE .brep file of parts and sheets, as `exportBrep` writes it:
 * BRepTools::Read and `fromBrep` read it back.
 */
export function toBrep(shapes: unknown): string {
  return _text(shapes, 'toBrep')
}

/**
 * Write parts, sheets and faces to an OpenCASCADE .brep file (ASCII, as OpenCASCADE's
 * BRepTools::Write writes it), which build123d (import_brep), CadQuery (importBrep), FreeCAD and
 * OpenCASCADE itself read (Node only; `toBrep` gives the text anywhere).
 *
 * The file holds one shape: the solid or shell of a single body, or a compound of the bodies (a part
 * with several solids gives one solid each, a sheet its shell; a sheet whose faces share no edge, a
 * shell per connected set). Faces keep their exact surfaces (planes, cylinders, cones, spheres, tori
 * and B-splines; surfaces of revolution and extrusions are written as the B-splines they are), edges
 * their curves, and every edge gets its curves in the parameters of its faces, as OpenCASCADE
 * requires. Names and colors are not written: the format has no place for them (`exportStep` keeps
 * them).
 *
 * Throws a RangeError for a body without faces, a TypeError for meshes, curves and points, and a
 * KernelError where a body cannot be converted (an edge that lies farther from its face than 1e-3 of
 * the body's size, a face whose boundary does not close).
 */
export function exportBrep(shapes: unknown, path: string): void {
  _fs().writeFileSync(String(path), _text(shapes, 'exportBrep'))
}

function _read(data: Uint8Array | string, options: BrepImportOptions, what: string): Part | Shell | ShapeList<Part | Shell> {
  let got: { bodies: number[]; warnings: string[] }
  try {
    got = kernelCall(what, () => ext.occt_read(data, options.heal ?? false, options.check ?? true))
  } catch (e) {
    throw _renamed(e, what)
  }
  for (const note of got.warnings) _warn(`${what}: ${note}`)
  const out = new ShapeList<Part | Shell>()
  for (const b of got.bodies) out.push(_body(b, null, null, what))
  return out.length === 1 ? out[0] : out
}

/**
 * Read an OpenCASCADE .brep file (ASCII from BRepTools::Write, binary from BinTools::Write), as
 * build123d (export_brep), CadQuery (exportBrep), FreeCAD and OpenCASCADE write it (Node only;
 * `fromBrep` reads contents anywhere).
 *
 * Gives a Part for each solid of the file's shape and a Shell for each shell or face that is no
 * solid's (a single shape when there is one, otherwise a ShapeList in the order of the file's
 * compound), placed as the file places them and in its units (millimeters for the tools above).
 * Faces and edges keep their exact geometry: planes, cylinders, cones, spheres, tori and B-splines
 * come back as those; surfaces of extrusion and revolution, Bezier surfaces and offset geometry as
 * B-splines. Curves and points outside faces (wires, edges and vertices of the compound) are not
 * read: a warning names how many. A file that is not a .brep file, or whose shape holds no faces,
 * throws a RangeError; one the kernel cannot build, a KernelError.
 */
export function importBrep(path: string, options: BrepImportOptions = {}): Part | Shell | ShapeList<Part | Shell> {
  _opts('importBrep', options)
  return _read(_fs().readFileSync(String(path)), options, 'importBrep')
}

/** The bodies of an OpenCASCADE .brep file's contents (the text of an ASCII file, or the bytes of
 * either kind), as `importBrep` reads a file; the options as there. */
export function fromBrep(data: string | Uint8Array, options: BrepImportOptions = {}): Part | Shell | ShapeList<Part | Shell> {
  _opts('fromBrep', options)
  if (typeof data !== 'string' && !(data instanceof Uint8Array))
    throw new TypeError(`fromBrep reads the contents of a .brep file as a Uint8Array or a string, not ${_typeName(data)}`)
  return _read(data, options, 'fromBrep')
}
