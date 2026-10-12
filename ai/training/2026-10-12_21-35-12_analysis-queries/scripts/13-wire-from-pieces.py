# Can unordered intersection pieces be joined into a wire? (box & tilted cylinder, 7 pieces)
box = Box(20, 20, 20)
pipe = Cylinder(4, 40).rotate(X, 30)
cs = box.intersection_curves(pipe)
try:
    w = Wire(cs)
    print("[13] Wire(7 pieces):", w.is_closed, len(w.edges()), round(w.length, 6))
except Exception as e:
    print(f"[13] Wire(7 pieces): {type(e).__name__}: {e}")
# two loops: group by z of the start points (bottom/top), side pieces separately
bottom = [c for c in cs if c.center().z < 0]
try:
    w = Wire(bottom)
    print("[13] Wire(bottom pieces):", len(bottom), w.is_closed, round(w.length, 6))
except Exception as e:
    print(f"[13] Wire(bottom): {type(e).__name__}: {e}")
