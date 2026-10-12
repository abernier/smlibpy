# what raises
for kwargs in (dict(text="A", size=0), dict(text="A", size=-2), dict(text="", size=5), dict(text="   ", size=5),
               dict(text="A\tB", size=5), dict(text="A", size=5, line_spacing=0)):
    try:
        Text(**kwargs)
    except ValueError as e:
        print("[10]", kwargs, "-> ValueError:", e)
try:
    Text(42, 5)
except TypeError as e:
    print("[10] Text(42, 5) -> TypeError:", e)
try:
    Text("A", 5, path=Box(1, 1, 1))
except TypeError as e:
    print("[10] path=Box -> TypeError:", e)
