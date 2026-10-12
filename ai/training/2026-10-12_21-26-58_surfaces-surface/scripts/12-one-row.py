# One row only, and 2D points: z?
try:
    surface([[(0, 0, 0), (1, 0, 0), (2, 0, 0), (3, 0, 0)]])
except Exception as e:
    print("[12] one row:", type(e).__name__, e)
s = surface([[(10 * i, 10 * j) for i in range(4)] for j in range(4)])
print("[12] 2D points bbox:", s.bbox().min, s.bbox().max)
