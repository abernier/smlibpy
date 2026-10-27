# smlibpy-three API

The exports of `@classcad/smlibpy-three` (and its entries `/worker` and `/init`) as TypeScript
declarations with their doc comments, written by `npm run api` from the package's declarations. The
[README](README.md) has the design: three's types and coordinates (Y up), shapes taken where they
are, results in the frame of what an operation was called on, angles in radians. smlibpy's
[documentation](https://smlibpy.classcad.ch/docs/) describes the operations themselves.

- [Shapes](#shapes): `Body`, `EdgeLines`, `Part`, `Shell`, `Sketch`, `BrepFace`, `BrepEdge`, `Wire`, `BrepVertex`, `ShapeList`, `EdgesLike`, `FacesLike`, `RegionLike`, `PushOptions`, `FilletRadius`, `FilletOptions`, `ChamferOptions`, `ExtrudeOptions`, `SweepOptions`, `SortKey`
- [Solids](#solids): `Box`, `Cylinder`, `Cone`, `Ball`, `Torus`, `Pyramid`, `Wedge`, `AnnularSector`, `Hole`, `CounterBoreHole`, `CounterSinkHole`, `PlacementOptions`, `SectorOptions`, `BallOptions`, `TorusOptions`
- [Sketches and text](#sketches-and-text): `Rectangle`, `RoundedRectangle`, `Circle`, `Ellipse`, `Polygon`, `RegularPolygon`, `TriangleSketch`, `Trapezoid`, `Slot`, `ArcSlot`, `Stroke`, `Hull`, `Text`, `Profile`, `OpenTypeFont`, `makeFace`, `loadFont`, `DEFAULT_FONT`, `CornerOptions`, `SketchPlacement`, `SketchPoint`, `TrapezoidOptions`, `StrokeOptions`, `HullItem`, `TextOptions`, `Coordinates`, `FontSource`, `PairAdjustment`, `Contour`
- [Curves](#curves): `Segment`, `PolarLine`, `Polyline`, `FilletPolyline`, `CenterArc`, `ThreePointArc`, `RadiusArc`, `SagittaArc`, `TangentArc`, `EllipticalArc`, `ParabolicArc`, `HyperbolicArc`, `ConicArc`, `Spline`, `Bezier`, `Helix`, `Spiral`, `fitCurve`, `makeCompatible`, `ArcSideOptions`, `HelixOptions`, `FitCurveOptions`
- [Operations and patterns](#operations-and-patterns): `extrude`, `revolve`, `sweep`, `loft`, `swing`, `fillet`, `chamfer`, `shell`, `offset`, `mirror`, `split`, `merge`, `section`, `thicken`, `fuse`, `cut`, `intersect`, `xor`, `imprint`, `filletPreview`, `draft`, `moveFaces`, `offsetFaces`, `removeFaces`, `removeFillets`, `push`, `warp`, `flatten`, `extend`, `trim`, `matchEdge`, `mergeFaces`, `project`, `silhouette`, `intersectionCurves`, `partingLine`, `slices`, `scale`, `GridLocations`, `PolarLocations`, `HexLocations`, `Locations`, `TOLERANCE`, `ACCURACY`, `X`, `Y`, `Z`, `ProfileLike`, `LoftOptions`
- [Measurements](#measurements): `MassProperties`, `SectionProperties`, `DraftAnalysis`, `ClosestPoints`, `Curvature`, `Continuity`, `RayHit`, `Problem`, `FaceDraft`, `BodyInfo`
- [Deformations](#deformations): `Lattice`, `twist`, `taper`, `bend`, `unroll`, `deform`, `RangeOptions`, `TwistOptions`, `TaperOptions`, `BendOptions`, `UnrollOptions`, `LatticeLayers`, `LatticeIndex`, `LatticeAxis`
- [Surfaces](#surfaces): `FitReport`, `StitchReport`, `surface`, `nurbsSurface`, `ruled`, `fill`, `network`, `surfaceFillet`, `blend`, `stitch`, `CurveLike`, `SurfaceOptions`, `NurbsSurfaceData`, `FillOptions`, `SurfaceFilletOptions`, `BlendOptions`, `StitchOptions`, `StitchPiece`
- [Sheet metal](#sheet-metal): `Bend`, `FlatPattern`, `bendAllowance`, `bendDeduction`, `developedLength`, `fold`, `flange`, `bends`, `unfold`, `flatPattern`, `KFactor`, `BendAllowanceOptions`, `DevelopedLengthOptions`, `FoldOptions`, `FlangeOptions`, `UnfoldOptions`
- [Triangle meshes](#triangle-meshes): `TriangleMesh`, `tessellate`, `TessellateOptions`, `DecimateOptions`, `RepairReport`, `MeshHit`
- [Files](#files): `STEPLoader`, `STEPExporter`, `IGESLoader`, `DXFLoader`, `DXFExporter`, `SVGExporter`, `USDBrepLoader`, `USDBrepExporter`, `BREPLoader`, `BREPExporter`, `SMBLoader`, `SMBExporter`, `SMPLoader`, `SMPExporter`, `DrawingView`, `drawingViews`, `STEPLoaderOptions`, `STEPExporterOptions`, `IGESLoaderOptions`, `DXFUnit`, `DXFLoaderOptions`, `DXFExporterOptions`, `SVGExporterOptions`, `USDBrepLoaderOptions`, `USDBrepExporterOptions`, `BREPLoaderOptions`, `BREPExporterOptions`, `SMLibExporterOptions`, `ViewName`, `DrawingViewsOptions`
- [Pictures](#pictures): `Picture`, `ImageDiff`, `render`, `diffImages`, `VIEWS`, `RenderViewName`, `RenderView`, `RenderPoint`, `RenderMarker`, `Frame`, `ImageLike`, `RenderOptions`
- [Memory and settings](#memory-and-settings): `scope`, `memoryUsage`, `setWarningHandler`, `setGuardSeconds`, `setGuardBooleans`, `GUARD_SECONDS`, `GUARD_BOOLEANS`, `MemoryUsage`
- [Errors and types](#errors-and-types): `ModelingError`, `KernelError`, `FontError`, `AlignValue`, `Align3`, `Align2`
- [The worker: @classcad/smlibpy-three/worker](#the-worker-classcadsmlibpy-threeworker): `KernelWorker`, `expose`, `FunctionName`, `Crossed`, `Remote`, `WorkerLike`, `KernelWorkerOptions`, `CallOptions`
- [Loading the kernel: @classcad/smlibpy-three/init](#loading-the-kernel-classcadsmlibpy-threeinit): `init`, `InitOptions`

## Shapes

Bodies (Part, Shell, Sketch) are THREE.Meshes, faces THREE.Meshes, edges and wires THREE.Lines, vertices THREE.Points.

### Body

```ts
/**
 * A body of exact faces: the base of Part, Shell and Sketch. A THREE.Mesh whose geometry is the
 * tessellation of the body (made when three first reads it), with the body's edges as a child
 * `edgeLines` (THREE.LineSegments).
 *
 * Raycasting it with three's Raycaster gives three's intersections, and on each the body's face
 * that was hit as `intersection.brep` (an edge for hits on `edgeLines`).
 */
export abstract class Body extends THREE.Mesh {
    readonly isBody: true;
    /** The lines of the body's edges (a child of the body), and what raycasts hit its edges on. */
    readonly edgeLines: EdgeLines;
    constructor(material?: THREE.Material | THREE.Material[] | null);
    /** Chord height of the tessellation in model units (null: 0.1 % of the body's diagonal). Setting
     * it tessellates again when three next reads the geometry. */
    get tolerance(): number | null;
    set tolerance(value: number | null);
    /** The largest angle between neighbouring triangle normals, in radians (default 15 degrees). */
    get angle(): number;
    set angle(value: number);
    /** The faces, in the kernel's order. The same objects every time. */
    faces(): ShapeList<BrepFace>;
    /** The edges, in the kernel's order: seams, where a closed surface meets itself, only with
     * `seams` (they are not in its tessellation's edges, and their `index` is -1). */
    edges(options?: {
        seams?: boolean;
    }): ShapeList<BrepEdge>;
    vertices(): ShapeList<BrepVertex>;
    /** The faces' boundary loops. */
    wires(): ShapeList<Wire>;
    /** The surface area. */
    get area(): number;
    /** The center of mass (of the area, for sheets). */
    center(target?: THREE.Vector3): THREE.Vector3;
    /** The exact bounding box, in the body's frame (Box3.setFromObject gives the tessellation's,
     * in the world's). */
    bbox(target?: THREE.Box3): THREE.Box3;
    /** The shortest distance to a point (in this body's frame) or to another shape (where it is). */
    distanceTo(other: THREE.Vector3Like | Body | BrepFace | BrepEdge | Wire | BrepVertex): number;
    /** The point of the body nearest to `point` (both in its frame). */
    closestPoint(point: THREE.Vector3Like, target?: THREE.Vector3): THREE.Vector3;
    /** The kernel's check of the body (true: sound). */
    isValid(): boolean;
    /** The curves where a plane (in this body's frame) cuts the body. */
    intersectionCurves(other: THREE.Plane | Body | BrepFace): ShapeList<BrepEdge>;
    /** True if `other` holds the same kernel body (as a clone does). */
    equals(other: unknown): boolean;
    /** The body's summary: its type, how many faces, edges and vertices, its box (in its frame). */
    info(): BodyInfo;
    /** The kernel's check of the body: what it finds wrong (nothing for a sound body). `level` 0 to 3, more thorough. */
    check(level?: number): Problem[];
    /** The nearest points of this body and another shape (taken where it is), and the faces they lie on. */
    closestPoints(other: Body | BrepFace | BrepEdge | Wire): ClosestPoints;
    /** The exact hits of a ray (in the body's frame) on its faces, nearest first: the kernel's ray
     * cast on the exact surfaces (three's raycast works on the tessellation). */
    intersectRay(ray: THREE.Ray): RayHit[];
    /** The first exact hit of each ray (null where it misses), for many rays at once. */
    intersectRays(rays: Iterable<THREE.Ray>): (RayHit | null)[];
    /** Frees what the kernel keeps for queries of the body (its meshes and bounds); the body stays as
     * it is, and the next query builds what it needs again. */
    compact(): void;
    /** The body's contour seen along `direction` (in its frame, from the body towards the viewer;
     * default +z, from the front): the curves where its faces turn away, as curves of their own where
     * the body is. */
    silhouette(direction?: THREE.Vector3Like): ShapeList<BrepEdge>;
    /** A curve (taken where it is) projected onto the body along `direction` (in its frame): the
     * curves on its faces. `nearest` keeps what the projection reaches first. */
    project(curve: BrepEdge | Wire, direction?: THREE.Vector3Like, options?: {
        nearest?: boolean;
    }): ShapeList<BrepEdge>;
    /**
     * The body's edges and contours projected onto a plane (in its frame; default the XY plane, seen
     * from +z: a front view): a drawing view's visible lines, in the plane. `hidden: true` gives
     * [visible, hidden]; `tangentEdges` draws the edges between tangent faces too.
     */
    outline(plane?: THREE.Plane, options?: {
        hidden?: false;
        tangentEdges?: boolean;
    }): ShapeList<BrepEdge>;
    outline(plane: THREE.Plane | undefined, options: {
        hidden: true;
        tangentEdges?: boolean;
    }): [ShapeList<BrepEdge>, ShapeList<BrepEdge>];
    /**
     * Clones of this body, one at each of `locations` (moved by it, as `clone().applyMatrix4(m)`):
     * `plate.cut(hole.at(GridLocations(60, 40, 2, 2)))`. The clones share the body and its
     * tessellation.
     */
    at(locations: Iterable<THREE.Matrix4 | THREE.Vector3Like>): this[];
    /**
     * The body's triangles as a TriangleMesh, in its frame with its transform and material, as an
     * operation's result: as finely as its geometry unless `options` say otherwise (`tolerance`,
     * `angle` in radians), `maxEdge` the longest edge a triangle may have.
     */
    toMesh(options?: TessellateOptions): TriangleMesh;
    /** three's raycast, and on each intersection the face that was hit as `brep`. */
    raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void;
    clone(recursive?: boolean): this;
    /** Shares the body (the kernel's, and its tessellation) and the material, as three's copy
     * shares geometry and material; the source's edge lines' settings go to this one's. */
    copy(source: this, recursive?: boolean): this;
    /**
     * Frees what the body made: its tessellation (once no clone draws it), its own materials and its
     * kernel body (once no clone holds it). Materials assigned to it are the app's, as with any
     * three object. The body stays in the scene as it was drawn; operations on it throw.
     */
    dispose(): void;
}
```

### EdgeLines

```ts
/**
 * The edges of a body as line segments: a child of the body. Raycasts hit them as three's
 * LineSegments are hit (within `raycaster.params.Line.threshold`, in world units), with the
 * body's edge that was hit as `intersection.brep`.
 */
export class EdgeLines extends THREE.LineSegments {
    readonly isEdgeLines: true;
    constructor(owner?: Body);
    /** The body whose edges these are. */
    get body(): Body | null;
    raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void;
    copy(source: this, recursive?: boolean): this;
    /** Frees its own material (the geometry is its body's). */
    dispose(): void;
}
```

### Part

```ts
/** A solid: Booleans, fillets, chamfers, shells, splits and sections; volume and mass. */
export class Part extends Body {
    readonly isPart: true;
    /**
     * A part from a triangle mesh (a THREE.BufferGeometry of a closed surface: STL, a GLB's mesh,
     * three's BoxGeometry): its triangles, welded by position, become planar faces (`maxFaces` limits
     * them; triangles in one plane merge). Without a geometry, an empty part.
     */
    constructor(geometry?: THREE.BufferGeometry | null, material?: THREE.Material | THREE.Material[] | null, options?: {
        maxFaces?: number;
    });
    /** The volume. */
    get volume(): number;
    /** Mass, volume, area, center and inertia (in three's axes, about the center) for a density;
     * `accuracy` the relative accuracy of the integration. */
    massProperties(density?: number, accuracy?: number | null): MassProperties;
    /** True where `point` (in this part's frame) is inside the part or on it. */
    contains(point: THREE.Vector3Like): boolean;
    /** The solids of a part of several. */
    solids(): ShapeList<Part>;
    /** This part and the others, fused (smlibpy's `a + b`). The others are taken where they are. */
    fuse(...others: (Part | Iterable<Part>)[]): Part;
    /** This part with the others cut away (smlibpy's `a - b`). */
    cut(...others: (Part | Iterable<Part>)[]): Part;
    /** What this part and the others share (smlibpy's `a & b`); with a sheet or a face, the piece of
     * it inside the part (a Shell). */
    intersect(sheet: Shell | BrepFace): Shell;
    intersect(...others: (Part | Iterable<Part>)[]): Part;
    /** Rounds edges of this part (faces: all their edges). */
    fillet(edges: EdgesLike, radius: FilletRadius, options?: FilletOptions): Part;
    /** Bevels edges of this part. */
    chamfer(edges: EdgesLike, length: number, options?: ChamferOptions): Part;
    /**
     * A hollow part with walls `thickness` thick, open at `openings` (faces of this part); `outward`
     * grows the walls outward, `corners` 'round' or 'sharp', `walls` other thicknesses for some faces
     * (a Map of faces to thicknesses, or [faces, thickness] pairs).
     */
    shell(thickness: number, openings?: FacesLike | null, options?: {
        outward?: boolean;
        corners?: 'round' | 'sharp' | null;
        walls?: ReadonlyMap<BrepFace, number> | Iterable<readonly [FacesLike, number]> | null;
    }): Part;
    /** The part grown (or shrunk, for a negative distance) by `distance` all round; `corners` 'round'
     * or 'sharp'. */
    offset(distance: number, options?: {
        corners?: 'round' | 'sharp';
    }): Part;
    /** The part on the side of `plane` (in its frame) the plane's normal points to, as three's
     * clipping keeps it; 'below' the other side, 'both' both. A face or sheet splits it too. */
    split(plane: THREE.Plane | BrepFace | Shell, keep?: 'above' | 'below'): Part;
    split(plane: THREE.Plane | BrepFace | Shell, keep: 'both'): [Part, Part];
    /** The section where `plane` (in this part's frame) cuts it: a sketch. */
    section(plane: THREE.Plane): Sketch;
    /** The part mirrored in `plane` (in its frame). */
    mirror(plane: THREE.Plane): Part;
    /** The shells of the part: its outer skin and the walls of its voids. */
    shells(): ShapeList<Shell>;
    /** Its voids (closed cavities), as solids. */
    voids(): ShapeList<Part>;
    /** A part of several cells (regions that keep the faces they share: several materials), of this
     * part and the others (taken where they are). */
    merge(...others: (Part | Iterable<Part>)[]): Part;
    /** The cells of a merged part, as parts. */
    cells(): ShapeList<Part>;
    /** The parts a merged part was made of. */
    get sources(): Part[];
    /** The cell of a merged part a point (in the part's frame) lies in; null outside. */
    cellAt(point: THREE.Vector3Like, tolerance?: number | null): Part | null;
    /** Where a point (in the part's frame) lies: 'inside', 'outside', or 'on' with the face, edge or
     * vertex it lies on (within `tolerance`). */
    classify(point: THREE.Vector3Like, tolerance?: number | null): ['inside' | 'outside' | 'on', BrepFace | BrepEdge | BrepVertex | null];
    /** The sheets a fillet of these edges would add, without making it (to show it before). */
    filletPreview(edges: EdgesLike, radius: number, options?: {
        propagate?: boolean;
    }): ShapeList<Shell>;
    /** The part with a tool's outline (a body, face, or curves, taken where they are) imprinted on its
     * faces (projected along `direction`, in the part's frame), splitting them; `nearest` imprints on
     * the faces the projection reaches first. */
    imprint(tool: Body | BrepFace | BrepEdge | Wire | Iterable<BrepFace | BrepEdge | Wire>, direction?: THREE.Vector3Like | null, options?: {
        nearest?: boolean;
    }): Part;
    /** Sections `step` apart along `axis` (in the part's frame; default +z, so that they lie as
     * sketches do, parallel to XY), as sketches. */
    slices(step: number, axis?: THREE.Vector3Like): Sketch[];
    /** The part without its fillets (or those faces of them given, or those up to `maxRadius`); with
     * `partial`, the ones the kernel cannot remove stay. */
    removeFillets(faces?: FacesLike | null, options?: {
        maxRadius?: number | null;
        partial?: boolean;
    }): Part;
    /** The part without these faces (holes, bosses, pockets), the faces around closed over them. */
    removeFaces(faces: FacesLike, options?: {
        partial?: boolean;
    }): Part;
    /** How every face drafts for a mold pulled along `direction` (in the part's frame); `minAngle`
     * (radians) the draft a face needs. */
    draftAnalysis(direction: THREE.Vector3Like, options?: {
        minAngle?: number;
    }): DraftAnalysis;
    /** The parting lines for a mold pulled along `direction` (in the part's frame): where the faces
     * turn from facing it to facing away. */
    partingLine(direction: THREE.Vector3Like): ShapeList<Wire>;
    /** The faces given tilted by `angle` (radians) about where they meet `neutralPlane` (a THREE.Plane
     * in the part's frame, or a face), for a mold pulled along that plane's normal. */
    draft(faces: FacesLike, angle: number, neutralPlane: THREE.Plane | BrepFace): Part;
    /** The faces given moved by a matrix or a vector (in the part's frame), the faces around them
     * following. */
    moveFaces(faces: FacesLike, by: THREE.Matrix4 | THREE.Vector3Like): Part;
    /** The faces given moved along their normals by `distance`. */
    offsetFaces(faces: FacesLike, distance: number): Part;
    /** A face pushed (or pulled) at a point of it (in the part's frame): a smooth bump or dent. */
    push(face: BrepFace, at: THREE.Vector3Like, options?: PushOptions): Part;
    /** A region of a face moved by `by` (a distance along its normal or a Vector3), the face bending
     * smoothly around it. */
    warp(face: BrepFace, region: RegionLike, by: number | THREE.Vector3Like, options?: {
        continuity?: 'crease' | 'G1' | 'G2';
    }): Part;
    /** A region of a face pressed flat onto a plane (a THREE.Plane in the part's frame, or a face). */
    flatten(face: BrepFace, region: RegionLike, plane: THREE.Plane | BrepFace, options?: {
        continuity?: 'crease' | 'G1' | 'G2';
    }): Part;
    /** The part placed on a face (where it is), a THREE.Plane or a THREE.Matrix4 (both in its frame):
     * its origin to the face's center, its z axis along the face's normal. */
    on(target: BrepFace | THREE.Plane | THREE.Matrix4): Part;
    /** A copy whose faces and edges are all NURBS. */
    toNurbs(): Part;
    /** The part with gaps, tolerances and topology repaired (mostly for imported parts). */
    heal(): Part;
    /** The part with these faces colored (the color stays with them through later operations, and
     * files keep it); null takes it off. */
    colorFaces(faces: FacesLike, color: THREE.ColorRepresentation | null): Part;
    /** The part with these faces named (the name stays with them through later operations). */
    nameFaces(faces: FacesLike, name: string | null): Part;
    /** The part twisted about an axis (default: its y axis) by `angle` radians over its length; see `twist`. */
    twist(angle: number, options?: deformations.TwistOptions): Part;
    /** The part tapered along an axis (default: its y axis): its cross-sections scaled from 1 to `scale`; see `taper`. */
    taper(scale: number, options?: deformations.TaperOptions): Part;
    /** The part bent by `angle` radians (by default up, toward +y, about an axis along z); see `bend`. */
    bend(angle: number, options?: deformations.BendOptions): Part;
    /** The part wrapped around an axis laid out flat; see `unroll`. */
    unroll(options: deformations.UnrollOptions): Part;
    /** The part deformed by a lattice (in the part's frame); see `Lattice.apply`. */
    deform(lattice: deformations.Lattice, options?: {
        tolerance?: number | null;
    }): Part;
    /** The sheet folded along a line (a THREE.Ray in its frame, or a straight BrepEdge) by `angle` radians; see `fold`. */
    fold(line: THREE.Ray | BrepEdge, angle: number, options: sheetMetal.FoldOptions): Part;
    /** The sheet with a flange along one of its straight edges; see `flange`. */
    flange(edge: BrepEdge | Iterable<BrepEdge>, length: number, options: sheetMetal.FlangeOptions): Part;
    /** The bends of the sheet, their axes in its frame; see `bends`. */
    bends(options?: {
        kFactor?: sheetMetal.KFactor;
    }): sheetMetal.Bend[];
    /** The sheet with every bend flat again; see `unfold`. */
    unfold(options?: sheetMetal.UnfoldOptions): Part;
    /** The flat pattern of the sheet, in the XY plane of its frame; see `flatPattern`. */
    flatPattern(options?: sheetMetal.UnfoldOptions): sheetMetal.FlatPattern;
}
```

### Shell

```ts
/** A sheet: a surface body of open faces (drawn on both sides). */
export class Shell extends Body {
    readonly isShell: true;
    /** A solid of the sheet grown by `thickness` (to the side its normals point to; `both`: half to
     * each side). */
    thicken(thickness: number, options?: {
        both?: boolean;
    }): Part;
    /** The sheet twisted about an axis (default: its y axis) by `angle` radians; see `twist`. */
    twist(angle: number, options?: deformations.TwistOptions): Shell;
    /** The sheet tapered along an axis (default: its y axis); see `taper`. */
    taper(scale: number, options?: deformations.TaperOptions): Shell;
    /** The sheet bent by `angle` radians (by default up, toward +y, about an axis along z); see `bend`. */
    bend(angle: number, options?: deformations.BendOptions): Shell;
    /** The sheet wrapped around an axis laid out flat; see `unroll`. */
    unroll(options: deformations.UnrollOptions): Shell;
    /** The sheet deformed by a lattice (in the sheet's frame); see `Lattice.apply`. */
    deform(lattice: deformations.Lattice, options?: {
        tolerance?: number | null;
    }): Shell;
    /** The sheet moved `distance` along its normals (a parallel surface). */
    offset(distance: number): Shell;
    /** The sheet cut along curves on it (taken where they are), keeping the side of `keep` (a point in
     * the sheet's frame on or near the side to keep), or both sides as faces of their own ('split'). */
    trim(curves: BrepEdge | Wire | Iterable<BrepEdge | Wire>, keep: THREE.Vector3Like | 'split'): Shell;
    /** The sheet with its normals turned the other way. */
    flipped(): Shell;
    /** The sheet extended past its free edges (or those given of them) by `distance`; `continuity`
     * 'natural' (the default), 'G1' or 'G2' with the surface. */
    extend(distance: number, options?: {
        sides?: BrepEdge | Iterable<BrepEdge> | null;
        continuity?: 'natural' | 'G1' | 'G2';
    }): Shell;
    /** The sheet with one of its free edges moved onto a curve (taken where it is), the surface
     * following over `extent` of its width. */
    matchEdge(edge: BrepEdge, target: BrepEdge | Wire, options?: {
        extent?: number;
    }): Shell;
    /** Two neighbouring faces of the sheet as one. */
    mergeFaces(a: BrepFace, b: BrepFace): Shell;
    /** A face of the sheet pushed at a point (in the sheet's frame): a smooth bump or dent. */
    push(face: BrepFace, at: THREE.Vector3Like, options?: PushOptions): Shell;
    /** A region of a face of the sheet moved by `by` (a distance along its normal or a Vector3). */
    warp(face: BrepFace, region: RegionLike, by: number | THREE.Vector3Like, options?: {
        continuity?: 'crease' | 'G1' | 'G2';
    }): Shell;
    /** A region of a face of the sheet pressed flat onto a plane (a THREE.Plane in its frame, or a face). */
    flatten(face: BrepFace, region: RegionLike, plane: THREE.Plane | BrepFace, options?: {
        continuity?: 'crease' | 'G1' | 'G2';
    }): Shell;
    /** This sheet and other sheets, parts or faces (taken where they are), sewn into one where they meet. */
    fuse(...others: (Shell | Part | BrepFace | Iterable<Shell | Part | BrepFace>)[]): Shell;
    /** The sheet with what lies inside the parts (taken where they are) cut away. */
    cut(...others: (Part | Sketch | Iterable<Part | Sketch>)[]): Shell;
    /** The piece of the sheet inside the parts (taken where they are). */
    intersect(...others: (Part | Sketch | Iterable<Part | Sketch>)[]): Shell;
    /** The sheet mirrored in `plane` (in its frame). */
    mirror(plane: THREE.Plane): Shell;
    /** The sheet placed on a face (where it is), a THREE.Plane or a THREE.Matrix4 (both in its frame). */
    on(target: BrepFace | THREE.Plane | THREE.Matrix4): Shell;
    /** A copy whose faces and edges are all NURBS. */
    toNurbs(): Shell;
    /** The sheet with gaps, tolerances and topology repaired; a Part where it closes around a volume. */
    heal(): Shell | Part;
    /** The sheet with these faces colored (files keep it); null takes it off. */
    colorFaces(faces: FacesLike, color: THREE.ColorRepresentation | null): Shell;
    /** The sheet with these faces named. */
    nameFaces(faces: FacesLike, name: string | null): Shell;
}
```

### Sketch

```ts
/**
 * A planar region: drawn in its own 2D coordinates (x, y), which are three's x and y: it lies in the
 * XY plane of its frame and faces +z, as three's ShapeGeometry does, and extrudes along +z, as
 * ExtrudeGeometry does. Place it with its transform, or on a face with on(). Extrude, revolve and
 * sweep it into parts.
 */
export class Sketch extends Shell {
    readonly isSketch: true;
    /**
     * A sketch of three's 2D shapes (THREE.Shape with its holes, THREE.Path, any THREE.Curve<Vector2>:
     * what SVGLoader.createShapes or Font.generateShapes give): their lines, arcs, ellipses and
     * Bézier curves become the same exact curves, splines exact B-splines. Several shapes are fused.
     */
    constructor(shapes?: THREE.Curve<THREE.Vector2> | readonly THREE.Curve<THREE.Vector2>[] | null, material?: THREE.Material | THREE.Material[] | null);
    /** The region's area. */
    get area(): number;
    /** The length of its outline. */
    get perimeter(): number;
    /** The plane it lies on, in its frame. */
    get plane(): THREE.Plane;
    /** A solid: the region moved `amount` along its normal (or `direction`). */
    extrude(amount: number, options?: ExtrudeOptions): Part;
    /** A solid of revolution about `axis` (a THREE.Ray in the sketch's frame, in its plane) through
     * `angle` radians; by default about the frame's y axis, as THREE.LatheGeometry revolves its points
     * (a sketch elsewhere than in a plane through that axis: about its plane's y axis through its
     * plane's origin). */
    revolve(axis?: THREE.Ray | null, angle?: number): Part;
    /** A solid: the region swept along `path` (a BrepEdge or Wire where it is, or a THREE.Curve in the
     * sketch's frame). */
    sweep(path: BrepEdge | Wire | THREE.Curve<THREE.Vector3>, options?: SweepOptions): Part;
    /**
     * The sketch placed on `target`: a face (where it is in the world; the sketch's origin goes to
     * the face's center, its normal along the face's), a THREE.Plane, or a THREE.Matrix4 (both in
     * the sketch's frame).
     */
    on(target: BrepFace | THREE.Plane | THREE.Matrix4): Sketch;
    /** This region and the others (in the same plane, where they are), fused. */
    fuse(...others: (Sketch | Iterable<Sketch>)[]): Sketch;
    /** This region with the others cut away. */
    cut(...others: (Sketch | Iterable<Sketch>)[]): Sketch;
    /** What this region and the others share. */
    intersect(...others: (Sketch | Iterable<Sketch>)[]): Sketch;
    /** The region grown (shrunk, negative) by `distance` all round; `corners` 'round' (the default),
     * 'sharp' or 'chamfer'. */
    offset(distance: number, options?: {
        corners?: 'round' | 'sharp' | 'chamfer';
    }): Sketch;
    /** The regions this one or the others cover, but not both. */
    xor(...others: (Sketch | Iterable<Sketch>)[]): Sketch;
    /** The region facing the other way. */
    flipped(): Sketch;
    /** The region with its corners cut off (all, or those at `vertices`). */
    chamfer(length: number, vertices?: BrepVertex | THREE.Vector3Like | Iterable<BrepVertex | THREE.Vector3Like> | null): Sketch;
    /** Area, centroid and second moments of the region. */
    sectionProperties(): SectionProperties;
    /** A solid: the region swung around an outline, as a rim or a frame is (smlibpy's swing): a
     * revolve about z whose circle is the outline (a sketch, face or curve around the z axis, parallel
     * to XY, taken where it is). The region stands in its frame's XZ plane, as for a lathe about z:
     * draw it with x the distance from the z axis and y the height, and stand it up with
     * `.on(new THREE.Matrix4().makeRotationX(Math.PI / 2))`, which turns its y to +z. */
    swing(outline: Sketch | BrepFace | Wire | BrepEdge): Part;
    /** The region mirrored in `plane` (in its frame). */
    mirror(plane: THREE.Plane): Sketch;
    /** A copy whose curves are all NURBS. */
    toNurbs(): Sketch;
    /** The region with these faces colored. */
    colorFaces(faces: FacesLike, color: THREE.ColorRepresentation | null): Sketch;
    /** The region with these faces named. */
    nameFaces(faces: FacesLike, name: string | null): Sketch;
    /** The region with its corners rounded (all, or those at `vertices`). */
    fillet(radius: number, vertices?: BrepVertex | THREE.Vector3Like | Iterable<BrepVertex | THREE.Vector3Like> | null): Sketch;
}
```

### BrepFace

```ts
/**
 * A face of a body: a THREE.Mesh of the face's triangles, in its body's frame (add it as a child
 * of the body to draw it there; its own material is a highlight in front of the body's faces).
 * (smlibpy's Face; three has a Face of its own, the face of a raycast hit.)
 */
export class BrepFace extends THREE.Mesh {
    readonly isBrepFace: true;
    constructor();
    /** The body the face belongs to. */
    get owner(): Body | null;
    /** Its place in `owner.faces()`. */
    get index(): number;
    /** "plane", "cylinder", "cone", "sphere", "torus", "bspline", ... */
    get geomType(): string;
    get area(): number;
    get isPlanar(): boolean;
    /** The radius of a cylinder, cone (at its base), sphere or torus face. */
    get radius(): number;
    /** The plane of a planar face, in its body's frame. */
    get plane(): THREE.Plane;
    /** The axis of a cylinder, cone, sphere or torus face, in its body's frame. */
    get axis(): THREE.Ray;
    center(target?: THREE.Vector3): THREE.Vector3;
    /** The outward normal at `point` (default: the face's center), in its body's frame. */
    normalAt(point?: THREE.Vector3Like | null, target?: THREE.Vector3): THREE.Vector3;
    bbox(target?: THREE.Box3): THREE.Box3;
    /** The shortest distance to a point (in its body's frame) or to another shape (where it is). */
    distanceTo(other: THREE.Vector3Like | Body | BrepFace | BrepEdge | Wire | BrepVertex): number;
    /** The face's triangles as a TriangleMesh (smlibpy's `mesh`), where its body is: as finely as its
     * body's geometry unless `options` say otherwise (`tolerance`, `angle` in radians). */
    toMesh(options?: TessellateOptions): TriangleMesh;
    /** The face's edges: its body's (with `seams`, also the seams where its surface meets itself). */
    edges(options?: {
        seams?: boolean;
    }): ShapeList<BrepEdge>;
    vertices(): ShapeList<BrepVertex>;
    /** The faces of its body that share an edge with it. */
    neighbors(): ShapeList<BrepFace>;
    /** Its outer boundary. */
    outerWire(): Wire;
    /** The boundaries of its holes. */
    innerWires(): ShapeList<Wire>;
    /** All its boundaries, the outer one first. */
    wires(): ShapeList<Wire>;
    /** The face's own color (given with colorFaces, or read from a file); null for none. */
    get color(): THREE.Color | null;
    /** The cells of a merged part the face bounds (one outside, two between cells; none on a sheet). */
    get cells(): number[];
    /** The major radius of a torus face. */
    get majorRadius(): number;
    /** The half angle of a cone face, in radians. */
    get coneAngle(): number;
    /** A point inside the face (not on its border), in its body's frame. */
    interiorPoint(target?: THREE.Vector3): THREE.Vector3;
    /** The face's point nearest to `point` (both in its body's frame). */
    closestPoint(point: THREE.Vector3Like, target?: THREE.Vector3): THREE.Vector3;
    /** The parameters (u, v, from 0 to 1 over the face) of its point nearest to `point`. */
    uvAt(point: THREE.Vector3Like, target?: THREE.Vector2): THREE.Vector2;
    /** The face's point at parameters u, v (0 to 1 over the face). */
    positionAt(u: number, v: number, target?: THREE.Vector3): THREE.Vector3;
    /** The curvature at a point (default: the face's center). */
    curvatureAt(point?: THREE.Vector3Like | null): Curvature;
    /** The smallest radius of curvature over the face. */
    minRadius(): number;
    /** The face's surface as NURBS data: degrees, knots, control points (Vector3s, in its body's
     * frame) and weights (null for a non-rational surface). */
    nurbs(): {
        degrees: [number, number];
        knots: [
            number[],
            number[]
        ];
        points: THREE.Vector3[][];
        weights: number[][] | null;
    };
    /** The exact hits of a ray (in its body's frame) on this face, nearest first. */
    intersectRay(ray: THREE.Ray): RayHit[];
    /** A curve (taken where it is) projected onto the face along its normals: the curves on it. */
    project(curve: BrepEdge | Wire): ShapeList<BrepEdge>;
    /** The face's iso curves at parameter u or v (0 to 1). */
    iso(options?: {
        u?: number | null;
        v?: number | null;
    }): ShapeList<BrepEdge>;
    /**
     * A drawing wrapped onto the face, as a label onto a can: a sketch or curves in their own
     * coordinates (as drawn in their XY plane, wherever they are placed), their origin at `at` (a point of
     * the face, in its body's frame; default its middle), their x axis along `direction`. The curves on
     * the face.
     */
    wrap(shape: BrepEdge | Wire | Sketch | Iterable<BrepEdge>, at?: THREE.Vector3Like | BrepVertex | null, options?: {
        direction?: THREE.Vector3Like | null;
    }): ShapeList<BrepEdge>;
    /** The face as a sketch (a planar face) where it is. */
    toSketch(): Sketch;
    /** The face as a sheet of its own where it is. */
    toShell(): Shell;
    /** The face moved `distance` along its normals, as a sheet. */
    offset(distance: number): Shell;
    /** The face split along curves on it (taken where they are): the faces of the split sheet. */
    split(curves: BrepEdge | Wire | Iterable<BrepEdge | Wire>): ShapeList<BrepFace>;
    /** The face turned the other way, as a sheet. */
    flipped(): Shell;
    /** The face's whole surface, its trims taken off, as a sheet. */
    untrimmed(): Shell;
    /** The face extended past its edges (or those given of them) by `distance`, as a sheet;
     * `continuity` 'natural' (the default), 'G1' or 'G2' with the surface. */
    extend(distance: number, options?: {
        sides?: BrepEdge | Iterable<BrepEdge> | null;
        continuity?: 'natural' | 'G1' | 'G2';
    }): Shell;
    /** True for the same face of the same body (of a clone too). */
    equals(other: unknown): boolean;
    /** A solid: the face moved `amount` along its normal (in its body's frame and place). */
    extrude(amount: number, options?: ExtrudeOptions): Part;
    raycast(): void;
    clone(recursive?: boolean): this;
    copy(source: this, recursive?: boolean): this;
    dispose(): void;
}
```

### BrepEdge

```ts
/**
 * An edge: a THREE.Line along the exact curve. Either an edge of a body (in its body's frame;
 * `owner` is the body), or a curve of its own (Segment, Spline, Helix, ... or one of three's curves),
 * placed by its own transform. (smlibpy's Edge, named as BrepFace and BrepVertex are.)
 */
export class BrepEdge extends THREE.Line {
    readonly isBrepEdge: true;
    /** An edge along one of three's curves (LineCurve3, CubicBezierCurve3, CatmullRomCurve3,
     * CurvePath, ...) in its own frame. Without a curve, an empty edge. */
    constructor(curve?: THREE.Curve<THREE.Vector3> | null, material?: THREE.Material | null);
    /** The body the edge belongs to (null for a curve of its own). */
    get owner(): Body | null;
    /** Its place in `owner.edges()`; -1 for a seam (in `owner.edges({ seams: true })` only) and for
     * a curve of its own. */
    get index(): number;
    /** "line", "circle" (also arcs), "ellipse", "bspline" or "other". */
    get geomType(): string;
    get length(): number;
    get isClosed(): boolean;
    get start(): THREE.Vector3;
    get end(): THREE.Vector3;
    /** The radius of a circle or arc. */
    get radius(): number;
    /** The center of a circle or arc. */
    get arcCenter(): THREE.Vector3;
    /** The point at fraction `t` of the length. */
    pointAt(t?: number, target?: THREE.Vector3): THREE.Vector3;
    /** The unit tangent at fraction `t` of the length. */
    tangentAt(t?: number, target?: THREE.Vector3): THREE.Vector3;
    /** The point halfway along it. */
    center(target?: THREE.Vector3): THREE.Vector3;
    bbox(target?: THREE.Box3): THREE.Box3;
    /** The shortest distance to a point (in its frame) or to another shape (where it is). */
    distanceTo(other: THREE.Vector3Like | Body | BrepFace | BrepEdge | Wire | BrepVertex): number;
    /** The faces of its body that meet at it. */
    faces(): ShapeList<BrepFace>;
    vertices(): ShapeList<BrepVertex>;
    /** The same curve the other way round (a curve of its own, where this one is). */
    reversed(): BrepEdge;
    /** How far the edge's curve, its ends and its faces may lie apart (the kernel's tolerance of the
     * edge; a RangeError for a curve of its own). */
    get tolerance(): number;
    /** True for a seam, where a closed surface meets itself. */
    get isSeam(): boolean;
    /** "convex", "concave" or "smooth": how the faces meet at the edge. */
    get convexity(): string;
    /** The angle between the edge's faces, through the body, in radians (π/2 at a box's edges). */
    get dihedralAngle(): number;
    /** True where the faces meet convexly (an outside corner). */
    isConvex(): boolean;
    /** The direction of a straight edge. */
    get direction(): THREE.Vector3;
    /** The normal of the plane of a planar curve (an arc's axis). */
    get normal(): THREE.Vector3;
    /** How smoothly the edge's faces meet along it; `angleTolerance` in radians. */
    continuity(samples?: number, options?: {
        angleTolerance?: number;
        curvatureTolerance?: number;
    }): Continuity;
    /** The edge's point nearest to `point` (both in its frame). */
    closestPoint(point: THREE.Vector3Like | BrepVertex, target?: THREE.Vector3): THREE.Vector3;
    /** The fraction of the length at which the edge comes nearest to `point`. */
    paramAtPoint(point: THREE.Vector3Like | BrepVertex): number;
    /** The part of the edge from `start` to `end`: fractions of the length or points on it. */
    trim(start: number | THREE.Vector3Like | BrepVertex, end: number | THREE.Vector3Like | BrepVertex): BrepEdge;
    /** The edge in two at a fraction of its length or a point on it. */
    split(where: number | THREE.Vector3Like | BrepVertex): [BrepEdge, BrepEdge];
    /** The edge made longer by `distance` at its 'end' (default), 'start' or 'both'; `continuity`
     * 'G1', 'G2' or 'natural' for curves that are not lines or arcs. */
    extend(distance: number, options?: {
        end?: 'start' | 'end' | 'both';
        continuity?: 'G1' | 'G2' | 'natural';
    }): BrepEdge;
    /** Where the edge crosses another shape (taken where it is), in its frame. */
    intersections(other: Body | BrepFace | BrepEdge | Wire | Iterable<Body | BrepFace | BrepEdge | Wire>, options?: {
        tolerance?: number | null;
    }): THREE.Vector3[];
    /** The fractions of the length at which the edge crosses another shape. */
    intersectionParams(other: Body | BrepFace | BrepEdge | Wire | Iterable<Body | BrepFace | BrepEdge | Wire>, options?: {
        tolerance?: number | null;
    }): number[];
    /** Where the edge crosses itself. */
    selfIntersections(options?: {
        tolerance?: number | null;
    }): THREE.Vector3[];
    /** The curvature (1 / radius) at a fraction of the length. */
    curvatureAt(t?: number): number;
    /** The radius of curvature at a fraction of the length (Infinity where it is straight). */
    radiusAt(t?: number): number;
    /** The smallest radius of curvature along the edge. */
    minRadius(): number;
    /** The fraction of the length where the radius of curvature is smallest. */
    minRadiusAt(): number;
    /** The fractions of the length where the curve turns the other way. */
    inflections(): number[];
    /** A parallel curve `distance` away, in the curve's plane (or `plane`, in its frame). */
    offset(distance: number, options?: {
        plane?: THREE.Plane | null;
    }): BrepEdge;
    /** The curve as lines and arcs within `tolerance`, as a wire. */
    toArcs(tolerance?: number): Wire;
    /** The curve bent locally to pass through a point (in its frame), with a tangent there if given. */
    through(point: THREE.Vector3Like | BrepVertex, options?: {
        tangent?: THREE.Vector3Like | null;
        at?: number | null;
    }): BrepEdge;
    /** The curve with its ends moved onto points (and turned to tangents), in its frame. */
    match(options?: {
        start?: THREE.Vector3Like | BrepVertex | null;
        end?: THREE.Vector3Like | BrepVertex | null;
        startTangent?: THREE.Vector3Like | null;
        endTangent?: THREE.Vector3Like | null;
    }): BrepEdge;
    /** The edges of its body that run on from this one tangentially, this one included. */
    tangentChain(): ShapeList<BrepEdge>;
    /** The curve as NURBS data: degree, knots, control points (Vector3s, in its frame) and weights
     * (null for a non-rational curve). */
    nurbs(): {
        degree: number;
        knots: number[];
        points: THREE.Vector3[];
        weights: number[] | null;
    };
    /** The curve mirrored in `plane` (in its frame), a curve of its own where this one is. */
    mirror(plane: THREE.Plane): BrepEdge;
    /** The curve placed on a face (where it is), a THREE.Plane or a THREE.Matrix4 (in its frame): its
     * origin to the face's center, its z axis along the face's normal. */
    on(target: BrepFace | THREE.Plane | THREE.Matrix4): BrepEdge;
    /** The curve with the knots it does not need taken out. */
    removeKnots(): BrepEdge;
    /** True for the same edge of the same body (of a clone too), or the same curve. */
    equals(other: unknown): boolean;
    /** An edge of a NURBS curve's data (the inverse of nurbs()): degree, knots (every knot as often as
     * its multiplicity), control points (Vector3s) and weights (null: non-rational). */
    static fromNurbs(data: {
        degree: number;
        knots: readonly number[];
        points: readonly THREE.Vector3Like[];
        weights?: readonly number[] | null;
    }): BrepEdge;
    /**
     * The exact curve as a THREE.Curve (getPoint(t) evaluates the kernel's curve at fraction t of
     * the length), for three's own uses of curves: `new THREE.TubeGeometry(edge.curve, 64, 1)`.
     */
    get curve(): THREE.Curve<THREE.Vector3>;
    /** three's raycast, with the edge itself as `brep`, for a curve of its own. An edge of a body
     * is hit on its body's edge lines, so drawn as a highlight it is not hit again. */
    raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void;
    clone(recursive?: boolean): this;
    copy(source: this, recursive?: boolean): this;
    dispose(): void;
}
```

### Wire

```ts
/**
 * A wire: edges joined end to end, as one THREE.Line. A boundary loop of a body's face (in its
 * body's frame), or a curve of its own.
 */
export class Wire extends THREE.Line {
    readonly isWire: true;
    /** A wire of edges (where they are, in this wire's frame) or of one of three's curve paths (a
     * THREE.CurvePath, in its own frame). Without either, an empty wire. */
    constructor(edges?: Iterable<BrepEdge | Wire> | THREE.CurvePath<THREE.Vector3> | null, material?: THREE.Material | null, options?: {
        sort?: boolean;
    });
    get owner(): Body | null;
    get length(): number;
    get isClosed(): boolean;
    /** Its edges, in order (curves of their own, in this wire's frame). */
    edges(): ShapeList<BrepEdge>;
    pointAt(t?: number, target?: THREE.Vector3): THREE.Vector3;
    /** The unit tangent at a fraction of the length. */
    tangentAt(t?: number, target?: THREE.Vector3): THREE.Vector3;
    get start(): THREE.Vector3;
    get end(): THREE.Vector3;
    /** The point halfway along it. */
    center(target?: THREE.Vector3): THREE.Vector3;
    bbox(target?: THREE.Box3): THREE.Box3;
    /** Its vertices, in order. */
    vertices(): ShapeList<BrepVertex>;
    /** The shortest distance to a point (in its frame) or another shape (where it is). */
    distanceTo(other: THREE.Vector3Like | Body | BrepFace | BrepEdge | Wire | BrepVertex): number;
    /** The wire's point nearest to `point` (both in its frame). */
    closestPoint(point: THREE.Vector3Like, target?: THREE.Vector3): THREE.Vector3;
    /** The wire in two at a fraction of its length or a point on it. */
    split(where: number | THREE.Vector3Like | BrepVertex): [Wire, Wire];
    /** The part of the wire from `start` to `end`: fractions of the length or points on it. */
    trim(start: number | THREE.Vector3Like | BrepVertex, end: number | THREE.Vector3Like | BrepVertex): Wire;
    /** Where the wire crosses another shape (taken where it is), in its frame. */
    intersections(other: Body | BrepFace | BrepEdge | Wire | Iterable<Body | BrepFace | BrepEdge | Wire>, options?: {
        tolerance?: number | null;
    }): THREE.Vector3[];
    /** The wire as one edge (its edges joined into one curve). */
    toEdge(): BrepEdge;
    /** A parallel wire `distance` away in its plane (or `plane`, in its frame); `corners` 'round',
     * 'sharp' or 'chamfer'. */
    offset(distance: number, options?: {
        corners?: 'round' | 'sharp' | 'chamfer';
        plane?: THREE.Plane | null;
    }): Wire;
    /** The wire as lines and arcs within `tolerance`. */
    toArcs(tolerance?: number): Wire;
    /** The smallest radius of curvature along the wire. */
    minRadius(): number;
    /** The fraction of the length where the radius of curvature is smallest. */
    minRadiusAt(): number;
    /** How smoothly the wire's edges meet (the worst joint); `angleTolerance` in radians. */
    continuity(options?: {
        angleTolerance?: number;
        curvatureTolerance?: number;
    }): Continuity;
    /** The wire closed with a line from its end to its start. */
    close(): Wire;
    /** The wire the other way round. */
    reversed(): Wire;
    /** The plane of a planar wire, in its frame. */
    plane(): THREE.Plane;
    /** The wire mirrored in `plane` (in its frame). */
    mirror(plane: THREE.Plane): Wire;
    /** The wire placed on a face (where it is), a THREE.Plane or a THREE.Matrix4 (in its frame). */
    on(target: BrepFace | THREE.Plane | THREE.Matrix4): Wire;
    /** The wire with its corners (all, or those at `vertices`) rounded. */
    fillet(radius: number, vertices?: BrepVertex | THREE.Vector3Like | Iterable<THREE.Vector3Like | BrepVertex> | null): Wire;
    /** three's raycast for a wire of its own; a body's is drawn as a highlight, not hit. */
    raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void;
    /** The region a closed, planar wire bounds. */
    toSketch(): Sketch;
    clone(recursive?: boolean): this;
    copy(source: this, recursive?: boolean): this;
    dispose(): void;
}
```

### BrepVertex

```ts
/** A vertex of a body: a THREE.Points of one point, in its body's frame. (smlibpy's Vertex, named
 * as BrepFace and BrepEdge are.) */
export class BrepVertex extends THREE.Points {
    readonly isBrepVertex: true;
    /** A vertex of a body (made by the package), or a point of its own: `new BrepVertex(point)`. */
    constructor(point?: THREE.Vector3Like | null);
    get x(): number;
    get y(): number;
    get z(): number;
    /** The kernel's tolerance of the vertex. */
    get tolerance(): number;
    /** "convex", "concave" or "smooth": how the edges meet at a sketch's corner. */
    get convexity(): string;
    center(target?: THREE.Vector3): THREE.Vector3;
    bbox(target?: THREE.Box3): THREE.Box3;
    /** The edges of its body that meet at it. */
    edges(): ShapeList<BrepEdge>;
    /** The faces of its body that meet at it. */
    faces(): ShapeList<BrepFace>;
    /** The shortest distance to a point (in its frame) or another shape (where it is). */
    distanceTo(other: THREE.Vector3Like | Body | BrepFace | BrepEdge | Wire | BrepVertex): number;
    /** True for the same vertex of the same body (of a clone too), or the same point. */
    equals(other: unknown): boolean;
    get owner(): Body | null;
    get index(): number;
    /** Where it is, in its body's frame. */
    get point(): THREE.Vector3;
    raycast(): void;
    clone(recursive?: boolean): this;
    copy(source: this, recursive?: boolean): this;
    dispose(): void;
}
```

### ShapeList

```ts
/**
 * A list of faces, edges or vertices with smlibpy's selectors, in three's directions: `top()` is the
 * highest along +y (up), `front()` the nearest along +z (towards three's default camera), `right()`
 * the furthest along +x; `parallelTo(new Vector3(0, 1, 0))` the ones along y. Points and directions
 * are in the frame of the list's body.
 */
export class ShapeList<T = Item> extends Array<T> {
    /** The first item (a RangeError for an empty list). */
    get first(): T;
    get last(): T;
    /** Array's filter, giving a ShapeList (so selectors go on). */
    filter<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: unknown): ShapeList<S>;
    filter(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: unknown): ShapeList<T>;
    /** The only item (a RangeError unless there is exactly one). */
    one(): T;
    /** The items highest along +y (up). */
    top(): ShapeList<T>;
    /** The items lowest along +y. */
    bottom(): ShapeList<T>;
    /** The items furthest along +z (towards three's default camera). */
    front(): ShapeList<T>;
    /** The items furthest along -z. */
    back(): ShapeList<T>;
    /** The items furthest along +x. */
    right(): ShapeList<T>;
    /** The items furthest along -x. */
    left(): ShapeList<T>;
    /** The largest face (or longest edge). */
    largest(): T;
    smallest(): T;
    /** The item nearest to a point. */
    nearest(point: THREE.Vector3Like): T;
    /** The items whose geometry is one of these types ('plane', 'cylinder', 'line', 'circle', ...). */
    ofType(...geomTypes: string[]): ShapeList<T>;
    planar(): ShapeList<T>;
    cylinders(): ShapeList<T>;
    lines(): ShapeList<T>;
    circles(): ShapeList<T>;
    /** Edges along `direction`, faces whose normal is along it. */
    parallelTo(direction: THREE.Vector3Like): ShapeList<T>;
    perpendicularTo(direction: THREE.Vector3Like): ShapeList<T>;
    /** Faces whose normal points within `maxAngle` radians of `direction`. */
    facing(direction: THREE.Vector3Like, maxAngle?: number): ShapeList<T>;
    /** Sorted by a direction (position along it), a property name ('area', 'length', 'radius') or a
     * function; default along +y. */
    sortBy(key?: SortKey<T>, reverse?: boolean): ShapeList<T>;
    /** `parallelTo(direction)`, `ofType(name)` or `filter(predicate)`, by the criterion's kind. */
    filterBy(criterion: THREE.Vector3Like | string | ((item: T) => boolean)): ShapeList<T>;
    /** Sorted by distance from a point (in the body's frame), nearest first. */
    sortByDistance(point: THREE.Vector3Like, reverse?: boolean): ShapeList<T>;
    /** Groups of items with equal keys (within `tolerance`), in ascending key order. */
    groupBy(key?: SortKey<T>, tolerance?: number): ShapeList<T>[];
    /** The items with the greatest key (all of them, within `tolerance`). */
    maxBy(key?: SortKey<T>, tolerance?: number): ShapeList<T>;
    /** The items with the smallest key (all of them, within `tolerance`). */
    minBy(key?: SortKey<T>, tolerance?: number): ShapeList<T>;
    /** The edges where faces meet tangentially. */
    smooth(): ShapeList<T>;
    /** The edges that run on tangentially from these, these included. */
    tangentChain(): ShapeList<BrepEdge>;
    /** The edges where faces meet with continuous tangents (G1). */
    g1(): ShapeList<T>;
    /** The edges where faces meet with continuous curvature (G2). */
    g2(): ShapeList<T>;
    /** The faces that are fillets (rounds), up to `maxRadius`. */
    fillets(maxRadius?: number | null): ShapeList<T>;
    /** The items a ray (in the body's frame) hits. */
    hitBy(ray: THREE.Ray): ShapeList<T>;
    /** The items through a point (within `tolerance`). */
    atPoint(point: THREE.Vector3Like, tolerance?: number): ShapeList<T>;
    /** The items that came from these shapes' faces and edges (through the operations since). */
    derivedFrom(...shapes: (Body | BrepFace | BrepEdge | Iterable<Body | BrepFace | BrepEdge>)[]): ShapeList<T>;
    /** The edges (or faces) where what came from `a` meets what came from `b`. */
    joining(a: Body | BrepFace | BrepEdge | Iterable<Body | BrepFace | BrepEdge>, b: Body | BrepFace | BrepEdge | Iterable<Body | BrepFace | BrepEdge>): ShapeList<T>;
    /** The faces shared by two cells of a merged part. */
    shared(): ShapeList<T>;
    /** The items of this list and another. */
    union(other: Iterable<T>): ShapeList<T>;
    /** The items of this list that are not in another. */
    difference(other: Iterable<T>): ShapeList<T>;
    /** The items in both lists. */
    intersection(other: Iterable<T>): ShapeList<T>;
    /** The vertices of the items. */
    vertices(): ShapeList<BrepVertex>;
    /** The edges of the items. */
    edges(): ShapeList<BrepEdge>;
    /** The faces of the items. */
    faces(): ShapeList<BrepFace>;
    /** The wires of the items. */
    wires(): ShapeList<Wire>;
    /** The average of the items' centers (in the body's frame). */
    center(target?: THREE.Vector3): THREE.Vector3;
    /** The box around the items (in the body's frame). */
    bbox(target?: THREE.Box3): THREE.Box3;
    /** The edges where faces meet convexly (outside corners). */
    convex(): ShapeList<T>;
    concave(): ShapeList<T>;
    /** The items in a box (in the body's frame). */
    within(box: THREE.Box3): ShapeList<T>;
    /** The faces made, or changed, since `part`: `filleted.faces().newSince(part)`. */
    newSince(part: Body): ShapeList<T>;
}
```

### EdgesLike

```ts
/** What a fillet, chamfer or shell takes: edges (or faces, whose edges are meant) of the body. */
export type EdgesLike = BrepEdge | BrepFace | Wire | Iterable<BrepEdge | BrepFace | Wire>;
```

### FacesLike

```ts
/** Faces of the body. */
export type FacesLike = BrepFace | Iterable<BrepFace>;
```

### RegionLike

```ts
/** What push, warp and flatten take as a region: a sketch, face or curve (where it is) or points (in the body's frame). */
export type RegionLike = Sketch | BrepFace | Wire | BrepEdge | Iterable<THREE.Vector3Like>;
```

### PushOptions

```ts
/** Options of push (smlibpy's): how far and which way the region of a face moves. */
export interface PushOptions {
    /** A distance along the face's normal there, or a Vector3 (in the body's frame). */
    by?: number | THREE.Vector3Like | null;
    /** The point to move to instead. */
    to?: THREE.Vector3Like | null;
    /** The direction to move along instead of the face's normal. */
    normal?: THREE.Vector3Like | null;
    /** How far around `at` the face follows. */
    radius?: number | null;
    /** How the face stays joined to its neighbours: 'G0', 'G1' (the default) or 'G2'. */
    continuity?: 'G0' | 'G1' | 'G2';
}
```

### FilletRadius

```ts
/** A fillet's radius: one, one per edge, `{ start, end }` along each run of edges, or radii at
 * positions along it (0 to 1). */
export type FilletRadius = number | readonly number[] | {
    start: number;
    end: number;
} | ReadonlyMap<number, number>;
```

### FilletOptions

```ts
/** Options of fillets (smlibpy's). */
export interface FilletOptions {
    /** null: circular rounds; "G2" or "G3": curvature-continuous blends ("G1" tangent ones). */
    continuity?: number | string | null;
    /** The shape of a blend's cross-section: above 1 fuller, below 1 flatter. */
    fullness?: number;
    /** Round the edges that continue the given ones tangentially too (default true). */
    propagate?: boolean;
    /** Where three rounds meet: 'patch' (default) or 'mitre' ('miter'). */
    corners?: 'patch' | 'mitre' | 'miter';
    /** Rounds stop this far from corners of three or more rounded edges, joined by one larger patch. */
    setback?: number | null;
}
```

### ChamferOptions

```ts
/** Options of chamfers (smlibpy's). */
export interface ChamferOptions {
    /** An asymmetric bevel: the setback on the other face of each edge (`length` is on `reference`). */
    length2?: number | null;
    /** An asymmetric bevel: the angle between the bevel and the `reference` face, in radians. */
    angle?: number | null;
    /** The face (or faces) of the part each edge lies on, which `length` is measured on. */
    reference?: BrepFace | Iterable<BrepFace> | null;
    /** Bevel the edges that continue the given ones tangentially too (default true). */
    propagate?: boolean;
    /** Where three bevels meet: 'patch' (default) or 'mitre' ('miter'). */
    corners?: 'patch' | 'mitre' | 'miter';
}
```

### ExtrudeOptions

```ts
/** Options of extrusions. */
export interface ExtrudeOptions {
    /** Extrude to both sides (the amount to each). */
    both?: boolean;
    /** Draft of the side walls, in radians (inward for positive). */
    taper?: number;
    /** The direction (in the sketch's frame) instead of its normal. */
    direction?: THREE.Vector3Like | null;
    corners?: 'sharp' | 'round';
}
```

### SweepOptions

```ts
/** Options of sweeps (smlibpy's). */
export interface SweepOptions {
    /** Keep the corners of a path of several edges sharp (mitered), or round them. */
    sharpCorners?: boolean | null;
    /** Keep the profile's angle to this direction (in the sketch's frame) along the path, or 'frenet'. */
    up?: THREE.Vector3Like | string | null;
    /** Turn the profile along the path: radians in all, or a function of the fraction of the path. */
    twist?: number | ((s: number) => number);
    /** Grow the profile along the path: [start, end], [fraction, scale] pairs, or a function. */
    scale?: readonly [number, number] | readonly (readonly [number, number])[] | ((s: number) => number) | null;
    /** The profile's point that goes along the path: its center (default), the sketch's origin, or a
     * point (the sketch's own 2D coordinates) or vertex of it. */
    anchor?: 'center' | 'origin' | THREE.Vector2Like | BrepVertex;
}
```

### SortKey

```ts
/** What sorts and groups go by: a direction (position along it), a property ('area', 'length',
 * 'radius', ...) or a function of an item. */
export type SortKey<T> = THREE.Vector3Like | string | ((item: T) => number);
```

## Solids

smlibpy's solids, made as three's geometries are: their arguments, defaults and placement.

### Box

```ts
/**
 * A box: `width` along x, `height` along y and `depth` along z, centered on the origin, as
 * `THREE.BoxGeometry(width, height, depth)`.
 */
export class Box extends Part {
    readonly parameters: {
        readonly width: number;
        readonly height: number;
        readonly depth: number;
        readonly align?: Align3;
    };
    constructor(width?: number, height?: number, depth?: number, options?: PlacementOptions);
}
```

### Cylinder

```ts
/**
 * A cylinder along y, centered on the origin, as `THREE.CylinderGeometry(radiusTop, radiusBottom,
 * height)`: `radiusTop` at the top (+y), `radiusBottom` at the bottom (a frustum where they differ,
 * a cone where one is 0). A sector of one runs from `thetaStart` over `thetaLength` radians about
 * +y, from +z (at 0) towards +x (at π/2), as three's does.
 */
export class Cylinder extends Part {
    readonly parameters: {
        readonly radiusTop: number;
        readonly radiusBottom: number;
        readonly height: number;
        readonly thetaStart: number;
        readonly thetaLength: number;
        readonly align?: Align3;
    };
    constructor(radiusTop?: number, radiusBottom?: number, height?: number, options?: SectorOptions);
}
```

### Cone

```ts
/**
 * A cone along y, centered on the origin, its tip at the top (+y), as `THREE.ConeGeometry(radius,
 * height)` (a Cylinder of `radiusTop` 0). `thetaStart` and `thetaLength` make a sector, as for
 * Cylinder.
 */
export class Cone extends Part {
    readonly parameters: {
        readonly radius: number;
        readonly height: number;
        readonly thetaStart: number;
        readonly thetaLength: number;
        readonly align?: Align3;
    };
    constructor(radius?: number, height?: number, options?: SectorOptions);
}
```

### Ball

```ts
/**
 * A solid sphere around the origin, its poles on y, as `THREE.SphereGeometry(radius)`; or the part
 * of one its angles keep (see BallOptions), with flat sides where three's leaves it open. (smlibpy's
 * Sphere; a ball is the solid a sphere bounds, and `THREE.Sphere` is three's.)
 */
export class Ball extends Part {
    readonly parameters: {
        readonly radius: number;
        readonly phiStart: number;
        readonly phiLength: number;
        readonly thetaStart: number;
        readonly thetaLength: number;
        readonly align?: Align3;
    };
    constructor(radius?: number, options?: BallOptions);
}
```

### Torus

```ts
/**
 * A torus in the XY plane around z, centered on the origin, as `THREE.TorusGeometry(radius, tube)`:
 * `radius` from the center to the middle of the tube, `tube` the tube's radius.
 */
export class Torus extends Part {
    readonly parameters: {
        readonly radius: number;
        readonly tube: number;
    } & TorusOptions;
    constructor(radius?: number, tube?: number, options?: TorusOptions);
}
```

### Pyramid

```ts
/** A pyramid: a `width` (x) by `depth` (z) base, its apex `height` above (+y), centered on its
 * bounding box. */
export class Pyramid extends Part {
    readonly parameters: {
        readonly width: number;
        readonly height: number;
        readonly depth: number;
        readonly align?: Align3;
    };
    constructor(width?: number, height?: number, depth?: number, options?: PlacementOptions);
}
```

### Wedge

```ts
/** A ramp: a `width` (x) by `depth` (z) base whose high side, `height` tall (y), is at x =
 * -width/2, the slope running down towards +x; `topWidth` gives it a flat top of that width from
 * the high side. Centered on its bounding box. */
export class Wedge extends Part {
    readonly parameters: {
        readonly width: number;
        readonly height: number;
        readonly depth: number;
        readonly topWidth: number;
        readonly align?: Align3;
    };
    constructor(width?: number, height?: number, depth?: number, topWidth?: number, options?: PlacementOptions);
}
```

### AnnularSector

```ts
/**
 * A sector of a thick ring in the XY plane, as `THREE.RingGeometry(innerRadius, outerRadius)` with
 * a thickness: between `innerRadius` and `outerRadius` from the z axis, `height` along z (centered
 * on z = 0), from `thetaStart` over `thetaLength` radians about +z from +x (a whole ring by
 * default), as three's ring runs. An `innerRadius` of 0 gives a sector of a cylinder along z.
 */
export class AnnularSector extends Part {
    readonly parameters: {
        readonly innerRadius: number;
        readonly outerRadius: number;
        readonly height: number;
        readonly thetaStart: number;
        readonly thetaLength: number;
        readonly align?: Align3;
    };
    constructor(innerRadius?: number, outerRadius?: number, height?: number, options?: SectorOptions);
}
```

### Hole

```ts
/** A drilling tool: a cylinder from the origin down to -`depth` along -z, to cut into a face its
 * frame lies on (`at(Locations(face))`, whose z is the face's normal). */
export class Hole extends Part {
    readonly parameters: {
        readonly radius: number;
        readonly depth: number;
    };
    constructor(radius?: number, depth?: number);
}
```

### CounterBoreHole

```ts
/** A drilling tool with a counterbore at the top (z = 0), drilling along -z as Hole. */
export class CounterBoreHole extends Part {
    readonly parameters: {
        readonly radius: number;
        readonly counterBoreRadius: number;
        readonly counterBoreDepth: number;
        readonly depth: number;
    };
    constructor(radius?: number, counterBoreRadius?: number, counterBoreDepth?: number, depth?: number);
}
```

### CounterSinkHole

```ts
/** A drilling tool with a conical countersink of included `angle` (radians; default 82 degrees) at
 * the top (z = 0), drilling along -z as Hole. */
export class CounterSinkHole extends Part {
    readonly parameters: {
        readonly radius: number;
        readonly counterSinkRadius: number;
        readonly depth: number;
        readonly angle: number;
    };
    constructor(radius?: number, counterSinkRadius?: number, depth?: number, angle?: number);
}
```

### PlacementOptions

```ts
/** Where a solid lies: its 'min' side, 'center' or 'max' side at the origin, per axis ({ y: 'min' }
 * stands it on the XZ plane, x and z as they are), or one value for all. Without it a solid lies as
 * three's geometry of it does. */
export interface PlacementOptions {
    align?: Align3;
}
```

### SectorOptions

```ts
/** Options of the solids that are sectors about their axis as three's are: from `thetaStart` over
 * `thetaLength` radians. */
export interface SectorOptions extends PlacementOptions {
    thetaStart?: number;
    thetaLength?: number;
}
```

### BallOptions

```ts
/** Options of Ball: the part of the sphere three's SphereGeometry makes of its angles (radians):
 * `phiStart` and `phiLength` about +y, `thetaStart` and `thetaLength` down from the pole at +y. */
export interface BallOptions extends PlacementOptions {
    phiStart?: number;
    phiLength?: number;
    thetaStart?: number;
    thetaLength?: number;
}
```

### TorusOptions

```ts
/** Options of Torus: the part of the ring (`arc` radians from +x about +z, as three's) and of the
 * tube's section (from `minorStartAngle` to `minorEndAngle`: radians from the side away from the
 * axis, 0, towards +z, π/2), each a whole turn by default. */
export interface TorusOptions extends PlacementOptions {
    arc?: number;
    minorStartAngle?: number;
    minorEndAngle?: number;
}
```

## Sketches and text

Regions in the sketch's own 2D coordinates, which are three's x and y: in the XY plane of its frame, facing +z.

### Rectangle

```ts
/** A rectangle, `width` along x and `height` along y, centered. */
export class Rectangle extends Sketch {
    readonly parameters: {
        readonly width: number;
        readonly height: number;
    } & CornerOptions & SketchPlacement;
    constructor(width?: number, height?: number, options?: CornerOptions & SketchPlacement);
}
```

### RoundedRectangle

```ts
/** A rectangle with its corners rounded by `radius`, `width` along x and `height` along y, centered:
 * the same as `new Rectangle(width, height, { fillet: radius })`. */
export class RoundedRectangle extends Sketch {
    readonly parameters: {
        readonly width: number;
        readonly height: number;
        readonly radius: number;
        readonly align?: Align2;
    };
    constructor(width?: number, height?: number, radius?: number, options?: {
        align?: Align2;
    });
}
```

### Circle

```ts
/** A circle around the origin. */
export class Circle extends Sketch {
    readonly parameters: {
        readonly radius: number;
        readonly align?: Align2;
    };
    constructor(radius?: number, options?: {
        align?: Align2;
    });
}
```

### Ellipse

```ts
/** An ellipse around the origin, `xRadius` along x and `yRadius` along y. */
export class Ellipse extends Sketch {
    readonly parameters: {
        readonly xRadius: number;
        readonly yRadius: number;
    } & SketchPlacement;
    constructor(xRadius?: number, yRadius?: number, options?: SketchPlacement);
}
```

### Polygon

```ts
/** A polygon through `points` (closed by itself): THREE.Vector2s of the sketch's 2D coordinates, or
 * THREE.Vector3s of three's in the XY plane. The points stay where they are unless `align` is given. */
export class Polygon extends Sketch {
    readonly parameters: {
        readonly points: readonly SketchPoint[];
    } & CornerOptions & {
        readonly align?: Align2;
    };
    constructor(points?: readonly SketchPoint[], options?: CornerOptions & {
        align?: Align2;
    });
}
```

### RegularPolygon

```ts
/** A regular polygon of `sides` sides around the origin, its corners on a circle of `radius`
 * (`inscribed`: the middles of its sides on it, so that `radius` is half the width across flats). */
export class RegularPolygon extends Sketch {
    readonly parameters: {
        readonly radius: number;
        readonly sides: number;
        readonly inscribed?: boolean;
    } & CornerOptions & SketchPlacement;
    constructor(radius?: number, sides?: number, options?: {
        inscribed?: boolean;
    } & CornerOptions & SketchPlacement);
}
```

### TriangleSketch

```ts
/** A triangle: a base `width` long along x and its top corner `height` above it along y, centered
 * on its bounding box. `apex` is the top corner's x from the left end of the base: the middle by
 * default (an isosceles triangle), 0 for a right angle at the left end, `width` for one at the right.
 * (smlibpy's Triangle; `THREE.Triangle` is three's.) */
export class TriangleSketch extends Sketch {
    readonly parameters: {
        readonly width: number;
        readonly height: number;
        readonly apex?: number | null;
    } & CornerOptions & SketchPlacement;
    constructor(width?: number, height?: number, options?: {
        apex?: number | null;
    } & CornerOptions & SketchPlacement);
}
```

### Trapezoid

```ts
/**
 * A trapezoid, centered: a base `width` long along x, `height` high along y, its sides at
 * `leftAngle` and `rightAngle` to the base (radians, inside the base's corners; `rightAngle` is
 * `leftAngle` unless given). The options may follow `leftAngle`:
 * `new Trapezoid(40, 15, Math.PI / 3, { fillet: 2 })`.
 */
export class Trapezoid extends Sketch {
    readonly parameters: {
        readonly width: number;
        readonly height: number;
        readonly leftAngle: number;
        readonly rightAngle: number | null;
    } & TrapezoidOptions;
    constructor(width?: number, height?: number, leftAngle?: number, rightAngle?: number | null | TrapezoidOptions, options?: TrapezoidOptions);
}
```

### Slot

```ts
/** A slot: `length` overall along x (round ends included), `width` across, centered. For a slot
 * between two centers use `new Stroke(new Segment(a, b), width)`; along an arc, ArcSlot. */
export class Slot extends Sketch {
    readonly parameters: {
        readonly length: number;
        readonly width: number;
    } & SketchPlacement;
    constructor(length?: number, width?: number, options?: SketchPlacement);
}
```

### ArcSlot

```ts
/** A slot along an arc around the origin: its centerline, of `radius`, runs over `angle` radians from
 * +x (turned by `rotation`), counterclockwise seen from +z; `width` wide, with round ends. The
 * arc's center stays on the origin unless `align` is given. */
export class ArcSlot extends Sketch {
    readonly parameters: {
        readonly radius: number;
        readonly width: number;
        readonly angle: number;
    } & SketchPlacement;
    constructor(radius?: number, width?: number, angle?: number, options?: SketchPlacement);
}
```

### Stroke

```ts
/**
 * The region a pen `width` wide covers along `path`: a slot between two centers
 * (`new Stroke(new Segment(a, b), 6)`), a slot along an arc, a rib from its centerline, a groove along a
 * spline; a ring along a closed path. The path is a BrepEdge or Wire, taken where it is, or a
 * THREE.Curve in the stroke's frame; it lies in a plane, and so does the region. Lines and arcs give
 * exact lines and arcs, splines and ellipses their offsets (within 1e-6 of the path's size).
 */
export class Stroke extends Sketch {
    readonly parameters: {
        readonly path: BrepEdge | Wire | THREE.Curve<THREE.Vector3>;
        readonly width: number;
    } & StrokeOptions;
    constructor(path?: BrepEdge | Wire | THREE.Curve<THREE.Vector3> | null, width?: number, options?: StrokeOptions);
}
```

### Hull

```ts
/**
 * The convex hull of points and shapes: the smallest convex region around them, as a string pulled
 * tight around them; around circles and arcs it follows the arcs exactly, joined by tangent lines
 * (`new Hull(new Circle(10), movedCircle)` is a lever's outline). Shapes are taken where they are.
 * The hull lies in the plane of the first sketch among them, else in the XY plane (z = 0): edges,
 * wires and faces off that plane are projected onto it, points must lie in it.
 */
export class Hull extends Sketch {
    readonly parameters: {
        readonly items: readonly HullItem[];
    };
    constructor(...items: HullItem[]);
}
```

### Text

```ts
/**
 * Text as a sketch: the exact outlines of a font's letters in the XY plane, read from the front (+z,
 * where three's default camera is), as three's TextGeometry lies: along x, lines below each other
 * along -y. `size` is the height of the capital letters (H, E, T);
 * round letters overshoot it a little, descenders go below the baseline. "\n" starts a new line.
 * Straight parts are lines, curved runs B-splines through the font's own points; counters are holes
 * (an o is one face with a hole, an i two faces). A character the font lacks is a RangeError, a font
 * that cannot be read a FontError.
 */
export class Text extends Sketch {
    readonly parameters: {
        readonly text: string;
        readonly size: number;
    } & TextOptions;
    constructor(text?: string, size?: number, options?: TextOptions);
}
```

### Profile

```ts
/**
 * A pen that draws one outline in the XY plane, segment by segment: lines and tangent arcs, each from
 * where the last one ended, with the corners it passes rounded or beveled.
 *
 *     const section = new Profile()
 *       .lineTo(12, 0).lineTo({ y: 4 }).fillet(1.5)
 *       .lineTo({ x: 6 }).lineTo({ y: 20 }).chamfer(1)
 *       .lineTo({ x: 0 })
 *       .close() // a Sketch: extrude or revolve it
 *
 * Moves: `lineTo` (to a point, or to an x or y), `lineBy` (by an offset), `forward` (along the
 * heading, or until x or y reaches a value), `arc` (tangent, by radius and angle; a positive angle
 * turns left), `arcTo` (tangent to an end point, or through a point). `turn` and `turnTo` change the
 * heading without drawing. `fillet` and `chamfer` round or bevel the corner at the pen, between the
 * segment before and the one after. `mirror` adds the mirror image of the path drawn so far.
 *
 * Points are THREE.Vector2s of the sketch's 2D coordinates (three's x and y), or THREE.Vector3s in
 * the XY plane; headings are radians counterclockwise from +x, seen from +z (π/2 is +y). Errors name
 * the segment by the call that drew it.
 */
export class Profile {
    /** A pen at `start` (default the origin), heading `heading` radians: `new Profile()`,
     * `new Profile(new THREE.Vector2(0, 5), { heading: Math.PI / 2 })` or `new Profile({ heading })`. */
    constructor(start?: THREE.Vector2Like | THREE.Vector3Like | {
        heading?: number;
    }, options?: {
        heading?: number;
    });
    /** Where the pen is. */
    get point(): THREE.Vector2;
    /** Where the drawing started. */
    get start(): THREE.Vector2;
    /** The direction the pen moves in: radians counterclockwise from +x (-π to π). */
    get heading(): number;
    /** The number of segments drawn. */
    get length(): number;
    /** A straight line to a point (`lineTo(30, 5)`, `lineTo(new THREE.Vector2(30, 5))`), or to one
     * coordinate, keeping the other: `lineTo({ x: 30 })` (along x), `lineTo({ y: 5 })` (along y). */
    lineTo(x: number, y: number): Profile;
    lineTo(point: THREE.Vector2Like | THREE.Vector3Like | Coordinates): Profile;
    /** A straight line by an offset from the pen: `lineBy(10, -5)` or `lineBy(new THREE.Vector2(10, -5))`. */
    lineBy(dx?: number | THREE.Vector2Like | THREE.Vector3Like, dy?: number): Profile;
    /** A straight line along the heading: `length` long (`forward(20)`), or until x or y reaches a
     * value (`forward({ x: 30 })`, `forward({ y: 5 })`). */
    forward(length: number | Coordinates): Profile;
    /** Turns the heading by `angle` radians (positive: left, counterclockwise seen from +z) without
     * drawing: the next segment starts at a corner. */
    turn(angle: number): Profile;
    /** Sets the heading (radians counterclockwise from +x) without drawing. */
    turnTo(heading: number): Profile;
    /** A tangent arc of `radius` that turns the heading by `angle` radians: positive turns left
     * (counterclockwise seen from +z), negative right; `arc(5, Math.PI)` is a U-turn. */
    arc(radius: number, angle: number): Profile;
    /** An arc to an end point, tangent to the heading (`arcTo(20, 10)`), or through a point on the way
     * (`arcTo(20, 10, { through: new THREE.Vector2(15, 12) })`, which need not be tangent). */
    arcTo(x: number, y: number, options?: {
        through?: THREE.Vector2Like | THREE.Vector3Like | null;
    }): Profile;
    arcTo(point: THREE.Vector2Like | THREE.Vector3Like, options?: {
        through?: THREE.Vector2Like | THREE.Vector3Like | null;
    }): Profile;
    /** Rounds the corner at the pen with a tangent arc of `radius`: the corner between the segment just
     * drawn and the next one (at the start point: between the closing segment and the first). */
    fillet(radius: number): Profile;
    /** Bevels the corner at the pen: cuts back `length` along the segments before and after it and
     * joins the two points with a line. */
    chamfer(length: number): Profile;
    /**
     * Goes on with the mirror image of the path drawn so far, so that the outline is symmetric about
     * the axis through `origin` along `direction` (both in the sketch's 2D coordinates:
     * `mirror(new THREE.Vector2(0, 0), new THREE.Vector2(0, 1))` is its y axis). Draw half the outline
     * from the axis around to the axis; an end off the axis is joined straight across to its mirror
     * image. Corners rounded on the half are rounded on the mirrored half too.
     */
    mirror(origin: THREE.Vector2Like | THREE.Vector3Like, direction: THREE.Vector2Like | THREE.Vector3Like): Profile;
    /**
     * The region inside the outline, a Sketch in the XY plane (a straight line goes back to the start if
     * the pen is not there). `align` moves it ('min', 'center', 'max', per axis of the sketch); null,
     * the default, leaves the outline where it was drawn.
     */
    close(options?: {
        align?: Align2 | null;
    }): Sketch;
    /** The path as drawn, an open Wire of exact lines and arcs in the XY plane (a sweep path, or the
     * centerline of a Stroke). */
    wire(): Wire;
    toString(): string;
}
```

### OpenTypeFont

```ts
/**
 * One font: its characters, metrics, kerning and glyph outlines (font units, y up). Read once with
 * `loadFont(bytes)`, or made with `new OpenTypeFont(bytes)`; give it to Text as `font`. (smlibpy's
 * Font; three's FontLoader gives a Font of its own, of typeface JSON.)
 */
export class OpenTypeFont {
    /** The font file's path, for a font read from a file (Node); null for one read from bytes. */
    readonly path: string | null;
    /** The full name of the font ("Lato Regular"). */
    readonly name: string;
    /** The font units in an em (the size the outlines are drawn at). */
    readonly unitsPerEm: number;
    readonly numGlyphs: number;
    /** The height of the capital letters in font units (the font's own, or the top of its H): Text's
     * `size` is this height. */
    readonly capHeight: number;
    /** Reads the font of a file's bytes (or, in Node, of a file's path; default the built-in font's
     * bytes); a FontError if they are no font it can use. */
    constructor(source?: FontSource);
    /** The glyph of a character, or null when the font has none for it. */
    glyphIndex(char: string): number | null;
    /** Every character the font has a glyph for. */
    characters(): string[];
    /** The advance width of a glyph, in font units. */
    advance(glyph: number): number;
    /** The kerning of two neighbouring glyphs (the font's GPOS pair adjustments, else its kern table). */
    kerning(left: number, right: number): PairAdjustment;
    /** Where `kerning` takes its values from: "GPOS", "kern" or null (none). */
    get kerningSource(): string | null;
    /** The closed outlines of a glyph (none for a space), in font units with y up. */
    outline(glyph: number): Contour[];
    toString(): string;
}
```

### makeFace

```ts
/**
 * The planar region inside a closed wire or edge (`outer`), less the regions inside `holes`: closed
 * curves made a sketch (a Polyline with `close`, a closed Spline, a face's outline). The holes are
 * taken where they are; the result is in `outer`'s frame and placed as it is, as `wire.toSketch()`.
 */
export function makeFace(outer: Wire | BrepEdge, ...holes: (Wire | BrepEdge)[]): Sketch;
```

### loadFont

```ts
/**
 * The font of a file's bytes (or, in Node, of a file's path), read once and kept: the same bytes
 * give the same OpenTypeFont. Without a source, the built-in default (`DEFAULT_FONT`).
 */
export function loadFont(source?: FontSource | null): OpenTypeFont;
```

### DEFAULT_FONT

```ts
/**
 * The bytes of the font Text uses unless told otherwise: Lato Regular (SIL Open Font License 1.1),
 * a TTF file built in, so text needs no file. `loadFont()` reads it.
 */
export const DEFAULT_FONT: Uint8Array;
```

### CornerOptions

```ts
/** Corners rounded (`fillet`, a radius) or cut (`chamfer`, a length along each side); not both. */
export interface CornerOptions {
    fillet?: number;
    chamfer?: number;
}
```

### SketchPlacement

```ts
/** Where the shape lies and how it is turned: `rotation`, radians counterclockwise (seen from +z)
 * about its center; then `align`, its 'min' side, 'center' or 'max' side at the origin, per axis of
 * the sketch ({ x, y }) or one value for both. */
export interface SketchPlacement {
    align?: Align2;
    rotation?: number;
}
```

### SketchPoint

```ts
/** A point of a sketch: a THREE.Vector2 (or { x, y }) of its own 2D coordinates, or a THREE.Vector3
 * (or { x, y, z }) of three's. */
export type SketchPoint = THREE.Vector2Like | THREE.Vector3Like;
```

### TrapezoidOptions

```ts
/** Options of Trapezoid. */
export type TrapezoidOptions = CornerOptions & SketchPlacement;
```

### StrokeOptions

```ts
/** Options of Stroke. */
export interface StrokeOptions {
    /** The ends of an open path: 'round' (half circles, the default) or 'flat' (cut square at its ends). */
    ends?: 'round' | 'flat';
    /** The outside of its bends: 'round' (the default), 'sharp' or 'chamfer'. */
    corners?: 'round' | 'sharp' | 'chamfer';
}
```

### HullItem

```ts
/** What Hull takes: points (THREE.Vector2s of the sketch's 2D coordinates, or THREE.Vector3s of
 * three's), vertices, edges, wires, sketches and faces, or lists of them. */
export type HullItem = SketchPoint | BrepVertex | BrepEdge | Wire | Sketch | BrepFace | Iterable<HullItem>;
```

### TextOptions

```ts
/** Options of Text. */
export interface TextOptions {
    /** The font: an OpenTypeFont (`loadFont(bytes)`), or the bytes of a font file (TTF, OTF, TTC, WOFF, WOFF2:
     * an ArrayBuffer or a Uint8Array). Default: the built-in Lato Regular. */
    font?: OpenTypeFont | ArrayBuffer | ArrayBufferView | null;
    /**
     * Where the text's layout box goes (from the start to the end of the longest line, from the last
     * baseline to the cap height of the first line), per axis of the sketch or one value for both:
     * 'center' (the default) centers it on the origin; 'min' starts the text at x = 0 with the last
     * baseline on y = 0; 'max' ends it at x = 0 with the first cap height on y = 0; null starts it at
     * the origin, on the first baseline. A block's lines are aligned alike (left, centered, right).
     * Along a `path`, x places the text along it ('min': at its start) and y across it ('min': the
     * baseline on the path, 'center': the middle of the capitals, 'max': their top).
     */
    align?: Align2 | null;
    /** Extra distance between neighbouring letters, in model units (negative: closer). Default 0. */
    spacing?: number;
    /** The distance between baselines, as a multiple of `size`. Default 1.6. */
    lineSpacing?: number;
    /** Apply the font's kerning pairs (default true). */
    kerning?: boolean;
    /**
     * A curve in the XY plane (z = 0) to set one line of text along: a BrepEdge or Wire, taken where it
     * is, or a THREE.Curve in the text's frame. Each letter stands upright on it at the middle of its
     * advance, turned with its tangent (not bent): the text reads along the path and stands on its
     * left, seen from +z, so a clockwise arc carries it over the top of a circle.
     */
    path?: BrepEdge | Wire | THREE.Curve<THREE.Vector3> | null;
}
```

### Coordinates

```ts
/** The coordinate a line or a forward move goes to, in the sketch's 2D coordinates: `{ x }`,
 * `{ y }` or both. */
export interface Coordinates {
    x?: number | null;
    y?: number | null;
}
```

### FontSource

```ts
/** A font file: its bytes (an ArrayBuffer, a Uint8Array or another view of an ArrayBuffer), or its
 * path in Node. */
export type FontSource = string | ArrayBuffer | ArrayBufferView;
```

### PairAdjustment

```ts
/**
 * Kerning of two neighbouring glyphs, in font units: the first glyph's advance changes by
 * `advance1` and it moves by `placement1`; the second moves by `placement2` and its advance changes
 * by `advance2`.
 */
export interface PairAdjustment {
    readonly advance1: number;
    readonly placement1: number;
    readonly advance2: number;
    readonly placement2: number;
}
```

### Contour

```ts
/**
 * A closed outline of a glyph: its segments end to end (the last ends where the first starts),
 * each 2 points (a line), 3 (a quadratic Bézier: its control points) or 4 (a cubic Bézier), in font
 * units with y up, as a sketch's 2D coordinates are.
 */
export type Contour = THREE.Vector2[][];
```

## Curves

Edges and wires of their own: points are Vector3s, angles radians, planar curves lie in the XY plane.

### Segment

```ts
/** A straight line from `start` to `end` (smlibpy's Line; `THREE.Line` is three's). */
export class Segment extends BrepEdge {
    constructor(start?: THREE.Vector3Like, end?: THREE.Vector3Like);
}
```

### PolarLine

```ts
/** A line `length` long from `start` in the direction `angle` radians from +x in the XY plane,
 * counterclockwise seen from +z (π/2: along +y). */
export class PolarLine extends BrepEdge {
    constructor(start?: THREE.Vector3Like, length?: number, angle?: number);
}
```

### Polyline

```ts
/** Straight lines through `points` (back to the first with `close`): a wire of one line per pair of
 * neighbouring points. */
export class Polyline extends Wire {
    constructor(points?: readonly THREE.Vector3Like[], options?: {
        close?: boolean;
    });
}
```

### FilletPolyline

```ts
/** Straight lines through `points` with every corner rounded by an arc of `radius` (back to the
 * first with `close`). A polyline in a plane is rounded in its plane; one that is not, at each
 * corner in the plane of the two lines that meet there. */
export class FilletPolyline extends Wire {
    constructor(points?: readonly THREE.Vector3Like[], radius?: number, options?: {
        close?: boolean;
    });
}
```

### CenterArc

```ts
/** A circle around `center`, or the arc of it from `startAngle` over `arcSize` (radians, from +x
 * counterclockwise seen from +z; a negative `arcSize` runs clockwise), in the plane of constant z
 * through `center`, as three's ArcCurve. `arcSize` 2π (the default) is the whole circle. */
export class CenterArc extends BrepEdge {
    constructor(center?: THREE.Vector3Like, radius?: number, startAngle?: number, arcSize?: number);
}
```

### ThreePointArc

```ts
/** The circular arc from `start` through `through` to `end` (in the plane of the three points). */
export class ThreePointArc extends BrepEdge {
    constructor(start?: THREE.Vector3Like, through?: THREE.Vector3Like, end?: THREE.Vector3Like);
}
```

### RadiusArc

```ts
/**
 * The shorter arc of `radius` from `start` to `end`. A positive radius bulges to the left of start to
 * end seen from +z (going along +x: towards +y), a negative one to the right; `normal` sees it from
 * elsewhere.
 */
export class RadiusArc extends BrepEdge {
    constructor(start?: THREE.Vector3Like, end?: THREE.Vector3Like, radius?: number, options?: ArcSideOptions);
}
```

### SagittaArc

```ts
/** The arc from `start` to `end` whose middle is `sagitta` from the middle of the chord: to its left
 * seen from +z for a positive sagitta (`normal` sees it from elsewhere), to its right for a
 * negative one. */
export class SagittaArc extends BrepEdge {
    constructor(start?: THREE.Vector3Like, end?: THREE.Vector3Like, sagitta?: number, options?: ArcSideOptions);
}
```

### TangentArc

```ts
/** The arc from `start` to `end` that leaves `start` along `tangent` (a line if `end` lies straight
 * ahead). */
export class TangentArc extends BrepEdge {
    constructor(start?: THREE.Vector3Like, end?: THREE.Vector3Like, tangent?: THREE.Vector3Like);
}
```

### EllipticalArc

```ts
/**
 * An ellipse around `center` in the plane of constant z through it, `xRadius` along x and `yRadius`
 * along y, or the arc of it from `startAngle` to `endAngle` (radians counterclockwise seen from +z),
 * as three's EllipseCurve: the point at angle a lies xRadius cos a along x and yRadius sin a along y
 * from the center. The arc runs counterclockwise, also across 0 (from 5π/3 to π/3 it passes +x);
 * equal angles give the whole ellipse.
 */
export class EllipticalArc extends BrepEdge {
    constructor(center?: THREE.Vector3Like, xRadius?: number, yRadius?: number, startAngle?: number, endAngle?: number);
}
```

### ParabolicArc

```ts
/**
 * A piece of a parabola in the plane of constant z through its `vertex`, opening towards +y (a
 * negative `focalLength`: towards -y): the points `x` along x from the vertex and
 * `x² / (4 focalLength)` along +y from it, for `x` from `start` to `end`. Exact (a quadratic
 * B-spline). `new ParabolicArc(new THREE.Vector3(), 10, -20, 20)` runs from (-20, 10, 0) through the
 * vertex to (20, 10, 0); its focus is (0, 10, 0).
 */
export class ParabolicArc extends BrepEdge {
    constructor(vertex?: THREE.Vector3Like, focalLength?: number, start?: number, end?: number);
}
```

### HyperbolicArc

```ts
/**
 * A piece of the branch on the +x side of `center` of the hyperbola x²/xRadius² - y²/yRadius² = 1 in
 * the plane of constant z through `center`: from y = `start` to y = `end`. Its vertex is `xRadius` along x from the center, its asymptotes have
 * the slopes ±yRadius / xRadius. Exact (a rational quadratic B-spline).
 */
export class HyperbolicArc extends BrepEdge {
    constructor(center?: THREE.Vector3Like, xRadius?: number, yRadius?: number, start?: number, end?: number);
}
```

### ConicArc

```ts
/**
 * A conic arc from `start` to `end`, tangent there to the lines towards `apex` (where the end
 * tangents meet), passing `rho` of the way from the middle of the chord to the apex (0 < rho < 1):
 * 0.5 a parabola, less an ellipse (flatter), more a hyperbola (fuller); √2 - 1 a circular arc for
 * a square corner. Exact (a rational quadratic B-spline).
 */
export class ConicArc extends BrepEdge {
    constructor(start?: THREE.Vector3Like, apex?: THREE.Vector3Like, end?: THREE.Vector3Like, rho?: number);
}
```

### Spline

```ts
/**
 * A smooth cubic curve through `points`. `tangents`: the directions at the start and the end
 * (`[start, end]`, either may be null), or one at every point (the curve passes through each in its
 * direction); `closed`: a loop back to the first point, as smooth there as everywhere else.
 */
export class Spline extends BrepEdge {
    constructor(points?: readonly THREE.Vector3Like[], options?: {
        tangents?: readonly (THREE.Vector3Like | null)[] | null;
        closed?: boolean;
    });
}
```

### Bezier

```ts
/** A Bézier curve of these control points (rational with `weights`, one per point). */
export class Bezier extends BrepEdge {
    constructor(points?: readonly THREE.Vector3Like[], options?: {
        weights?: readonly number[] | null;
    });
}
```

### Helix

```ts
/**
 * A helix `height` high, rising `pitch` per turn, of `radius`: around z from the origin along +z, as
 * three's HelixCurve (addons) rises, starting on +x and turning counterclockwise seen from +z as it
 * rises (right-handed). Any number of turns.
 */
export class Helix extends BrepEdge {
    constructor(pitch?: number, height?: number, radius?: number, options?: HelixOptions);
}
```

### Spiral

```ts
/**
 * A flat (Archimedean) spiral in the XY plane around the origin: its radius grows (or shrinks) evenly
 * with the angle from `startRadius` to `endRadius` over `turns` turns, starting on +x and turning
 * counterclockwise seen from +z (`clockwise`: the other way). Either radius may be 0. A B-spline
 * within 1e-4 of the exact spiral; `new Spiral(2, 20, 5)` runs from (2, 0, 0) to (20, 0, 0).
 */
export class Spiral extends BrepEdge {
    constructor(startRadius?: number, endRadius?: number, turns?: number, options?: {
        clockwise?: boolean;
    });
}
```

### fitCurve

```ts
/**
 * A smooth curve near many points (in order along it), with as few control points as keep it within
 * `tolerance` of every one: for scanned or sampled outlines and long polylines, where Spline passes
 * through every point and needs a control point for each. A least-squares B-spline, from the first
 * point to the last; fewer than six points give the Spline through them. A ModelingError says how
 * close the best fit came where none keeps within the tolerance.
 */
export function fitCurve(points: Iterable<THREE.Vector3Like>, options?: FitCurveOptions): BrepEdge;
```

### makeCompatible

```ts
/**
 * Copies of the edges as B-splines of one degree and one knot vector, with the same shapes: their
 * control points correspond one to one, as surfaces through the curves need them. Lines and arcs
 * become B-splines too (arcs rational ones). The edges are taken where they are; the copies are
 * placed as the first edge is (in its frame, with its transform).
 */
export function makeCompatible(...edges: (BrepEdge | Iterable<BrepEdge>)[]): BrepEdge[];
```

### ArcSideOptions

```ts
/** Which side an arc between two points bulges to. */
export interface ArcSideOptions {
    /**
     * The direction the arc is seen from (default +z, the front): its left is the left of start to end
     * seen from there, and it lies in the plane through `start` and `end` that faces it. Give one for
     * two points one behind the other, or for an arc in another plane.
     */
    normal?: THREE.Vector3Like;
}
```

### HelixOptions

```ts
/** Options of Helix. */
export interface HelixOptions {
    /** The center of the circle it starts on (default the origin). */
    center?: THREE.Vector3Like;
    /** The direction of its axis, which it rises along (default +z; another one turns where it
     * starts too). */
    direction?: THREE.Vector3Like;
    /** The radius at its end: a conical helix (default `radius`). */
    endRadius?: number | null;
    /** Turn the other way: clockwise seen from where it rises to (default counterclockwise). */
    leftHanded?: boolean;
}
```

### FitCurveOptions

```ts
/** Options of fitCurve. */
export interface FitCurveOptions {
    /** The largest distance from any point to the curve (default 1/1000 of the size of the points). */
    tolerance?: number | null;
    /** The degree of the curve, 2 to 9 (default 3). */
    degree?: number;
    /** Directions at the start and the end (`[start, end]`, either may be null), or one at every point
     * (a cubic curve that leaves each point near its direction); not for closed curves. */
    tangents?: readonly (THREE.Vector3Like | null)[] | null;
    /** A closed curve, starting and ending near the first point, as smooth there as elsewhere. */
    closed?: boolean;
}
```

## Operations and patterns

Every operation of a body is a method and a function: the function takes the body first, as the receiver. Patterns are Matrix4s.

### extrude

```ts
/** A solid of a sketch or face moved `amount` along its normal (or `direction`); a sheet of a curve. */
export function extrude(profile: Sketch | BrepFace, amount: number, options?: ExtrudeOptions): Part;
export function extrude(profile: ProfileLike, amount: number, options?: ExtrudeOptions): Part | Shell;
```

### revolve

```ts
/** A solid of revolution of a sketch about `axis` (a THREE.Ray in its frame; default its frame's y
 * axis, as THREE.LatheGeometry revolves) through `angle` radians; a sheet of a curve. */
export function revolve(profile: Sketch, axis?: THREE.Ray | null, angle?: number): Part;
export function revolve(profile: ProfileLike, axis?: THREE.Ray | null, angle?: number): Part | Shell;
```

### sweep

```ts
/** A solid along `path` (a BrepEdge or Wire where it is, or a THREE.Curve in the profile's frame); a
 * sheet of a curve. `orient` turns the profile to face along the path, `translational` keeps it as
 * it is; `rails` a curve the profile's ends follow. */
export function sweep(profile: Sketch | BrepFace, path: BrepEdge | Wire | THREE.Curve<THREE.Vector3>, options?: SweepOptions & {
    orient?: boolean;
    translational?: boolean;
    rails?: BrepEdge | Wire | null;
}): Part;
export function sweep(profile: ProfileLike, path: BrepEdge | Wire | THREE.Curve<THREE.Vector3>, options?: SweepOptions & {
    orient?: boolean;
    translational?: boolean;
    rails?: BrepEdge | Wire | null;
}): Part | Shell;
```

### loft

```ts
/** A solid through sketches (or a sheet through curves), each where it is, in the frame of the first. */
export function loft(sections: readonly (Sketch | BrepFace)[], options?: LoftOptions): Part;
export function loft(sections: readonly ProfileLike[], options?: LoftOptions): Part | Shell;
```

### swing

```ts
/** A solid of a profile swung around an outline (a sketch, face or curve, where it is), as a rim or
 * a frame is; a sheet of a curve. */
export function swing(profile: Sketch | BrepFace, outline: Sketch | BrepFace | Wire | BrepEdge): Part;
export function swing(profile: ProfileLike, outline: Sketch | BrepFace | Wire | BrepEdge): Part | Shell;
```

### fillet

```ts
/** The part with these edges (of one part) rounded; a sketch with the corners at these vertices rounded. */
export function fillet(edges: EdgesLike, radius: FilletRadius, options?: FilletOptions): Part;
export function fillet(vertices: BrepVertex | readonly BrepVertex[], radius: number): Sketch;
```

### chamfer

```ts
/** The part with these edges (of one part) bevelled; a sketch with the corners at these vertices cut. */
export function chamfer(edges: EdgesLike, length: number, options?: ChamferOptions): Part;
export function chamfer(vertices: BrepVertex | readonly BrepVertex[], length: number): Sketch;
```

### shell

```ts
/** A hollow part: `Part.shell`. */
export function shell(part: Part, thickness: number, openings?: FacesLike | null, options?: Parameters<Part['shell']>[2]): Part;
```

### offset

```ts
/** A shape grown (or shrunk) by `distance`: a part all round (`Part.offset`), a sketch's region in its
 * plane (`Sketch.offset`), a sheet or face along its normals, a curve in its plane (`Wire.offset`,
 * `BrepEdge.offset`). */
export function offset(shape: Part, distance: number, options?: {
    corners?: 'round' | 'sharp';
}): Part;
export function offset(shape: Sketch, distance: number, options?: {
    corners?: 'round' | 'sharp' | 'chamfer';
}): Sketch;
export function offset(shape: Shell | BrepFace, distance: number): Shell;
export function offset(shape: Wire, distance: number, options?: {
    corners?: 'round' | 'sharp' | 'chamfer';
    plane?: THREE.Plane | null;
}): Wire;
export function offset(shape: BrepEdge, distance: number, options?: {
    plane?: THREE.Plane | null;
}): BrepEdge;
```

### mirror

```ts
/** A shape mirrored in `plane` (in its frame): `mirror` of a Part, Shell, Sketch, BrepEdge or Wire. */
export function mirror<S extends Part | Shell | Sketch | BrepEdge | Wire>(shape: S, plane: THREE.Plane): S;
```

### split

```ts
/** The part split by a plane, a face or a sheet: `Part.split`. */
export function split(part: Part, plane: THREE.Plane | BrepFace | Shell, keep: 'both'): [Part, Part];
export function split(part: Part, plane: THREE.Plane | BrepFace | Shell, keep?: 'above' | 'below'): Part;
```

### merge

```ts
/** A part of several cells, of these parts (each where it is), in the frame of the first: `Part.merge`. */
export function merge(...parts: (Part | Iterable<Part>)[]): Part;
```

### section

```ts
/** The section of a part by a plane (in its frame): `Part.section`. */
export function section(part: Part, plane: THREE.Plane): Sketch;
```

### thicken

```ts
/** A solid of a sheet or face grown by `thickness` (`both`: half to each side): `Shell.thicken`. */
export function thicken(surface: Shell | BrepFace, thickness: number, options?: {
    both?: boolean;
}): Part;
```

### fuse

```ts
/** The shape and the others (each where it is) fused: `fuse` of a Part, Shell or Sketch. */
export function fuse(shape: Sketch, ...others: (Sketch | Iterable<Sketch>)[]): Sketch;
export function fuse(shape: Shell, ...others: (Shell | Part | BrepFace | Iterable<Shell | Part | BrepFace>)[]): Shell;
export function fuse(shape: Part, ...others: (Part | Iterable<Part>)[]): Part;
```

### cut

```ts
/** The shape with the others (each where it is) cut away: `cut` of a Part, Shell or Sketch. */
export function cut(shape: Sketch, ...others: (Sketch | Iterable<Sketch>)[]): Sketch;
export function cut(shape: Shell, ...others: (Part | Sketch | Iterable<Part | Sketch>)[]): Shell;
export function cut(shape: Part, ...others: (Part | Iterable<Part>)[]): Part;
```

### intersect

```ts
/** What the shape and the others (each where it is) share: `intersect` of a Part, Shell or Sketch
 * (a part and a sheet: the sheet's part inside the part). */
export function intersect(shape: Sketch, ...others: (Sketch | Iterable<Sketch>)[]): Sketch;
export function intersect(shape: Shell, ...others: (Part | Sketch | Iterable<Part | Sketch>)[]): Shell;
export function intersect(shape: Part, sheet: Shell | BrepFace): Shell;
export function intersect(shape: Part, ...others: (Part | Iterable<Part>)[]): Part;
```

### xor

```ts
/** The regions the sketch or the others cover, but not both: `Sketch.xor`. */
export function xor(sketch: Sketch, ...others: (Sketch | Iterable<Sketch>)[]): Sketch;
```

### imprint

```ts
/** The part with a tool's outline imprinted on its faces: `Part.imprint`. */
export function imprint(part: Part, tool: Body | BrepFace | BrepEdge | Wire | Iterable<BrepFace | BrepEdge | Wire>, direction?: THREE.Vector3Like | null, options?: {
    nearest?: boolean;
}): Part;
```

### filletPreview

```ts
/** The faces a fillet of these edges (of one part) would add, as sheets: `Part.filletPreview`. */
export function filletPreview(edges: EdgesLike, radius: number, options?: {
    propagate?: boolean;
}): ShapeList<Shell>;
```

### draft

```ts
/** The part with these faces drafted by `angle` radians from a neutral plane or face: `Part.draft`. */
export function draft(part: Part, faces: FacesLike, angle: number, neutralPlane: THREE.Plane | BrepFace): Part;
```

### moveFaces

```ts
/** The part with these faces moved, the faces around them following: `Part.moveFaces`. */
export function moveFaces(part: Part, faces: FacesLike, by: THREE.Matrix4 | THREE.Vector3Like): Part;
```

### offsetFaces

```ts
/** The part with these faces moved `distance` along their normals: `Part.offsetFaces`. */
export function offsetFaces(part: Part, faces: FacesLike, distance: number): Part;
```

### removeFaces

```ts
/** The part without these faces, the faces around them closing the gap: `Part.removeFaces`. */
export function removeFaces(part: Part, faces: FacesLike, options?: {
    partial?: boolean;
}): Part;
```

### removeFillets

```ts
/** The part without its fillets (or these of them): `Part.removeFillets`. */
export function removeFillets(part: Part, faces?: FacesLike | null, options?: {
    maxRadius?: number | null;
    partial?: boolean;
}): Part;
```

### push

```ts
/** The body with a region of a face pushed, the face bending smoothly around it: `push` of a Part or
 * Shell. */
export function push(shape: Part, face: BrepFace, at: THREE.Vector3Like, options?: PushOptions): Part;
export function push(shape: Shell, face: BrepFace, at: THREE.Vector3Like, options?: PushOptions): Shell;
```

### warp

```ts
/** The body with a region of a face moved by `by`, the face bending smoothly around it: `warp` of a
 * Part or Shell. */
export function warp(shape: Part, face: BrepFace, region: RegionLike, by: number | THREE.Vector3Like, options?: {
    continuity?: 'crease' | 'G1' | 'G2';
}): Part;
export function warp(shape: Shell, face: BrepFace, region: RegionLike, by: number | THREE.Vector3Like, options?: {
    continuity?: 'crease' | 'G1' | 'G2';
}): Shell;
```

### flatten

```ts
/** The body with a region of a face pressed flat onto a plane or face: `flatten` of a Part or Shell. */
export function flatten(shape: Part, face: BrepFace, region: RegionLike, plane: THREE.Plane | BrepFace, options?: {
    continuity?: 'crease' | 'G1' | 'G2';
}): Part;
export function flatten(shape: Shell, face: BrepFace, region: RegionLike, plane: THREE.Plane | BrepFace, options?: {
    continuity?: 'crease' | 'G1' | 'G2';
}): Shell;
```

### extend

```ts
/** A curve made longer (`BrepEdge.extend`), or a sheet or face extended past its edges
 * (`Shell.extend`, `BrepFace.extend`). */
export function extend(shape: BrepEdge, distance: number, options?: {
    end?: 'start' | 'end' | 'both';
    continuity?: 'G1' | 'G2' | 'natural';
}): BrepEdge;
export function extend(shape: Shell | BrepFace, distance: number, options?: {
    sides?: BrepEdge | Iterable<BrepEdge> | null;
    continuity?: 'natural' | 'G1' | 'G2';
}): Shell;
```

### trim

```ts
/** A sheet trimmed by curves on it (`Shell.trim`), or a curve trimmed to a part of it (`BrepEdge.trim`,
 * `Wire.trim`). */
export function trim(shape: Shell, curves: BrepEdge | Wire | Iterable<BrepEdge | Wire>, keep: THREE.Vector3Like | 'split'): Shell;
export function trim(shape: BrepEdge, start: number | THREE.Vector3Like | BrepVertex, end: number | THREE.Vector3Like | BrepVertex): BrepEdge;
export function trim(shape: Wire, start: number | THREE.Vector3Like | BrepVertex, end: number | THREE.Vector3Like | BrepVertex): Wire;
```

### matchEdge

```ts
/** The sheet with one of its free edges moved onto a curve, the sheet following: `Shell.matchEdge`. */
export function matchEdge(sheet: Shell, edge: BrepEdge, target: BrepEdge | Wire, options?: {
    extent?: number;
}): Shell;
```

### mergeFaces

```ts
/** The sheet with two neighbouring faces made one: `Shell.mergeFaces`. */
export function mergeFaces(sheet: Shell, a: BrepFace, b: BrepFace): Shell;
```

### project

```ts
/** A curve projected onto a face (`BrepFace.project`) or onto a body along a direction
 * (`Body.project`). */
export function project(shape: BrepFace, curve: BrepEdge | Wire): ShapeList<BrepEdge>;
export function project(shape: Part | Shell, curve: BrepEdge | Wire, direction?: THREE.Vector3Like, options?: {
    nearest?: boolean;
}): ShapeList<BrepEdge>;
```

### silhouette

```ts
/** The body's contour seen along a direction: `Body.silhouette`. */
export function silhouette(shape: Part | Shell, direction?: THREE.Vector3Like): ShapeList<BrepEdge>;
```

### intersectionCurves

```ts
/** The curves where the body meets another body, a face or a plane: `Body.intersectionCurves`. */
export function intersectionCurves(shape: Part | Shell, other: Part | Shell | BrepFace | THREE.Plane): ShapeList<BrepEdge>;
```

### partingLine

```ts
/** The line a mold parts along, seen along `direction`: `Part.partingLine`. */
export function partingLine(part: Part, direction: THREE.Vector3Like): ShapeList<Wire>;
```

### slices

```ts
/** Sections `step` apart along `axis`: a part's as sketches (`Part.slices`), a triangle mesh's as
 * wires (`TriangleMesh.slices`). */
export function slices(shape: Part, step: number, axis?: THREE.Vector3Like): Sketch[];
export function slices(shape: TriangleMesh, step: number, axis?: THREE.Vector3Like): ShapeList<Wire>[];
```

### scale

```ts
/**
 * A copy of the shape scaled by `factor` (a number, or one per axis: a THREE.Vector3; none zero)
 * about `center` (in its frame; default its origin), in its frame with its transform: the body (or
 * curve, or triangle mesh) itself scaled, where its `scale` (three's, the object's transform) only
 * places it so. A factor different per axis makes B-splines of round faces. (A function only: the
 * method's name is three's.)
 */
export function scale<S extends Part | Shell | Sketch | BrepEdge | Wire | TriangleMesh>(shape: S, factor: number | THREE.Vector3Like, center?: THREE.Vector3Like): S;
```

### GridLocations

```ts
/** A grid in the XY plane: `xCount` places `xSpacing` apart along x, `yCount` places `ySpacing`
 * apart along y, centered on the origin unless `centered` is false. */
export function GridLocations(xSpacing: number, ySpacing: number, xCount: number, yCount: number, options?: {
    centered?: boolean;
}): THREE.Matrix4[];
```

### PolarLocations

```ts
/** `count` places on a circle of `radius` around z in the XY plane, from `startAngle` over
 * `angularRange` (radians from +x, counterclockwise seen from +z), each turned about z to face
 * outward (its x away from the center) unless `rotate` is false. */
export function PolarLocations(radius: number, count: number, options?: {
    startAngle?: number;
    angularRange?: number;
    rotate?: boolean;
}): THREE.Matrix4[];
```

### HexLocations

```ts
/** A hexagonal grid in the XY plane, `spacing` apart: `xCount` places along x in each of `yCount`
 * rows. */
export function HexLocations(spacing: number, xCount: number, yCount: number, options?: {
    centered?: boolean;
}): THREE.Matrix4[];
```

### Locations

```ts
/**
 * Places in the world (smlibpy's Locations): at a face's center with its z axis along the face's
 * normal (as a sketch on the face lies: a Hole placed there drills into the face; a cylinder, along
 * its y, stands on it once turned, `cylinder.rotation.x = Math.PI / 2`), at a vertex, at a point, or
 * a matrix as it is; faces and vertices where their body is.
 */
export function Locations(...items: (BrepFace | BrepVertex | THREE.Vector3Like | THREE.Matrix4 | Iterable<BrepFace | BrepVertex | THREE.Vector3Like | THREE.Matrix4>)[]): THREE.Matrix4[];
```

### TOLERANCE

```ts
/** The kernel's tolerance of lengths (smlibpy's TOLERANCE). */
export const TOLERANCE: number;
```

### ACCURACY

```ts
/** The relative accuracy of the kernel's measurements (smlibpy's ACCURACY). */
export const ACCURACY: number;
```

### X

```ts
/** three's axes as directions: x, y (up) and z. Frozen: copy one to change it. */
export const X: Readonly<THREE.Vector3>;
```

### Y

```ts
export const Y: Readonly<THREE.Vector3>;
```

### Z

```ts
export const Z: Readonly<THREE.Vector3>;
```

### ProfileLike

```ts
/** What extrude, revolve, sweep, loft and swing take: a sketch or face (a solid comes of it), or a
 * curve (a sheet comes of it). */
export type ProfileLike = Sketch | BrepFace | Wire | BrepEdge;
```

### LoftOptions

```ts
/** Options of lofts (smlibpy's). */
export interface LoftOptions {
    /** Straight between the sections (default: smooth through them). */
    ruled?: boolean;
    /** Through three sections or more with a cubic surface (false: quadratic). */
    smooth?: boolean;
    /** Leave the first section along a direction (a Vector3 in the first section's frame) or tangent to faces (where they are). */
    startTangent?: THREE.Vector3Like | BrepFace | Iterable<BrepFace> | null;
    /** Arrive at the last section so. */
    endTangent?: THREE.Vector3Like | BrepFace | Iterable<BrepFace> | null;
    /** Back from the last section to the first: a ring. */
    closed?: boolean;
    /** Curves (where they are) the sections' corners follow. */
    rails?: BrepEdge | Wire | readonly (BrepEdge | Wire)[] | null;
}
```

## Measurements

Records in three's types, in the frame of what was measured.

### MassProperties

```ts
/**
 * Mass, volume, area, center of mass and inertia of a part for a density (smlibpy's
 * MassProperties), in the part's frame: the inertia tensor about the center of mass, in three's
 * axes.
 */
export class MassProperties {
    readonly mass: number;
    readonly volume: number;
    readonly area: number;
    readonly density: number;
    readonly center: THREE.Vector3;
    /** The inertia tensor about the center of mass (three's axes). */
    readonly inertia: THREE.Matrix3;
    /** The principal moments of inertia, smallest first. */
    get principalMoments(): [number, number, number];
    /** The principal axes (unit directions, in the order of the moments). */
    get principalAxes(): [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    /** The radii of gyration about the principal axes. */
    get radiiOfGyration(): [number, number, number];
    /** The inertia tensor about another point (three's axes). */
    inertiaAbout(point: THREE.Vector3Like): THREE.Matrix3;
    /** The moment of inertia about an axis. */
    momentAbout(axis: THREE.Ray): number;
}
```

### SectionProperties

```ts
/**
 * Area, centroid and second moments of a sketch's region (smlibpy's SectionProperties), about the
 * centroid, in the region's plane: `ixx` about the in-plane axis `xAxis`, `iyy` about `yAxis`.
 */
export class SectionProperties {
    readonly area: number;
    readonly centroid: THREE.Vector3;
    /** The plane of the region, in the sketch's frame. */
    readonly plane: THREE.Plane;
    /** The in-plane axes the moments are taken about (through the centroid). */
    readonly xAxis: THREE.Vector3;
    readonly yAxis: THREE.Vector3;
    readonly ixx: number;
    readonly iyy: number;
    readonly ixy: number;
    /** The polar moment, ixx + iyy. */
    get polar(): number;
    /** The principal moments, largest first. */
    get principalMoments(): [number, number];
    /** The principal axes (in-plane unit directions). */
    get principalAxes(): [THREE.Vector3, THREE.Vector3];
    get radiiOfGyration(): [number, number];
    /** The elastic section moduli [ixx / c_y, iyy / c_x]. */
    get sectionModuli(): [number, number];
}
```

### DraftAnalysis

```ts
/** The draft of every face of a part for a pull direction (smlibpy's DraftAnalysis). */
export class DraftAnalysis {
    /** The pull direction, in the part's frame. */
    readonly direction: THREE.Vector3;
    /** The draft a face needs, in radians. */
    readonly minAngle: number;
    readonly faces: readonly FaceDraft[];
    /** Faces drafted at least `minAngle`. */
    get positive(): ShapeList<BrepFace>;
    /** Faces drafted less than `minAngle`. */
    get insufficient(): ShapeList<BrepFace>;
    /** Faces along the pull direction. */
    get vertical(): ShapeList<BrepFace>;
    /** Faces that hold the mold back. */
    get undercut(): ShapeList<BrepFace>;
    /** True when no face is insufficient, vertical or an undercut. */
    get ok(): boolean;
    /** A face's smallest and largest draft, in radians. */
    angles(face: BrepFace): [number, number];
    get length(): number;
}
```

### ClosestPoints

```ts
/** The nearest points of two shapes (smlibpy's ClosestPoints), in the frame of the first. */
export interface ClosestPoints {
    readonly point: THREE.Vector3;
    readonly otherPoint: THREE.Vector3;
    readonly distance: number;
    /** The faces the points lie on, where they lie on faces. */
    readonly face: BrepFace | null;
    readonly otherFace: BrepFace | null;
}
```

### Curvature

```ts
/** The curvature of a face at a point (smlibpy's Curvature): principal curvatures and directions. */
export interface Curvature {
    /** The principal curvatures (1 / radius; positive where the face bends away from its normal). */
    readonly k1: number;
    readonly k2: number;
    readonly dir1: THREE.Vector3;
    readonly dir2: THREE.Vector3;
    readonly normal: THREE.Vector3;
    readonly point: THREE.Vector3;
    /** (k1 + k2) / 2 */
    readonly mean: number;
    /** k1 · k2 */
    readonly gaussian: number;
}
```

### Continuity

```ts
/** How smoothly two faces (or the edges of a wire) meet (smlibpy's Continuity). */
export interface Continuity {
    /** "G0", "G1", "G2" or "G3"; null where they leave a gap. */
    readonly level: string | null;
    readonly gap: number;
    /** The largest angle between their normals (or tangents), in radians. */
    readonly angle: number;
    readonly curvatureJump: number;
    /** Where the worst of it is. */
    readonly point: THREE.Vector3;
}
```

### RayHit

```ts
/** An exact hit of a ray on a shape's surface (the kernel's ray cast, not the tessellation's). */
export interface RayHit {
    readonly point: THREE.Vector3;
    readonly distance: number;
    /** The face's outward normal there. */
    readonly normal: THREE.Vector3;
    readonly face: BrepFace | null;
}
```

### Problem

```ts
/** A defect the kernel's check found (smlibpy's Problem). */
export interface Problem {
    readonly shape: Body | BrepFace | BrepEdge | BrepVertex;
    readonly message: string;
    readonly value: number | null;
    readonly tolerance: number | null;
    readonly category: string;
    readonly test: string;
    readonly other: Body | BrepFace | BrepEdge | BrepVertex | null;
}
```

### FaceDraft

```ts
/** How a face drafts for a mold pulled along a direction (smlibpy's FaceDraft). */
export interface FaceDraft {
    readonly face: BrepFace;
    /** The smallest and largest draft angle over the face, in radians (negative: an undercut). */
    readonly minAngle: number;
    readonly maxAngle: number;
    /** "positive", "insufficient", "vertical" or "undercut". */
    readonly kind: string;
}
```

### BodyInfo

```ts
/** The summary of a body (smlibpy's info()). */
export interface BodyInfo {
    readonly type: string;
    readonly faces: number;
    readonly edges: number;
    readonly vertices: number;
    readonly bbox: THREE.Box3;
    readonly corners?: string;
    readonly solids?: number;
    readonly voids?: number;
}
```

## Deformations

### Lattice

```ts
/**
 * A grid of control points around a shape, for free-form deformation with exact results: the points
 * start evenly spaced over a box (`counts` per axis, corners included); move them, then `apply` the
 * lattice to a shape, and space inside the box moves smoothly with them (a Bezier volume; space
 * outside follows the same polynomial). A lattice whose points were not moved changes nothing.
 *
 * Its points are indexed along x, y (up) and z: `points[i][j][k]` is the point i along x, j
 * along y and k along z, a THREE.Vector3 in the frame of the shapes the lattice is applied to (the
 * frame of the shape whose box it was made around, as a plane given to a method is). `move`, `scale`
 * and `rotate` take a selection `[i, j, k]` (see `LatticeIndex`, or `layer()`), change the lattice in
 * place and return it.
 *
 * A lattice is a global map, for the overall shape: every point pulls the whole box, most near
 * itself (by Bernstein polynomials), so one moved point changes every face it does not leave in place;
 * the middle point of the top layer of a 3 x 3 x 3 lattice moved up by 8 lifts the middle of the top
 * by 2.
 */
export class Lattice {
    /** Where the points are, `points[i][j][k]` along x, y (up) and z, in the frame of the
     * shapes the lattice is applied to. Writable: `lattice.points[1][2][1].y += 5` lifts one point. */
    points: THREE.Vector3[][][];
    /**
     * @param box A THREE.Box3, or a shape (anything with `bbox()`: a Part, Shell, BrepFace, BrepEdge or Wire),
     *   whose bounding box (in its frame) is used.
     * @param counts Points per axis, one number for all or three ([x, y, z]), 2 to 12: 2 moves the
     *   corners only (a trilinear map), 3 adds the middles (default). More points concentrate a
     *   point's pull nearer to it without confining it; the degree of the exact result grows with them.
     * @param options `margin`: the box grown by this much on every side (for flat shapes).
     */
    constructor(box: THREE.Box3 | {
        bbox(): THREE.Box3;
    }, counts?: number | readonly number[], options?: {
        margin?: number;
    });
    /** Points per axis: [x, y, z]. */
    get counts(): [number, number, number];
    /** The box the points started on (a new THREE.Box3). */
    get box(): THREE.Box3;
    /** Where the points started, indexed as `points` (new THREE.Vector3s). */
    get rest(): THREE.Vector3[][][];
    /** How far each point was moved (`points - rest`), indexed as `points`. */
    get offsets(): THREE.Vector3[][][];
    /**
     * The points of one layer across an axis, as a selection: `layer('y', -1)` is the top layer,
     * `layer('x', 0)` the points at the smallest x.
     */
    layer(axis: LatticeAxis, index: number): [LatticeLayers, LatticeLayers, LatticeLayers];
    /** Moves the selected points by `offset`. In place; returns the lattice. */
    move(index: LatticeIndex, offset: THREE.Vector3Like): this;
    /** Scales the selected points about `center` (default: their centroid) by `factor`: one number, or
     * one per axis of three's (a THREE.Vector3). In place; returns the lattice. */
    scale(index: LatticeIndex, factor: number | THREE.Vector3Like, center?: THREE.Vector3Like | null): this;
    /** Turns the selected points by `angle` radians about `axis` (a THREE.Ray; the right-hand rule).
     * In place; returns the lattice. */
    rotate(index: LatticeIndex, axis: THREE.Ray, angle: number): this;
    /** Puts every point back where it started. In place; returns the lattice. */
    reset(): this;
    /** An independent copy (smlibpy's `copy()`, named as three's math types name it). */
    clone(): Lattice;
    /** Makes this lattice a copy of `source`: its box, counts and points (as three's `copy`). */
    copy(source: Lattice): this;
    /** Where the lattice moves `point` (in the frame the lattice is in). */
    map(point: THREE.Vector3Like, target?: THREE.Vector3): THREE.Vector3;
    /**
     * The shape deformed by the lattice, which is in the shape's frame: a Part gives a Part and a Shell
     * (or Sketch) a Shell, in the shape's frame with its transform; a BrepEdge a BrepEdge and a Wire a Wire
     * (exact B-splines; lines and arcs it only moves stay lines and arcs), curves of their own where
     * the shape is; points their THREE.Vector3s (as `map`). The result is exact, unless a face's image
     * needs a degree above 12: such faces are within `tolerance`. A lattice that folds a part onto
     * itself (a point moved past its neighbours) is refused with a ModelingError; curves and points are
     * not checked for that.
     */
    apply(shape: Part, options?: {
        tolerance?: number | null;
    }): Part;
    apply(shape: Shell, options?: {
        tolerance?: number | null;
    }): Shell;
    apply(shape: BrepEdge, options?: {
        tolerance?: number | null;
    }): BrepEdge;
    apply(shape: Wire, options?: {
        tolerance?: number | null;
    }): Wire;
    apply(point: THREE.Vector3Like, options?: {
        tolerance?: number | null;
    }): THREE.Vector3;
    apply(points: readonly THREE.Vector3Like[], options?: {
        tolerance?: number | null;
    }): THREE.Vector3[];
    /** A summary: the counts, how many points were moved, the box. */
    toString(): string;
}
```

### twist

```ts
/**
 * The shape twisted about an axis by `angle` radians over its length (or from `start` to `end`):
 * every cross-section turns by an angle that grows evenly from 0 at `start` to `angle` at `end`,
 * counterclockwise seen from the tip of the axis (the right-hand rule, as three's rotations turn);
 * what lies beyond `end` turns by the whole angle. The volume stays. A cylinder, cone, sphere or
 * torus about the axis stays the exact face it was, the turned ends stay planes, the other faces
 * become NURBS within `tolerance`.
 *
 * A Part gives a Part and a Shell (or Sketch) a Shell, in the shape's frame with its transform; an
 * BrepEdge gives a BrepEdge and a Wire a Wire, curves of their own where the shape is; a point (a
 * THREE.Vector3 or `{ x, y, z }`) gives the THREE.Vector3 the twist moves it to, an array of points
 * an array. Give points `start` and `end` (the range of the part they belong to): a point has no
 * length along the axis. An edge's or wire's default range is its own; give it the part's `start`
 * and `end` to deform it as the part deforms.
 */
export function twist(shape: Part, angle: number, options?: TwistOptions): Part;
export function twist(shape: Shell, angle: number, options?: TwistOptions): Shell;
export function twist(shape: BrepEdge, angle: number, options?: TwistOptions): BrepEdge;
export function twist(shape: Wire, angle: number, options?: TwistOptions): Wire;
export function twist(point: THREE.Vector3Like, angle: number, options?: TwistOptions): THREE.Vector3;
export function twist(points: readonly THREE.Vector3Like[], angle: number, options?: TwistOptions): THREE.Vector3[];
```

### taper

```ts
/**
 * The shape tapered along an axis: its cross-sections scale toward the axis by a factor that
 * changes evenly from 1 at `start` to `scale` at `end` (0.5 halves them, 2 doubles them); what lies
 * beyond `end` is scaled by `scale` across the axis. The result is exact: a cylinder becomes a cone,
 * a box a frustum of a pyramid, and lines along the axis stay straight. Shapes, curves and points as
 * for `twist`.
 */
export function taper(shape: Part, scale: number, options?: TaperOptions): Part;
export function taper(shape: Shell, scale: number, options?: TaperOptions): Shell;
export function taper(shape: BrepEdge, scale: number, options?: TaperOptions): BrepEdge;
export function taper(shape: Wire, scale: number, options?: TaperOptions): Wire;
export function taper(point: THREE.Vector3Like, scale: number, options?: TaperOptions): THREE.Vector3;
export function taper(points: readonly THREE.Vector3Like[], scale: number, options?: TaperOptions): THREE.Vector3[];
```

### bend

```ts
/**
 * The shape bent around an axis by `angle` radians (less than a full turn; positive: toward the y
 * axis of `frame`), like a bar over a mandrel. Material on the inside of the neutral layer is
 * compressed, on the outside stretched. The bend axis lies `radius` from the neutral layer on the
 * side the part bends toward, and the part must not reach it. `start` and `end` are distances along
 * the frame's x axis from its origin (default: where the part begins and ends along it, so
 * `bend(part, Math.PI / 2)` bends the whole part into a quarter circle); what lies before `start`
 * stays, what lies beyond `end` goes on straight, turned by `angle`.
 *
 * Plane faces across the bend become exact cylinders about the bend axis and lines across it exact
 * arcs, so a bent plate is sheet metal to `bends` and `unfold`. A Wire comes back with every piece an
 * edge of its own (a straight path bent in its middle: line, arc, line), a BrepEdge as one edge. Shapes,
 * curves and points otherwise as for `twist`.
 */
export function bend(shape: Part, angle: number, options?: BendOptions): Part;
export function bend(shape: Shell, angle: number, options?: BendOptions): Shell;
export function bend(shape: BrepEdge, angle: number, options?: BendOptions): BrepEdge;
export function bend(shape: Wire, angle: number, options?: BendOptions): Wire;
export function bend(point: THREE.Vector3Like, angle: number, options?: BendOptions): THREE.Vector3;
export function bend(points: readonly THREE.Vector3Like[], angle: number, options?: BendOptions): THREE.Vector3[];
```

### unroll

```ts
/**
 * The shape wrapped around an axis laid out flat: the inverse of a bend of the whole shape. A point at
 * distance r from the axis and at the angle a (radians, about the axis) from `start` goes to distance
 * r from the axis along `start` and `radius * a` across it, so the layer at `radius` keeps its length,
 * material inside it gets longer and outside it shorter. Cylinders about the axis become planes and
 * circles about it lines (a helix about it a line). The shape must not reach the axis, must cover less
 * than a full turn about it, and must not reach the half-plane opposite `start`, where it would
 * tear. Shapes, curves and points as for `twist`.
 */
export function unroll(shape: Part, options: UnrollOptions): Part;
export function unroll(shape: Shell, options: UnrollOptions): Shell;
export function unroll(shape: BrepEdge, options: UnrollOptions): BrepEdge;
export function unroll(shape: Wire, options: UnrollOptions): Wire;
export function unroll(point: THREE.Vector3Like, options: UnrollOptions): THREE.Vector3;
export function unroll(points: readonly THREE.Vector3Like[], options: UnrollOptions): THREE.Vector3[];
```

### deform

```ts
/**
 * The shape deformed by a lattice of control points (see Lattice; it is in the shape's frame): the
 * function form of `Part.deform` and `Shell.deform`, and of `lattice.apply` for curves and points.
 * Shapes, curves and points as for `twist`.
 */
export function deform(shape: Part, lattice: Lattice, options?: {
    tolerance?: number | null;
}): Part;
export function deform(shape: Shell, lattice: Lattice, options?: {
    tolerance?: number | null;
}): Shell;
export function deform(shape: BrepEdge, lattice: Lattice, options?: {
    tolerance?: number | null;
}): BrepEdge;
export function deform(shape: Wire, lattice: Lattice, options?: {
    tolerance?: number | null;
}): Wire;
export function deform(point: THREE.Vector3Like, lattice: Lattice, options?: {
    tolerance?: number | null;
}): THREE.Vector3;
export function deform(points: readonly THREE.Vector3Like[], lattice: Lattice, options?: {
    tolerance?: number | null;
}): THREE.Vector3[];
```

### RangeOptions

```ts
/** Where a deformation applies along its axis: distances along the axis from its origin. */
export interface RangeOptions {
    /** Where the deformation begins (default: where the shape begins along the axis). What lies
     * before it stays. */
    start?: number | null;
    /** Where it ends (default: where the shape ends along the axis). What lies beyond it moves as the
     * end does. */
    end?: number | null;
    /** The largest distance of the deformed faces and edges from the exact map, in model units
     * (default 1e-6). */
    tolerance?: number | null;
}
```

### TwistOptions

```ts
/** Options of twists. */
export interface TwistOptions extends RangeOptions {
    /** The line to twist about, in the shape's frame (default: its y axis, through the origin). */
    axis?: THREE.Ray | null;
}
```

### TaperOptions

```ts
/** Options of tapers. */
export interface TaperOptions extends RangeOptions {
    /** The line the cross-sections shrink toward, in the shape's frame (default: its y axis, through
     * the origin). */
    axis?: THREE.Ray | null;
}
```

### BendOptions

```ts
/** Options of bends. */
export interface BendOptions extends RangeOptions {
    /** The bend radius of the neutral layer. With `radius` and neither `start` nor `end`, the bend
     * (`radius * angle` long) is centered on the frame's origin; with one of them it begins or ends
     * there. Without it, `start` and `end` set it: radius = (end - start) / angle. */
    radius?: number | null;
    /**
     * The frame of the bend, in the shape's frame: its x axis runs along the part, a positive angle
     * bends the part toward its y axis, the bend axis is parallel to x × y, and the layer through its
     * origin spanned by x and x × y is the neutral layer, which keeps its length. Default: the
     * identity (a part lying along x bends up, toward +y, about an axis along z). (smlibpy's `plane`:
     * a frame, which a THREE.Plane is not.)
     */
    frame?: THREE.Matrix4 | null;
}
```

### UnrollOptions

```ts
/** Options of unrolls. */
export interface UnrollOptions {
    /** The radius of the neutral layer, the one that keeps its length (> 0). */
    radius: number;
    /** The axis the shape is rolled about, in its frame (default: its y axis, through the origin). */
    axis?: THREE.Ray | null;
    /** A direction across the axis, in the shape's frame: the line (at every distance from the axis)
     * that stays in place. Default: the middle of the shape's angle about the axis. */
    start?: THREE.Vector3Like | null;
    /** The largest distance of fitted faces from the exact unroll, in model units (default 1e-6). */
    tolerance?: number | null;
}
```

### LatticeLayers

```ts
/** Which layers of a lattice along one axis: a number (negative ones count from the end), null for
 * all of them, or an array of numbers. */
export type LatticeLayers = number | null | readonly number[];
```

### LatticeIndex

```ts
/** A selection of points of a lattice: `[i, j, k]` along x, y (up) and z, each a
 * `LatticeLayers`; the points are every combination (`[1, -1, 1]` is the middle of the top layer of
 * a 3 x 3 x 3 lattice, `[null, -1, null]` the whole top layer). */
export type LatticeIndex = readonly [LatticeLayers, LatticeLayers, LatticeLayers];
```

### LatticeAxis

```ts
/** One of three's axes, for `Lattice.layer`: 'x', 'y' or 'z', or a direction (or THREE.Ray) along one. */
export type LatticeAxis = 'x' | 'y' | 'z' | THREE.Vector3Like | THREE.Ray;
```

## Surfaces

### FitReport

```ts
/**
 * How far the points given to `surface` lie from it, each to its closest point on the surface, in
 * model units (`surface(points, { report: true })`).
 */
export class FitReport {
    /** The largest distance of a point from the surface. */
    readonly maxDistance: number;
    /** The root mean square of the distances. */
    readonly rmsDistance: number;
    /** The distance of each point, in the order given (a grid's rows one after the other). */
    readonly distances: number[];
    constructor(maxDistance: number, rmsDistance: number, distances: number[]);
}
```

### StitchReport

```ts
/** What `stitch` sewed (`stitch(..., { report: true })`). */
export class StitchReport {
    /** Pairs of free edges sewn into one edge. */
    readonly sewnEdges: number;
    /** Free edges left: the border of a sheet, and edges whose partner lies further away than the
     * tolerance. */
    readonly openEdges: number;
    /** The widest gap closed, between vertices or edges that were sewn (0 where the pieces met
     * exactly); every gap closed is at most `tolerance`. */
    readonly maxGap: number;
    /** Faces turned over so that their normals agree with their neighbours' (on open results; a
     * closed result faces outward anyway). */
    readonly turnedFaces: number;
    /** The widest gap looked for: the tolerance given, or its default, or less where every edge was
     * sewn before. */
    readonly tolerance: number;
    constructor(sewnEdges: number, openEdges: number, maxGap: number, turnedFaces: number, tolerance: number);
}
```

### surface

```ts
/**
 * A freeform NURBS sheet through a grid of points, or fitted to a cloud of points (THREE.Vector3s, or
 * `{ x, y, z }`), at the origin. A grid is rows of points, `points[i][j]`, all rows the same length
 * and at least 4 x 4 (the surface is bicubic); its normal is (points[i + 1][j] - points[i][j]) ×
 * (points[i][j + 1] - points[i][j]), so rows that follow one another along +z, each running along +x,
 * face up (+y). A cloud is points in any order (at least 4), such as a scan, which the surface
 * approaches; it spans the smallest rectangle around them in their best-fit plane and faces +z where
 * that plane's normal has a z part (a cloud over the XY plane faces +z), else +y, else +x. A cloud
 * must be a height field over its
 * best-fit plane (no overhangs); one that is not gets a surface that misses it, without an error:
 * check the report's `maxDistance`.
 */
export function surface(points: readonly (readonly THREE.Vector3Like[])[] | readonly THREE.Vector3Like[], options: SurfaceOptions & {
    report: true;
}): [Shell, FitReport];
export function surface(points: readonly (readonly THREE.Vector3Like[])[] | readonly THREE.Vector3Like[], options?: SurfaceOptions): Shell;
```

### nurbsSurface

```ts
/**
 * A sheet of one face from a surface's NURBS data, as other programs, files and papers give it: the
 * control points in rows (`points[i][j]` the point i along u and j along v, THREE.Vector3s; all rows
 * the same length, at least degree + 1 each way), the knot vectors `[uKnots, vKnots]` (each knot as
 * often as its multiplicity, not decreasing; default uniform and clamped, so the surface starts and
 * ends at the corners of the net), the degrees `[u, v]` or one for both (default: from the knots,
 * else 3, less where there are fewer points), and a positive weight per control point in the same
 * rows (null: not rational). Or the data in one object (NurbsSurfaceData: the inverse of
 * `BrepFace.nurbs()`, in the frame of the face's body), or three's NURBSSurface
 * (three/addons/curves/NURBSSurface.js) read as three evaluates it: `degree1` and `knots1` along u
 * (the first index of its control points), and the `w` of each control point its weight (for
 * clamped knots, which three's getPoint assumes, the same surface). The face's normal is along
 * du × dv; the sheet is at the origin.
 */
export function nurbsSurface(points: readonly (readonly THREE.Vector3Like[])[] | NurbsSurfaceData | NURBSSurface, knots?: readonly [
    readonly number[],
    readonly number[]
] | null, degrees?: number | readonly [number, number] | null, weights?: readonly (readonly number[])[] | null): Shell;
```

### ruled

```ts
/**
 * The ruled sheet between two curves (Edges, Wires of one edge, or three's curves): straight lines
 * join matching points of the two. In the frame of `a`, with its transform; `b` is taken where it is.
 */
export function ruled(a: CurveLike, b: CurveLike): Shell;
```

### fill

```ts
/**
 * A sheet that fills a closed loop of curves: a hole in a sheet, or the frame of a patch. The curves
 * (border edges of sheets, `sheet.edges().filter((e) => e.faces().length === 1)`, other Edges, Wires
 * or three's curves) come in any order and direction and are taken where they are; a sheet's edges
 * keep their sheet, so that the patch can meet it tangentially. Four sides make a Coons patch of one
 * face, three or five and more an N-sided fill, one or two closed curves are cut into four sides. The
 * patch is in the frame of the first curve, with its transform; sew it to the sheets with
 * `stitch(sheet, patch)`.
 */
export function fill(boundary: CurveLike | Iterable<CurveLike>, options?: FillOptions): Shell;
```

### network

```ts
/**
 * A sheet through a network of curves (a Gordon surface): `u` curves that each cross every `v` curve
 * once, the outer curves of each set bounding it (Edges, Wires or three's curves, where they are, in
 * any order and direction). It runs through the curves (to 1e-7 of their size); its normal is the
 * first `u` curve's direction crossed with the first `v` curve's, where they cross. In the frame of the
 * first `u` curve, with its transform.
 */
export function network(u: Iterable<CurveLike>, v: Iterable<CurveLike>): Shell;
```

### surfaceFillet

```ts
/**
 * A round blend between the surfaces of two faces (or sheets of one face), as a sheet: for surfaces
 * that are no faces of one part, such as two sheets that cross (`Part.fillet` rounds a part's edges).
 * A ball of `radius` rolls between the two surfaces, as far as they reach; the blend's long edges lie
 * on them. `b` is taken where it is; the blend is in the frame of `a` (its body's, for a face), with
 * its transform.
 */
export function surfaceFillet(a: BrepFace | Shell, b: BrepFace | Shell, radius: number, options?: SurfaceFilletOptions): Shell;
```

### blend

```ts
/**
 * A smooth bridge between border edges of two sheets (edges one face uses:
 * `sheet.edges().filter((e) => e.faces().length === 1)`): a sheet that leaves one sheet across
 * `edgeA` and reaches the other across `edgeB`, tangent to both or smoother. It joins the nearest ends
 * of the two edges, and its normal follows `edgeA`'s sheet; two closed edges (the rims of two tubes)
 * are bridged all round. The sheets are taken where they are; the blend is in the frame of `edgeA`'s
 * sheet, with its transform.
 */
export function blend(edgeA: BrepEdge, edgeB: BrepEdge, options?: BlendOptions): Shell;
```

### stitch

```ts
/**
 * Faces and sheets sewn along their common edges: `stitch(a, b, c, { tolerance: 0.01 })`, or
 * `stitch(box.faces())`. The pieces are taken where they are. Edges that meet closely are sewn first,
 * looser ones after them, up to the tolerance: a wider gap is never closed silently. A Part where the
 * pieces close around a volume (its faces then point outward), else a Shell whose faces are turned
 * to agree with their neighbours (each connected piece keeps the normal of its first face, in the
 * order given). In the frame of the first piece (its body's, for a face), with its transform.
 */
export function stitch(...args: [
    ...StitchPiece[],
    StitchOptions & {
        report: true;
    }
]): [Part | Shell, StitchReport];
export function stitch(...args: (StitchPiece | StitchOptions)[]): Part | Shell;
```

### CurveLike

```ts
/** A curve given to a surface: a BrepEdge or Wire (where it is), or one of three's 3D curves (in the
 * frame of the first curve). */
export type CurveLike = BrepEdge | Wire | THREE.Curve<THREE.Vector3>;
```

### SurfaceOptions

```ts
/** Options of `surface`. */
export interface SurfaceOptions {
    /** Grids: pass through the points (default); false takes them as control points, for a smoother
     * surface that only approaches them. */
    interpolate?: boolean;
    /** Clouds: control points per direction, one number or [along, across] (4 to 64, "along" the
     * longer side of the cloud); default about one per 8 points. */
    controls?: number | readonly [number, number] | null;
    /** Clouds: how much the surface resists bending, against how close it comes to the points, 0 to 1
     * (default 0.01); for noisy points raise it (0.1 to 1), or take fewer control points. */
    smoothing?: number;
    /** True: `[sheet, report]`, with a FitReport of how far each point lies from the surface. */
    report?: boolean;
}
```

### NurbsSurfaceData

```ts
/** A surface's NURBS data, in three's coordinates: its degrees [u, v], its knot vectors [u, v], its
 * control points in rows (`points[i][j]`: i along u, j along v) and a weight for each (null: not
 * rational). */
export interface NurbsSurfaceData {
    readonly degrees: readonly [number, number];
    readonly knots: readonly [
        readonly number[],
        readonly number[]
    ];
    readonly points: readonly (readonly THREE.Vector3Like[])[];
    readonly weights?: readonly (readonly number[])[] | null;
}
```

### FillOptions

```ts
/** Options of `fill`. */
export interface FillOptions {
    /** True (default): where the curves are border edges of sheets, the patch meets each sheet
     * tangentially along its edge (then every curve must be such an edge, and the sheets must meet one
     * another tangentially where the edges meet); false runs the patch through the curves only. */
    tangent?: boolean;
}
```

### SurfaceFilletOptions

```ts
/** Options of `surfaceFillet`. */
export interface SurfaceFilletOptions {
    /** Chamfers only: a second distance, from `b` (default `radius`). */
    radius2?: number | null;
    /** 'round' (default): a circular cross-section; 'chamfer': a flat one, straight across between the
     * lines where the round of the same radius meets the surfaces. */
    shape?: 'round' | 'chamfer';
    /** The side of each face the blend lies on: 1 the side its normal (`normalAt()`) points to, -1 the
     * other (default [1, 1]). Two crossing surfaces leave four places for a ball to roll. */
    sides?: readonly [number, number];
    /** True: both faces cut back to the blend's long edges and sewn to it into one sheet. */
    trim?: boolean;
}
```

### BlendOptions

```ts
/** Options of `blend`. */
export interface BlendOptions {
    /** How smoothly the blend meets the sheets: 'G1' tangent, 'G2' (default) with the same curvature
     * across the edges too, 'G3' also the same change of curvature. */
    continuity?: 'G1' | 'G2' | 'G3' | number;
    /** How far the blend runs on in each sheet's direction before it turns, as a part of the gap
     * (default 1): one number, or one per edge; less is tighter, more bulges. */
    tension?: number | readonly [number, number];
    /** True: the blend sewn to both sheets, one sheet. */
    join?: boolean;
}
```

### StitchOptions

```ts
/** Options of `stitch`. */
export interface StitchOptions {
    /** The widest gap to close (default 1e-4 of the size of all pieces together); edges and vertices
     * further apart stay open. */
    tolerance?: number | null;
    /** True: `[body, report]`, with a StitchReport of what was sewn. */
    report?: boolean;
}
```

### StitchPiece

```ts
/** What `stitch` sews: faces, sheets (sketches too) and parts, and lists of them. */
export type StitchPiece = Part | Shell | BrepFace | Iterable<StitchPiece>;
```

## Sheet metal

### Bend

```ts
/** One bend of a sheet metal part, as `bends` finds it (with its axis) or a FlatPattern lays it out
 * (with its bend line and direction). */
export class Bend {
    /** The bend angle, in radians. */
    readonly angle: number;
    /** The inside bend radius. */
    readonly radius: number;
    /** The sheet's thickness. */
    readonly thickness: number;
    /** Where its neutral fiber lies, 0 (inside) to 1 (outside). */
    readonly kFactor: number;
    /** Its extent along its axis. */
    readonly length: number;
    /** From `bends`: the axis of its cylinders, a THREE.Ray in the part's frame (else null). */
    readonly axis: THREE.Ray | null;
    /** In a FlatPattern: the bend line, the middle of its strip on the bottom of the flat (a BrepEdge with
     * the pattern's transform; else null). */
    readonly line: BrepEdge | null;
    /** In a FlatPattern: 'up' where the sheet beyond the line folds up (+z), else 'down' (else null). */
    readonly direction: 'up' | 'down' | null;
    constructor(angle: number, radius: number, thickness: number, kFactor: number, length: number, axis?: THREE.Ray | null, line?: BrepEdge | null, direction?: 'up' | 'down' | null);
    /** The bend allowance, the width of the bend's strip in the flat: `angle * (radius + kFactor * thickness)`. */
    get allowance(): number;
    /** A summary of the bend (its angle in radians). */
    toString(): string;
}
```

### FlatPattern

```ts
/**
 * The unfolded part, laid in the XY plane of the part's frame, as a sketch lies, and with the part's
 * transform: its bottom face at z = 0 and its top at z = thickness, the longer side of the smallest
 * rectangle around it along x, and its corner at the origin: x from 0 to its length, y from 0 to its
 * width.
 */
export class FlatPattern {
    /** The flat part. */
    readonly part: Part;
    /** The cut contour (outer boundary and holes) as a sketch at z = 0. */
    readonly outline: Sketch;
    /** The bends, each with its bend line, angle, radius, direction and K-factor. */
    readonly bends: Bend[];
    /** The sheet's thickness. */
    readonly thickness: number;
    /** The K-factor of every bend, or null where the bends have different ones (each Bend has its own). */
    readonly kFactor: number | null;
    constructor(part: Part, outline: Sketch, bends: Bend[], thickness: number, kFactor: number | null);
    /** The bend lines (each bend's `line`), at z = 0. */
    get bendLines(): ShapeList<BrepEdge>;
    /** The size of the blank: its length along x, its width along y and its thickness along z,
     * measured on its edges (a new THREE.Vector3). */
    get size(): THREE.Vector3;
    /** A summary: the size of the blank (length x width), its thickness and bends. */
    toString(): string;
}
```

### bendAllowance

```ts
/**
 * The length of the flat strip a bend takes, `angle * (radius + kFactor * thickness)`: `angle` the
 * bend angle in radians (π / 2 for an L; above 0 and below 2π), `radius` the inside radius.
 */
export function bendAllowance(angle: number, options: BendAllowanceOptions): number;
```

### bendDeduction

```ts
/**
 * What a bend takes off the sum of the outside lengths of its legs:
 * `2 * (radius + thickness) * tan(angle / 2) - bendAllowance`, the outside lengths running to the
 * virtual sharp, where the outer faces of the two legs meet (`angle` in radians, above 0 and below π).
 */
export function bendDeduction(angle: number, options: BendAllowanceOptions): number;
```

### developedLength

```ts
/**
 * The length of the flat blank for a strip bent into `legs`: `developedLength(60, 40, { radius: 2,
 * thickness: 2 })`. The legs are outside lengths, from a free end or a virtual sharp (where the outer
 * faces of two legs meet) to the next, as a drawing gives them; `angle` is the angle of every bend in
 * radians (default π / 2), or one per bend. The result is the sum of the legs less a bend deduction
 * per bend.
 */
export function developedLength(...args: [
    ...legs: number[],
    options: DevelopedLengthOptions
]): number;
```

### fold

```ts
/**
 * The part (a sheet of constant thickness: a plate, or a part bent before) folded along a line by
 * `angle` radians, up to π (a hem): the strip of the bend allowance centered on the line becomes the
 * bend, exact cylinders of `radius` and `radius + thickness`. The line lies on the top or bottom face
 * of the sheet: a THREE.Ray in the part's frame, or a straight BrepEdge (where it is). A positive angle
 * folds the sheet toward the side the face with the line faces (a line on the top folds it up), a
 * negative one the other way.
 */
export function fold(part: Part, line: THREE.Ray | BrepEdge, angle: number, options: FoldOptions): Part;
```

### flange

```ts
/**
 * The part with a flange along a straight edge of the sheet, where a top or bottom face meets a side
 * face square to it (an edge of the part, picked by selectors: `plate.edges().parallelTo(Y).front().right()`):
 * the sheet extended beyond the edge and bent there, so the sheet keeps its size. `length` is the
 * flange's outside length, from the virtual sharp (where the outside faces of sheet and flange meet)
 * to its end: for a right angle, its height over the outside face of the sheet.
 */
export function flange(part: Part, edge: BrepEdge | Iterable<BrepEdge>, length: number, options: FlangeOptions): Part;
```

### bends

```ts
/**
 * The bends of a sheet metal part: pairs of coaxial cylinder faces one thickness apart (as fold,
 * flange and bend make them, or as a file has them), up to below a full turn; cylinders without such a
 * partner (holes, rounds) are none. Each with its angle, inside radius, thickness, length and axis (a
 * THREE.Ray in the part's frame); `kFactor` (see KFactor) sets their K-factors only.
 */
export function bends(part: Part, options?: {
    kFactor?: KFactor;
}): Bend[];
```

### unfold

```ts
/**
 * The sheet metal part with every bend flat again: the face `fixed` (default: the largest planar face)
 * stays where it is, the rest of the sheet unfolds into its plane. With the K-factor the part was bent
 * with (by default each bend's own, from fold and flange, else 0.44), it is the blank it was bent from.
 * Rolled parts (one bend, no flat sheet), bends at a free end of the sheet (a curl) and bends over π
 * unroll at the neutral radius `radius + kFactor * thickness`. For the flat pattern in the XY plane,
 * with its outline and bend lines, see `flatPattern`.
 */
export function unfold(part: Part, options?: UnfoldOptions): Part;
```

### flatPattern

```ts
/**
 * The flat pattern of a sheet metal part (see FlatPattern): the part unfolded with `fixed` (default:
 * the largest planar face) as its bottom, laid in the XY plane of the part's frame with the longer
 * side along x, its cut contour as a sketch, and its bends with their bend lines; a bend is 'up' where
 * the sheet beyond its line folds up (+z). `kFactor` as for `unfold`.
 */
export function flatPattern(part: Part, options?: UnfoldOptions): FlatPattern;
```

### KFactor

```ts
/**
 * The K-factors of `unfold`, `flatPattern` and `bends`, as smlibpy takes them: one number (0, the
 * inside of the sheet, to 1, its outside) for every bend; a function `(radius, thickness, angle) => k`
 * of each bend (its angle in radians); a mapping from inside radius to K-factor (a Map, or an object
 * such as `{ 1: 0.33, 6: 0.45 }`); `[r / t, k]` pairs, interpolated (a shop's table, its ends held);
 * `'din6935'`; or null: the K-factor each bend was folded with (`fold`, `flange`), else 0.44.
 */
export type KFactor = number | string | ((radius: number, thickness: number, angle: number) => number) | ReadonlyMap<number, number> | Readonly<Record<string, number>> | readonly (readonly [number, number])[] | null;
```

### BendAllowanceOptions

```ts
/** The bend of `bendAllowance` and `bendDeduction`. */
export interface BendAllowanceOptions {
    /** The inside bend radius. */
    radius: number;
    /** The sheet's thickness. */
    thickness: number;
    /** Where the neutral fiber lies, 0 (inside) to 1 (outside); default 0.44. */
    kFactor?: number;
}
```

### DevelopedLengthOptions

```ts
/** The bends of `developedLength`. */
export interface DevelopedLengthOptions extends BendAllowanceOptions {
    /** The angle of every bend in radians, or one per bend (default π / 2). */
    angle?: number | Iterable<number>;
}
```

### FoldOptions

```ts
/** Options of folds. */
export interface FoldOptions {
    /** The inside bend radius (from 0.11). */
    radius: number;
    /** Where the neutral fiber lies, 0 (inside) to 1 (outside); default 0.44. The part keeps it with
     * the bend: `unfold` and `flatPattern` take it by default. */
    kFactor?: number;
    /** A point on the side of the line that stays in place (in the part's frame), or a shape there
     * (where it is: its center; a vertex's point). By default the side that reaches farther from the
     * line stays. */
    fixed?: THREE.Vector3Like | Body | BrepFace | BrepEdge | Wire | BrepVertex | null;
    /** Bend only along the segment `line` (a BrepEdge), not across the whole sheet; the strip next to the
     * segment must be cut free from the rest of the sheet (relief cuts). */
    partial?: boolean;
}
```

### FlangeOptions

```ts
/** Options of flanges. */
export interface FlangeOptions {
    /** The bend angle in radians, below π (default π / 2): a positive angle folds the flange toward the
     * side the face with the edge faces, a negative one the other way. */
    angle?: number;
    /** The inside bend radius (from 0.11). */
    radius: number;
    /** Where the neutral fiber lies, 0 (inside) to 1 (outside); default 0.44. */
    kFactor?: number;
}
```

### UnfoldOptions

```ts
/** Options of `unfold` and `flatPattern`. */
export interface UnfoldOptions {
    /** The K-factor of each bend (see KFactor); default: the one each bend was folded with, else 0.44. */
    kFactor?: KFactor;
    /** The planar face of the part that stays in place (default: the largest planar face). */
    fixed?: BrepFace | null;
}
```

## Triangle meshes

### TriangleMesh

```ts
/**
 * A triangle mesh (smlibpy's Mesh): a THREE.Mesh whose geometry is its triangles, in the kernel's
 * order, with the kernel's corner normals where it has them (a tessellation's are the exact
 * surfaces' normals) and each triangle's own normal otherwise. Its
 * geometry is made when three first reads it; clones share it and the kernel's mesh, as three's
 * clones share their geometry. It raycasts, renders, exports (STLExporter, GLTFExporter) and
 * measures (Box3.setFromObject) as any mesh; `intersectRay` is the kernel's exact ray cast.
 *
 * Its own material is a MeshStandardMaterial drawn on both sides (meshes of scans and STL files
 * are often open). Assigning a geometry makes it the mesh, as a THREE.Mesh's geometry is its shape:
 * three draws it as it is, and the kernel's operations take it (its corners welded by position) when
 * one first needs it.
 */
export class TriangleMesh extends THREE.Mesh {
    readonly isTriangleMesh: true;
    /**
     * A mesh of `source`: a THREE.BufferGeometry of triangles (an STL file's, three's BoxGeometry, a
     * body's geometry), its corners welded by position and its normals kept; or bodies and faces,
     * tessellated where they are in the world (`options`: how finely), into one mesh; or nothing:
     * an empty mesh. The mesh is in its own frame, which is the world's until it is moved.
     */
    constructor(source?: THREE.BufferGeometry | Body | BrepFace | Iterable<Body | BrepFace> | null, material?: THREE.Material | THREE.Material[] | null, options?: TessellateOptions);
    /** The number of triangles. */
    get triangleCount(): number;
    /** The surface area. */
    get area(): number;
    /** The volume it encloses (meaningful for a closed mesh). */
    get volume(): number;
    /** The box around its points, in its frame (a RangeError for an empty mesh). */
    bbox(target?: THREE.Box3): THREE.Box3;
    /** The middle of its box, in its frame (`centroid` is the center of mass). */
    center(target?: THREE.Vector3): THREE.Vector3;
    /** The center of mass of the volume a closed mesh encloses, in its frame (see `massProperties`). */
    get centroid(): THREE.Vector3;
    /** One unit normal per triangle (x, y, z each), in the kernel's order. */
    get triangleNormals(): Float32Array;
    /**
     * Mass, volume, area, center and inertia (about the center, in three's axes) of the volume it
     * encloses, for a uniform `density`, in its frame; exact for the triangles. The mesh must be
     * closed and face outward (a ModelingError otherwise: close it with `fillHoles` or `repaired`).
     */
    massProperties(density?: number): MassProperties;
    /** True if every edge is shared by exactly two triangles (a watertight mesh). */
    isClosed(): boolean;
    /**
     * Every place where `ray` (in this mesh's frame, as its geometry's coordinates) meets the
     * triangles, nearest first, in its frame; through an edge or a corner, one hit. For a ray in
     * the world: `ray.clone().applyMatrix4(mesh.matrixWorld.clone().invert())`. (Its `raycast`
     * is three's, for three's Raycaster.)
     */
    intersectRay(ray: THREE.Ray): MeshHit[];
    /**
     * The first hit of each of `rays` (in this mesh's frame), or null where one misses: many rays in
     * one call (the kernel sorts the triangles into a grid once, then takes about 0.01 ms a ray).
     */
    intersectRays(rays: Iterable<THREE.Ray>): (MeshHit | null)[];
    /**
     * Where `plane` (in this mesh's frame) cuts it: polylines through the points where its
     * triangles cross the plane, longest first, placed where the mesh is (with its transform). Of a
     * closed mesh every loop is closed, outer loops counterclockwise seen from the plane's normal and
     * holes clockwise (`wire.toSketch()` makes a region of a closed loop). Empty where the plane
     * misses the mesh.
     */
    section(plane: THREE.Plane): ShapeList<Wire>;
    /**
     * Sections across `axis` (a direction in this mesh's frame; default +z, as a part's slices), `step` apart: the
     * mesh cut into layers `step` thick from its lowest point along the axis up, each cut in its
     * middle (the contours of a printer's layers). Layers whose plane cuts nothing are left out.
     */
    slices(step: number, axis?: THREE.Vector3Like): ShapeList<Wire>[];
    /**
     * A mesh with fewer triangles, as near to this one as the kernel's quadric decimation keeps it:
     * `fraction` is the share of the triangles to remove (0.9 leaves a tenth); or give `triangles`
     * or `tolerance` in `options` instead. A closed mesh stays closed, an open one keeps its border.
     */
    decimate(fraction?: number | null, options?: DecimateOptions): TriangleMesh;
    /** A copy with every hole (a border that closes on itself) filled with triangles that face as
     * the triangles beside them do. */
    fillHoles(): TriangleMesh;
    /**
     * A repaired copy, and what was done: points that lie on each other merged, triangles without
     * an area and repeated ones left out, triangles turned to face as their neighbours do (a closed
     * piece outward), holes filled.
     */
    repaired(): [TriangleMesh, RepairReport];
    /**
     * A faceted part of a closed mesh: a planar face per triangle, neighbouring triangles in one
     * plane merged into one face. It has this mesh's transform and name, and the material the app
     * gave the mesh (else a part's own). More than `maxFaces` faces (0: no limit) is a
     * ModelingError, as Booleans on it get slow: decimate the mesh first.
     */
    toPart(maxFaces?: number): Part;
    /** This mesh and the others (where they are), fused: the kernel's mesh Boolean. A ModelingError
     * where the kernel gives an open mesh or one of an impossible volume: then fuse the exact parts
     * and tessellate the result. */
    fuse(...others: (TriangleMesh | Iterable<TriangleMesh>)[]): TriangleMesh;
    /** This mesh with the others (where they are) cut away. */
    cut(...others: (TriangleMesh | Iterable<TriangleMesh>)[]): TriangleMesh;
    /** What this mesh and the others (where they are) share. */
    intersect(...others: (TriangleMesh | Iterable<TriangleMesh>)[]): TriangleMesh;
    /** The mesh mirrored in `plane` (in its frame); its triangles keep facing outward. */
    mirror(plane: THREE.Plane): TriangleMesh;
    clone(recursive?: boolean): this;
    /** Shares the kernel's mesh, its geometry and the material, as three's copy shares geometry and
     * material. */
    copy(source: this, recursive?: boolean): this;
    /**
     * Frees what the mesh made: its geometry and its kernel mesh (once no clone holds them) and its
     * own material, and fires three's 'dispose'. A material assigned to it is the app's. It stays in
     * the scene as it was drawn; operations on it throw.
     */
    dispose(): void;
}
```

### tessellate

```ts
/**
 * One TriangleMesh of bodies and faces (Part, Shell, Sketch, BrepFace), each tessellated where it is:
 * in the frame of the first one, with its transform, name and material (a face's: its body's), as
 * the result of an operation called on it; the others moved into that frame. `tolerance` is the
 * largest distance of the triangles from the exact faces (null: 0.1 % of each body's diagonal),
 * `angle` the largest angle between neighbouring normals in radians, `maxEdge` the longest edge a
 * triangle may have. (`new TriangleMesh(bodies)` takes them into the world's frame instead.)
 */
export function tessellate(shapes: Body | BrepFace | Iterable<Body | BrepFace>, tolerance?: number | null, angle?: number, options?: {
    maxEdge?: number | null;
}): TriangleMesh;
```

### TessellateOptions

```ts
/** How bodies are tessellated into a TriangleMesh. */
export interface TessellateOptions {
    /** The largest distance of the triangles from the exact faces, in model units (null, the
     * default: 0.1 % of each body's diagonal). */
    tolerance?: number | null;
    /** The largest angle between neighbouring triangle normals on curved faces, in radians (default
     * 15 degrees). */
    angle?: number;
    /** The longest edge a triangle may have (default: no limit): evenly sized triangles, where the
     * tolerance alone leaves a flat face two long ones. */
    maxEdge?: number | null;
}
```

### DecimateOptions

```ts
/** Options of `TriangleMesh.decimate`: give one of `fraction` (its argument), `triangles` or
 * `tolerance`. */
export interface DecimateOptions {
    /** About how many triangles to leave. */
    triangles?: number | null;
    /** How far the result may be from the mesh at most: it is decimated step by step while it stays
     * within this (a few decimations: seconds for 100 000 triangles). */
    tolerance?: number | null;
    /** Edges where the triangles turn by more than this many radians (default 30 degrees) are
     * features: kept longest, and sharp in the result's normals. */
    featureAngle?: number;
}
```

### RepairReport

```ts
/** What `TriangleMesh.repaired` did. */
export interface RepairReport {
    /** Points that lay on each other (to 1e-9 of the largest coordinate), merged. */
    readonly mergedVertices: number;
    /** Triangles without an area, and repeated ones, left out. */
    readonly removedTriangles: number;
    /** Triangles turned to face the way their neighbours face (a closed piece outward). */
    readonly flippedTriangles: number;
    /** Holes filled (as `fillHoles` fills them). */
    readonly filledHoles: number;
    /** Borders that do not close on themselves, left open. */
    readonly openHoles: number;
    /** Edges of the result not shared by two triangles: 0 for a closed mesh. */
    readonly openEdges: number;
}
```

### MeshHit

```ts
/** Where a ray meets a TriangleMesh's triangles (the kernel's ray cast), in the mesh's frame: a
 * RayHit on no face, on a triangle. */
export interface MeshHit extends RayHit {
    /** How far along the ray (its direction taken as a unit vector). */
    readonly distance: number;
    /** The triangle's unit normal: the side its corners turn counterclockwise around (outward on a
     * closed mesh that faces outward). */
    readonly normal: THREE.Vector3;
    readonly face: null;
    /** The triangle's index: the `faceIndex` three's raycast gives for it. */
    readonly triangle: number;
}
```

## Files

Loaders (THREE.Loader: load, loadAsync, parse) and exporters (parse); files are read and written as they are.

### STEPLoader

```ts
/**
 * Reads STEP files (AP203, AP214, AP242) into a THREE.Group of what they hold, in the file's
 * coordinates (see the module's notes on Z up), in millimeters, with the assembly's placements
 * applied:
 *
 * - bodies: a Part for each solid, a Shell for each sheet, named and colored as the file has them;
 * - curves that belong to no body (wireframe geometry, contours): BrepEdge and Wire objects of their own,
 *   named, and colored by their material where the file colors them;
 * - points that belong to no body: BrepVertex objects of their own, named and colored so;
 * - coordinate systems (named placements, as NX, CATIA and tool catalogs write `MCS`, `PCS` or
 *   `CSW`): empties (plain THREE.Object3Ds) named as the file names them and placed at them, their
 *   axes the coordinate system's. So `new Rectangle(20, 10).on(frame.matrixWorld)` draws in its XY
 *   plane, and STEPExporter writes it back (as it writes any named empty).
 *
 * Curves, points and coordinate systems keep the product they belong to in `userData.product`, a
 * coordinate system its color in `userData.color` (a CSS color). A body that cannot be read is left
 * out with a warning, and listed with the reason in the group's `userData.skipped` (`strict` throws
 * instead); a file of which nothing can be read throws a ModelingError.
 */
export class STEPLoader extends THREE.Loader<THREE.Group> {
    /** How files are read. */
    options: STEPLoaderOptions;
    /** Sets how files are read (see STEPLoaderOptions). */
    setOptions(options: STEPLoaderOptions): this;
    load(url: string, onLoad: (group: THREE.Group) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void;
    /** What the contents of a STEP file (its text or bytes) hold. */
    parse(data: string | ArrayBuffer | Uint8Array): THREE.Group;
}
```

### STEPExporter

```ts
/**
 * Writes what is under an object (or several) to STEP AP214, each where the scene shows it, in
 * millimeters unless `unit` says otherwise:
 *
 * - bodies (Part, Shell, Sketch): exact solids and sheets, named by their object's name and colored
 *   by their material's color;
 * - edges and wires of their own: curves, named and colored the same way;
 * - THREE.Points (BrepVertex objects of their own among them): each of their points, named and colored
 *   so;
 * - named empties (plain THREE.Object3Ds with a name, as STEPLoader gives a file's coordinate
 *   systems): coordinate systems, the object's axes theirs; `frames: false` leaves them out. Unnamed empties (pivots, and the containers of three's
 *   helpers) are passed over.
 *
 * `userData.product` puts a curve, point or coordinate system into the product of that name (in an
 * assembly, the body's of that name), `userData.color` (a CSS color or a hex number) colors a
 * coordinate system. A face, edge or vertex of a body is written when it is given (a face as a sheet,
 * without a color), not when it is found as a child of its body (a highlight). Other objects (meshes,
 * lines, groups, cameras, ...) are passed over, their children written.
 */
export class STEPExporter {
    /** The text of a STEP file of what is under `input`. */
    parse(input: THREE.Object3D | readonly THREE.Object3D[], options?: STEPExporterOptions): string;
}
```

### IGESLoader

```ts
/**
 * Reads IGES files (5.3, ASCII) into a THREE.Group of their bodies, in the file's coordinates, in
 * millimeters whatever unit the file uses, named and colored as the file has them.
 * Solids (manifold solid B-rep objects) come in as STEP's do; trimmed and bounded surfaces, the way
 * most CAD systems write IGES, are stitched where their edges meet, and each set of faces that closes
 * up becomes a Part, the others Shells. What cannot be read is left out with a warning (`strict`
 * throws instead); a file of which nothing can be read throws a ModelingError.
 */
export class IGESLoader extends THREE.Loader<THREE.Group> {
    /** How files are read. */
    options: IGESLoaderOptions;
    /** Sets how files are read (see IGESLoaderOptions). */
    setOptions(options: IGESLoaderOptions): this;
    load(url: string, onLoad: (group: THREE.Group) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void;
    /** The bodies of the contents of an IGES file (its text or bytes). */
    parse(data: string | ArrayBuffer | Uint8Array): THREE.Group;
}
```

### DXFLoader

```ts
/**
 * Reads DXF drawings (ASCII) into a THREE.Group of one Sketch in the XY plane (the drawing's): the
 * drawing's (x, y) is three's (x, y), so three's default camera shows it as drawn, and the sketch
 * extrudes towards +z. Lines, arcs, circles, ellipses, polylines (bulges as exact arcs), splines
 * (exact NURBS) and inserted blocks are joined end to end into closed loops, nested by the even-odd
 * rule (a loop inside a loop is a hole, a loop inside a hole an island), in millimeters. Curves that
 * do not close into loops, or outlines that branch, throw a ModelingError that says where; with
 * `wires: true` the group holds every chain of curves as a Wire instead.
 */
export class DXFLoader extends THREE.Loader<THREE.Group> {
    /** How drawings are read. */
    options: DXFLoaderOptions;
    /** Sets how drawings are read (see DXFLoaderOptions). */
    setOptions(options: DXFLoaderOptions): this;
    load(url: string, onLoad: (group: THREE.Group) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void;
    /** The sketch of the contents of a DXF file (its text or bytes), in a THREE.Group; with `wires`,
     * its chains of curves. */
    parse(data: string | ArrayBuffer | Uint8Array): THREE.Group;
}
```

### DXFExporter

```ts
/**
 * Writes 2D shapes to a DXF drawing (AutoCAD 2000, AC1015), each where the scene shows it, seen from
 * the front (+z), as three's default camera sees it: three's (x, y) is the drawing's (x, y), so a
 * sketch comes out as it is drawn. Sketches, planar sheets and planar faces give their
 * outlines (an object's name becomes its layer), edges and wires their curves, drawing views their
 * lines (on the layers VISIBLE and HIDDEN, the hidden lines dashed). Every curve is written exactly:
 * LINE, ARC, CIRCLE, ELLIPSE, or SPLINE with the kernel's control points, knots and weights (see
 * `curves`). Parts are passed over: drawingViews draws them, `part.section(plane)` cuts them.
 */
export class DXFExporter {
    /** The text of a DXF drawing of the 2D shapes under `input`. */
    parse(input: THREE.Object3D | DrawingView | readonly (THREE.Object3D | DrawingView)[], options?: DXFExporterOptions): string;
}
```

### SVGExporter

```ts
/**
 * Draws 2D shapes as SVG, each where the scene shows it, seen from the front (+z), as three's default
 * camera sees them: three's x to the right and y up (a drawing's x and y; the SVG's y runs down). Drawing views
 * give their lines (the hidden ones dashed), edges and wires their curves, sketches, sheets and faces
 * their edges. Lines and circular arcs are exact, other curves polylines. Lengths are millimeters: the
 * drawing prints at its true size. Parts are passed over: drawingViews draws them.
 */
export class SVGExporter {
    /** The text of an SVG drawing of the 2D shapes under `input`. */
    parse(input: THREE.Object3D | DrawingView | readonly (THREE.Object3D | DrawingView)[], options?: SVGExporterOptions): string;
}
```

### USDBrepLoader

```ts
/**
 * Reads the exact bodies of USD stages (.usda text) of NVIDIA's usd-brep schema (its BrepArray prims,
 * as smlibpy, smlibwasm, usd-brep and Omniverse write them) into a THREE.Group of Parts and Shells,
 * named and colored as their prims have them (the material bound to them, else their displayColor),
 * in millimeters and placed as the stage places them, in the stage's coordinates. A stage that says
 * it is Z up stands up in three: its group is turned (`rotation.x = -Math.PI / 2`), as three's own
 * USDLoader turns it. three's USDLoader reads USD's meshes; this one keeps the exact bodies (usd-brep's
 * B-reps, hence its name), and passes the meshes over.
 *
 * The layers a stage names (subLayers, references, payloads) are read as USD composes them: `load`
 * and `loadAsync` load them relative to the file's URL (through the loader's manager, path and
 * resourcePath; binary USD is not read), or the `resolve` option gives them. A body that cannot be
 * read is left out with a warning (`strict` throws instead).
 */
export class USDBrepLoader extends THREE.Loader<THREE.Group> {
    /** How stages are read. */
    options: USDBrepLoaderOptions;
    /** Sets how stages are read (see USDBrepLoaderOptions). */
    setOptions(options: USDBrepLoaderOptions): this;
    load(url: string, onLoad: (group: THREE.Group) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void;
    /** The bodies of the contents of a USD file (its text or bytes), with the layers it names from the
     * `resolve` option. */
    parse(data: string | ArrayBuffer | Uint8Array): THREE.Group;
}
```

### USDBrepExporter

```ts
/**
 * Writes the exact bodies under an object (or several) to a USD stage (.usda text), each where the
 * scene shows it: a BrepArray prim (usd-brep's schema, which Omniverse and usd-brep's tools read as
 * solids) named by its object's name and colored by its material's color, and a Mesh prim of it,
 * which other USD tools and viewers draw (see `mesh`). The stage is Z up in millimeters
 * (metersPerUnit 0.001), turned from three's so that a part standing in three stands in USD's tools
 * (and in USDBrepLoader's group). Binary USD (.usdc, .usdz) is not written: OpenUSD's usdcat converts
 * the text, usdzip packs it. three's USDZExporter writes meshes
 * only; curves and points have no place here (STEPExporter writes them).
 */
export class USDBrepExporter {
    /** The text of a USD stage of the bodies under `input`. */
    parse(input: THREE.Object3D | readonly THREE.Object3D[], options?: USDBrepExporterOptions): string;
}
```

### BREPLoader

```ts
/**
 * Reads OpenCASCADE .brep files (ASCII from BRepTools::Write, binary from BinTools::Write, as
 * build123d, CadQuery, FreeCAD and OpenCASCADE write them) into a THREE.Group of a Part for each solid
 * of the file's shape and a Shell for each sheet, in the file's coordinates and units (millimeters for
 * those tools), with their exact surfaces and curves. The format has no
 * names or colors; curves and points outside faces are not read (a warning says how many).
 */
export class BREPLoader extends THREE.Loader<THREE.Group> {
    /** How files are read. */
    options: BREPLoaderOptions;
    /** Sets how files are read (see BREPLoaderOptions). */
    setOptions(options: BREPLoaderOptions): this;
    load(url: string, onLoad: (group: THREE.Group) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void;
    /** The bodies of the contents of a .brep file (its text or bytes). */
    parse(data: string | ArrayBuffer | Uint8Array): THREE.Group;
}
```

### BREPExporter

```ts
/**
 * Writes the exact bodies under an object (or several) to an OpenCASCADE .brep file (ASCII, as
 * BRepTools::Write writes it), each where the scene shows it, which build123d
 * (import_brep), CadQuery (importBrep), FreeCAD and OpenCASCADE read: one shape, the solid or shell
 * of a single body or a compound of them, with their exact surfaces and curves. Names and colors are
 * not written: the format has no place for them (STEPExporter keeps them).
 */
export class BREPExporter {
    /** The text of a .brep file of the bodies under `input`. */
    parse(input: THREE.Object3D | readonly THREE.Object3D[], options?: BREPExporterOptions): string;
}
```

### SMBLoader

```ts
/**
 * Reads SMLib's native .smb files (one exact body, ASCII or binary) as that body: a Part when it
 * encloses a volume, a Shell when it does not, in the file's coordinates.
 */
export class SMBLoader extends THREE.Loader<Part | Shell> {
    load(url: string, onLoad: (body: Part | Shell) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void;
    /** The body of the contents of an .smb file (its text or bytes). */
    parse(data: string | ArrayBuffer | Uint8Array): Part | Shell;
}
```

### SMBExporter

```ts
/**
 * Writes the one exact body under an object to SMLib's native .smb format, where the scene shows it;
 * reading it back gives the same geometry. Names and colors are not written
 * (SMPExporter keeps them). Throws a RangeError unless there is exactly one body.
 */
export class SMBExporter {
    /** The contents of an .smb file of the body under `input`. */
    parse(input: THREE.Object3D | readonly THREE.Object3D[], options?: SMLibExporterOptions): Uint8Array;
}
```

### SMPLoader

```ts
/**
 * Reads SMLib part files (.smp) into a THREE.Group of what they hold, in the file's order and
 * coordinates: bodies (a Part where it encloses a volume, else a Shell) named
 * and colored as written, and curves as BrepEdge and Wire objects of their own.
 */
export class SMPLoader extends THREE.Loader<THREE.Group> {
    load(url: string, onLoad: (group: THREE.Group) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void;
    /** The bodies and curves of the contents of an .smp file (its text or bytes). */
    parse(data: string | ArrayBuffer | Uint8Array): THREE.Group;
}
```

### SMPExporter

```ts
/**
 * Writes the exact bodies under an object (or several) to an SMLib part file (.smp), the kernel's own
 * container, each where the scene shows it: bodies named by their object's name and
 * colored by their material's color, and edges and wires of their own as curves (the format names
 * bodies only). SMPLoader reads them back in the same order.
 */
export class SMPExporter {
    /** The contents of an .smp file of the bodies and curves under `input`. */
    parse(input: THREE.Object3D | readonly THREE.Object3D[], options?: SMLibExporterOptions): Uint8Array;
}
```

### DrawingView

```ts
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
    readonly name: ViewName;
    /** The direction it looks from (from the parts towards the viewer), in three's axes: (0, 0, 1)
     * for the front view, (0, 1, 0) for the top view. */
    readonly direction: THREE.Vector3;
    /** The lines seen from there. */
    readonly visible: ShapeList<BrepEdge>;
    /** The lines the parts hide (drawn dashed). */
    readonly hidden: ShapeList<BrepEdge>;
    constructor(name: ViewName, direction: THREE.Vector3Like, visible: Iterable<BrepEdge>, hidden: Iterable<BrepEdge>);
    /** The box around the view's lines, where they are (in the XY plane: its z extent is 0); empty
     * for a view without lines. */
    bbox(target?: THREE.Box3): THREE.Box3;
}
```

### drawingViews

```ts
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
export function drawingViews(parts: Body | THREE.Object3D | Iterable<Body | THREE.Object3D>, views?: ViewName | readonly ViewName[], options?: DrawingViewsOptions): DrawingView[];
```

### STEPLoaderOptions

```ts
/** How STEPLoader reads. */
export interface STEPLoaderOptions {
    /** Repair bodies that come out invalid (valid ones are left alone; default true): the kernel's
     * healer, then stitching where faces do not share their edges. */
    heal?: boolean;
    /** Throw a ModelingError for the first body that cannot be read, instead of leaving it out (with a
     * warning, and the reason in the group's `userData.skipped`). Default false. */
    strict?: boolean;
}
```

### STEPExporterOptions

```ts
/** How STEPExporter writes. */
export interface STEPExporterOptions {
    /** The product's name (default 'part'). */
    name?: string;
    /** Each body a product of its own, named as its object, in an assembly called `name`. */
    assembly?: boolean;
    /** The file's length unit: 'mm' (default), 'cm', 'm', 'um' or 'inch'; the model's millimeters are
     * converted to it. */
    unit?: 'mm' | 'cm' | 'm' | 'um' | 'inch';
    /** Leave out invisible objects (default true, as GLTFExporter does). */
    onlyVisible?: boolean;
    /** Write named empties (plain THREE.Object3Ds with a name) as coordinate systems (default true). */
    frames?: boolean;
}
```

### IGESLoaderOptions

```ts
/** How IGESLoader reads. */
export interface IGESLoaderOptions {
    /** Repair solids that come out invalid (default true), as STEPLoader does. */
    heal?: boolean;
    /** Throw a ModelingError for the first entity that cannot be read, instead of leaving it out with a
     * warning (default false). */
    strict?: boolean;
}
```

### DXFUnit

```ts
/** The length units of DXF drawings. */
export type DXFUnit = 'mm' | 'cm' | 'm' | 'um' | 'inch' | 'in' | 'ft';
```

### DXFLoaderOptions

```ts
/** How DXFLoader reads. */
export interface DXFLoaderOptions {
    /** Read only these layers (names in any letter case). */
    layers?: string | Iterable<string> | null;
    /** The drawing's unit, instead of the one the file names ($INSUNITS); a file without one is read
     * as millimeters. */
    unit?: DXFUnit | null;
    /** Curve ends closer than this (in millimeters) are joined (default: 1e-7 of the drawing's size). */
    tolerance?: number | null;
    /** Give every chain of curves of the drawing as a Wire, open or closed (closed ones first, each in
     * drawing order), instead of the sketch of its closed outlines. */
    wires?: boolean;
}
```

### DXFExporterOptions

```ts
/** How DXFExporter writes. */
export interface DXFExporterOptions {
    /** The file's unit: 'mm' (default), 'cm', 'm', 'um', 'inch' or 'ft'; the model's millimeters are
     * converted to it, and the file says so ($INSUNITS). */
    unit?: DXFUnit;
    /** 'exact' (default) writes splines and ellipses as SPLINE and ELLIPSE; 'arcs' as LINE and ARC
     * within `tolerance`, for software that reads only lines and arcs (CNC, laser and plasma cutters). */
    curves?: 'exact' | 'arcs';
    /** For `curves: 'arcs'`: the largest distance between a curve and its lines and arcs, in
     * millimeters (default 0.01). */
    tolerance?: number;
    /** The drawing's frame, in world coordinates: its XY plane is the drawing, its x and y the
     * drawing's, as a sketch lies in the XY plane of its frame (so `sketch.matrixWorld` draws a sketch
     * in its own coordinates wherever it is). The shapes must lie parallel to it. Default: the XY plane
     * where the shapes lie parallel to it, otherwise the plane of the first sketch. */
    frame?: THREE.Matrix4 | null;
    /** Leave out invisible objects (default true). */
    onlyVisible?: boolean;
}
```

### SVGExporterOptions

```ts
/** How SVGExporter draws. */
export interface SVGExporterOptions {
    /** The space around the lines, in millimeters (default: 5 % of the drawing's size). */
    margin?: number | null;
    /** The width of the visible lines, in millimeters (the hidden ones are 0.7 of it, dashed; default
     * 0.35, or 1/500 of the drawing's size where that is smaller). */
    stroke?: number | null;
    /** Leave out invisible objects (default true). */
    onlyVisible?: boolean;
}
```

### USDBrepLoaderOptions

```ts
/** How USDBrepLoader reads. */
export interface USDBrepLoaderOptions {
    /** Run the kernel's import healer on the bodies (default false). */
    heal?: boolean;
    /** The stage's unit ('mm', 'cm', 'm', 'um' or 'inch') instead of its metersPerUnit; a stage without
     * one is read as millimeters (where USD itself takes centimeters). */
    units?: 'mm' | 'cm' | 'm' | 'um' | 'inch' | null;
    /** Place the bodies as the stage does (default true: the transforms of their prims and the prims
     * above them, and a Z-up stage's group turned to stand it up, as three's USDLoader turns it); false
     * leaves each where its prim has it. */
    placement?: boolean;
    /** Check each body with the kernel first (default true): gaps of more than 1e-3 of its size make it
     * unreadable, smaller ones give a warning. */
    check?: boolean;
    /** Throw for the first body that cannot be read, instead of leaving it out with a warning (default
     * false). */
    strict?: boolean;
    /**
     * The text (or bytes) of a layer the stage names (a subLayer, a reference or a payload: `asset` as
     * written, `from` the name of the layer that names it, '' for the file's own), or null for none.
     * Without it, `load` and `loadAsync` load such layers relative to the file's URL; `parse` leaves
     * them out (with a warning that names them).
     */
    resolve?: ((asset: string, from: string) => string | Uint8Array | null | undefined) | null;
}
```

### USDBrepExporterOptions

```ts
/** How USDBrepExporter writes. */
export interface USDBrepExporterOptions {
    /** Write a Mesh prim of each body too (`<name>_mesh`, default true), which USD viewers draw; false
     * writes the exact bodies alone, for usd-brep and Omniverse, which draw them themselves. */
    mesh?: boolean;
    /** The meshes' chord height in millimeters (default: 0.1 % of each body's diagonal). */
    tolerance?: number | null;
    /** The largest angle between neighbouring triangle normals of the meshes, in radians (default 15
     * degrees). */
    angle?: number;
    /** Give each color a Material (a UsdPreviewSurface under /World/Looks) bound to the prims of that
     * color, which renderers use where they leave displayColor aside (default false). */
    materials?: boolean;
    /** The longest edge a triangle of the meshes may have, in millimeters (default: none). */
    maxEdge?: number | null;
    /** Leave out invisible objects (default true). */
    onlyVisible?: boolean;
}
```

### BREPLoaderOptions

```ts
/** How BREPLoader reads. */
export interface BREPLoaderOptions {
    /** Run the kernel's import healer on the bodies (default false). */
    heal?: boolean;
    /** Check each body with the kernel first (default true): one whose faces, edges and vertices leave
     * gaps of more than 1e-3 of its size throws a RangeError, smaller gaps give a warning. */
    check?: boolean;
    /** Throw a ModelingError where a solid, shell or face cannot be read, instead of leaving it out with
     * a warning (default false). */
    strict?: boolean;
}
```

### BREPExporterOptions

```ts
/** How BREPExporter writes. */
export interface BREPExporterOptions {
    /** Leave out invisible objects (default true). */
    onlyVisible?: boolean;
}
```

### SMLibExporterOptions

```ts
/** How SMBExporter and SMPExporter write. */
export interface SMLibExporterOptions {
    /** The kernel's ASCII form (default true, to 16 decimals); false its binary form, bit-exact. */
    ascii?: boolean;
    /** Leave out invisible objects (default true). */
    onlyVisible?: boolean;
}
```

### ViewName

```ts
/** The views of a drawing, by where they look from, in three's axes: 'front' from +Z (towards
 * three's default camera), 'back' from -Z, 'top' from +Y, 'bottom' from -Y, 'left' from -X,
 * 'right' from +X. */
export type ViewName = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right';
```

### DrawingViewsOptions

```ts
/** How drawingViews draws. */
export interface DrawingViewsOptions {
    /** 'first-angle' (ISO, the default: the view from above goes below the front view, the view from
     * the left to its right) or 'third-angle' (ASME: the view from above goes above it, the view from
     * the left to its left). The back view goes at the far right. */
    projection?: 'first-angle' | 'third-angle';
    /** Draw the hidden lines (default true); false leaves each view's `hidden` empty. */
    hidden?: boolean;
    /** Draw the edges where faces meet tangentially (the lines where fillets start); default false. */
    tangentEdges?: boolean;
    /** The space between the views, in model units (default: a fifth of the parts' largest extent). */
    gap?: number | null;
}
```

## Pictures

### Picture

```ts
/**
 * A picture `render` made: the PNG file's bytes (`data`: write them to a file, or show them,
 * `URL.createObjectURL(new Blob([picture.data], { type: 'image/png' }))`) and its pixels.
 */
export class Picture {
    /** The PNG file's bytes. */
    readonly data: Uint8Array;
    /** `width * height` pixels row by row from the top left, three bytes (red, green, blue) each. */
    readonly pixels: Uint8Array;
    readonly width: number;
    readonly height: number;
    /** The frame of a single view (give it to a later render as `frame`); null for sheets and drawings. */
    readonly frame: Frame | null;
    constructor(data: Uint8Array, pixels: Uint8Array, width: number, height: number, frame?: Frame | null);
}
```

### ImageDiff

```ts
/** How two pictures differ (`diffImages`). */
export class ImageDiff {
    /** The number of pixels that differ. */
    readonly changed: number;
    /** The number of pixels. */
    readonly total: number;
    /** `changed / total`. */
    readonly fraction: number;
    /** The pixels that changed lie in `[x0, y0, x1, y1]` (inclusive); null where none did. */
    readonly bbox: readonly [number, number, number, number] | null;
    /** The difference: changed pixels red on a faded gray of the second picture. */
    readonly picture: Picture;
    constructor(changed: number, total: number, fraction: number, bbox: readonly [number, number, number, number] | null, picture: Picture);
}
```

### render

```ts
/**
 * A PNG picture of objects, drawn in software (no GPU: Node, workers, tests): each object and what
 * is under it, where the scene shows it. Bodies (Part, Shell, Sketch) are drawn shaded with their
 * edges, TriangleMeshes shaded, curves of their own (BrepEdge, Wire) as lines on top, each in its
 * material's color (a sketch drawn with solids: its outline on top, in blue); faces, edges and
 * vertices added to their body (three's highlights) are drawn highlighted, and faces or edges given
 * on their own are drawn where their body is. Other objects (lights, cameras, plain meshes) are
 * left out, and so are invisible ones and what is under them, as three's renderers leave them out,
 * and empty or disposed ones.
 *
 *     const picture = render(part, { view: 'top', size: [400, 300] })
 *     writeFileSync('part.png', picture.data)
 */
export function render(objects: THREE.Object3D | Iterable<THREE.Object3D>, options?: RenderOptions): Picture;
```

### diffImages

```ts
/**
 * Compares two pictures of the same size pixel by pixel: pictures of `render`, PNG file bytes, or
 * pixels (`ImageLike`). `tolerance` is the largest difference per color channel (0 to 255) that
 * still counts as equal. Meaningful for two renders of one view with the same `frame`: without
 * it, a changed model is fitted anew and every pixel moves.
 */
export function diffImages(a: Picture | ImageLike | Uint8Array | ArrayBuffer, b: Picture | ImageLike | Uint8Array | ArrayBuffer, tolerance?: number): ImageDiff;
```

### VIEWS

```ts
/** The named views as directions from the objects towards the camera, in three's axes: `top` is
 * +Y, `front` +Z, `right` +X, `iso` (1, 1, 1) normalized. (Frozen: copy them,
 * `camera.position.copy(VIEWS.iso).multiplyScalar(distance)`.) */
export const VIEWS: Readonly<Record<RenderViewName, THREE.Vector3>>;
```

### RenderViewName

```ts
/** The named views: from the front (+Z), back, left, right (+X), above (+Y) and below, and the
 * isometric view from front, right and above. */
export type RenderViewName = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
```

### RenderView

```ts
/**
 * The camera of `render`, orthographic and fitted to what it draws: a named view; the direction
 * from the objects towards the camera (a THREE.Vector3: the position of a camera that looks at
 * the origin); `{ direction, up }`, the direction the camera looks in and its up (a camera's
 * `getWorldDirection()` and `up`; up defaults to +Y); or `{ azimuth, elevation }` in radians
 * (azimuth 0 from the front, π/2 from the right; elevation π/2 from above). Views are never
 * mirrored.
 */
export type RenderView = RenderViewName | THREE.Vector3Like | {
    direction: THREE.Vector3Like;
    up?: THREE.Vector3Like | null;
} | {
    azimuth?: number;
    elevation?: number;
};
```

### RenderPoint

```ts
/** A point of `render`'s options, in the world: a point, the center of a box, or the center of an
 * object where it is (a body's center of mass, the middle of other objects' boxes). */
export type RenderPoint = THREE.Vector3Like | THREE.Box3 | THREE.Object3D;
```

### RenderMarker

```ts
/** A crosshair `render` draws on top, with a label. */
export interface RenderMarker {
    position: RenderPoint;
    label?: string;
    /** Default red. */
    color?: THREE.ColorRepresentation | null;
}
```

### Frame

```ts
/** The frame of a single view: output pixels per model unit (`scale`), and the point in the middle
 * of the picture along the view's right and up directions (`midX`, `midY`, in model units). */
export interface Frame {
    readonly scale: number;
    readonly midX: number;
    readonly midY: number;
}
```

### ImageLike

```ts
/** Pixels to compare: `width * height` pixels row by row from the top left, 3 or 4 numbers each
 * (RGB or RGBA, as a canvas's ImageData); bytes (Uint8Array, Uint8ClampedArray) or numbers from 0
 * to 1 (any other array). */
export interface ImageLike {
    width: number;
    height: number;
    data: ArrayLike<number>;
}
```

### RenderOptions

```ts
/** The options of `render`. */
export interface RenderOptions {
    /** The camera (default 'iso'); 'sheet' is `drawing: 'first-angle'`. */
    view?: RenderView | 'sheet';
    /** Width and height in pixels (default [800, 600]). */
    size?: readonly [number, number];
    /** Draw the edges of faces in the shaded view (default true; hidden edges stay hidden). */
    edges?: boolean;
    /** Default white. */
    background?: THREE.ColorRepresentation;
    /** Tessellation tolerance (null, the default: 0.1 % of each body's size). */
    tolerance?: number | null;
    /** Factor on the scale that fits the objects (2 shows half as much). */
    zoom?: number;
    /** A point that lands in the middle of the picture. */
    lookAt?: RenderPoint | null;
    /** The frame of an earlier render of the same view and size (a Picture or its `frame`): scale and
     * middle stay, so pictures of a changed model compare pixel by pixel (`diffImages`). Overrides
     * `zoom` and `lookAt`. */
    frame?: Frame | Picture | null;
    /** Render at this many times the size and average down (1 to 4, default 2: smooth edges). */
    supersample?: number;
    /** 'native' (default): each object in its material's color (a material without one: a palette
     * color by its place in the list); 'distinct': a palette color per body, also per solid of a part. */
    colors?: 'native' | 'distinct';
    /** Line style: no fill, visible edges and silhouettes solid, hidden ones dashed. */
    lines?: boolean;
    /** A technical drawing: front, top and side view in line style at one scale, and a shaded iso
     * view in the free corner. `true` or 'first-angle' (ISO method E: the top view below the front
     * view, the view from the left right of it), 'third-angle' (method A), or `{ projection, side,
     * iso }` to pick the side view or leave the corner empty. */
    drawing?: boolean | 'first-angle' | 'third-angle' | {
        projection?: 'first-angle' | 'third-angle';
        side?: 'left' | 'right';
        iso?: boolean;
    } | null;
    /** Several shaded views in one picture: `true` (top, iso, front, right), 4 views (2 x 2) or 2 side
     * by side. Named ortho views share one scale. `drawing` wins over `sheet`. */
    sheet?: boolean | readonly (RenderView | null)[] | null;
    /** Cut at a plane (in the world) and keep what three's clipping with it keeps: the side its
     * normal points to. The picture keeps the framing of the whole model. */
    section?: THREE.Plane | null;
    /** Fill the cut faces of closed bodies, hatched (default true); false leaves the cut open. */
    cap?: boolean;
    /** Objects drawn in signal colors where they are: faces, bodies and meshes orange, edges and
     * wires red, vertices as dots. (Faces, edges and vertices added to their body, as three
     * highlights them, are drawn so too.) */
    highlight?: THREE.Object3D | Iterable<THREE.Object3D | Iterable<THREE.Object3D>> | null;
    /** Points (in the world): the face nearest to each is highlighted. */
    highlightAt?: THREE.Vector3Like | Iterable<THREE.Vector3Like> | null;
    /** Crosshairs with labels, drawn on top: points, or markers with a label and a color. */
    markers?: RenderPoint | RenderMarker | Iterable<RenderPoint | RenderMarker> | null;
    /** Translucent bodies: hidden faces shine through, edges stay opaque. */
    xray?: boolean;
    /** The opacity of each face in the x-ray view (0 to 1, default 0.42). */
    xrayAlpha?: number;
    /** Zebra stripes from the exact surface normals (they break at G0, kink at G1, run smoothly
     * across G2 joints): `true`, or the number of black stripes, the black share of each and the
     * direction of the light lines ('vertical' or 'horizontal' on the screen, or a direction in the
     * world). */
    zebra?: boolean | {
        stripes?: number;
        width?: number;
        direction?: 'vertical' | 'horizontal' | THREE.Vector3Like;
    } | null;
    /** A curvature map of the exact surfaces (blue concave, white flat, red convex, in 1/mm; 1/mm² for
     * 'gaussian'): the kind, or `{ kind, range }` to fix the range (`range` or `[low, high]`). */
    curvature?: 'mean' | 'gaussian' | 'max' | 'min' | {
        kind?: 'mean' | 'gaussian' | 'max' | 'min';
        range?: number | readonly [number, number] | null;
    } | false | null;
}
```

## Memory and settings

### scope

```ts
/**
 * Runs `fn` and disposes the bodies and curves made while it runs that its result does not hold,
 * when it returns: the operands and intermediates of a chain (`new Box(...).cut(new Cylinder(...))`
 * and its fillet), named or not, and what the kernel made on the way. What the result holds stays:
 * the bodies and curves it is or contains, through arrays, plain objects, Maps, Sets, the package's
 * objects (a face or edge in the result keeps its body) and the children of three's objects (not
 * their parents). Objects made before the scope stay as they are, clones of them made in it go.
 * Where `fn` throws, what it made is disposed (what the error holds stays) and the error goes on.
 * Scopes nest: what an inner scope returns belongs to the scope around it.
 *
 * The garbage collector frees the kernel's objects only between tasks of the event loop, so a loop
 * that builds without returning to it keeps every object it made until it ends: `scope` keeps such
 * a loop's memory flat.
 *
 * `fn` must return its result, not a promise (an async function goes on after its first `await`,
 * where a scope cannot follow it): a promise is a TypeError, and nothing is disposed. And `fn` must
 * keep what it makes nowhere but in its result: a body kept in a variable outside, added to a scene
 * the result is not in, or given to an object made before with `copy()`, is disposed with the rest
 * (it still draws as it was; modeling with it throws). Copy the result instead:
 * `part.copy(scope(() => model(params)))`.
 */
export function scope<T>(fn: () => T): T;
```

### memoryUsage

```ts
/**
 * What the kernel's memory holds: what its objects take (`used`), how far its memory has grown
 * (`heap`) and how far it can grow (`limit`), in bytes; how many kernel objects are not freed yet
 * (`handles`) and how often the kernel crashed (`crashes`). A kernel call that finds the memory
 * used up fails with a KernelError of status SM_ERR_OUT_OF_MEMORY: dispose of bodies no longer
 * needed, use `scope`, or let the event loop run. Each thread's kernel (a page, a worker) has a
 * memory of its own.
 */
export function memoryUsage(): MemoryUsage;
```

### setWarningHandler

```ts
/**
 * Where the kernel's warnings go (what smlibpy warns of: a STEP file's bodies left out, a sweep
 * that had to turn its profile, the first crash of the kernel): `console.warn` unless set here;
 * null sets it back. Each thread has its own.
 */
export function setWarningHandler(handler: ((message: string) => void) | null): void;
```

### setGuardSeconds

```ts
/** Sets GUARD_SECONDS (0 or more); returns the value it had. */
export function setGuardSeconds(seconds: number): number;
```

### setGuardBooleans

```ts
/** Sets GUARD_BOOLEANS (true or false); returns the value it had. */
export function setGuardBooleans(on: boolean): boolean;
```

### GUARD_SECONDS

```ts
/**
 * Seconds a kernel step that can crash or loop may take: the steps of `removeFillets`,
 * `removeFaces`, `surfaceFillet`, `shell`, `offset`, `thicken` and `cells()`, fillets and chamfers
 * of parts read from files and, with GUARD_BOOLEANS, every Boolean (SMLib's offset code can read
 * memory it freed, and its patching code loops for good on some parts). Where a thread can wait for
 * another (Node, and Web Workers of a cross-origin isolated page), such a step runs in a probe
 * worker, a kernel of its own, on copies of the bodies: a step that crashes there or takes longer
 * fails with a ModelingError (`removeFillets` and `removeFaces` leave it out and go on), and this
 * thread's kernel is left alone. On a page's main thread the step runs here, held to this many
 * seconds by the kernel's deadline, which its long loops (the surface and topology intersections)
 * test. 0 runs the steps here without a limit. Default 20; read here, set with `setGuardSeconds`.
 * Each thread has its own: set it in a KernelWorker's worker module for the calls there.
 */
export let GUARD_SECONDS: number;
```

### GUARD_BOOLEANS

```ts
/** Whether every Boolean (`fuse`, `cut`, `intersect`, `merge`) runs in the probe worker too, as the
 * steps of GUARD_SECONDS do (default false: the bodies go there and back as copies): for long runs
 * over unknown inputs, where a crash of the kernel must not end the run. Read here, set with
 * `setGuardBooleans`; each thread has its own. */
export let GUARD_BOOLEANS: boolean;
```

### MemoryUsage

```ts
/** What the kernel's memory holds (`memoryUsage()`), in bytes, and how many objects. */
export interface MemoryUsage {
    /** What the kernel's objects take, in bytes. */
    readonly used: number;
    /** How far the kernel's memory has grown, in bytes: it grows when the kernel needs more, up to
     * `limit`, and never shrinks. */
    readonly heap: number;
    /** How far the kernel's memory can grow, in bytes: 4 GB (less 64 kB), as far as a 32-bit
     * WebAssembly module reaches (a browser may stop it earlier). */
    readonly limit: number;
    /** The kernel objects (of bodies, curves, surfaces, meshes) that are neither disposed nor garbage
     * collected yet. A count, not bytes. */
    readonly handles: number;
    /** The times the kernel crashed since it was loaded. After a crash its memory may be damaged and
     * what it computes may be wrong: the first crash warns (`setWarningHandler`), and an app that goes
     * on loads the page again, or models in a KernelWorker, which starts a new kernel after one. A
     * count. */
    readonly crashes: number;
}
```

## Errors and types

### ModelingError

```ts
/** An operation the kernel could not carry out (smlibpy's ModelingError), with a hint where there is one. */
export class ModelingError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
```

### KernelError

```ts
/** The kernel itself failed (smlibpy's KernelError): its operation, status and hint, and where it gave up. */
export class KernelError extends ModelingError {
    readonly operation: string;
    readonly status: string | null;
    readonly hint: string | null;
    readonly trace: readonly string[];
    constructor(message: string, details: {
        operation: string;
        status: string | null;
        hint: string | null;
        trace: readonly string[];
    }, options?: {
        cause?: unknown;
    });
}
```

### FontError

```ts
/** The data is not a font the reader can use (smlibpy's FontError): a RangeError. */
export class FontError extends RangeError {
    constructor(message: string);
}
```

### AlignValue

```ts
/** An alignment along one axis: the shape's 'min' side, 'center' or 'max' side at the origin. */
export type AlignValue = 'min' | 'center' | 'max';
```

### Align3

```ts
/** One alignment for every axis, or one per axis (x, y, z); an axis not named stays as it is. */
export type Align3 = AlignValue | {
    x?: AlignValue;
    y?: AlignValue;
    z?: AlignValue;
};
```

### Align2

```ts
/** One alignment for both axes of a sketch, or one per axis (its own x and y); an axis not named
 * stays as it is. */
export type Align2 = AlignValue | {
    x?: AlignValue;
    y?: AlignValue;
};
```

## The worker: @classcad/smlibpy-three/worker

### KernelWorker

```ts
/**
 * The functions a worker exposes (`expose`), called from this thread: they take and return the
 * package's objects and three's values (see the module's comment for what crosses).
 *
 * `worker` makes the worker: a function that returns a new Web Worker or Node `worker_threads`
 * Worker (written as `new Worker(new URL('./cad.worker.js', import.meta.url), { type: 'module' })`
 * where it is called, bundlers find and bundle the worker's module), or the URL of the worker's
 * module, of which `KernelWorker` makes a module worker itself (in Node: a worker thread). The
 * worker starts with the first call (or `start()`), and again after one was terminated; an idle
 * worker does not keep Node running.
 *
 * Calls run one at a time, in the order they were made; each resolves to what the function
 * returned in the worker, or rejects with what it threw: ModelingError and KernelError (the
 * package's, with operation, status, hint and trace), TypeError and RangeError as such, other errors
 * as an Error of their name. A call that runs longer than its timeout rejects with a `TimeoutError`
 * (DOMException), one whose signal fires with the signal's reason; both terminate the worker
 * (nothing else stops a kernel that is at work), and the calls after them run in a new one. So does
 * the call after one whose kernel crashed or ran out of memory, so every call finds a sound kernel.
 */
export class KernelWorker<M extends object = Record<string, (...args: Any[]) => unknown>> {
    constructor(worker: URL | string | (() => WorkerLike), options?: KernelWorkerOptions);
    /**
     * Calls the worker's function `name` with `args`; resolves to what it returns, as it arrives
     * (bodies as Part, Shell or Sketch, curves as BrepEdge or Wire: `Crossed`). Bodies, curves, faces,
     * edges and vertices of bodies, groups, three's values and plain data cross in both directions
     * (see the module's comment); other objects are a TypeError.
     */
    call<K extends FunctionName<M>>(name: K, args?: M[K] extends (...a: infer A) => unknown ? A : never, options?: CallOptions): Promise<M[K] extends (...a: Any[]) => infer R ? Crossed<Awaited<R>> : never>;
    /** The worker's functions as functions of this thread: `functions.plate(80)` is
     * `call('plate', [80])`. */
    get functions(): Remote<M>;
    /** Starts the worker now (it starts with the first call otherwise); resolves once it has loaded
     * its kernel and functions, to their names. */
    start(): Promise<string[]>;
    /** The calls that wait or run. */
    get pending(): number;
    /** Terminates the worker, whatever it is doing; the calls that wait or run reject with an
     * `AbortError` (DOMException). The next call starts a new worker. */
    terminate(): void;
}
```

### expose

```ts
/**
 * Answers the calls of a `KernelWorker` in this worker (a Web Worker or a Node worker thread) with
 * `functions`: an object of functions, or a function that loads them, such as
 * `() => import('./models.js')` (a module's exported functions). The functions take and return the
 * package's objects, and may return a promise.
 *
 * The worker listens for calls at once and answers them once the functions have loaded: a module
 * worker can only be sure to see the messages that come while it loads when it listens before it
 * waits.
 */
export function expose(functions: object | (() => object | Promise<object>)): void;
```

### FunctionName

```ts
/** The names of the functions of `M` (a worker's module). */
export type FunctionName<M> = {
    [K in keyof M]: M[K] extends (...args: Any[]) => unknown ? K : never;
}[keyof M] & string;
```

### Crossed

```ts
/**
 * What a value of type `T` is once it has crossed to or from a worker: bodies as Part, Shell or
 * Sketch and curves as BrepEdge or Wire (the classes of the package's results: a Box arrives as a Part,
 * a Segment as a BrepEdge), groups as THREE.Group or THREE.Object3D, lists, arrays and plain objects item
 * by item, the rest as it is (functions do not cross).
 */
export type Crossed<T> = 0 extends 1 & T ? Any : T extends Primitive | Date | RegExp | ArrayBuffer | ArrayBufferView | ThreeValue ? T : T extends Sketch ? Sketch : T extends Part ? Part : T extends Shell ? Shell : T extends Wire ? Wire : T extends BrepEdge ? BrepEdge : T extends BrepFace ? BrepFace : T extends BrepVertex ? BrepVertex : T extends EdgeLines ? EdgeLines : T extends TriangleMesh ? TriangleMesh : T extends ShapeList<infer U> ? ShapeList<Crossed<U>> : T extends THREE.Group ? THREE.Group : T extends THREE.Object3D ? THREE.Object3D : T extends THREE.BufferGeometry ? THREE.BufferGeometry : T extends ReadonlyMap<infer K, infer V> ? Map<Crossed<K>, Crossed<V>> : T extends ReadonlySet<infer U> ? Set<Crossed<U>> : T extends readonly unknown[] ? {
    -readonly [K in keyof T]: Crossed<T[K]>;
} : T extends (...args: never[]) => unknown ? never : {
    [K in keyof T]: Crossed<T[K]>;
};
```

### Remote

```ts
/** The functions of `M` as the calling thread calls them: each returns a promise of what the
 * function returns in the worker, as it arrives (`Crossed`). */
export type Remote<M> = {
    readonly [K in FunctionName<M>]: M[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Crossed<Awaited<R>>> : never;
};
```

### WorkerLike

```ts
/** A worker as `KernelWorker` takes it: a Web Worker, or a Node `worker_threads` Worker. */
export interface WorkerLike {
    postMessage(message: unknown, transfer?: readonly Transferable[]): void;
    terminate(): unknown;
}
```

### KernelWorkerOptions

```ts
/** The options of a `KernelWorker`. */
export interface KernelWorkerOptions {
    /** Milliseconds a call may run before its worker is terminated (default: no limit); a call's own
     * `timeout` takes its place. */
    timeout?: number;
    /** Milliseconds a new worker may take to load its kernel and its functions (default 60000). */
    startTimeout?: number;
}
```

### CallOptions

```ts
/** The options of one call (`KernelWorker.call`). */
export interface CallOptions {
    /** Milliseconds the call may run in the worker before the worker is terminated (default: the
     * KernelWorker's `timeout`). The time it waits for the calls before it, or for a new worker to
     * start, does not count. */
    timeout?: number;
    /** Ends the call when it fires: a call that waits is dropped, one that runs ends with its worker. */
    signal?: AbortSignal;
}
```

## Loading the kernel: @classcad/smlibpy-three/init

### init

```ts
/**
 * Loads the package with its kernel from where `options` say. Call it before anything imports
 * '@classcad/smlibpy-three', and take the package from its promise.
 */
export function init(options?: InitOptions): Promise<typeof import('./index.ts')>;
```

### InitOptions

```ts
/** Where the kernel's WebAssembly file comes from (all optional; at most one of `wasmBinary`,
 * `wasmModule` and `instantiateWasm`). */
export interface InitOptions {
    /** The URL of a file of the kernel (`smlibwasm.wasm`) from its name and the loader's directory. */
    locateFile?: (path: string, prefix: string) => string;
    /** The kernel's bytes, fetched already. */
    wasmBinary?: ArrayBuffer | ArrayBufferView;
    /** The kernel compiled already (WebAssembly.compile). */
    wasmModule?: WebAssembly.Module;
    /** Emscripten's own hook: instantiates the module with `imports` and hands the instance to `receive`. */
    instantiateWasm?: (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) => unknown;
}
```

