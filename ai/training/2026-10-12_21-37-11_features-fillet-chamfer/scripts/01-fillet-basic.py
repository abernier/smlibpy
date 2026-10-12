from smlibpy._kernel import k
print("FilletXSect", {n: int(getattr(k.FilletXSect, n)) for n in dir(k.FilletXSect) if n.isupper()})
def rep(tag, p, base=None):
    d = f" dV={p.volume - base.volume:.4f}" if base is not None else ""
    print(f"[{tag}] valid={p.is_valid()} vol={p.volume:.4f}{d} faces={len(p.faces())} edges={len(p.edges())}")

box = Box(40, 30, 20)
rep("box", box)
r = 5
v = box.fillet(box.edges().parallel_to(Z), r)
rep("4 vertical r5", v, box)
print("expected dV", -4*(r*r - math.pi*r*r/4)*20)
one = box.fillet(box.edges().parallel_to(Z).first, r)
rep("single Edge r5", one, box)
print("expected dV", -(r*r - math.pi*r*r/4)*20)
fn = fillet(box.edges().parallel_to(Z), r)
rep("function form", fn, box)
top = box.fillet(box.faces().top(), 3)
rep("faces().top() -> its 4 edges r3", top, box)
print("expected dV straight parts", -(3*3 - math.pi*9/4)*(2*(40-0)+2*(30-0)))
allr = box.fillet(box.edges(), 3)
rep("all 12 edges r3", allr, box)
# expected: box minus edges with corner spheres: V = V_box - (4-pi)r^2 * sum(L-2r)/4*... use exact formula
a, b, c, rr = 40, 30, 20, 3
exact = (a*b*c - (4-math.pi)*rr*rr*((a-2*rr)+(b-2*rr)+(c-2*rr)) - (8-4*math.pi/3)*rr**3)
print("expected all-edge rounded box", exact)
# edges of an earlier version: fillet after a cut, edges from the box before the cut
cut = box - Cylinder(5, 40)
e_old = box.edges().parallel_to(Z)
f2 = cut.fillet(e_old, 4)
rep("edges from earlier version", f2, cut)
# circle edge: top edge of a cylinder
cyl = Cylinder(10, 20)
cf = cyl.fillet(cyl.edges().circles().top() if hasattr(cyl.edges().circles(), "top") else cyl.edges().circles().sort_by(Z)[-1], 2)
rep("cylinder top edge r2", cf, cyl)
rr = 2; R = 10
print("expected dV (Pappus)", -(rr*rr - math.pi*rr*rr/4) * 2*math.pi*(R - rr + (4*rr/(3*(4-math.pi)))*0) )
# exact: removed region = square minus quarter disc, centroid distance from the corner: (10-3pi)/(12-3pi) * r ... compute numerically
xc = (rr - (rr*rr*rr/2 - (math.pi*rr*rr/4)*(rr - 4*rr/(3*math.pi)))/(rr*rr - math.pi*rr*rr/4))  # x-centroid distance from the inner line
A = rr*rr - math.pi*rr*rr/4
cent = (rr**3/2 - (math.pi*rr*rr/4)*(4*rr/(3*math.pi))) / A   # distance of the removed region's centroid from the fillet center line... measured from the corner towards inside? 
print("pappus via numeric centroid:", -A*2*math.pi*(R - (rr - cent)))
snapshot("allr", allr, top.translate(50, 0, 0), cf.translate(100, 0, 0))
