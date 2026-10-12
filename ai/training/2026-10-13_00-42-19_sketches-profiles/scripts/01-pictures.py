# The new 2D tools at a glance: one picture each, numbers to back them.
section = (Profile((0, 0)).line_to(12, 0).line_to(y=4).fillet(1.5)
           .line_to(x=6).line_to(y=20).chamfer(1).line_to(x=0).close())
bracket = (Profile((0, 0)).line_to(30, 0).line_to(y=6).line_to(x=10).fillet(4)
           .line_to(y=30).arc(10, 90).mirror(Y).close())
lever = Hull(Circle(10), Pos(60, 0) * Circle(6)) - Circle(5) - Pos(60, 0) * Circle(3)
slot = ArcSlot(40, 6, 60, rotation=15)
rib = Stroke(Profile((0, 0)).line_to(20, 0).arc(10, 90).wire(), 3)
outline = Rectangle(80, 50, fillet=6)
gasket = outline.offset(3) - outline
for name, s in (("section", section), ("bracket", bracket), ("lever", lever), ("slot", slot), ("rib", rib),
                ("gasket", gasket)):
    b = s.bbox()
    print(f"[01] {name}: area {s.area:.4f} faces {len(s.faces())} holes {sum(len(f.inner_wires()) for f in s.faces())} "
          f"bbox ({b.min.x:.4g}, {b.min.y:.4g})..({b.max.x:.4g}, {b.max.y:.4g}) edges {sorted(set(e.geom_type for e in s.edges()))}")
snapshot("profiles", section.translate(-40, 0), bracket.translate(0, 0), lever.translate(60, 10), view="top")
snapshot("shapes", slot, rib.translate(60, 0), gasket.translate(0, -80), view="top")
bushing = section.revolve(Axis((0, 0, 0), (0, 1, 0)))
snapshot("bushing", bushing, view="iso")
print("[01] bushing volume", round(bushing.volume, 4), "valid", bushing.is_valid())
