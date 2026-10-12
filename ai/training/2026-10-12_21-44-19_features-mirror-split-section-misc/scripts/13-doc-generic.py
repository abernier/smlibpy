def check(tag, part, expected=None):
    ok = part.is_valid() and part.volume > 0 and len(part.solids()) == 1
    if expected is not None:
        ok = ok and abs(part.volume - expected) <= 1e-6 * expected
    print(tag, ok, round(part.volume, 3), part.bbox().size.to_tuple())
    return ok

body = Box(60, 40, 20)
check("box", body, 60 * 40 * 20)
body = body.fillet(body.edges().parallel_to(Z), 6)
check("corners", body, 48000 - 4 * (36 - 9 * math.pi) * 20)
body = body.shell(2, body.faces().planar().top())
check("shell", body)
body -= Cylinder(4, 10).translate(0, 0, -10)
check("hole", body)
