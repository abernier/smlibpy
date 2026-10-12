box = Box(40, 30, 10)
try:
    box.shell(10, box.faces().top())
except Exception as e:
    print(type(e).__name__, e, flush=True)
