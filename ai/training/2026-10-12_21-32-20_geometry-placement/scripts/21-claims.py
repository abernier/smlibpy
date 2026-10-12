# claims in BoundBox.md and translate.md
a = np.array([0.4256, -0.4256, 0.7986])
rp = Cylinder(5, 10).rotate(Axis((0, 0, 0), (1, 1, 0)), 37)
ax = rp.faces().cylinders()[0].axis.direction
exp = [5 * abs(ax[i]) + 5 * math.sqrt(1 - ax[i] ** 2) for i in range(3)]
print("[21] rotated cylinder bbox max:", rp.bbox().max.to_tuple(), "analytic:", exp, "err", max(abs(rp.bbox().max[i] - exp[i]) for i in range(3)))
p = Box(10, 10, 10)
e = p.edges().parallel_to(Z)[0].translate(0, 0, 0.0)
try:
    p.fillet([e], 1)
    print("[21] fillet with translated edge: accepted")
except Exception as ex:
    print("[21] fillet with translated edge ->", type(ex).__name__, str(ex)[:150])
f = p.faces().top()[0].translate(0, 0, 0)
try:
    p.shell(1, openings=[f])
    print("[21] shell with translated face: accepted")
except Exception as ex:
    print("[21] shell with translated face ->", type(ex).__name__, str(ex)[:150])
e1 = p.edges().parallel_to(Z)[0].translate(1, 0, 0)
try:
    p.fillet([e1], 1)
    print("[21] fillet with edge moved by 1: accepted")
except Exception as ex:
    print("[21] fillet with edge moved by 1 ->", type(ex).__name__, str(ex)[:150])
# edges of the moved part feed the moved part
q = p.translate(50, 0, 0)
try:
    q.fillet(p.edges().parallel_to(Z), 1)
    print("[21] fillet q with edges of p: accepted")
except Exception as ex:
    print("[21] fillet q with edges of p ->", type(ex).__name__, str(ex)[:150])
