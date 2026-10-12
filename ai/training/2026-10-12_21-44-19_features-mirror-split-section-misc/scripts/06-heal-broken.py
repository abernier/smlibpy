def rep(tag, p):
    try:
        v = p.volume
    except Exception as e:
        v = float("nan")
    print(f"[{tag}] valid={p.is_valid()} vol={v:.4f} faces={len(p.faces())} solids={len(p.solids())}")

cases = {}
cases["revolve crossing (neg volume)"] = Rectangle(10, 20).on(Plane.front).revolve(Z)
cases["sweep 360 arc (2 solids)"] = sweep(Circle(2), CenterArc((0, 0), 20, 0, 360))
cases["sweep disconnected (invalid)"] = sweep(Circle(1), Wire([Line((0, 0, 0), (0, 0, 10)), Line((5, 0, 20), (5, 0, 30))]))
cases["fillet r4.99 cube (garbage)"] = Box(10, 10, 10).fillet(Box(10, 10, 10).edges(), 4.99)
cases["taper 90 (empty)"] = Rectangle(20, 20).extrude(10, taper=90)
for tag, p in cases.items():
    rep(tag, p)
    try:
        h = p.heal()
        rep(tag + " -> heal", h)
    except Exception as e:
        print(f"[{tag} -> heal] {type(e).__name__}: {e}")
# imported STEP: round trip and heal
d = "/private/tmp/claude-501/-Users-dev-dev-awv-classcad/b6f86784-159b-48f0-a560-42efd2a6af42/scratchpad"
part = (Box(40, 30, 20) - Cylinder(8, 30))
export_step(part, f"{d}/p.step")
imp = import_step(f"{d}/p.step")
print("imported type", type(imp).__name__)
rep("imported", imp)
rep("imported -> heal", imp.heal())
