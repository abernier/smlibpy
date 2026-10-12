a = Box(10, 10, 10)
empty = a - Box(20, 20, 20)
print("[08] start: a & empty", flush=True)
r = a & empty
print("[08] a & empty ->", r, "valid", r.is_valid(), flush=True)
