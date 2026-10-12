bar = Box(100, 10, 10)
p = (49, 0, 6)                                         # 1 mm above the top face
print(bar.faces().nearest(p).center())                 # (50, 0, 0): the end face, center closest
true = bar.faces().sort_by(lambda f: f.distance_to(p)).first
print(true.center())                                   # (0, 0, 5): the top face, 1 mm away
right_half = BoundBox((0, -100, -100), (100, 100, 100))
print(len(bar.faces().within(right_half)))             # 1: only the end face lies fully inside
w = Wedge(20, 20, 10)
print(len(w.faces().facing(Z)), len(w.faces().facing(Z, max_angle=60)))   # 0 1
