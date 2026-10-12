# intersection_curves between bodies and with planar sketches: count, type, length, on-surface.
import time
pi = math.pi
def show(name, a, b, exp_len=None):
    t = time.perf_counter()
    try:
        cs = a.intersection_curves(b)
    except Exception as e:
        print(f"[10] {name}: {type(e).__name__}: {e}")
        return None
    dt = 1000*(time.perf_counter()-t)
    L = sum(c.length for c in cs)
    off = 0.0
    for c in cs:
        for i in range(11):
            p = c.point_at(i/10)
            off = max(off, a.distance_to(p), b.distance_to(p))
    s = f"[10] {name}: n={len(cs)} types={sorted(set(c.geom_type for c in cs))} closed={[c.is_closed for c in cs]} total length={L:.9g}"
    if exp_len:
        s += f" exp={exp_len:.9g} rel={(L-exp_len)/exp_len:+.1e}"
    print(s + f" max off-surface={off:.1e} ({dt:.0f} ms) type={type(cs).__name__}")
    return cs

box = Box(20, 20, 20)
show("box & vertical cylinder r4 (2 circles)", box, Cylinder(4, 40), 2*2*pi*4)
pipe = Cylinder(4, 40).rotate(X, 30)
cs = show("box & tilted cylinder (doc example)", box, pipe)
snapshot("tilted", box, pipe)
show("sphere r10 & plane sketch z=6", Sphere(10), Rectangle(40, 40).on(Plane.XY.offset(6)), 2*pi*8)
show("sphere r10 & tilted plane sketch through center", Sphere(10), Rectangle(40, 40).on(Plane((0, 0, 0), z_dir=(1, 1, 1))), 2*pi*10)
show("cylinders r5 crossing (Steinmetz)", Cylinder(5, 30), Cylinder(5, 30).rotate(X, 90))
show("cylinder r5 & cylinder r3 crossing", Cylinder(5, 30), Cylinder(3, 30).rotate(X, 90))
show("torus & plane z=0", Torus(20, 5), Rectangle(80, 80), 2*pi*25 + 2*pi*15)
show("disjoint boxes", box, Box(5, 5, 5).translate(50, 0, 0))
show("touching boxes (shared face)", box, Box(20, 20, 20).translate(20, 0, 0))
show("nested sphere", box, Sphere(3))
show("part & itself", box, box)
show("shell & shell", Sphere(10).faces()[0].to_shell(), Rectangle(40, 40).on(Plane.XY.offset(6)), 2*pi*8)
try:
    print("[10] with a Plane:", box.intersection_curves(Plane.XY))
except Exception as e:
    print(f"[10] with a Plane: {type(e).__name__}: {e}")
sec = box.section(Plane.XY.offset(3))
print(f"[10] section for comparison: type={type(sec).__name__} area={sec.area} edges={len(sec.edges())}")
