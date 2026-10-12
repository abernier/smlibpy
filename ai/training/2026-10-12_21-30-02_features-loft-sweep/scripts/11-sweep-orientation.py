def rep(tag, p):
    b = p.bbox()
    print(f"[{tag}] valid={p.is_valid()} vol={p.volume:.4f} min={tuple(round(v,3) for v in b.min.to_tuple())} max={tuple(round(v,3) for v in b.max.to_tuple())}")

# A rectangle 10 (x) by 2 (y) along X: how is it turned?
r = sweep(Rectangle(10, 2), Line((0, 0, 0), (40, 0, 0)))
rep("rect 10x2 along X", r)
r = sweep(Rectangle(10, 2), Line((0, 0, 0), (0, 40, 0)))
rep("rect 10x2 along Y", r)
r = sweep(Rectangle(10, 2), Line((0, 0, 0), (0, 0, 40)))
rep("rect 10x2 along Z", r)
r = sweep(Rectangle(10, 2), Line((0, 0, 0), (0, 0, -40)))
rep("rect 10x2 along -Z", r)
r = sweep(Rectangle(10, 2), Line((0, 0, 0), (30, 0, 30)))
rep("rect 10x2 along XZ diag", r)
# profile placed on a plane perpendicular to the path already
r = sweep(Rectangle(10, 2).on(Plane.YZ), Line((0, 0, 0), (40, 0, 0)))
rep("rect on YZ along X", r)
r = sweep(Rectangle(10, 2).on(Plane.XZ), Line((0, 0, 0), (40, 0, 0)))
rep("rect on XZ along X (in-plane)", r)
# orient=False
try:
    r = sweep(Rectangle(10, 2), Line((0, 0, 0), (40, 0, 0)), orient=False)
    rep("orient=False along X", r)
except Exception as e:
    print(f"[orient=False along X] {type(e).__name__}: {e}")
r = sweep(Rectangle(10, 2), Line((0, 0, 0), (0, 0, 40)), orient=False)
rep("orient=False along Z", r)
# translational along an arc: profile does not turn
arc = CenterArc((0, 0), 20, 0, 90, plane=Plane.front)
print("arc start", arc.start.to_tuple(), "end", arc.end.to_tuple(), "tangent0", arc.tangent_at(0).to_tuple())
a = sweep(Circle(3), arc)
rep("arc normal", a); print("expected", math.pi*9*2*math.pi*20/4)
t = sweep(Circle(3), arc, translational=True)
rep("arc translational", t)
snapshot("trans", a, t.translate(40, 0, 0), view="front")
