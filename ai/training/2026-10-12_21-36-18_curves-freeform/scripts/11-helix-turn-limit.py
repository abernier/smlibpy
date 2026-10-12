# The turn limit of Helix, and a workaround for long helices (several helices in a wire)
last_ok = None
for turns in range(30, 51):
    try:
        Helix(1, turns, 5)
        last_ok = turns
    except Exception as ex:
        print(f"[11] {turns} turns ->", str(ex).splitlines()[0])
        break
print("[11] last ok turns:", last_ok)
for turns in (40.5, 45, 48, 49.9):
    try:
        Helix(1, turns, 5)
        print(f"[11] {turns} turns ok")
    except Exception as ex:
        print(f"[11] {turns} turns ->", str(ex).splitlines()[0])
# workaround: two helices of 30 turns chained (the second starts where the first ends: whole turns)
a = Helix(1, 30, 5)
b = Helix(1, 30, 5, center=(0, 0, 30))
w = Wire([a, b])
print("[11] chained:", w, "start", w.start, "end", w.end, "joint angle", a.tangent_at(1).angle_to(b.tangent_at(0)))
