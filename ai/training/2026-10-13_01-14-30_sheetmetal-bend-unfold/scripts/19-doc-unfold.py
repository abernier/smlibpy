blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
u = bend(blank, Axis((-30, 0, 2), (0, 1, 0)), 90, radius=2)
u = bend(u, Axis((30, 0, 2), (0, 1, 0)), 90, radius=2)
flat = unfold(u)                                          # the base stays where it is
print(flat.bbox(), round(flat.volume, 9))
side = u.faces().filter(lambda f: f.geom_type == "plane").sort_by(X).first   # outside of the -X flange
print(unfold(u, fixed=side).bbox())                       # the flat now stands in that face's plane
