# deformed parts in later steps, files and meshes
import numpy as np
bar = Box(20, 20, 100).twist(90)
for label, make in [("cut a hole", lambda: bar - Cylinder(4, 40).rotate(X, 90)),
                    ("fuse a boss", lambda: bar + Cylinder(8, 30).translate(0, 0, 60)),
                    ("fillet the top", lambda: bar.fillet(bar.faces().sort_by(Z)[-1].edges(), 2)),
                    ("fillet the twisted edges", lambda: bar.fillet(bar.edges().filter_by(lambda e: e.length > 50), 2)),
                    ("shell open top", lambda: bar.shell(2, bar.faces().sort_by(Z)[-1])),
                    ("offset", lambda: bar.offset(1))]:
    try:
        r = make()
        print(f"[14] {label}: valid {r.is_valid()} faces {len(r.faces())} volume {r.mass_properties(accuracy=1e-10).volume:.3f}")
    except Exception as e:
        print(f"[14] {label}: {type(e).__name__}: {e}")
import tempfile, os
d = tempfile.mkdtemp()
export_step(bar, os.path.join(d, "bar.step"))
back = import_step(os.path.join(d, "bar.step"))
print("[14] STEP round trip: volume", round(back.mass_properties(accuracy=1e-10).volume, 6))
def mesh_error(m):
    v = m.vertices[m.triangles].mean(axis=1)
    a = -(v[:, 2] + 50) / 100 * math.pi / 2
    x = v[:, 0] * np.cos(a) - v[:, 1] * np.sin(a)
    y = v[:, 0] * np.sin(a) + v[:, 1] * np.cos(a)
    inner = np.abs(v[:, 2]) < 49.9
    return float(np.minimum(np.abs(np.abs(x) - 10), np.abs(np.abs(y) - 10))[inner].max())
for tol in (None, 0.01, 0.001):
    m = bar.mesh(tolerance=tol)
    print(f"[14] mesh tolerance {tol}: triangles {len(m.triangles)} volume {m.volume:.2f} centroids off the surface by up to {mesh_error(m):.4f}")
plain = Box(20, 20, 100).rotate(Z, 45)
print("[14] plain box mesh volume", round(plain.mesh().volume, 3))
