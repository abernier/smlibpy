# Fender continued: fillet the arch edges, export STEP and read it back.
import math, os, tempfile
L, W = 120.0, 50.0
def z(x, y):
    return 40 + 6 * math.cos(math.pi * x / L) ** 2 - 18 * (y / W) ** 2.2
grid = [[(x, y, z(x, y)) for y in np.linspace(0, W, 9)] for x in np.linspace(-L / 2, L / 2, 13)]
skin = surface(grid)
panel = skin.thicken(-2)
fender = panel - Cylinder(42, 200).rotate(X, 90)
arch_faces = fender.faces().cylinders()
print("[05] arch faces:", len(arch_faces), [round(f.radius, 3) for f in arch_faces])
arch_edges = [e for f in arch_faces for e in f.edges()]
print("[05] arch edges:", len(arch_edges), [e.geom_type for e in arch_edges])
for r in (0.5, 0.9, 1.5):
    try:
        ff = fender.fillet(arch_faces.edges() if hasattr(arch_faces, 'edges') else arch_edges, r)
        print(f"[05] fillet {r}: valid {ff.is_valid()} vol {ff.volume:.2f} faces {len(ff.faces())}")
    except Exception as e:
        print(f"[05] fillet {r}: {type(e).__name__}: {e}")
ff = fender.fillet(arch_faces.edges(), 0.5)
d = tempfile.mkdtemp(); p = os.path.join(d, "fender.step")
export_step(ff, p)
back = import_step(p)
print("[05] STEP round trip:", type(back).__name__, round(back.volume, 2), "vs", round(ff.volume, 2), back.is_valid())
snapshot("filleted", ff, view=(0.3, -1, 0.25))
