line = Sphere(10).parting_line(Z)
print(len(line), [e.geom_type for e in line[0].edges()], round(line[0].length, 6))   # 1 ['circle', 'circle'] 62.831853

lying = Cylinder(5, 20).rotate(Y, 90).parting_line(Z)[0]
print(round(lying.length, 6), sorted(round(e.center().y, 6) for e in lying.edges() if e._is_straight()))   # 71.415927 [-5.0, 5.0]

cup = Box(40, 30, 20) - Box(30, 20, 15, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 10)
rim = cup.parting_line(Z)
print(len(rim), rim[0].length, rim[0].bbox().max.z)   # 1 140.0 -10.0: walls without draft go with the top half

print([round(w.length, 4) for w in Torus(20, 5).parting_line(Z)])   # [157.0796, 94.2478]
