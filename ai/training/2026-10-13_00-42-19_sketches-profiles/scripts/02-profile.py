# Profile: moves, headings, arcs, corners, mirror, results, errors.
import math

# --- guide example: revolve section (Profile.md, recipe) ---
section = (Profile((0, 0))
           .line_to(12, 0).line_to(y=4).fillet(1.5)
           .line_to(x=6).line_to(y=20).chamfer(1)
           .line_to(x=0)
           .close())
bushing = section.revolve(Axis((0, 0, 0), (0, 1, 0)))
print("[02] section area", round(section.area, 4), "edges", [e.geom_type for e in section.edges()])
print("[02] bushing volume", round(bushing.volume, 4), "Pappus", round(2 * math.pi * section.center().x * section.area, 4))

# --- guide example: symmetric bracket ---
bracket = (Profile((0, 0))
           .line_to(30, 0).line_to(y=6)
           .line_to(x=10).fillet(4)
           .line_to(y=30)
           .arc(10, 90)
           .mirror(Y)
           .close())
print("[02] bracket area", round(bracket.area, 4), "bbox", bracket.bbox(), "edges", len(bracket.edges()))
print("[02] bracket closed form", round(60 * 6 + 20 * 24 + 50 * math.pi + 2 * (4 - math.pi) * 4, 4))

# --- moves and where the pen is ---
p = Profile((0, 0)).line_to(20, 0).arc(10, 90)
print("[02] point", p.point, "heading", p.heading, "segments", len(p))
q = Profile((0, 0), heading=30).forward(y=5)
print("[02] forward(y=5) at 30 deg ends at", q.point)
print("[02] headings:", Profile().turn(90).heading, Profile().turn(270).heading, Profile().arc(5, -90).heading)
print("[02] line_to(x=..)", Profile((3, 4)).line_to(x=10).point, "line_by", Profile((3, 4)).line_by(1, -1).point)

# --- arcs ---
u_turn = Profile((0, -3)).forward(20).arc(3, 180).forward(20).arc(3, 180).close()
print("[02] slot by turtle: area", round(u_turn.area, 4), "closed form", round(20 * 6 + 9 * math.pi, 4))
tangent = Profile((0, 0)).line_to(10, 0).arc_to(20, 10)
print("[02] arc_to tangent ends at", tangent.point, "heading", round(tangent.heading, 6))
half = (Profile((-25, 0)).line_to(-25, -7.5)
        .arc_to(25, -7.5, through=(0, -15))
        .line_to(25, 0)
        .mirror(X)
        .close())
print("[02] bottle base area", round(half.area, 4), "bbox", half.bbox())

# --- corners ---
r = Profile((0, 0)).fillet(2).line_to(20, 0).line_to(20, 10).line_to(0, 10).close()
print("[02] fillet at the start corner: area", round(r.area, 6), "expected", round(200 - (4 - math.pi), 6))

# --- branching variants ---
base = Profile((0, 0)).line_to(20, 0).line_to(20, 10)
square = base.line_to(0, 10).close()
round_top = base.arc_to(0, 10).close()
print("[02] variants", round(square.area, 4), round(round_top.area, 4))

# --- wire for a sweep ---
path = Profile((0, 0)).line_to(20, 0).fillet(5).line_to(20, 20).wire()
pipe = sweep(Circle(1), path)
print("[02] wire", path, [e.geom_type for e in path.edges()], "pipe volume", round(pipe.volume, 4),
      "expected", round(math.pi * path.length, 4))

# --- align ---
print("[02] close(align=CENTER) bbox", Profile((10, 10)).line_to(30, 10).line_to(30, 20).close(align=Align.CENTER).bbox())

# --- mirror with ends off the axis ---
m = Profile((5, 0)).line_to(20, 0).line_to(20, 10).line_to(5, 10).mirror(Y).close()
print("[02] off-axis ends joined: area", m.area, "edges", len(m.edges()))

# --- errors ---
def err(label, f):
    try:
        f()
        print(f"[02] {label}: no error")
    except Exception as e:
        print(f"[02] {label}: {type(e).__name__}: {e}")
err("crossing", lambda: Profile().line_to(10, 0).line_to(10, 10).line_to(0, -5).line_to(5, 5).close())
err("fillet too large", lambda: Profile().line_to(10, 0).fillet(20).line_to(10, 10).line_to(0, 10).close())
err("fillet on tangent joint", lambda: Profile().forward(10).fillet(2).arc(5, 90).close())
err("forward behind", lambda: Profile().line_to(10, 0).forward(x=-5))
err("forward parallel", lambda: Profile().forward(y=5))
err("arc_to straight ahead", lambda: Profile().line_to(10, 0).arc_to(20, 0))
err("arc_to behind", lambda: Profile().line_to(10, 0).arc_to(0, 0))
err("through collinear", lambda: Profile().arc_to(10, 0, through=(5, 0)))
err("zero length", lambda: Profile().line_to(10, 0).line_to(10, 0))
err("arc radius", lambda: Profile().arc(-5, 90))
err("wire end corner", lambda: Profile().line_to(10, 0).fillet(2).wire())
err("mirror along axis", lambda: Profile().line_to(10, 0).line_to(10, 10).line_to(0, 10).line_to(0, 5).mirror(Y))
err("mirror closed", lambda: Profile().line_to(10, 0).line_to(0, 10).line_to(0, 0).mirror(Y))
err("extrude a Profile", lambda: Profile().line_to(10, 0).line_to(0, 10).extrude(5))
err("two corners at start", lambda: Profile().fillet(2).line_to(20, 0).line_to(0, 10).line_to(0, 0).fillet(1).close())
err("3D start", lambda: Profile((0, 0, 5)))
err("no area", lambda: Profile().line_to(10, 0).close())

# --- added: clockwise drawing, turn and line_to ---
cw = Profile((0, 0)).line_to(0, 10).line_to(20, 10).line_to(20, 0).close()
print("[02] clockwise outline: area", cw.area, "normal", cw.faces()[0].normal_at(), "plane", cw.plane.z_dir)
t = Profile((0, 0)).turn(45).line_to(10, 0)
print("[02] turn then line_to: point", t.point, "heading", t.heading)
