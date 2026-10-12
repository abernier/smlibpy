import sys
a = Box(10, 10, 10)
empty = a - Box(20, 20, 20)
print("[07] made empty", flush=True)
print("[07] faces:", len(empty.faces()), flush=True)
print("[07] volume:", empty.volume, flush=True)
print("[07] valid:", empty.is_valid(), flush=True)
print("[07] repr:", repr(empty), flush=True)
