a = Box(10, 10, 10)
print("[09] start: a + Rectangle(10, 10).on(Plane.front).revolve()", flush=True)
r = a + Rectangle(10, 10).on(Plane.front).revolve()
print("[09] ->", r, flush=True)
if r is not None:
    print("[09] valid", r.is_valid(), "vol", r.volume, flush=True)
