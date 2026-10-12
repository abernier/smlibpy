# a dense face: the offset face of a thickened free-form surface (11025 poles)
import time
from smlibpy._kernel import ext
pts = [[(x, y, 3 * math.sin(x / 7) * math.cos(y / 9)) for y in np.linspace(0, 100, 10)] for x in np.linspace(0, 100, 10)]
slab = surface(pts).thicken(5)
print("[25] poles per face", sorted(len(ext.surface_data(f._f.surface(), True)["poles"]) for f in slab.faces()))
lat = Lattice(slab, 3)
lat.move((1, 1, -1), (0, 0, 5))
t0 = time.time(); out = lat.apply(slab); dt = time.time() - t0
print(f"[25] lattice: valid {out.is_valid()} in {dt:.2f} s, poles per face",
      sorted(len(ext.surface_data(f._f.surface(), True)["poles"]) for f in out.faces()))
t0 = time.time(); tw = slab.twist(30, axis=Axis(tuple(slab.bbox().center), (0, 0, 1))); dt = time.time() - t0
print(f"[25] twist: valid {tw.is_valid()} in {dt:.2f} s")
