for args in [(0, 4, 10), (-1, 4, 10), (2, 4, 0), (2, 2, 10), (2, 1, 10)]:
    try:
        CounterSinkHole(*args)
        print("[15]", args, "accepted")
    except Exception as e:
        print("[15]", args, type(e).__name__, e)
