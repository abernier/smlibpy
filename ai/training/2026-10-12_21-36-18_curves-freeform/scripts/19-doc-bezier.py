# Doc examples, copied verbatim from the docs listed below

# ---- Bezier.md block 1
print('==== Bezier.md block 1')
arch = Bezier((0, 0), (10, 20), (20, 0))                 # peak (10, 10)
s_curve = Bezier((0, 0), (0, 10), (20, 10), (20, 0))     # max y 7.5
quarter = Bezier((10, 0), (10, 10), (0, 10), weights=[1, math.sqrt(2) / 2, 1])
print(arch.point_at(0.5), round(quarter.length, 9))      # (10, 10, 0) 15.707963268
