# Counts of faces/edges/vertices/wires on common bodies
bodies = {
    "Box": Box(10, 10, 10),
    "Cylinder": Cylinder(5, 10),
    "Cone": Cone(5, 2, 10),
    "Cone_tip": Cone(5, 0, 10),
    "Sphere": Sphere(5),
    "Torus": Torus(10, 2),
    "Wedge": Wedge(10, 10, 10),
    "Wedge_top": Wedge(10, 10, 10, 4),
    "ruled": ruled(Line((0,0,0),(10,0,0)), Line((0,0,5),(10,5,5))),
    "Box-hole": Box(20, 20, 10) - Cylinder(3, 20),
    "Box-blind": Box(20, 20, 10) - Cylinder(3, 6).translate(0, 0, 5),
    "filleted": Box(20, 20, 10).fillet(Box(20, 20, 10).edges(), 2),
    "Rectangle": Rectangle(20, 10),
    "Circle": Circle(5),
    "Ring": Circle(10) - Circle(5),
    "two_rects": Rectangle(5, 5) + Rectangle(5, 5).translate(10, 0, 0),
}
rows = {}
for n, b in bodies.items():
    try:
        r = dict(type=type(b).__name__, faces=len(b.faces()), edges=len(b.edges()), seams=len(b.edges(seams=True)),
                 vertices=len(b.vertices()), wires=len(b.wires()))
        if isinstance(b, Part):
            r["solids"] = len(b.solids())
        r["face_types"] = sorted(f.geom_type for f in b.faces())
        r["edge_types"] = sorted(e.geom_type for e in b.edges())
    except Exception as ex:
        r = {"error": f"{type(ex).__name__}: {ex}"}
    rows[n] = r
    print(f"[04] {n}: {r}")
filewrite(rows, "counts")
