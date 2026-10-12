# draft
core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)  # every side wall drafted 3 degrees
blk = Box(60, 40, 20)
blk -= Rectangle(30, 20).on(blk.faces().top()).extrude(-10, taper=5)  # pocket 30x20 at the top, narrower at the bottom

# to_nurbs
part = Box(40, 30, 20) - Cylinder(8, 30)
n = part.to_nurbs()
print(sorted({f.geom_type for f in n.faces()}), len(n.edges().circles()))   # ['bspline'] 0
print(abs(n.volume / part.volume - 1) < 1e-6, round(n.volume - part.volume, 4))  # True, a few thousandths

# heal
fixed = part.heal()                                     # same volume, same faces on clean parts
print(fixed.is_valid(), round(fixed.volume, 3))         # True 19978.761
