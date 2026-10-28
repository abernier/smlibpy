# WASM API

The exports of `@classcad/smlibwasm` as TypeScript declarations (`js/scripts/api.mjs` writes them from the
package's declarations). The [Python API](index.md) describes each of them under its Python name: `parallel_to`
there is `parallelTo` here. [JavaScript (WASM)](../javascript.md) is the guide: installing, the browser, memory
and workers.

## Geometry

```ts
export const TOLERANCE = 0.000001;
export type VectorLike = Vector | ArrayLike<number>;
export type Matrix = Float64Array;
export class Vector {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    constructor(x?: number | VectorLike, y?: number, z?: number);
    toArray(): [number, number, number];
    add(other: VectorLike): Vector;
    sub(other: VectorLike): Vector;
    mul(s: number): Vector;
    div(s: number): Vector;
    neg(): Vector;
    equals(other: unknown): boolean;
    toString(): string;
    get length(): number;
    dot(other: VectorLike): number;
    cross(other: VectorLike): Vector;
    normalized(): Vector;
    distanceTo(other: VectorLike): number;
    angleTo(other: VectorLike): number;
    isClose(other: VectorLike, tolerance?: number): boolean;
    isParallel(other: VectorLike, angleTolerance?: number): boolean;
    isPerpendicular(other: VectorLike, angleTolerance?: number): boolean;
    rotate(axis: Axis | VectorLike, angle: number): Vector;
    projectTo(plane: Plane): Vector;
    anyPerpendicular(): Vector;
}
export class Axis {
    static X: Axis;
    static Y: Axis;
    static Z: Axis;
    readonly origin: Vector;
    readonly direction: Vector;
    constructor(origin?: VectorLike, direction?: VectorLike);
    neg(): Axis;
    reversed(): Axis;
    moved(location: Location): Axis;
    at(origin: VectorLike): Axis;
    isParallel(other: Axis | VectorLike, angleTolerance?: number): boolean;
    distanceTo(point: VectorLike): number;
    project(point: VectorLike): Vector;
    positionAlong(point: VectorLike): number;
    equals(other: unknown): boolean;
    toString(): string;
}
export const X: Axis;
export const Y: Axis;
export const Z: Axis;
export interface Movable<T> {
    moved(location: Location): T;
}
export class Location {
    constructor(position?: VectorLike | Plane | Location | Matrix | number[][] | null, rotation?: VectorLike | null);
    static about(axis: Axis, angle: number): Location;
    get matrix(): number[][];
    get position(): Vector;
    get rotation(): Vector;
    get xDir(): Vector;
    get yDir(): Vector;
    get zDir(): Vector;
    get plane(): Plane;
    inverse(): Location;
    rotateVector(v: VectorLike): Vector;
    mul(other: Location): Location;
    mul(other: VectorLike): Vector;
    mul(other: Axis): Axis;
    mul(other: Plane): Plane;
    mul<T>(other: Movable<T>): T;
    mul<T>(other: readonly T[]): unknown[];
    equals(other: unknown): boolean;
    toString(): string;
}
export interface XYZ {
    x?: number;
    y?: number;
    z?: number;
}
export function Pos(x?: number | VectorLike | XYZ, y?: number, z?: number): Location;
export function Rot(x?: number | VectorLike | XYZ, y?: number, z?: number): Location;
export class Plane {
    static XY: Plane;
    static YZ: Plane;
    static ZX: Plane;
    static XZ: Plane;
    static YX: Plane;
    static ZY: Plane;
    static top: Plane;
    static bottom: Plane;
    static front: Plane;
    static back: Plane;
    static left: Plane;
    static right: Plane;
    readonly origin: Vector;
    readonly xDir: Vector;
    readonly yDir: Vector;
    readonly zDir: Vector;
    constructor(origin?: VectorLike | Plane | Location | Face, xDir?: VectorLike | null, zDir?: VectorLike);
    get normal(): Vector;
    get location(): Location;
    offset(distance: number): Plane;
    shifted(x?: number, y?: number, z?: number): Plane;
    flipped(): Plane;
    rotated(x?: number | XYZ, y?: number, z?: number): Plane;
    moved(location: Location): Plane;
    at(origin: VectorLike): Plane;
    toLocal(point: VectorLike): Vector;
    fromLocal(point: VectorLike): Vector;
    contains(point: VectorLike, tolerance?: number): boolean;
    distanceTo(point: VectorLike): number;
    project(point: VectorLike): Vector;
    isCoplanar(other: Plane, tolerance?: number): boolean;
    mul(other: Location): Location;
    mul(other: VectorLike): Vector;
    mul<T>(other: Movable<T>): T;
    equals(other: unknown): boolean;
    toString(): string;
}
export class Hit<F extends Face | null = Face | null> {
    readonly point: Vector;
    readonly distance: number;
    readonly normal: Vector;
    readonly face: F;
    readonly triangle: number | null;
    constructor(point: Vector, distance: number, normal: Vector, face?: F, triangle?: number | null);
}
export class Nurbs {
    readonly degree: number;
    readonly knots: number[];
    readonly points: Vector[];
    readonly weights: number[] | null;
    constructor(degree: number, knots: number[], points: Vector[], weights?: number[] | null);
}
export class NurbsSurface {
    readonly degrees: [number, number];
    readonly knots: [
        number[],
        number[]
    ];
    readonly points: Vector[][];
    readonly weights: number[][] | null;
    constructor(degrees: [number, number], knots: [
        number[],
        number[]
    ], points: Vector[][], weights?: number[][] | null);
}
export class Curvature {
    readonly k1: number;
    readonly k2: number;
    readonly dir1: Vector;
    readonly dir2: Vector;
    readonly normal: Vector;
    readonly point: Vector;
    constructor(k1: number, k2: number, dir1: Vector, dir2: Vector, normal: Vector, point: Vector);
    get mean(): number;
    get gaussian(): number;
}
export class Continuity {
    readonly level: string | null;
    readonly gap: number;
    readonly angle: number;
    readonly curvatureJump: number;
    readonly point: Vector;
    constructor(level: string | null, gap: number, angle: number, curvatureJump: number, point: Vector);
}
export class ClosestPoints {
    readonly point: Vector;
    readonly otherPoint: Vector;
    readonly distance: number;
    readonly face: Face | null;
    readonly otherFace: Face | null;
    constructor(point: Vector, otherPoint: Vector, distance: number, face?: Face | null, otherFace?: Face | null);
}
export class BoundBox {
    min: Vector;
    max: Vector;
    constructor(min: VectorLike, max: VectorLike);
    static ofPoints(points: Iterable<VectorLike>): BoundBox;
    get size(): Vector;
    get center(): Vector;
    get diagonal(): number;
    union(other: BoundBox): BoundBox;
    contains(point: VectorLike, tolerance?: number): boolean;
    toString(): string;
}
export const Align: {
    readonly MIN: "min";
    readonly CENTER: "center";
    readonly MAX: "max";
};
export type Align = (typeof Align)[keyof typeof Align];
export type AlignLike = Align | string | null | readonly (Align | string | null)[];
```

## Shapes

```ts
export const ACCURACY = 1e-7;
export type ColorLike = string | readonly number[];
export type EdgesLike = Edge | Face | Wire | (Iterable<EdgesLike> & object);
export type FacesLike = Face | (Iterable<FacesLike> & object);
export type SourcesLike = Part | Shell | Face | Edge | (Iterable<SourcesLike> & object);
export type RegionLike = Sketch | Face | Wire | Edge | Iterable<VectorLike>;
export type WallsLike = ReadonlyMap<Face, number> | Iterable<readonly [FacesLike, number]>;
export interface IsoOptions {
    u?: number | null;
    v?: number | null;
}
export interface BodyOptions {
    name?: string | null;
    color?: ColorLike | null;
    plane?: Plane | null;
}
export abstract class Shape {
    abstract vertices(): ShapeList<Vertex>;
    abstract edges(): ShapeList<Edge>;
    wires(): ShapeList<Wire>;
    faces(): ShapeList<Face>;
    moved(location: Location): this;
    translate(x?: number | VectorLike, y?: number, z?: number): this;
    rotate(axis?: Axis, angle?: number): this;
    mirror(plane?: Plane | Face | Axis | ShapeList<Face>): this;
    scale(factor: number | VectorLike, center?: VectorLike): this;
    on(target: Plane | Face | Location | ShapeList<Face> | Sketch): this;
    abstract bbox(): BoundBox;
    abstract center(): Vector;
    distanceTo(other: VectorLike | Shape): number;
    mesh(tolerance?: number | null, angle?: number, options?: {
        maxEdge?: number | null;
    }): Mesh;
    show(options?: ShowOptions): string;
    export(path: string, options?: FileOptions): void;
    toString(): string;
}
export type SortKey = Axis | string | ((s: Any) => number);
export class ShapeList<T = Shape> extends Array<T> {
    one(): T;
    get first(): T;
    at(index: number): T | undefined;
    get last(): T;
    sortBy(key?: SortKey, reverse?: boolean): ShapeList<T>;
    filterBy(criterion: Axis | string | ((s: T) => boolean)): ShapeList<T>;
    sortByDistance(point: VectorLike, reverse?: boolean): ShapeList<T>;
    groupBy(key?: SortKey, tolerance?: number): ShapeList<T>[];
    maxBy(key?: SortKey, tolerance?: number): ShapeList<T>;
    minBy(key?: SortKey, tolerance?: number): ShapeList<T>;
    top(): ShapeList<T>;
    bottom(): ShapeList<T>;
    right(): ShapeList<T>;
    left(): ShapeList<T>;
    back(): ShapeList<T>;
    front(): ShapeList<T>;
    largest(): T;
    smallest(): T;
    nearest(point: VectorLike): T;
    filter<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: unknown): ShapeList<S>;
    filter(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: unknown): ShapeList<T>;
    map<U>(fn: (value: T, index: number, array: T[]) => U, thisArg?: unknown): U[];
    ofType(...geomTypes: string[]): ShapeList<T>;
    lines(): ShapeList<T>;
    circles(): ShapeList<T>;
    planar(): ShapeList<T>;
    cylinders(): ShapeList<T>;
    parallelTo(axis: Axis | VectorLike): ShapeList<T>;
    perpendicularTo(axis: Axis | VectorLike): ShapeList<T>;
    facing(direction: Axis | VectorLike, maxAngle?: number): ShapeList<T>;
    convex(): ShapeList<T>;
    concave(): ShapeList<T>;
    smooth(): ShapeList<T>;
    tangentChain(): ShapeList<Edge>;
    g1(): ShapeList<T>;
    g2(): ShapeList<T>;
    fillets(maxRadius?: number | null): ShapeList<T>;
    hitBy(origin: VectorLike | Axis, direction?: VectorLike | Axis | null): ShapeList<T>;
    within(box: BoundBox): ShapeList<T>;
    atPoint(point: VectorLike, tolerance?: number): ShapeList<T>;
    newSince(since: SourcesLike): ShapeList<T>;
    derivedFrom(...shapes: SourcesLike[]): ShapeList<T>;
    joining(a: SourcesLike, b: SourcesLike): ShapeList<T>;
    shared(): ShapeList<T>;
    union(other: Iterable<T>): ShapeList<T>;
    difference(other: Iterable<T>): ShapeList<T>;
    intersection(other: Iterable<T>): ShapeList<T>;
    vertices(): ShapeList<Vertex>;
    edges(): ShapeList<Edge>;
    faces(): ShapeList<Face>;
    wires(): ShapeList<Wire>;
    center(): Vector;
    bbox(): BoundBox;
    moved(location: Location): ShapeList<T>;
    on(target: Plane | Face | Location | ShapeList<Face> | Sketch): ShapeList<T>;
    translate(x?: number | VectorLike, y?: number, z?: number): ShapeList<T>;
    rotate(axis?: Axis, angle?: number): ShapeList<T>;
    toString(): string;
}
export class Vertex extends Shape {
    constructor(x?: number | VectorLike, y?: number, z?: number);
    get point(): Vector;
    get x(): number;
    get y(): number;
    get z(): number;
    get tolerance(): number;
    center(): Vector;
    bbox(): BoundBox;
    vertices(): ShapeList<Vertex>;
    edges(): ShapeList<Edge>;
    faces(): ShapeList<Face>;
    distanceTo(other: VectorLike | Shape): number;
    get convexity(): string;
    equals(other: unknown): boolean;
    toString(): string;
}
export class Edge extends Shape {
    dispose(): void;
    get geomType(): string;
    get tolerance(): number;
    get length(): number;
    get start(): Vector;
    get end(): Vector;
    get isClosed(): boolean;
    get isSeam(): boolean;
    get convexity(): string;
    get dihedralAngle(): number;
    isConvex(): boolean;
    get direction(): Vector;
    get radius(): number;
    get arcCenter(): Vector;
    get normal(): Vector;
    pointAt(t?: number): Vector;
    tangentAt(t?: number): Vector;
    center(): Vector;
    bbox(): BoundBox;
    distanceTo(point: VectorLike | Shape): number;
    continuity(samples?: number, options?: {
        angleTolerance?: number;
        curvatureTolerance?: number;
    }): Continuity;
    closestPoint(point: VectorLike | Vertex): Vector;
    paramAtPoint(point: VectorLike | Vertex): number;
    trim(start: number | VectorLike | Vertex, end: number | VectorLike | Vertex): Edge;
    split(at: number | VectorLike | Vertex): [Edge, Edge];
    extend(distance: number, options?: {
        end?: 'start' | 'end' | 'both';
        continuity?: 'G1' | 'G2' | 'natural';
    }): Edge;
    intersections(other: Shape | Iterable<Shape>, options?: {
        tolerance?: number | null;
    }): Vector[];
    intersectionParams(other: Shape | Iterable<Shape>, options?: {
        tolerance?: number | null;
    }): number[];
    selfIntersections(options?: {
        tolerance?: number | null;
    }): Vector[];
    curvatureAt(t?: number): number;
    radiusAt(t?: number): number;
    minRadius(): number;
    minRadiusAt(): number;
    inflections(): number[];
    offset(distance: number, options?: {
        plane?: Plane | null;
    }): Edge;
    toArcs(tolerance?: number): Wire;
    through(point: VectorLike | Vertex, options?: {
        tangent?: VectorLike | null;
        at?: number | null;
    }): Edge;
    match(options?: {
        start?: VectorLike | Vertex | null;
        end?: VectorLike | Vertex | null;
        startTangent?: VectorLike | null;
        endTangent?: VectorLike | null;
    }): Edge;
    vertices(): ShapeList<Vertex>;
    edges(): ShapeList<Edge>;
    faces(): ShapeList<Face>;
    tangentChain(): ShapeList<Edge>;
    reversed(): Edge;
    nurbs(): Nurbs;
    static fromNurbs(nurbs: Nurbs | {
        degree: number;
        knots: readonly number[];
        points: readonly VectorLike[];
        weights?: readonly number[] | null;
    }): Edge;
    removeKnots(): Edge;
    add(other: Edge | Wire): Wire;
    equals(other: unknown): boolean;
    toString(): string;
}
export class Wire extends Shape {
    constructor(edges: Edge | Wire | Iterable<Edge | Wire | Iterable<Edge | Wire>>, options?: {
        sort?: boolean;
    });
    dispose(): void;
    edges(): ShapeList<Edge>;
    vertices(): ShapeList<Vertex>;
    wires(): ShapeList<Wire>;
    get isClosed(): boolean;
    get start(): Vector;
    get end(): Vector;
    get length(): number;
    center(): Vector;
    bbox(): BoundBox;
    pointAt(t?: number): Vector;
    tangentAt(t?: number): Vector;
    distanceTo(point: VectorLike | Shape): number;
    split(at: number | VectorLike | Vertex): [Wire, Wire];
    trim(start: number | VectorLike | Vertex, end: number | VectorLike | Vertex): Wire;
    intersections(other: Shape | Iterable<Shape>, options?: {
        tolerance?: number | null;
    }): Vector[];
    toEdge(): Edge;
    offset(distance: number, options?: {
        corners?: 'round' | 'sharp' | 'chamfer';
        plane?: Plane | null;
    }): Wire;
    toArcs(tolerance?: number): Wire;
    minRadius(): number;
    minRadiusAt(): number;
    closestPoint(point: VectorLike): Vector;
    continuity(options?: {
        angleTolerance?: number;
        curvatureTolerance?: number;
    }): Continuity;
    close(): Wire;
    reversed(): Wire;
    add(other: Edge | Wire): Wire;
    plane(): Plane;
    fillet(radius: number, vertices?: VectorLike | Vertex | Iterable<VectorLike | Vertex> | null): Wire;
    toSketch(): Sketch;
    toString(): string;
}
export class Face extends Shape {
    get owner(): Part | Shell | null;
    get color(): [number, number, number] | null;
    get name(): string | null;
    get cells(): number[];
    get geomType(): string;
    get area(): number;
    center(): Vector;
    interiorPoint(): Vector;
    normalAt(point?: VectorLike | null): Vector;
    get isPlanar(): boolean;
    get plane(): Plane;
    get radius(): number;
    get majorRadius(): number;
    get coneAngle(): number;
    get axis(): Axis;
    bbox(): BoundBox;
    distanceTo(point: VectorLike | Shape): number;
    closestPoint(point: VectorLike): Vector;
    uvAt(point: VectorLike): [number, number];
    positionAt(u: number, v: number): Vector;
    curvatureAt(point?: VectorLike | null): Curvature;
    minRadius(): number;
    nurbs(): NurbsSurface;
    raycast(origin: VectorLike | Axis, direction?: VectorLike | Axis | null): Hit<Face>[];
    project(curve: Edge | Wire): ShapeList<Edge>;
    iso(options?: IsoOptions): ShapeList<Edge>;
    wrap(shape: Edge | Wire | Sketch | Iterable<Edge>, at?: VectorLike | Vertex | null, options?: {
        direction?: VectorLike | null;
    }): ShapeList<Edge>;
    outerWire(): Wire;
    innerWires(): ShapeList<Wire>;
    wires(): ShapeList<Wire>;
    edges(options?: {
        seams?: boolean;
    }): ShapeList<Edge>;
    vertices(): ShapeList<Vertex>;
    faces(): ShapeList<Face>;
    neighbors(): ShapeList<Face>;
    toSketch(): Sketch;
    toShell(): Shell;
    offset(distance: number): Shell;
    split(curves: Edge | Wire | Iterable<Edge | Wire>): ShapeList<Face>;
    flipped(): Shell;
    untrimmed(): Shell;
    extend(distance: number, options?: {
        sides?: Edge | Iterable<Edge> | null;
        continuity?: 'natural' | 'G1' | 'G2';
    }): Shell;
    extrude(amount: number, options?: ExtrudeOptions): Part;
    equals(other: unknown): boolean;
    toString(): string;
}
export class Problem {
    readonly shape: Face | Edge | Vertex | Part | Shell;
    readonly message: string;
    readonly value: number | null;
    readonly tolerance: number | null;
    readonly category: string;
    readonly test: string;
    readonly other: Face | Edge | Vertex | Part | Shell | null;
    constructor(shape: Face | Edge | Vertex | Part | Shell, message: string, value?: number | null, tolerance?: number | null, category?: string, test?: string, other?: Face | Edge | Vertex | Part | Shell | null);
    toString(): string;
}
export class MassProperties {
    readonly mass: number;
    readonly volume: number;
    readonly area: number;
    readonly center: Vector;
    readonly inertia: number[][];
    readonly density: number;
    constructor(mass: number, volume: number, area: number, center: Vector, inertia: number[][], density: number);
    get principalMoments(): [number, number, number];
    get principalAxes(): [Vector, Vector, Vector];
    get radiiOfGyration(): [number, number, number];
    inertiaAbout(point: VectorLike): number[][];
    momentAbout(axis: Axis): number;
    toString(): string;
}
export class SectionProperties {
    readonly area: number;
    readonly centroid: Vector;
    readonly plane: Plane;
    readonly ixx: number;
    readonly iyy: number;
    readonly ixy: number;
    constructor(area: number, plane: Plane, ixx: number, iyy: number, ixy: number, extent: [number, number, number, number]);
    get polar(): number;
    get principalMoments(): [number, number];
    get principalAxes(): [Vector, Vector];
    get radiiOfGyration(): [number, number];
    get sectionModuli(): [number, number];
    toString(): string;
}
export type FilletRadius = number | readonly number[] | {
    start: number;
    end: number;
} | ReadonlyMap<number, number>;
export interface FilletOptions {
    continuity?: number | string | null;
    fullness?: number;
    propagate?: boolean;
    corners?: 'patch' | 'mitre' | 'miter';
    setback?: number | null;
}
export interface ChamferOptions {
    length2?: number | null;
    angle?: number | null;
    reference?: unknown;
    propagate?: boolean;
    corners?: 'patch' | 'mitre' | 'miter';
}
export class Part extends Shape {
    get volume(): number;
    get area(): number;
    center(): Vector;
    massProperties(density?: number, accuracy?: number | null): MassProperties;
    isValid(options?: {
        strict?: boolean;
    }): boolean;
    solids(): ShapeList<Part>;
    shells(): ShapeList<Shell>;
    voids(): ShapeList<Part>;
    info(): {
        type: string;
        faces: number;
        edges: number;
        vertices: number;
        bbox: [
            number[],
            number[]
        ];
        corners?: string;
        solids: number;
        voids: number;
    };
    merge(...others: (Part | Iterable<Part>)[]): Part;
    get sources(): Part[];
    cells(): ShapeList<Part>;
    classify(point: VectorLike, tolerance?: number | null): [string, Face | Edge | Vertex | null];
    contains(point: VectorLike, tolerance?: number | null): boolean;
    cellAt(point: VectorLike, tolerance?: number | null): Part | null;
    fuse(...others: (Part | Iterable<Part>)[]): Part;
    cut(...others: (Part | Iterable<Part>)[]): Part;
    intersect(sheet: Shell | Face): Shell;
    intersect(...others: (Part | Iterable<Part>)[]): Part;
    fillet(edges: EdgesLike, radius: FilletRadius, options?: FilletOptions): Part;
    filletPreview(edges: EdgesLike, radius: number, options?: {
        propagate?: boolean;
    }): ShapeList<Shell>;
    chamfer(edges: EdgesLike, length: number, options?: ChamferOptions): Part;
    shell(thickness: number, openings?: FacesLike | null, options?: {
        outward?: boolean;
        corners?: 'round' | 'sharp' | null;
        walls?: WallsLike | null;
    }): Part;
    offset(distance: number, options?: {
        corners?: 'sharp' | 'round';
    }): Part;
    split(plane: Plane | Face | Shell | ShapeList<Face>, keep: 'above' | 'below'): Part;
    split(plane: Plane | Face | Shell | ShapeList<Face>, keep: 'both'): [Part, Part];
    split(plane: Plane | Face | Shell | ShapeList<Face>): Part;
    imprint(tool: Part | Shell | Face | ShapeList<Face> | Edge | Wire | Iterable<Edge | Wire>, direction?: Axis | VectorLike | null, options?: {
        nearest?: boolean;
    }): Part;
    section(plane?: Plane | Face): Sketch;
    slices(step: number, axis?: Axis | VectorLike): Sketch[];
    static fromMesh(mesh: Mesh, maxFaces?: number): Part;
    twist(angle: number, options?: TwistOptions): Part;
    taper(scale: number, options?: TaperOptions): Part;
    bend(angle: number, options?: BendOptions): Part;
    unroll(options: UnrollOptions): Part;
    deform(lattice: Lattice, options?: {
        tolerance?: number | null;
    }): Part;
    removeFillets(faces?: FacesLike | null, options?: {
        maxRadius?: number | null;
        partial?: boolean;
    }): Part;
    removeFaces(faces: FacesLike, options?: {
        partial?: boolean;
    }): Part;
    draftAnalysis(direction: Axis | VectorLike, options?: {
        minAngle?: number;
    }): DraftAnalysis;
    partingLine(direction: Axis | VectorLike): ShapeList<Wire>;
    draft(faces: FacesLike, angle: number, neutralPlane: Plane | Face): Part;
    moveFaces(faces: FacesLike, by: Location | VectorLike): Part;
    offsetFaces(faces: FacesLike, distance: number): Part;
    push(face: Face, at: VectorLike, options?: PushOptions): Part;
    warp(face: Face, region: RegionLike, by: number | VectorLike, options?: {
        continuity?: 'crease' | 'G1' | 'G2';
    }): Part;
    flatten(face: Face, region: RegionLike, plane: Plane | Face, options?: {
        continuity?: 'crease' | 'G1' | 'G2';
    }): Part;
    fold(line: Axis | Edge, angle: number, options: FoldOptions): Part;
    flange(edge: Edge | ShapeList<Edge>, length: number, options: FlangeOptions): Part;
    bends(options?: {
        kFactor?: KFactor;
    }): Bend[];
    unfold(options?: UnfoldOptions): Part;
    flatPattern(options?: UnfoldOptions): FlatPattern;
    toString(): string;
    name: string | null;
    color: ColorLike | null;
    dispose(): void;
    named(name: string | null, options?: {
        faces?: FacesLike | null;
    }): this;
    colored(color: ColorLike | null, options?: {
        faces?: FacesLike | null;
    }): this;
    faces(): ShapeList<Face>;
    edges(options?: {
        seams?: boolean;
    }): ShapeList<Edge>;
    vertices(): ShapeList<Vertex>;
    wires(): ShapeList<Wire>;
    bbox(): BoundBox;
    distanceTo(other: VectorLike | Shape): number;
    closestPoints(other: Part | Shell | Face | Edge | Wire): ClosestPoints;
    closestPoint(point: VectorLike): Vector;
    raycast(origin: VectorLike | Axis, direction?: VectorLike | Axis | null): Hit<Face>[];
    raycastMany(origins: Iterable<VectorLike>, directions: VectorLike | Axis | Iterable<VectorLike | Axis>): (Hit<Face> | null)[];
    compact(): void;
    intersectionCurves(other: Part | Shell | Face | Plane): ShapeList<Edge>;
    silhouette(direction?: Axis | VectorLike): ShapeList<Edge>;
    project(curve: Edge | Wire, direction?: Axis | VectorLike, options?: {
        nearest?: boolean;
    }): ShapeList<Edge>;
    outline(plane?: Plane, options?: {
        hidden?: false;
        tangentEdges?: boolean;
    }): ShapeList<Edge>;
    outline(plane: Plane | undefined, options: {
        hidden: true;
        tangentEdges?: boolean;
    }): [ShapeList<Edge>, ShapeList<Edge>];
    outline(plane?: Plane, options?: {
        hidden?: boolean;
        tangentEdges?: boolean;
    }): ShapeList<Edge> | [ShapeList<Edge>, ShapeList<Edge>];
    toNurbs(): this;
    heal(): this | Part;
    check(level?: number): Problem[];
    equals(other: unknown): boolean;
}
export class Shell extends Shape {
    static fromNurbs(nurbs: NurbsSurface | {
        readonly degrees: readonly [number, number];
        readonly knots: readonly [
            readonly number[],
            readonly number[]
        ];
        readonly points: readonly (readonly VectorLike[])[];
        readonly weights?: readonly (readonly number[])[] | null;
    }): Shell;
    get area(): number;
    center(): Vector;
    thicken(thickness: number, options?: {
        both?: boolean;
    }): Part;
    offset(distance: number): Shell;
    trim(curves: Edge | Wire | Iterable<Edge | Wire>, keep: VectorLike | string): this;
    flipped(): this;
    extend(distance: number, options?: {
        sides?: Edge | Iterable<Edge> | null;
        continuity?: 'natural' | 'G1' | 'G2';
    }): this;
    matchEdge(edge: Edge, target: Edge | Wire, options?: {
        extent?: number;
    }): Shell;
    mergeFaces(a: Face, b: Face): Shell;
    push(face: Face, at: VectorLike, options?: PushOptions): Shell;
    warp(face: Face, region: RegionLike, by: number | VectorLike, options?: {
        continuity?: 'crease' | 'G1' | 'G2';
    }): Shell;
    flatten(face: Face, region: RegionLike, plane: Plane | Face, options?: {
        continuity?: 'crease' | 'G1' | 'G2';
    }): Shell;
    fuse(...others: (Shell | Part | Face | Iterable<Shell | Part | Face>)[]): Shell;
    cut(...others: (Part | Sketch | Iterable<Part | Sketch>)[]): Shell;
    intersect(...others: (Part | Sketch | Iterable<Part | Sketch>)[]): Shell;
    toString(): string;
    name: string | null;
    color: ColorLike | null;
    dispose(): void;
    named(name: string | null, options?: {
        faces?: FacesLike | null;
    }): this;
    colored(color: ColorLike | null, options?: {
        faces?: FacesLike | null;
    }): this;
    faces(): ShapeList<Face>;
    edges(options?: {
        seams?: boolean;
    }): ShapeList<Edge>;
    vertices(): ShapeList<Vertex>;
    wires(): ShapeList<Wire>;
    bbox(): BoundBox;
    distanceTo(other: VectorLike | Shape): number;
    closestPoints(other: Part | Shell | Face | Edge | Wire): ClosestPoints;
    closestPoint(point: VectorLike): Vector;
    raycast(origin: VectorLike | Axis, direction?: VectorLike | Axis | null): Hit<Face>[];
    raycastMany(origins: Iterable<VectorLike>, directions: VectorLike | Axis | Iterable<VectorLike | Axis>): (Hit<Face> | null)[];
    compact(): void;
    intersectionCurves(other: Part | Shell | Face | Plane): ShapeList<Edge>;
    silhouette(direction?: Axis | VectorLike): ShapeList<Edge>;
    project(curve: Edge | Wire, direction?: Axis | VectorLike, options?: {
        nearest?: boolean;
    }): ShapeList<Edge>;
    outline(plane?: Plane, options?: {
        hidden?: false;
        tangentEdges?: boolean;
    }): ShapeList<Edge>;
    outline(plane: Plane | undefined, options: {
        hidden: true;
        tangentEdges?: boolean;
    }): [ShapeList<Edge>, ShapeList<Edge>];
    outline(plane?: Plane, options?: {
        hidden?: boolean;
        tangentEdges?: boolean;
    }): ShapeList<Edge> | [ShapeList<Edge>, ShapeList<Edge>];
    toNurbs(): this;
    heal(): this | Part;
    check(level?: number): Problem[];
    equals(other: unknown): boolean;
    info(): {
        type: string;
        faces: number;
        edges: number;
        vertices: number;
        bbox: [
            number[],
            number[]
        ];
        corners?: string;
    };
}
export interface PushOptions {
    by?: number | VectorLike | null;
    to?: VectorLike | null;
    normal?: VectorLike | null;
    radius?: number | null;
    continuity?: 'G0' | 'G1' | 'G2';
}
export interface ExtrudeOptions {
    both?: boolean;
    taper?: number;
    direction?: Axis | VectorLike | null;
    corners?: 'sharp' | 'round';
}
export class Sketch extends Shell {
    flipped(): this;
    get plane(): Plane;
    fuse(...others: (Sketch | Iterable<Sketch>)[]): Sketch;
    cut(...others: (Sketch | Iterable<Sketch>)[]): Sketch;
    intersect(...others: (Sketch | Iterable<Sketch>)[]): Sketch;
    xor(...others: (Sketch | Iterable<Sketch>)[]): Sketch;
    center(): Vector;
    get perimeter(): number;
    sectionProperties(): SectionProperties;
    offset(distance: number, options?: {
        corners?: 'round' | 'sharp' | 'chamfer';
    }): Sketch;
    fillet(radius: number, vertices?: VectorLike | Vertex | Iterable<VectorLike | Vertex> | null): Sketch;
    chamfer(length: number, vertices?: VectorLike | Vertex | Iterable<VectorLike | Vertex> | null): Sketch;
    mirror(plane?: Plane | Face | Axis | ShapeList<Face>): this;
    extrude(amount: number, options?: ExtrudeOptions): Part;
    revolve(axis?: Axis | null, angle?: number): Part;
    sweep(path: Edge | Wire, options?: {
        orient?: boolean;
        translational?: boolean;
        sharpCorners?: boolean | null;
        up?: Axis | VectorLike | string | null;
        twist?: number | ((s: number) => number);
        scale?: readonly [number, number] | readonly (readonly [number, number])[] | ((s: number) => number) | null;
        anchor?: 'center' | 'origin' | VectorLike | Vertex;
    }): Part;
    swing(outline: Sketch | Face | Wire | Edge): Part;
    toString(): string;
}
```

## Curves

```ts
export function Line(start: VectorLike, end: VectorLike): Edge;
export function PolarLine(start: VectorLike, length: number, angle: number, plane?: Plane): Edge;
export function Polyline(...args: (VectorLike | readonly VectorLike[] | {
    close?: boolean;
})[]): Wire;
export function CenterArc(center: VectorLike, radius: number, startAngle: number, arcSize: number, plane?: Plane): Edge;
export function ThreePointArc(start: VectorLike, through: VectorLike, end: VectorLike): Edge;
export function RadiusArc(start: VectorLike, end: VectorLike, radius: number, plane?: Plane): Edge;
export function SagittaArc(start: VectorLike, end: VectorLike, sagitta: number, plane?: Plane): Edge;
export function TangentArc(start: VectorLike, end: VectorLike, tangent: VectorLike): Edge;
export function EllipticalArc(center: VectorLike, xRadius: number, yRadius: number, startAngle?: number, endAngle?: number, plane?: Plane): Edge;
export function ParabolicArc(vertex: VectorLike, focalLength: number, start: number, end: number, plane?: Plane): Edge;
export function HyperbolicArc(center: VectorLike, xRadius: number, yRadius: number, start: number, end: number, plane?: Plane): Edge;
export function ConicArc(start: VectorLike, apex: VectorLike, end: VectorLike, rho?: number): Edge;
export function Spline(...args: (VectorLike | readonly VectorLike[] | {
    tangents?: readonly (VectorLike | null)[] | null;
    closed?: boolean;
})[]): Edge;
export function fitCurve(points: Iterable<VectorLike>, options?: {
    tolerance?: number | null;
    degree?: number;
    tangents?: readonly [VectorLike | null, VectorLike | null] | readonly VectorLike[] | null;
    closed?: boolean;
}): Edge;
export function Bezier(...args: (VectorLike | readonly VectorLike[] | {
    weights?: readonly number[] | null;
})[]): Edge;
export function Helix(pitch: number, height: number, radius: number, options?: {
    center?: VectorLike;
    direction?: Axis | VectorLike;
    endRadius?: number | null;
    leftHanded?: boolean;
}): Edge;
export function Spiral(startRadius: number, endRadius: number, turns: number, plane?: Plane, options?: {
    clockwise?: boolean;
}): Edge;
export function FilletPolyline(...args: (VectorLike | readonly VectorLike[] | {
    radius: number;
    close?: boolean;
})[]): Wire;
export function makeCompatible(...edges: (Edge | Iterable<Edge>)[]): Edge[];
```

## Sketches and text

```ts
export interface Coordinates {
    x?: number | null;
    y?: number | null;
}
export class Profile {
    constructor(start?: VectorLike | {
        heading?: number;
    }, options?: {
        heading?: number;
    });
    get point(): Vector;
    get start(): Vector;
    get heading(): number;
    get length(): number;
    lineTo(...args: (number | VectorLike | Coordinates)[]): Profile;
    lineBy(dx?: number | VectorLike, dy?: number): Profile;
    forward(length?: number | null | Coordinates, options?: Coordinates): Profile;
    turn(angle: number): Profile;
    turnTo(heading: number): Profile;
    arc(radius: number, angle: number): Profile;
    arcTo(...args: (number | VectorLike | {
        through?: VectorLike | null;
    })[]): Profile;
    fillet(radius: number): Profile;
    chamfer(length: number): Profile;
    mirror(axis: Axis): Profile;
    close(options?: {
        align?: AlignLike;
    }): Sketch;
    wire(): Wire;
    toString(): string;
}
export interface PlacementOptions {
    rotation?: number;
    align?: AlignLike;
}
export interface CornerOptions {
    fillet?: number;
    chamfer?: number;
}
export function Rectangle(width: number, height: number, options?: CornerOptions & PlacementOptions): Sketch;
export function RoundedRectangle(width: number, height: number, radius: number, options?: {
    align?: AlignLike;
}): Sketch;
export function Circle(radius: number, options?: {
    align?: AlignLike;
}): Sketch;
export function Ellipse(xRadius: number, yRadius: number, options?: PlacementOptions): Sketch;
export interface PolygonOptions extends CornerOptions {
    align?: AlignLike;
}
export function Polygon(...args: (VectorLike | readonly VectorLike[] | PolygonOptions)[]): Sketch;
export function RegularPolygon(radius: number, sides: number, options?: {
    inscribed?: boolean;
} & CornerOptions & PlacementOptions): Sketch;
export function Triangle(width: number, height: number, options?: {
    apex?: number | null;
} & CornerOptions & PlacementOptions): Sketch;
export type TrapezoidOptions = CornerOptions & PlacementOptions;
export function Trapezoid(width: number, height: number, leftAngle: number, rightAngle?: number | null | TrapezoidOptions, options?: TrapezoidOptions): Sketch;
export function Slot(length: number, width: number, options?: PlacementOptions): Sketch;
export function ArcSlot(radius: number, width: number, angle: number, options?: PlacementOptions): Sketch;
export function Stroke(path: Edge | Wire, width: number, options?: {
    ends?: 'round' | 'flat';
    corners?: 'round' | 'sharp' | 'chamfer';
}): Sketch;
export type HullItem = VectorLike | Vertex | Edge | Wire | Sketch | Face | readonly HullItem[];
export function Hull(...items: HullItem[]): Sketch;
export function makeFace(outer: Wire | Edge, ...holes: (Wire | Edge)[]): Sketch;
export interface TextOptions {
    font?: string | BytesLike | Font | null;
    align?: AlignLike;
    spacing?: number;
    lineSpacing?: number;
    kerning?: boolean;
    path?: Edge | Wire | null;
}
export function Text(text: string, size: number, options?: TextOptions): Sketch;
export type Point = readonly [number, number];
export type Segment = readonly Point[];
export type Contour = Segment[];
export class PairAdjustment {
    readonly advance1: number;
    readonly placement1: number;
    readonly advance2: number;
    readonly placement2: number;
    constructor(advance1?: number, placement1?: number, advance2?: number, placement2?: number);
    toString(): string;
}
export class FontError extends RangeError {
    constructor(message: string);
}
export const DEFAULT_FONT: Uint8Array;
export function loadFont(source?: string | BytesLike | null): Font;
export class Font {
    readonly path: string | null;
    readonly name: string;
    readonly unitsPerEm: number;
    readonly numGlyphs: number;
    readonly capHeight: number;
    constructor(source: string | BytesLike);
    toString(): string;
    glyphIndex(char: string): number | null;
    characters(): string[];
    advance(glyph: number): number;
    kerning(left: number, right: number): PairAdjustment;
    get kerningSource(): string | null;
    outline(glyph: number): Contour[];
}
```

## Parts and patterns

```ts
export function Box(length: number, width: number, height: number, options?: {
    align?: AlignLike;
}): Part;
export function Cylinder(radius: number, height: number, options?: {
    arcSize?: number;
    align?: AlignLike;
}): Part;
export function Cone(bottomRadius: number, topRadius: number, height: number, options?: {
    arcSize?: number;
    align?: AlignLike;
}): Part;
export function Sphere(radius: number, options?: {
    arcSize1?: number;
    arcSize2?: number;
    arcSize3?: number;
    align?: AlignLike;
}): Part;
export function Torus(majorRadius: number, minorRadius: number, options?: {
    minorStartAngle?: number;
    minorEndAngle?: number;
    majorAngle?: number;
    align?: AlignLike;
}): Part;
export function Pyramid(length: number, width: number, height: number, options?: {
    align?: AlignLike;
}): Part;
export function Wedge(length: number, width: number, height: number, topLength?: number, options?: {
    align?: AlignLike;
}): Part;
export function AnnularSector(innerRadius: number, outerRadius: number, height: number, arcSize: number, options?: {
    align?: AlignLike;
}): Part;
export function Hole(radius: number, depth: number): Part;
export function CounterBoreHole(radius: number, counterBoreRadius: number, counterBoreDepth: number, depth: number): Part;
export function CounterSinkHole(radius: number, counterSinkRadius: number, depth: number, angle?: number): Part;
export type LocationLike = Location | Plane | Locations | Face | Vertex | VectorLike | ShapeList<Face>;
export class Locations extends Array<Location> {
    constructor(...items: LocationLike[]);
    mul(other: Location | Locations): Locations;
    mul<T>(other: Shape | Iterable<T>): ShapeList<Any>;
    moved(location: Location): Locations;
    on(target: Plane | Face | Location | ShapeList<Face> | Sketch): Locations;
    get points(): Vector[];
    toString(): string;
}
export function GridLocations(xSpacing: number, ySpacing: number, xCount: number, yCount: number, options?: {
    centered?: boolean;
}): Locations;
export function PolarLocations(radius: number, count: number, options?: {
    startAngle?: number;
    angularRange?: number;
    rotate?: boolean;
}): Locations;
export function HexLocations(spacing: number, xCount: number, yCount: number, options?: {
    centered?: boolean;
}): Locations;
```

## Features

```ts
export interface ExtrudeFunctionOptions {
    both?: boolean;
    taper?: number;
    direction?: Axis | VectorLike | null;
    corners?: 'sharp' | 'round';
}
export function extrude(profile: Sketch | Face | ShapeList<Sketch | Face>, amount: number, options?: ExtrudeFunctionOptions): Part;
export function extrude(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, amount: number, options?: ExtrudeFunctionOptions): Part | Shell;
export function revolve(profile: Sketch | Face | ShapeList<Sketch | Face>, axis?: Axis | null, angle?: number): Part;
export function revolve(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, axis?: Axis | null, angle?: number): Part | Shell;
export type LoftOptions = {
    ruled?: boolean;
    smooth?: boolean;
    startTangent?: Axis | VectorLike | Face | ShapeList<Face> | null;
    endTangent?: Axis | VectorLike | Face | ShapeList<Face> | null;
    closed?: boolean;
    rails?: Edge | Wire | readonly (Edge | Wire)[] | null;
};
export function loft(sections: readonly (Sketch | Face | ShapeList<Sketch | Face>)[], options?: LoftOptions): Part;
export function loft(sections: readonly (Sketch | Face | Wire | Edge | ShapeList<Any>)[], options?: LoftOptions): Part | Shell;
export interface SweepOptions {
    orient?: boolean;
    translational?: boolean;
    sharpCorners?: boolean | null;
    up?: Axis | VectorLike | string | null;
    twist?: number | ((s: number) => number);
    scale?: readonly [number, number] | readonly (readonly [number, number])[] | ((s: number) => number) | null;
    anchor?: 'center' | 'origin' | VectorLike | Vertex;
    rails?: Edge | Wire | null;
}
export function sweep(profile: Sketch | Face | ShapeList<Sketch | Face>, path: Edge | Wire | ShapeList<Edge>, options?: SweepOptions): Part;
export function sweep(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, path: Edge | Wire | ShapeList<Edge>, options?: SweepOptions): Part | Shell;
export function swing(profile: Sketch | Face, outline: Sketch | Face | Wire | Edge | ShapeList<Any>): Part;
export function swing(profile: Sketch | Face | Wire | Edge | ShapeList<Any>, outline: Sketch | Face | Wire | Edge | ShapeList<Any>): Part | Shell;
export function fillet(edges: EdgesLike, radius: FilletRadius, options?: FilletOptions): Part;
export function fillet(vertices: Vertex | readonly Vertex[], radius: number): Sketch;
export function fillet(edges: EdgesLike | Vertex | readonly Vertex[], radius: FilletRadius, options?: FilletOptions): Part | Sketch;
export function chamfer(edges: EdgesLike, length: number, options?: ChamferOptions): Part;
export function chamfer(vertices: Vertex | readonly Vertex[], length: number): Sketch;
export function chamfer(edges: EdgesLike | Vertex | readonly Vertex[], length: number, options?: ChamferOptions): Part | Sketch;
export function shell(part: Part, thickness: number, openings?: FacesLike | null, options?: {
    outward?: boolean;
    corners?: 'round' | 'sharp' | null;
    walls?: WallsLike | null;
}): Part;
export type OffsetFunctionOptions = {
    corners?: 'round' | 'sharp' | 'chamfer';
    plane?: Plane | null;
};
export function offset(shape: Part, distance: number, options?: {
    corners?: 'sharp' | 'round';
}): Part;
export function offset(shape: Sketch, distance: number, options?: {
    corners?: 'round' | 'sharp' | 'chamfer';
}): Sketch;
export function offset(shape: Shell | Face, distance: number): Shell;
export function offset(shape: Wire, distance: number, options?: {
    corners?: 'round' | 'sharp' | 'chamfer';
    plane?: Plane | null;
}): Wire;
export function offset(shape: Edge, distance: number, options?: {
    plane?: Plane | null;
}): Edge;
export function offset(shape: Part | Sketch | Shell | Face | Wire | Edge, distance: number, options?: OffsetFunctionOptions): Part | Sketch | Shell | Wire | Edge;
export function mirror<S extends Shape>(shape: S, plane?: Plane | Face | Axis | ShapeList<Face>): S;
export function split(part: Part, plane: Plane | Face | Shell, keep: 'both'): [Part, Part];
export function split(part: Part, plane: Plane | Face | Shell, keep?: 'above' | 'below'): Part;
export function split(part: Part, plane: Plane | Face | Shell, keep?: 'above' | 'below' | 'both'): Part | [Part, Part];
export function merge(...parts: (Part | Iterable<Part>)[]): Part;
export function section(part: Part, plane?: Plane | Face): Sketch;
export function thicken(surface: Shell | Face, thickness: number, options?: {
    both?: boolean;
}): Part;
export function fuse(shape: Sketch, ...others: (Sketch | Iterable<Sketch>)[]): Sketch;
export function fuse(shape: Shell, ...others: (Shell | Part | Face | Iterable<Shell | Part | Face>)[]): Shell;
export function fuse(shape: Part, ...others: (Part | Iterable<Part>)[]): Part;
export function cut(shape: Sketch, ...others: (Sketch | Iterable<Sketch>)[]): Sketch;
export function cut(shape: Shell, ...others: (Part | Iterable<Part>)[]): Shell;
export function cut(shape: Part, ...others: (Part | Iterable<Part>)[]): Part;
export function intersect(shape: Sketch, ...others: (Sketch | Iterable<Sketch>)[]): Sketch;
export function intersect(shape: Shell, ...others: (Part | Iterable<Part>)[]): Shell;
export function intersect(shape: Part, sheet: Shell | Face): Shell;
export function intersect(shape: Part, ...others: (Part | Iterable<Part>)[]): Part;
export function xor(sketch: Sketch, ...others: (Sketch | Iterable<Sketch>)[]): Sketch;
export function imprint(part: Part, tool: Part | Shell | Face | ShapeList<Face> | Edge | Wire | Iterable<Edge | Wire>, direction?: Axis | VectorLike | null, options?: {
    nearest?: boolean;
}): Part;
export function filletPreview(edges: EdgesLike, radius: number, options?: {
    propagate?: boolean;
}): ShapeList<Shell>;
export function draft(part: Part, faces: FacesLike, angle: number, neutralPlane: Plane | Face): Part;
export function moveFaces(part: Part, faces: FacesLike, by: Location | VectorLike): Part;
export function offsetFaces(part: Part, faces: FacesLike, distance: number): Part;
export function removeFaces(part: Part, faces: FacesLike, options?: {
    partial?: boolean;
}): Part;
export function removeFillets(part: Part, faces?: FacesLike | null, options?: {
    maxRadius?: number | null;
    partial?: boolean;
}): Part;
export function push(shape: Part, face: Face, at: VectorLike, options?: PushOptions): Part;
export function push(shape: Shell, face: Face, at: VectorLike, options?: PushOptions): Shell;
export function warp(shape: Part, face: Face, region: RegionLike, by: number | VectorLike, options?: {
    continuity?: 'crease' | 'G1' | 'G2';
}): Part;
export function warp(shape: Shell, face: Face, region: RegionLike, by: number | VectorLike, options?: {
    continuity?: 'crease' | 'G1' | 'G2';
}): Shell;
export function flatten(shape: Part, face: Face, region: RegionLike, plane: Plane | Face, options?: {
    continuity?: 'crease' | 'G1' | 'G2';
}): Part;
export function flatten(shape: Shell, face: Face, region: RegionLike, plane: Plane | Face, options?: {
    continuity?: 'crease' | 'G1' | 'G2';
}): Shell;
export function extend(shape: Edge, distance: number, options?: {
    end?: 'start' | 'end' | 'both';
    continuity?: 'G1' | 'G2' | 'natural';
}): Edge;
export function extend(shape: Shell | Face, distance: number, options?: {
    sides?: Edge | Iterable<Edge> | null;
    continuity?: 'natural' | 'G1' | 'G2';
}): Shell;
export function trim(shape: Shell, curves: Edge | Wire | Iterable<Edge | Wire>, keep: VectorLike | string): Shell;
export function trim(shape: Edge, start: number | VectorLike | Vertex, end: number | VectorLike | Vertex): Edge;
export function trim(shape: Wire, start: number | VectorLike | Vertex, end: number | VectorLike | Vertex): Wire;
export function matchEdge(sheet: Shell, edge: Edge, target: Edge | Wire, options?: {
    extent?: number;
}): Shell;
export function mergeFaces(sheet: Shell, a: Face, b: Face): Shell;
export function project(shape: Face, curve: Edge | Wire): ShapeList<Edge>;
export function project(shape: Part | Shell, curve: Edge | Wire, direction?: Axis | VectorLike, options?: {
    nearest?: boolean;
}): ShapeList<Edge>;
export function outline(shape: Part | Shell, plane?: Plane, options?: {
    hidden?: false;
    tangentEdges?: boolean;
}): ShapeList<Edge>;
export function outline(shape: Part | Shell, plane: Plane | undefined, options: {
    hidden: true;
    tangentEdges?: boolean;
}): [ShapeList<Edge>, ShapeList<Edge>];
export function silhouette(shape: Part | Shell, direction?: Axis | VectorLike): ShapeList<Edge>;
export function intersectionCurves(shape: Part | Shell, other: Part | Shell | Face | Plane): ShapeList<Edge>;
export function partingLine(part: Part, direction: Axis | VectorLike): ShapeList<Wire>;
export function slices(shape: Part, step: number, axis?: Axis | VectorLike): Sketch[];
export function slices(shape: Mesh, step: number, axis?: Axis | VectorLike): ShapeList<Wire>[];
export function scale<S extends Shape | Mesh>(shape: S, factor: number | VectorLike, center?: VectorLike): S;
export let GUARD_SECONDS: number;
export let GUARD_BOOLEANS: boolean;
export function setGuardBooleans(on: boolean): boolean;
export function setGuardSeconds(seconds: number): number;
export class FaceDraft {
    readonly face: Face;
    readonly minAngle: number;
    readonly maxAngle: number;
    readonly kind: string;
    constructor(face: Face, minAngle: number, maxAngle: number, kind: string);
    equals(other: unknown): boolean;
    toString(): string;
}
export class DraftAnalysis {
    readonly direction: Vector;
    readonly minAngle: number;
    readonly faces: readonly FaceDraft[];
    constructor(direction: Vector, minAngle: number, faces: readonly FaceDraft[]);
    get positive(): ShapeList<Face>;
    get insufficient(): ShapeList<Face>;
    get vertical(): ShapeList<Face>;
    get undercut(): ShapeList<Face>;
    get ok(): boolean;
    angles(face: Face): [number, number];
    get length(): number;
    toString(): string;
}
```

## Deformations

```ts
export interface RangeOptions {
    start?: number | null;
    end?: number | null;
    tolerance?: number | null;
}
export interface TwistOptions extends RangeOptions {
    axis?: Axis;
}
export function twist(shape: Part, angle: number, options?: TwistOptions): Part;
export function twist(shape: Shell, angle: number, options?: TwistOptions): Shell;
export function twist(shape: Edge, angle: number, options?: TwistOptions): Edge;
export function twist(shape: Wire, angle: number, options?: TwistOptions): Wire;
export function twist(shape: VectorLike, angle: number, options?: TwistOptions): Vector;
export function twist(shape: readonly VectorLike[], angle: number, options?: TwistOptions): Vector[];
export interface TaperOptions extends RangeOptions {
    axis?: Axis;
}
export function taper(shape: Part, scale: number, options?: TaperOptions): Part;
export function taper(shape: Shell, scale: number, options?: TaperOptions): Shell;
export function taper(shape: Edge, scale: number, options?: TaperOptions): Edge;
export function taper(shape: Wire, scale: number, options?: TaperOptions): Wire;
export function taper(shape: VectorLike, scale: number, options?: TaperOptions): Vector;
export function taper(shape: readonly VectorLike[], scale: number, options?: TaperOptions): Vector[];
export interface BendOptions extends RangeOptions {
    radius?: number | null;
    plane?: Plane;
}
export function bend(shape: Part, angle: number, options?: BendOptions): Part;
export function bend(shape: Shell, angle: number, options?: BendOptions): Shell;
export function bend(shape: Edge, angle: number, options?: BendOptions): Edge;
export function bend(shape: Wire, angle: number, options?: BendOptions): Wire;
export function bend(shape: VectorLike, angle: number, options?: BendOptions): Vector;
export function bend(shape: readonly VectorLike[], angle: number, options?: BendOptions): Vector[];
export interface UnrollOptions {
    radius: number;
    axis?: Axis;
    start?: VectorLike | null;
    tolerance?: number | null;
}
export function unroll(shape: Part, options: UnrollOptions): Part;
export function unroll(shape: Shell, options: UnrollOptions): Shell;
export function unroll(shape: Edge, options: UnrollOptions): Edge;
export function unroll(shape: Wire, options: UnrollOptions): Wire;
export function unroll(shape: VectorLike, options: UnrollOptions): Vector;
export function unroll(shape: readonly VectorLike[], options: UnrollOptions): Vector[];
export type LatticeLayers = number | null | readonly number[];
export type LatticeIndex = readonly [LatticeLayers, LatticeLayers, LatticeLayers];
export class Lattice {
    points: number[][][][];
    constructor(box: BoundBox | {
        bbox(): BoundBox;
    }, counts?: number | readonly number[], options?: {
        margin?: number;
    });
    get counts(): [number, number, number];
    get box(): BoundBox;
    get rest(): readonly (readonly (readonly (readonly number[])[])[])[];
    get offsets(): number[][][][];
    layer(axis: Axis | string, index: number): [LatticeLayers, LatticeLayers, LatticeLayers];
    move(index: LatticeIndex, offset: VectorLike): this;
    scale(index: LatticeIndex, factor: number | VectorLike, center?: VectorLike | null): this;
    rotate(index: LatticeIndex, axis: Axis, angle: number): this;
    reset(): this;
    copy(): Lattice;
    map(point: VectorLike): Vector;
    apply(shape: Part, options?: {
        tolerance?: number | null;
    }): Part;
    apply(shape: Shell, options?: {
        tolerance?: number | null;
    }): Shell;
    apply(shape: Edge, options?: {
        tolerance?: number | null;
    }): Edge;
    apply(shape: Wire, options?: {
        tolerance?: number | null;
    }): Wire;
    apply(shape: VectorLike, options?: {
        tolerance?: number | null;
    }): Vector;
    apply(shape: readonly VectorLike[], options?: {
        tolerance?: number | null;
    }): Vector[];
    toString(): string;
}
export function deform(shape: Part, lattice: Lattice, options?: {
    tolerance?: number | null;
}): Part;
export function deform(shape: Shell, lattice: Lattice, options?: {
    tolerance?: number | null;
}): Shell;
export function deform(shape: Edge, lattice: Lattice, options?: {
    tolerance?: number | null;
}): Edge;
export function deform(shape: Wire, lattice: Lattice, options?: {
    tolerance?: number | null;
}): Wire;
export function deform(shape: VectorLike, lattice: Lattice, options?: {
    tolerance?: number | null;
}): Vector;
export function deform(shape: readonly VectorLike[], lattice: Lattice, options?: {
    tolerance?: number | null;
}): Vector[];
```

## Surfaces

```ts
export class FitReport {
    readonly maxDistance: number;
    readonly rmsDistance: number;
    readonly distances: number[];
    constructor(maxDistance: number, rmsDistance: number, distances: number[]);
}
type SurfaceOptions = {
    interpolate?: boolean;
    controls?: number | readonly [number, number] | null;
    smoothing?: number;
    report?: boolean;
};
export function surface(points: readonly (readonly VectorLike[])[] | readonly VectorLike[], options: SurfaceOptions & {
    report: true;
}): [Shell, FitReport];
export function surface(points: readonly (readonly VectorLike[])[] | readonly VectorLike[], options?: SurfaceOptions): Shell;
export function nurbsSurface(points: readonly (readonly VectorLike[])[] | NurbsSurfaceData, knots?: readonly [
    readonly number[],
    readonly number[]
] | null, degrees?: number | readonly [number, number] | null, weights?: readonly (readonly number[])[] | null): Shell;
export function ruled(a: Edge | Wire, b: Edge | Wire): Shell;
export class StitchReport {
    readonly sewnEdges: number;
    readonly openEdges: number;
    readonly maxGap: number;
    readonly turnedFaces: number;
    readonly tolerance: number;
    constructor(sewnEdges: number, openEdges: number, maxGap: number, turnedFaces: number, tolerance: number);
}
type StitchOptions = {
    tolerance?: number | null;
    report?: boolean;
};
export function stitch(...args: [
    ...StitchPiece[],
    StitchOptions & {
        report: true;
    }
]): [Part | Shell, StitchReport];
export function stitch(...args: (StitchPiece | StitchOptions)[]): Part | Shell;
export function surfaceFillet(a: Face | Shell, b: Face | Shell, radius: number, options?: {
    radius2?: number | null;
    shape?: 'round' | 'chamfer';
    sides?: readonly [number, number];
    trim?: boolean;
}): Shell;
export function blend(edgeA: Edge, edgeB: Edge, options?: {
    continuity?: 'G1' | 'G2' | 'G3' | number;
    tension?: number | readonly [number, number];
    join?: boolean;
}): Shell;
export function fill(boundary: Edge | Wire | Iterable<Edge | Wire>, options?: {
    tangent?: boolean;
}): Shell;
export function network(u: Iterable<Edge | Wire>, v: Iterable<Edge | Wire>): Shell;
```

## Sheet metal

```ts
export type KFactor = number | string | ((radius: number, thickness: number, angle: number) => number) | ReadonlyMap<number, number> | Readonly<Record<string, number>> | readonly (readonly [number, number])[] | null;
export interface BendAllowanceOptions {
    radius: number;
    thickness: number;
    kFactor?: number;
}
export interface DevelopedLengthOptions extends BendAllowanceOptions {
    angle?: number | Iterable<number>;
}
export function bendAllowance(angle: number, options: BendAllowanceOptions): number;
export function bendDeduction(angle: number, options: BendAllowanceOptions): number;
export function developedLength(...args: [
    ...legs: number[],
    options: DevelopedLengthOptions
]): number;
export class Bend {
    readonly angle: number;
    readonly radius: number;
    readonly thickness: number;
    readonly kFactor: number;
    readonly length: number;
    readonly axis: Axis | null;
    readonly line: Edge | null;
    readonly direction: string | null;
    constructor(angle: number, radius: number, thickness: number, kFactor: number, length: number, axis?: Axis | null, line?: Edge | null, direction?: string | null);
    get allowance(): number;
    equals(other: unknown): boolean;
    toString(): string;
}
export class FlatPattern {
    readonly part: Part;
    readonly outline: Sketch;
    readonly bends: Bend[];
    readonly thickness: number;
    readonly kFactor: number | null;
    constructor(part: Part, outline: Sketch, bends: Bend[], thickness: number, kFactor: number | null);
    get bendLines(): ShapeList<Edge>;
    get size(): Vector;
    equals(other: unknown): boolean;
    toString(): string;
}
export interface FoldOptions {
    radius: number;
    kFactor?: number;
    fixed?: VectorLike | Shape | null;
    partial?: boolean;
}
export function fold(part: Part, line: Axis | Edge, angle: number, options: FoldOptions): Part;
export interface FlangeOptions {
    angle?: number;
    radius: number;
    kFactor?: number;
}
export function flange(part: Part, edge: Edge | ShapeList<Edge>, length: number, options: FlangeOptions): Part;
export interface UnfoldOptions {
    kFactor?: KFactor;
    fixed?: Face | null;
}
export function unfold(part: Part, options?: UnfoldOptions): Part;
export function flatPattern(part: Part, options?: UnfoldOptions): FlatPattern;
```

## Meshes

```ts
export class RepairReport {
    readonly mergedVertices: number;
    readonly removedTriangles: number;
    readonly flippedTriangles: number;
    readonly filledHoles: number;
    readonly openHoles: number;
    readonly openEdges: number;
    constructor(mergedVertices: number, removedTriangles: number, flippedTriangles: number, filledHoles: number, openHoles: number, openEdges: number);
}
export class Mesh {
    vertices: Float64Array;
    triangles: Uint32Array;
    normals: Float32Array | null;
    constructor(vertices: ArrayLike<number>, triangles: ArrayLike<number>, normals?: ArrayLike<number> | null);
    get length(): number;
    dispose(): void;
    get triangleNormals(): Float64Array;
    get area(): number;
    get volume(): number;
    bbox(): BoundBox;
    center(): Vector;
    get centroid(): Vector;
    massProperties(density?: number): MassProperties;
    moved(location: Location): Mesh;
    translate(x?: number | VectorLike, y?: number, z?: number): Mesh;
    rotate(axis?: Axis, angle?: number): Mesh;
    mirror(plane?: Plane | Face | Axis | ShapeList<Face>): Mesh;
    scale(factor: number | VectorLike, center?: VectorLike): Mesh;
    raycast(origin: VectorLike | Axis, direction?: VectorLike | Axis | null): Hit<null>[];
    raycastMany(origins: Iterable<VectorLike>, directions: VectorLike | Axis | Iterable<VectorLike | Axis>): (Hit<null> | null)[];
    isClosed(): boolean;
    section(plane?: Plane | Face): ShapeList<Wire>;
    slices(step: number, axis?: Axis | VectorLike): ShapeList<Wire>[];
    decimate(fraction?: number | null, options?: {
        triangles?: number | null;
        tolerance?: number | null;
        featureAngle?: number;
    }): Mesh;
    fillHoles(): Mesh;
    repaired(): [Mesh, RepairReport];
    toPart(maxFaces?: number): Part;
    fuse(other: Mesh): Mesh;
    cut(other: Mesh): Mesh;
    intersect(other: Mesh): Mesh;
    export(path: string, options?: FileOptions): void;
    toString(): string;
}
export function tessellate(shape: Shape | Iterable<Shape>, tolerance?: number | null, angle?: number, options?: {
    maxEdge?: number | null;
}): Mesh;
export function faceMeshes(shape: Shape | ShapeList<Shape>, tolerance?: number | null, angle?: number): Mesh[];
```

## Files

```ts
export type ShapesLike = Shape | Mesh | (Iterable<ShapesLike> & object);
export type StepItemsLike = Shape | Mesh | Vector | Plane | StepCurve | StepPoint | StepFrame | StepModel | (Iterable<StepItemsLike> & object);
export type FileItemsLike = StepItemsLike | DxfShapesLike;
export type FileOptions = StepExportOptions | (MeshOptions & {
    ascii?: boolean;
}) | GltfOptions | DxfWriteOptions | SvgOptions | UsdExportOptions;
export function exportFile(shapes: FileItemsLike, path: string, options?: FileOptions): void;
export function toFile(shapes: FileItemsLike, name: string, options?: FileOptions): string | Uint8Array;
export function fromFile(data: string | BytesLike, name: string): Part | Shell | Sketch | Mesh | ShapeList<Part | Shell> | Shape | ShapeList<Shape>;
export interface StepExportOptions {
    unit?: 'mm' | 'cm' | 'm' | 'um' | 'inch' | 'in';
    name?: string | null;
    assembly?: boolean;
}
export function exportStep(shapes: StepItemsLike, path: string, options?: StepExportOptions): void;
export function toStep(shapes: StepItemsLike, options?: StepExportOptions): string;
export interface MeshOptions {
    tolerance?: number | null;
    angle?: number;
    maxEdge?: number | null;
}
export function toStl(shapes: ShapesLike, options?: MeshOptions & {
    ascii?: boolean;
}): Uint8Array;
export function exportStl(shapes: ShapesLike, path: string, options?: MeshOptions & {
    ascii?: boolean;
}): void;
export function importStl(path: string): Mesh;
export function fromStl(data: string | BytesLike): Mesh;
export function toObj(shapes: ShapesLike, options?: MeshOptions): string;
export function exportObj(shapes: ShapesLike, path: string, options?: MeshOptions): void;
export interface GltfOptions extends MeshOptions {
    edges?: boolean;
    edgeColor?: Any;
}
export function toGlb(shapes: ShapesLike, options?: GltfOptions): Uint8Array;
export function exportGlb(shapes: ShapesLike, path: string, options?: GltfOptions): void;
export function toGltf(shapes: ShapesLike, options?: GltfOptions): string;
export function exportGltf(shapes: ShapesLike, path: string, options?: GltfOptions): void;
export function toSmb(shapes: ShapesLike, options?: {
    ascii?: boolean;
}): Uint8Array;
export function fromSmb(data: string | BytesLike): Part | Shell;
export function toSmp(shapes: ShapesLike, options?: {
    ascii?: boolean;
}): Uint8Array;
export function fromSmp(data: string | BytesLike): Shape | ShapeList<Shape>;
export function save(shapes: ShapesLike, path: string, options?: {
    ascii?: boolean;
}): void;
export function load(path: string): Part | Shell | Sketch | Mesh | ShapeList<Part | Shell> | Shape | ShapeList<Shape>;
export class StepFrame {
    readonly name: string;
    readonly plane: Plane;
    readonly product: string;
    readonly color: readonly number[] | null;
    constructor(name: string, plane: Plane, product?: string, color?: readonly number[] | null);
    get location(): Location;
    equals(other: unknown): boolean;
    toString(): string;
}
export class StepCurve {
    readonly name: string;
    readonly shape: Edge | Wire;
    readonly product: string;
    readonly color: readonly number[] | null;
    constructor(name: string, shape: Edge | Wire, product?: string, color?: readonly number[] | null);
    equals(other: unknown): boolean;
    toString(): string;
}
export class StepPoint {
    readonly name: string;
    readonly point: Vector;
    readonly product: string;
    readonly color: readonly number[] | null;
    constructor(name: string, point: Vector, product?: string, color?: readonly number[] | null);
    equals(other: unknown): boolean;
    toString(): string;
}
export class StepModel {
    readonly bodies: ShapeList<Part | Shell>;
    readonly frames: StepFrame[];
    readonly curves: StepCurve[];
    readonly points: StepPoint[];
    readonly skipped: string[];
    constructor(bodies: ShapeList<Part | Shell>, frames?: StepFrame[], curves?: StepCurve[], points?: StepPoint[], skipped?: string[]);
    frame(name: string, product?: string | null): Plane;
    equals(other: unknown): boolean;
    toString(): string;
}
export function fromStepModel(data: string | BytesLike, options?: {
    heal?: boolean;
    strict?: boolean;
}): StepModel;
export function readStep(path: string, options?: {
    heal?: boolean;
    strict?: boolean;
}): StepModel;
export function fromStep(data: string | BytesLike, options?: {
    heal?: boolean;
    strict?: boolean;
}): Part | Shell | ShapeList<Part | Shell>;
export function importStep(path: string, options?: {
    heal?: boolean;
    strict?: boolean;
}): Part | Shell | ShapeList<Part | Shell>;
export interface IgesImportOptions {
    heal?: boolean;
    strict?: boolean;
}
export function fromIges(data: string | BytesLike, options?: IgesImportOptions): Part | Shell | ShapeList<Part | Shell>;
export function importIges(path: string, options?: IgesImportOptions): Part | Shell | ShapeList<Part | Shell>;
export interface DxfReadOptions {
    layers?: Iterable<string> | string | null;
    unit?: 'mm' | 'cm' | 'm' | 'um' | 'inch' | 'in' | 'ft' | null;
    tolerance?: number | null;
}
export interface DxfWriteOptions {
    unit?: 'mm' | 'cm' | 'm' | 'um' | 'inch' | 'in' | 'ft';
    plane?: Plane | null;
    curves?: 'exact' | 'arcs';
    tolerance?: number;
}
export function importDxfWires(path: string, options?: DxfReadOptions): ShapeList<Wire>;
export function fromDxfWires(data: string | BytesLike, options?: DxfReadOptions): ShapeList<Wire>;
export function importDxf(path: string, options?: DxfReadOptions): Sketch;
export function fromDxf(data: string | BytesLike, options?: DxfReadOptions): Sketch;
export type DxfShapesLike = ShapesLike | DrawingView | (Iterable<DxfShapesLike> & object);
export function exportDxf(shapes: DxfShapesLike, path: string, options?: DxfWriteOptions): void;
export function toDxf(shapes: DxfShapesLike, options?: DxfWriteOptions): string;
export class DrawingView {
    readonly name: string;
    readonly direction: Vector;
    readonly visible: ShapeList<Edge>;
    readonly hidden: ShapeList<Edge>;
    constructor(name: string, direction: Vector, visible: ShapeList<Edge>, hidden: ShapeList<Edge>);
    bbox(): BoundBox;
    toString(): string;
}
export interface DrawingViewsOptions {
    projection?: 'first-angle' | 'third-angle';
    hidden?: boolean;
    tangentEdges?: boolean;
    gap?: number | null;
}
export function drawingViews(part: Part | Shell | Iterable<Part | Shell>, views?: string | readonly string[], options?: DrawingViewsOptions): DrawingView[];
export type SvgItemsLike = DrawingView | Edge | Wire | Face | Shell | readonly SvgItemsLike[];
export interface SvgOptions {
    margin?: number | null;
    stroke?: number | null;
}
export function toSvg(shapes: SvgItemsLike, options?: SvgOptions): string;
export function exportSvg(shapes: SvgItemsLike, path: string, options?: SvgOptions): void;
export interface UsdExportOptions {
    mesh?: boolean;
    tolerance?: number | null;
    angle?: number;
    materials?: boolean;
    maxEdge?: number | null;
}
export function toUsd(shapes: ShapesLike, options?: UsdExportOptions): string;
export function exportUsd(shapes: ShapesLike, path: string, options?: UsdExportOptions): void;
export interface UsdImportOptions {
    heal?: boolean;
    units?: string | null;
    placement?: boolean;
    check?: boolean;
    strict?: boolean;
}
export interface UsdReadOptions extends UsdImportOptions {
    resolve?: ((asset: string, from: string) => string | Uint8Array | null | undefined) | null;
}
export function fromUsd(data: string | BytesLike, options?: UsdReadOptions): Part | Shell | ShapeList<Part | Shell>;
export function importUsd(path: string, options?: UsdImportOptions): Part | Shell | ShapeList<Part | Shell>;
export interface BrepImportOptions {
    heal?: boolean;
    check?: boolean;
    strict?: boolean;
}
export function toBrep(shapes: ShapesLike): string;
export function exportBrep(shapes: ShapesLike, path: string): void;
export function importBrep(path: string, options?: BrepImportOptions): Part | Shell | ShapeList<Part | Shell>;
export function fromBrep(data: string | BytesLike, options?: BrepImportOptions): Part | Shell | ShapeList<Part | Shell>;
export type BytesLike = Uint8Array | ArrayBufferView | ArrayBuffer;
```

## Pictures and the viewer

```ts
export interface Frame {
    scale: number;
    midX: number;
    midY: number;
}
export const VIEWS: Readonly<Record<string, readonly [number, number, number]>>;
export interface ImageLike {
    width: number;
    height: number;
    data: ArrayLike<number>;
}
export class Picture {
    readonly data: Uint8Array;
    readonly pixels: Uint8Array;
    readonly width: number;
    readonly height: number;
    readonly frame: Frame | null;
    save(path: string): void;
    toString(): string;
}
export class ImageDiff {
    readonly changed: number;
    readonly total: number;
    readonly fraction: number;
    readonly bbox: [number, number, number, number] | null;
    readonly picture: Picture;
    constructor(changed: number, total: number, fraction: number, bbox: [number, number, number, number] | null, picture: Picture);
    save(path: string): void;
    toString(): string;
}
export type Renderable = Shape | Mesh | StepModel | (Iterable<Renderable> & object);
export type RenderView = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | (string & {}) | VectorLike | {
    azimuth?: number;
    elevation?: number;
} | {
    direction: VectorLike;
    up?: VectorLike | null;
};
export type RenderPoint = VectorLike | Shape | BoundBox;
export type RenderMarker = RenderPoint | readonly [RenderPoint, string] | readonly [RenderPoint, string, ColorLike | null] | {
    position: RenderPoint;
    label?: string;
    color?: ColorLike | null;
};
export type CurvatureKind = 'mean' | 'gaussian' | 'max' | 'min' | (string & {});
export interface RenderOptions {
    path?: string | null;
    view?: RenderView | 'sheet';
    size?: readonly [number, number];
    edges?: boolean;
    background?: string | readonly number[];
    tolerance?: number | null;
    zoom?: number;
    lookAt?: RenderPoint | null;
    frame?: Frame | Picture | Record<string, number> | readonly number[] | null;
    supersample?: number;
    colors?: 'native' | 'distinct';
    lines?: boolean;
    drawing?: boolean | 'first-angle' | 'third-angle' | (string & {}) | {
        projection?: string;
        side?: string;
        iso?: boolean;
    } | null;
    sheet?: boolean | readonly (RenderView | null)[] | null;
    section?: Plane | Face | readonly [Face] | readonly [RenderPoint, VectorLike] | {
        origin: RenderPoint;
        normal: VectorLike;
        cap?: boolean;
    } | false | null;
    cap?: boolean;
    highlight?: Shape | Mesh | readonly (Shape | Mesh | readonly (Shape | Mesh)[])[] | null;
    highlightAt?: VectorLike | Iterable<RenderPoint> | null;
    markers?: VectorLike | {
        position: RenderPoint;
        label?: string;
        color?: ColorLike | null;
    } | Iterable<RenderMarker> | null;
    annotate?: boolean;
    xray?: boolean;
    xrayAlpha?: number;
    zebra?: boolean | {
        stripes?: number;
        width?: number;
        direction?: 'vertical' | 'horizontal' | (string & {}) | VectorLike;
    } | null;
    curvature?: CurvatureKind | {
        kind?: CurvatureKind;
        range?: number | readonly [number, number] | null;
    } | false | null;
}
export function render(...shapes: Renderable[]): Picture;
export function render(...args: [
    ...shapes: Renderable[],
    options: RenderOptions
]): Picture;
export function diffImages(a: Picture | ImageLike | Uint8Array | ArrayBuffer | string, b: Picture | ImageLike | Uint8Array | ArrayBuffer | string, tolerance?: number): ImageDiff;
export interface PageOptions {
    title?: string;
    tolerance?: number | null;
    angle?: number;
    edges?: boolean;
    view?: readonly [number, number, number];
    margin?: number;
}
export function htmlPage(...shapes: ShapesLike[]): string;
export function htmlPage(...args: [
    ...shapes: ShapesLike[],
    options: PageOptions
]): string;
export interface ShowOptions {
    title?: string;
    path?: string | null;
    openBrowser?: boolean;
    tolerance?: number | null;
    angle?: number;
    edges?: boolean;
}
export function show(...shapes: ShapesLike[]): string;
export function show(...args: [
    ...shapes: ShapesLike[],
    options: ShowOptions
]): string;
```

## Errors and memory

```ts
export class ModelingError extends Error {
    constructor(message: string);
}
export class KernelError extends ModelingError {
    readonly operation: string;
    readonly status: string | null;
    readonly detail: string;
    readonly hint: string | null;
    readonly trace: readonly string[];
    constructor(operation: string, detail: string, status?: string | null, hint?: string | null);
}
export interface MemoryUsage {
    readonly used: number;
    readonly heap: number;
    readonly limit: number;
    readonly handles: number;
    readonly crashes: number;
}
export function memoryUsage(): MemoryUsage;
export function scope<T>(fn: () => T): T;
export function setWarningHandler(handler: (message: string) => void): void;
```

## The worker entry: @classcad/smlibwasm/worker

```ts
export type FunctionName<M> = {
    [K in keyof M]: M[K] extends (...args: any[]) => unknown ? K : never;
}[keyof M] & string;
export type Remote<M> = {
    readonly [K in FunctionName<M>]: M[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
};
export interface WorkerLike {
    postMessage(message: unknown, transfer?: readonly Transferable[]): void;
    terminate(): unknown;
}
export interface KernelWorkerOptions {
    timeout?: number;
    startTimeout?: number;
}
export interface CallOptions {
    timeout?: number;
    signal?: AbortSignal;
}
export class KernelWorker<M extends object = Record<string, (...args: any[]) => unknown>> {
    constructor(worker: URL | string | (() => WorkerLike), options?: KernelWorkerOptions);
    call<K extends FunctionName<M>>(name: K, args?: M[K] extends (...a: infer A) => unknown ? A : never, options?: CallOptions): Promise<M[K] extends (...a: any[]) => infer R ? Awaited<R> : never>;
    get functions(): Remote<M>;
    start(): Promise<string[]>;
    get pending(): number;
    terminate(): void;
}
export function expose(functions: object | (() => object | Promise<object>)): void;
```

## Loading the kernel: @classcad/smlibwasm/init

```ts
export interface InitOptions {
    locateFile?: (path: string, prefix: string) => string;
    wasmBinary?: ArrayBuffer | ArrayBufferView;
    wasmModule?: WebAssembly.Module;
    instantiateWasm?: (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) => unknown;
}
export function init(options?: InitOptions): Promise<typeof import('./index.ts')>;
```

## The raw kernel layer (no stable API): @classcad/smlibwasm/kernel

```ts
export interface Kernel {
    [name: string]: Any;
}
export const module: Any;
export type Signature = readonly (string | readonly [
    string,
    unknown
])[];
export const k: Kernel;
export const ext: Any;
export function kernelCall<T>(operation: string, fn: () => T, hint?: string | null): T;
export interface MemoryUsage {
    readonly used: number;
    readonly heap: number;
    readonly limit: number;
    readonly handles: number;
    readonly crashes: number;
}
export function memoryUsage(): MemoryUsage;
export abstract class Handle {
    constructor(kind: string, p: number);
    readonly id: number;
    release(): number;
    get alive(): boolean;
    dispose(): void;
}
export function scope<T>(fn: () => T): T;
export class BrepHandle extends Handle {
    sound: number;
    props: Any;
    tags: [
        number[][],
        number[][]
    ] | null;
    shells: [
        Any[],
        number[][]
    ] | null;
    merged: {
        parts: Any[];
        placement: Float64Array;
        cells: Any[][] | null;
    } | null;
    sources: Any[] | null;
    meshes: Map<string, any>;
    imported: boolean;
    constructor(brep: number);
    get brep(): number;
    set brep(brep: number);
}
export class CurveHandle extends Handle {
    constructor(curve: number);
    get curve(): number;
}
export class SurfaceHandle extends Handle {
    constructor(surface: number);
    get surface(): number;
}
export class PolyHandle extends Handle {
    constructor(poly: number);
    get poly(): number;
}
export function setWarningHandler(handler: (message: string) => void): void;
```
