# Bodies where integration is hard: helix sweeps, inclined cuts, fillets. Default vs 1e-10.
import time
pi = math.pi
def report(name, p, v_exact=None):
    t = time.perf_counter()
    v7 = p.volume
    t7 = (time.perf_counter() - t) * 1000
    t = time.perf_counter()
    v10 = p.mass_properties(accuracy=1e-10).volume
    t10 = (time.perf_counter() - t) * 1000
    ref = v_exact if v_exact is not None else v10
    print(f"[04] {name}: V7={v7:.8g} V10={v10:.8g} ref={ref:.8g} rel7={(v7-ref)/ref:+.2e} rel10={(v10-ref)/ref:+.2e} t7={t7:.0f}ms t10={t10:.0f}ms valid={p.is_valid()}")
    m = p.mesh(tolerance=0.001)
    print(f"[04]    mesh(0.001) volume rel={(m.volume-ref)/ref:+.2e}")

for turns in (1, 4, 10, 20, 40):
    pitch, R, r = 5.0, 10.0, 1.0
    try:
        h = Helix(pitch, pitch*turns, R)
    except ModelingError as e:
        print(f"[04] helix turns={turns}: {e}")
        continue
    L = turns * math.hypot(2*pi*R, pitch)
    print(f"[04] helix turns={turns} length={h.length:.8g} exact={L:.8g} rel={(h.length-L)/L:+.2e}")
    spring = sweep(Circle(r), h)
    report(f"spring {turns} turns", spring, pi*r*r*h.length)  # the helix is a NURBS fit; its own length is the reference
    if turns == 4:
        snapshot("spring4", spring)

cyl = Cylinder(10, 40)
half = split(cyl, Plane((0, 0, 0), z_dir=(0, math.sin(math.radians(30)), math.cos(math.radians(30)))), keep="above")
report("cylinder split at 30 deg", half, pi*100*20)
snapshot("inclined", half)

a, b, c, r = 40.0, 30.0, 20.0, 3.0
fb = Box(a, b, c)
fb = fb.fillet(fb.edges(), r)
vf = (a-2*r)*(b-2*r)*(c-2*r) + 2*r*((a-2*r)*(b-2*r)+(b-2*r)*(c-2*r)+(a-2*r)*(c-2*r)) + pi*r*r*((a-2*r)+(b-2*r)+(c-2*r)) + 4/3*pi*r**3
report("box filleted r3", fb, vf)
