# Doc examples, copied verbatim from the docs listed below

# ---- FilletPolyline.md block 1
print('==== FilletPolyline.md block 1')
path = FilletPolyline((0, 0), (20, 0), (20, 10), (40, 10), radius=3)
frame = make_face(FilletPolyline((0, 0), (20, 0), (20, 10), (0, 10), radius=2, close=True))
print(frame.area)                                      # 200 - 4 * (4 - pi) = 196.566371
pipe = sweep(Circle(3), FilletPolyline((0, 0, 0), (0, 0, 30), (30, 0, 30), radius=8))
print("[21] path", path, "pipe", pipe.is_valid(), round(pipe.volume, 3))
# claim: bend radius below the profile radius fails or gives a bad body
try:
    bad = sweep(Circle(3), FilletPolyline((0, 0, 0), (0, 0, 30), (30, 0, 30), radius=2))
    print("[21] bend r 2 with profile r 3: valid", bad.is_valid(), "volume", round(bad.volume, 3), "pi*9*L", round(math.pi * 9 * FilletPolyline((0, 0, 0), (0, 0, 30), (30, 0, 30), radius=2).length, 3))
except Exception as ex:
    print("[21] bend r 2 with profile r 3 ->", type(ex).__name__, str(ex).splitlines()[0])
