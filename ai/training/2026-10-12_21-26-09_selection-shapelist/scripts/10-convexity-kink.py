# Where does "smooth" end? A kink of a few tenths of a degree on the top surface
for deg in (0.2, 0.4, 0.6, 1.0, -0.4, -1.0):
    h = 10 * math.tan(math.radians(deg))
    prof = Polygon((0, 0), (20, 0), (20, 5 + h), (10, 5), (0, 5))
    p = prof.on(Plane.XZ).extrude(-10)
    kink = p.edges().filter(lambda e: abs(e.center().x - 10) < 1e-6 and e.center().z > 1)
    print(f"[10] kink {deg} deg: edges {len(kink)} -> {[e.convexity for e in kink]}  total smooth {len(p.edges().smooth())}")
    if deg == 0.4:
        try:
            r = p.fillet(kink, 1)
            print("[10]   fillet smooth edge:", round(r.volume, 3))
        except Exception as ex:
            print("[10]   fillet smooth edge:", type(ex).__name__, ex)
