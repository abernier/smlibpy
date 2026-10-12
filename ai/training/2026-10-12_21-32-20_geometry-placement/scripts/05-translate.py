# translate on every shape type
b = Box(2, 2, 2)
print("[05] (x,y,z):", b.translate(1, 2, 3).center())
print("[05] tuple:", b.translate((1, 2, 3)).center(), "2D tuple:", b.translate((1, 2)).center(), "Vector:", b.translate(Vector(1, 2, 3)).center())
print("[05] kw z=5:", b.translate(z=5).center(), "x only:", b.translate(4).center())
print("[05] np array:", b.translate(np.array([1.0, 2.0, 3.0])).center())
try:
    print("[05] list:", b.translate([1, 2, 3]).center())
except Exception as e:
    print("[05] list ->", type(e).__name__, e)
try:
    print("[05] tuple + y:", b.translate((1, 2, 3), 5).center())
except Exception as e:
    print("[05] tuple+y ->", type(e).__name__, e)
s = Rectangle(4, 2).translate(10, 0)
print("[05] sketch:", type(s).__name__, s.center(), "plane origin", s.plane.origin)
s3 = Rectangle(4, 2).translate(0, 0, 7)
print("[05] sketch up z:", s3.bbox(), "plane", s3.plane, "extrude bbox", s3.extrude(2).bbox())
f = b.faces().top()[0]
ft = f.translate(0, 0, 10)
print("[05] face:", type(ft).__name__, ft.center(), "original", f.center())
e = b.edges()[0]
et = e.translate(10, 0, 0)
print("[05] edge:", type(et).__name__, e.center(), "->", et.center())
w = f.outer_wire().translate(0, 0, 10)
print("[05] wire:", type(w).__name__, w.center())
v = b.vertices()[0].translate(1, 1, 1)
print("[05] vertex:", type(v).__name__, v)
ln = Line((0, 0), (5, 0)).translate(0, 3)
print("[05] Line:", ln)
sh = Box(2, 2, 2).faces().top()[0].to_shell().translate(0, 0, 1)
print("[05] shell:", type(sh).__name__, sh.center())
sl = (GridLocations(10, 10, 2, 1) * Box(1, 1, 1)).translate(0, 0, 5)
print("[05] ShapeList:", type(sl).__name__, [x.center() for x in sl])
fl = b.faces().translate(0, 0, 1)
print("[05] faces().translate:", type(fl).__name__, len(fl), fl.bbox())
pl = [Box(1, 1, 1)]
try:
    pl.translate(1, 0, 0)
except Exception as e:
    print("[05] python list ->", type(e).__name__, e)
# named / color kept?
nb = Box(1, 1, 1).named("a").colored("red").translate(1, 0, 0)
print("[05] name/color kept:", nb.name, nb.color)
# topology kept
print("[05] faces count:", len(b.faces()), len(b.translate(5, 5, 5).faces()))
