part = Box(40, 30, 20) - Cylinder(6, 30)
print(len(part.edges().filter_by(Z)))                        # 4  (= parallel_to(Z))
print(len(part.edges().filter_by("circle")))                 # 2  (= of_type("circle"))
print(len(part.faces().filter_by(lambda f: f.area > 700)))   # 5  (= filter(...))
long_x = part.edges().filter(lambda e: e.geom_type == "line" and e.length > 35)
print(len(long_x))                                           # 4
