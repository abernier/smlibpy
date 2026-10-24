// Python's parameters of each kernel call (SmPyLib's py::arg), in order: a name, or [name, default]
// where Python has a default. Enum defaults are the numbers of the constants (commented); None is
// null. The order is the order in which the JavaScript functions of js/cpp/bind_kernel*.cpp take
// them; the names are what smlibpy passes as keywords (k.fillet_edges(b, edges, radius=r, ...)).
// (Python's keyword-only markers are not recorded: past one, an argument can only be named.)
export const SIGNATURES: Record<string, readonly (string | readonly [string, unknown])[]> = {
  // primitives (SmPyPrimitives.cpp)
  create_box: ['origin', 'length', 'width', 'height'],
  create_sphere: ['origin', 'radius'],
  create_cone: ['origin', 'radius_base', 'radius_top', 'height'],
  create_cylinder: ['origin', 'radius', 'height'],
  create_torus: ['origin', 'radius_major', 'radius_minor'],
  create_partial_cylinder: ['origin', 'radius', 'height', 'start_angle_deg', 'end_angle_deg'],
  create_partial_cone: ['origin', 'radius_base', 'radius_top', 'height', 'start_angle_deg', 'end_angle_deg'],
  create_partial_sphere: ['origin', 'radius', 'start_angle_deg', 'end_angle_deg'],
  create_skin_primitive: ['curves_per_profile', 'curves', ['degree', 1], ['cap_ends', true]],

  // curves (SmPyCurves.cpp)
  create_line_segment: ['start', 'end'],
  create_circle: ['center', 'radius'],
  create_ellipse: ['origin', 'radius1', 'radius2'],
  create_helix: ['origin', 'height', 'radius_start', 'radius_end', 'turns', ['right_handed', true], ['tolerance', 0.0001]],
  create_rectangle: ['center', 'length', 'width'],
  remove_curve_knots: ['curve'],
  make_curves_compatible: ['curves'],
  create_canonical_curve: [
    'points',
    'knots',
    'knot_multiplicities',
    ['weights', null],
    ['degree', 3],
    ['form', 6 /* BSplineCurveForm_UNSPECIFIED */],
  ],

  // surfaces (SmPySurfaces.cpp)
  create_surface_from_points: ['control_points', 'rows', 'cols'],
  create_surface_from_ordered_points: ['points', 'rows', 'cols'],
  create_ruled_surface: ['curve1', 'curve2'],
  create_skin_surface: ['profiles'],
  create_planar_faces: ['curves'],

  // booleans (SmPyBooleans.cpp)
  boolean: ['brep1', 'brep2', 'operation'],
  boolean_with_options: [
    'brep1',
    'brep2',
    'operation',
    ['cookie_cutter', false],
    ['imprinting', false],
    ['post_process', true],
    ['imprint_and_classify', false],
    ['keep_other_brep', false],
  ],
  boolean_2d: ['brep1', 'brep2', 'operation'],
  non_manifold_boolean: ['brep1', 'brep2', 'operation'],

  // sweeps (SmPySweeps.cpp)
  linear_sweep: ['curves', 'direction', 'distance', ['cap_ends', true]],
  rotational_sweep: ['curves', 'base_point', 'axis', 'angle_deg', ['cap_ends', true]],
  draft_sweep: ['curves', 'height', 'angle_deg', ['fillet_corners', false], ['cap_ends', 3 /* CapEnds_BOTH */]],
  sweep_along_planar_path: ['profile_curves', 'path_curves', ['move_profile', true], ['cap_ends', 3 /* CapEnds_BOTH */]],
  non_manifold_linear_sweep: [
    'brep_to_sweep',
    'direction',
    'distance',
    ['region_brep', null],
    ['do_stitching', true],
    ['do_merge', false],
    ['faces', null],
    ['edges', null],
    ['vertices', null],
  ],

  // fillets (SmPyFillets.cpp); xsect_type 0 linear, 1 circular, 2 blend (not FilletXSect values)
  fillet_edges: ['brep', 'edges', 'radius', ['xsect_type', 1], ['continuity', 1], ['thumbweight', 1.0]],
  variable_radius_fillet: ['brep', 'edges', 'start_radius', 'end_radius', ['xsect_type', 1], ['continuity', 1]],
  fillet_edges_per_edge: ['brep', 'edges', 'radii', 'xsect_types', ['continuity', 1], ['thumbweight', 1.0]],
  fillet_preview: ['brep', 'edges', 'radius'],
  remove_fillet: ['brep'],
  surface_surface_fillet: [
    'surface1',
    'surface2',
    'radius1',
    'radius2',
    'tolerance',
    ['xsect_type', 1],
    ['mirror', false],
    ['complement', false],
  ],

  // offset (SmPyOffset.cpp)
  shell_brep: [
    'brep',
    'distance',
    ['extended_offset', true],
    ['self_intersection', true],
    ['create_solid', true],
    ['faces_to_shell', []],
  ],
  offset_brep: ['brep', 'distance', ['extended_offset', true], ['self_intersection', true]],
  create_offset_profile: [
    'curves',
    'distance',
    ['offset_type', 3 /* OffsetType_BOTH */],
    ['round_corners', true],
    ['shell_result', false],
  ],

  // io (SmPyFileIo.cpp); ascii null: detect the format
  read_brep_from_file: ['filename', ['ascii', null], ['rebuild_uv_trim_curves', false]],

  // brep_ops, stitching, heal (SmPyBrepOps.cpp, SmPyStitching.cpp, SmPyHeal.cpp)
  turn_to_nurbs: ['brep'],
  stitch_into_solid: ['brep'],
  stitch_into_shell: ['brep', ['max_stitching_ratio', 1.0], ['shell_is_well_formed', false]],
  stitch_advanced: [
    'brep',
    'tolerance_3d',
    ['squeeze_small_edges', true],
    ['split_edges_with_vertices', true],
    ['making_manifold_solid', true],
    ['remove_laminar_slivers', false],
  ],
  heal_brep: ['brep'],

  // transforms (SmPyTransforms.cpp; Axis2Placement's constructor in SmPyTypes.cpp)
  Axis2Placement: ['origin', 'x_axis', 'y_axis'],
  rotate: ['target', 'ref_point', 'axis', 'angle_deg'],
  transform: ['target', 'placement'],

  // queries (SmPyQueries.cpp)
  brep_closest_point: ['brep', 'point'],
  curve_closest_point: ['curve', 'point'],
  surface_closest_point: ['surface', 'point'],
  brep_relationship: ['a', 'b'],

  // intersect (SmPyIntersectors.cpp)
  intersect_breps: ['brep1', 'brep2'],
  intersect_brep_with_plane: ['brep', 'plane_point', 'plane_normal'],
  intersect_curves: ['curve1', 'curve2'],
  intersect_curve_face: ['curve', 'face'],

  // cutting (SmPyCutProjectTrim.cpp)
  project_brep_onto_plane: ['brep', 'plane_point', 'plane_normal'],
  create_silhouette_curves: ['brep', 'plane_point', 'plane_normal'],
  project_curve: ['brep', 'curve', 'projection_vector'],

  // poly, tessellation (SmPyPolyOps.cpp, SmPyTessellation.cpp)
  poly_boolean: ['poly_brep1', 'poly_brep2', 'operation'],
  tessellate: [
    'brep',
    ['chord_height_tolerance', 0.0],
    ['curve_angle_tolerance_deg', 25.0],
    ['surface_angle_tolerance_deg', 25.0],
    ['max_edge_length', 0.0],
    ['max_aspect_ratio', 0.0],
    ['allow_partial', false],
    ['return_failures', false],
    ['return_report', false],
  ],
  tessellate_boundaries: ['brep', ['angle_tolerance_deg', 5.0], ['allow_partial', false]],
}
