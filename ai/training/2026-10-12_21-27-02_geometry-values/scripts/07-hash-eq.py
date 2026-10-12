# Vector/Axis: equal objects with different hashes
a, b = Vector(1.0000004, 0, 0), Vector(1.0000006, 0, 0)
print("[07] a==b:", a == b, "hash equal:", hash(a) == hash(b), "set size:", len({a, b}))
ax1, ax2 = Axis((0, 0, 0), (0, 0, 1)), Axis((0, 0, 5), (0, 0, 1))
print("[07] ax1==ax2:", ax1 == ax2, "hash equal:", hash(ax1) == hash(ax2), "set size:", len({ax1, ax2}))
print("[07] Vector == non-vector:", Vector(1, 2, 3) == "abc", Vector(1, 2, 3) == None)
