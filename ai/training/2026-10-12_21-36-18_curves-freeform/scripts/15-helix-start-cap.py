# Corners of the start cap of a rectangle swept along a helix
h = Helix(pitch=4, height=12, radius=8)
for w, hgt in [(2, 1), (1, 2)]:
    coil = sweep(Rectangle(w, hgt), h)
    caps = [f for f in coil.faces() if f.is_planar]
    start = min(caps, key=lambda f: f.center().z)
    vs = sorted({tuple(round(c, 3) for c in v.point.to_tuple()) for v in start.vertices()})
    print(f"[15] Rectangle({w}, {hgt}) start cap center {start.center()} corners {vs}")
    print(f"[15]   normal {start.normal_at()} helix t0 {h.tangent_at(0)}")
