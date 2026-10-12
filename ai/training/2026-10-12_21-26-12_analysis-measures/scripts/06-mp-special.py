# Principal axes pairing, density <= 0, cavities, multi-solid parts, shells and sketches.
pi = math.pi
a, b, c = 40.0, 30.0, 20.0
ax = Axis((0, 0, 0), (1, 2, 3))
Rm = Location.about(ax, 37).matrix[:3, :3]
mp = Box(a, b, c).rotate(ax, 37).mass_properties()
for i, (mom, v) in enumerate(zip(mp.principal_moments, mp.principal_axes)):
    dots = [round(abs(np.dot(np.array(v.to_tuple()), Rm[:, j])), 9) for j in range(3)]
    print(f"[06] principal {i}: moment={mom:.4f} |dot| with rotated X,Y,Z = {dots}")

for d in (0.0, -1.0, 2.0, 1e-9):
    mp = Box(10, 10, 10).mass_properties(density=d)
    print(f"[06] density={d}: mass={mp.mass:.6g} Izz={mp.inertia[2][2]:.6g} (exp {d*1000*200/12:.6g})")

cav = Box(20, 20, 20) - Sphere(5)
v = 8000 - 4/3*pi*125
print(f"[06] box with internal cavity: V={cav.volume:.8g} exp={v:.8g} rel={(cav.volume-v)/v:+.2e} A={cav.area:.8g} expA={2400+4*pi*25:.8g} valid={cav.is_valid()} solids={len(cav.solids())} faces={len(cav.faces())}")

two = Box(10, 10, 10) + Box(10, 10, 10).translate(30, 0, 0)
mp = two.mass_properties()
print(f"[06] two disjoint boxes: V={mp.volume} center={mp.center} solids={len(two.solids())} Iyy={mp.inertia[1][1]:.6g} exp={2*(1000*200/12 + 1000*15**2):.6g}")

sh = Box(10, 10, 10).faces().top().one().to_shell() if hasattr(Face, "to_shell") else None
print("[06] shell type:", type(sh).__name__)
for name in ("volume", "area", "center", "mass_properties", "is_valid"):
    try:
        val = getattr(sh, name)
        val = val() if callable(val) else val
        print(f"[06] shell.{name}: {val}")
    except Exception as e:
        print(f"[06] shell.{name}: {type(e).__name__}: {e}")
sk = Circle(10) - Circle(4)
for name in ("volume", "area", "center", "mass_properties", "is_valid"):
    try:
        val = getattr(sk, name)
        val = val() if callable(val) else val
        print(f"[06] sketch.{name}: {val}")
    except Exception as e:
        print(f"[06] sketch.{name}: {type(e).__name__}: {e}")
print(f"[06] ring area exp {pi*(100-16):.10g}")
