OUT = "ai/training/2026-10-12_21-32-28_files-mesh/files"
for label, s in [("sketch", Rectangle(20, 10)), ("face", Box(10, 10, 10).faces().top()),
                 ("shell", surface([[(x * 10, y * 10, math.sin(x)) for x in range(4)] for y in range(4)])),
                 ("shapelist", ShapeList([Box(5, 5, 5), Sphere(3).translate(10, 0, 0)])),
                 ("list", [Box(5, 5, 5)]), ("edge", Line((0, 0, 0), (1, 0, 0))), ("wire", Polyline((0, 0), (1, 0), (1, 1)))]:
    try:
        m = tessellate(s)
        print(f"[05] tessellate {label}: {m} area {round(m.area, 3)} volume {round(m.volume, 3)} normals {None if m.normals is None else m.normals.shape}")
    except Exception as e:
        print(f"[05] tessellate {label}: {type(e).__name__}: {e}")
# Sketch: which way do the normals point?
m = tessellate(Rectangle(20, 10))
print("[05] sketch triangle normals:", np.unique(np.round(m.triangle_normals, 6), axis=0))
# mesh Booleans
a = Box(20, 20, 20).mesh()
b = Sphere(12).mesh()
exact = {"+": (Box(20, 20, 20) + Sphere(12)).volume, "-": (Box(20, 20, 20) - Sphere(12)).volume, "&": (Box(20, 20, 20) & Sphere(12)).volume}
for op, r in [("+", a + b), ("-", a - b), ("&", a & b)]:
    print(f"[05] mesh {op}: {r} volume {round(r.volume, 2)} exact {round(exact[op], 2)} rel {(r.volume - exact[op]) / exact[op]:.2e} normals {None if r.normals is None else r.normals.shape}")
c = (a - b) - Cylinder(3, 40).mesh()
print("[05] chained:", c, round(c.volume, 2), "exact", round((Box(20, 20, 20) - Sphere(12) - Cylinder(3, 40)).volume, 2))
snapshot("bool", a - b, view="iso")
# Booleans with a mesh built by hand or read from STL
hand = Mesh([(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1)], [(0, 2, 1), (0, 1, 3), (0, 3, 2), (1, 2, 3)])
print("[05] hand mesh:", hand, "volume", hand.volume, "area", round(hand.area, 4), "normals", hand.normals)
try:
    hand + a
except Exception as e:
    print("[05] hand + tessellated:", type(e).__name__, e)
export_stl(a, f"{OUT}/05-a.stl")
try:
    import_stl(f"{OUT}/05-a.stl") - b
except Exception as e:
    print("[05] stl - tessellated:", type(e).__name__, e)
# disjoint union, no-overlap difference
far = Sphere(3).translate(50, 0, 0).mesh()
print("[05] disjoint union:", a + far, round((a + far).volume, 2), "sum", round(a.volume + far.volume, 2))
try:
    r = a & far
    print("[05] empty intersection:", r, r.volume)
except Exception as e:
    print("[05] empty intersection:", type(e).__name__, e)
try:
    r = a - Box(20, 20, 20).mesh()
    print("[05] coincident difference:", r, r.volume)
except Exception as e:
    print("[05] coincident difference:", type(e).__name__, e)
