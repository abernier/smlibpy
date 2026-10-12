# recipe: what radius and K-factor change
t = 2
for r in (1, 2, 4, 8):
    print(f"[15] R {r}: BA {bend_allowance(90, radius=r, thickness=t):.4f}  BD {bend_deduction(90, radius=r, thickness=t):.4f}"
          f"  blank for 50+30: {developed_length(50, 30, radius=r, thickness=t):.4f}")
for k in (0.33, 0.4, 0.44, 0.5):
    print(f"[15] K {k}: BA {bend_allowance(90, radius=2, thickness=t, k_factor=k):.4f}"
          f"  blank for 50+30: {developed_length(50, 30, radius=2, thickness=t, k_factor=k):.4f}")
# measured K: bend a test strip, measure the legs, solve the K-factor the shop's brake gives
legs = (50.0, 30.0)     # outside legs of a test bend of a 76.5 strip (made-up measurement)
strip = 76.5
setback = 2 * (2 + t)   # 2 * (R + t) * tan(45)
k = ((strip - sum(legs) + setback) / (math.pi / 2) - 2) / t
print(f"[15] K from the test strip: {k:.4f}; check: {developed_length(*legs, radius=2, thickness=t, k_factor=k):.4f}")
