# Part.remove_fillets: errors and edge cases
box = Box(40, 30, 20)
v4 = box.fillet(box.edges().parallel_to(Z), 3)
for call in ("v4.remove_fillets(v4.faces().top())", "v4.remove_fillets([])", "box.remove_fillets() is box",
             "v4.remove_fillets(max_radius=0)", "v4.remove_fillets(max_radius=2) is v4",
             "v4.remove_fillets(Box(5, 5, 5).fillet(Box(5, 5, 5).edges().parallel_to(Z), 1).faces().fillets())"):
    try:
        print("[06]", call, "->", eval(call))
    except Exception as e:
        print("[06]", call, "->", type(e).__name__ + ":", e)
from smlibpy import defeature
print("[06] guard:", defeature.GUARD_SECONDS, "s; tangency:", defeature.TANGENCY, "degrees")
