pts = [[(x*10, y*10, 3*math.sin(x*0.8)*math.cos(y*0.6)) for x in range(4)] for y in range(4)]
s = surface(pts)
print("[surface 4x4] area", round(s.area, 3), "normal at center", tuple(round(v, 3) for v in s.faces()[0].normal_at(s.faces()[0].center()).to_tuple()))
for t in (1, -1, 3):
    p = s.thicken(t)
    print(f"[thicken {t}] valid={p.is_valid()} vol={p.volume:.4f} area*t={s.area*abs(t):.4f}")
try:
    s3 = surface([[(0, 0, 0), (10, 0, 2), (20, 0, 0)], [(0, 10, 2), (10, 10, 5), (20, 10, 2)], [(0, 20, 0), (10, 20, 2), (20, 20, 0)]], interpolate=False)
    print("[3x3 control points] area", round(s3.area, 3), "thicken 1 vol", round(s3.thicken(1).volume, 4))
except Exception as e:
    print(f"[3x3] {type(e).__name__}: {e}")
snapshot("ff", s.thicken(1))
