# Python API

Everything below is importable from `smlibpy` directly. The same API in JavaScript is smlibwasm's,
[WASM](wasm.md), and with three.js objects smlibpy-three's, [three.js](three.md); both name it in
camelCase.

## Shapes

<!-- Part, Sketch and Shell show what every body has (smlibpy.shapes._Body) as their own:
     tests/test_lane_WN.py checks that the list holds every public member of _Body. -->
::: smlibpy.shapes.Part
    options:
      inherited_members: [bbox, check, closest_point, closest_points, color, colored, compact, distance_to, edges, faces, heal, info, intersection_curves, name, named, outline, project, raycast, raycast_many, silhouette, to_nurbs, vertices, wires]
::: smlibpy.shapes.Sketch
    options:
      inherited_members: [bbox, check, closest_point, closest_points, color, colored, compact, distance_to, edges, faces, heal, info, intersection_curves, name, named, outline, project, raycast, raycast_many, silhouette, to_nurbs, vertices, wires]
::: smlibpy.shapes.Shell
    options:
      inherited_members: [bbox, check, closest_point, closest_points, color, colored, compact, distance_to, edges, faces, heal, info, intersection_curves, name, named, outline, project, raycast, raycast_many, silhouette, to_nurbs, vertices, wires]
::: smlibpy.shapes.Face
::: smlibpy.shapes.Edge
::: smlibpy.shapes.Wire
::: smlibpy.shapes.Vertex
::: smlibpy.shapes.ShapeList
::: smlibpy.shapes.Shape
::: smlibpy.shapes.MassProperties
::: smlibpy.shapes.SectionProperties
::: smlibpy.shapes.Problem

## Geometry

::: smlibpy.geometry.Vector
::: smlibpy.geometry.Axis
::: smlibpy.geometry.Plane
::: smlibpy.geometry.Location
::: smlibpy.geometry.Pos
::: smlibpy.geometry.Rot
::: smlibpy.geometry.BoundBox
::: smlibpy.geometry.Hit
::: smlibpy.geometry.Nurbs
::: smlibpy.geometry.NurbsSurface
::: smlibpy.geometry.ClosestPoints
::: smlibpy.geometry.Curvature
::: smlibpy.geometry.Continuity
::: smlibpy.align.Align

## Parts

::: smlibpy.parts

## Sketches

::: smlibpy.profiles.Profile
::: smlibpy.sketches
::: smlibpy.text.Text

## Curves

::: smlibpy.curves

## Patterns

::: smlibpy.locations

## Operations

::: smlibpy.operations

## Deformations

::: smlibpy.deformations

## Surfaces

::: smlibpy.surfaces

## Sheet metal

::: smlibpy.sheetmetal

## Simplifying

::: smlibpy.defeature

## Molding

::: smlibpy.molding

## Meshes

::: smlibpy.mesh

## Files

::: smlibpy.exporters
::: smlibpy.step_import.import_step
::: smlibpy.step_import.from_step
::: smlibpy.step_import.read_step
::: smlibpy.step_import.from_step_model
::: smlibpy.step_import.StepModel
::: smlibpy.step_import.StepFrame
::: smlibpy.step_import.StepCurve
::: smlibpy.step_import.StepPoint
::: smlibpy.iges_import.import_iges
::: smlibpy.iges_import.from_iges
::: smlibpy.dxf.import_dxf
::: smlibpy.dxf.from_dxf
::: smlibpy.dxf.import_dxf_wires
::: smlibpy.dxf.from_dxf_wires
::: smlibpy.dxf.export_dxf
::: smlibpy.dxf.to_dxf
::: smlibpy.usd.export_usd
::: smlibpy.usd.to_usd
::: smlibpy.usd.import_usd
::: smlibpy.usd.from_usd
::: smlibpy.occt.export_brep
::: smlibpy.occt.to_brep
::: smlibpy.occt.import_brep
::: smlibpy.occt.from_brep

## Drawings

::: smlibpy.drawing
::: smlibpy.machining

## Viewer

::: smlibpy.viewer.show
::: smlibpy.pictures.render
::: smlibpy.pictures.diff_images
::: smlibpy.pictures.Picture
::: smlibpy.pictures.ImageDiff
::: smlibpy.viewer.html_page

## Errors

::: smlibpy._kernel.ModelingError
::: smlibpy._kernel.KernelError
