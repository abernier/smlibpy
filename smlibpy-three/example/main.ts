// smlibpy-three in a three.js page: a part made with smlibpy's API, drawn by three's own
// renderer, picked with three's own Raycaster. Hovering highlights the face or edge under the
// pointer (the kernel's, from `hit.brep`): a face is drawn by itself (a THREE.Mesh), an edge as a
// tube along its exact curve (`edge.curve`, a THREE.Curve). Clicking an edge rounds it.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Box, Cylinder, BrepEdge, BrepFace, GridLocations, Hole, Locations, Rectangle, type Part } from '@classcad/smlibpy-three'

const info = document.getElementById('info')!

// -- the part: a bracket on the ground ----------------------------------------------------------
function bracket(): Part {
  const up = new THREE.Vector3(0, 1, 0)
  // a plate lying on the ground, as THREE.BoxGeometry(120, 12, 80) would: 12 high
  let plate: Part = new Box(120, 12, 80, { align: { y: 'min' } })
  plate = plate.fillet(plate.edges().parallelTo(up), 10)
  // a boss standing on the plate: a sketch on the plate's top face (on() lays its XY plane on the
  // face, its +z along the face's normal), extruded up
  const top = plate.faces().top().one()
  const boss = new Rectangle(50, 30, { fillet: 6 }).on(top).extrude(24)
  let part = plate.fuse(boss)
  // four holes drilled into the top face, on a grid in the face's frame (its z the face's normal)
  const [frame] = Locations(top)
  part = part.cut(new Hole(5, 20).at(GridLocations(90, 50, 2, 2).map((m) => frame.clone().multiply(m))))
  // and a bore through the boss: a cylinder (along y, as three's) turned along z
  const bore = new Cylinder(8, 8, 100)
  bore.rotation.x = Math.PI / 2
  bore.position.y = 24
  return part.cut(bore)
}

// -- three ---------------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(devicePixelRatio)
renderer.setSize(innerWidth, innerHeight)
document.body.append(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#eef0f3')
scene.add(new THREE.HemisphereLight('#ffffff', '#8d96a3', 2.2))
const sun = new THREE.DirectionalLight('#ffffff', 2.4)
sun.position.set(120, 200, 90)
scene.add(sun)
scene.add(new THREE.GridHelper(400, 40, '#b9bec7', '#d5d9df'))

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 1, 5000)
camera.position.set(190, 170, 240)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 15, 0)
controls.update()

let part = bracket()
scene.add(part)

// -- hover: three's Raycaster, the kernel's faces and edges --------------------------------------
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2(2, 2)
let hovered: BrepFace | BrepEdge | null = null
let marker: THREE.Object3D | null = null
const edgeMaterial = new THREE.MeshBasicMaterial({ color: '#ff7a1a', depthTest: false })

function pick(): THREE.Intersection | undefined {
  raycaster.setFromCamera(pointer, camera)
  // (edges are picked within a few pixels: three's line threshold is in world units)
  const pixel = (2 * camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / innerHeight
  raycaster.params.Line.threshold = 5 * pixel
  const hits = raycaster.intersectObject(part)
  const first = hits[0]
  // an edge hit about as near as the first hit wins over the face it bounds
  return hits.find((h) => h.brep instanceof BrepEdge && h.distance < (first?.distance ?? 0) + 6 * pixel) ?? first
}

function highlight(next: BrepFace | BrepEdge | null): void {
  if (next === hovered) return
  if (marker) {
    part.remove(marker)
    if (marker !== hovered) (marker as THREE.Mesh).geometry.dispose()
  }
  hovered = next
  marker = null
  // (a face of the part is drawn in place as a child of the part, in its own highlight material;
  // an edge as a tube, since WebGL draws lines one pixel wide)
  if (hovered instanceof BrepFace) marker = hovered
  else if (hovered instanceof BrepEdge) {
    const pixel = (2 * camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / innerHeight
    marker = new THREE.Mesh(new THREE.TubeGeometry(hovered.curve, hovered.geomType === 'line' ? 1 : 64, 1.5 * pixel, 6), edgeMaterial)
    marker.raycast = () => {}
    marker.renderOrder = 1
  }
  if (marker) part.add(marker)
  info.textContent = describe(hovered)
}

function describe(shape: BrepFace | BrepEdge | null): string {
  if (shape instanceof BrepFace) return `face ${shape.index}: ${shape.geomType}\narea ${shape.area.toFixed(1)} mm²`
  if (shape instanceof BrepEdge) return `edge ${shape.index}: ${shape.geomType}\nlength ${shape.length.toFixed(2)} mm${shape.geomType === 'circle' ? `, radius ${shape.radius.toFixed(2)} mm` : ''}`
  return `${part.faces().length} faces, ${part.edges().length} edges\nvolume ${(part.volume / 1000).toFixed(1)} cm³`
}

renderer.domElement.addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
  const hit = pick()
  highlight(hit?.brep instanceof BrepFace || hit?.brep instanceof BrepEdge ? hit.brep : null)
})

renderer.domElement.addEventListener('pointerleave', () => highlight(null))

// -- click an edge: round it (a new part, which takes the old one's place) -----------------------
renderer.domElement.addEventListener('click', () => {
  if (!(hovered instanceof BrepEdge)) return
  try {
    const rounded = part.fillet(hovered, 3)
    highlight(null)
    scene.remove(part)
    part.dispose()
    part = rounded
    scene.add(part)
    info.textContent = describe(null)
  } catch (error) {
    info.textContent = `no fillet here: ${(error as Error).message.split('\n')[0]}`
  }
})

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

info.textContent = describe(null)
renderer.setAnimationLoop(() => renderer.render(scene, camera))
