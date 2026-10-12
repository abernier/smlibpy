# Closing closed surfaces: grid tube + caps, revolved tube + caps, torus grid alone.
import math
def report(label, r, exact=None):
    if isinstance(r, Part):
        print(f"[10] {label}: Part vol {r.volume:.3f} exact {exact} valid {r.is_valid()} faces {len(r.faces())}")
    else:
        free = sum(1 for e in r.edges() if len(e.faces()) == 1)
        print(f"[10] {label}: Shell faces {len(r.faces())} free {free}")
R, H = 10, 30
ring = lambda z: [(R * math.cos(a), R * math.sin(a), z) for a in np.linspace(0, 2 * math.pi, 25)]
tube = surface([ring(z) for z in np.linspace(0, H, 4)])
# caps from the tube's own boundary edges (exactly matching)
caps = [make_face(e) for e in tube.edges()]
print("[10] cap areas", [round(c.area, 3) for c in caps])
report("grid tube + caps from its edges", stitch(tube, caps), round(math.pi * R * R * H, 3))
caps2 = [make_face(CenterArc((0, 0, 0), R, 0, 360)), make_face(CenterArc((0, 0, H), R, 0, 360))]
report("grid tube + exact circle caps", stitch(tube, caps2), round(math.pi * R * R * H, 3))
rt = revolve(Line((R, 0, 0), (R, 0, H)), Z)
report("revolved tube + exact circle caps", stitch(rt, caps2), round(math.pi * R * R * H, 3))
def tor(u, v, R=20, r=5):
    return ((R + r * math.cos(v)) * math.cos(u), (R + r * math.cos(v)) * math.sin(u), r * math.sin(v))
tg = [[tor(2 * math.pi * i / 24, 2 * math.pi * j / 16) for j in range(17)] for i in range(25)]
torus = surface(tg)
report("torus grid alone", stitch(torus), round(2 * math.pi**2 * 20 * 25, 3))
