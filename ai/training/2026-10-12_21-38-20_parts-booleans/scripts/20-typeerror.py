a = Box(10, 10, 10)
for bad in [a.edges()[0], a.vertices()[0], Line((0, 0, 0), (1, 0, 0))]:
    try:
        a - bad
    except Exception as e:
        print("[20] a -", type(bad).__name__, "->", type(e).__name__, e)
