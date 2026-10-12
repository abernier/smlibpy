# A test strip of 76.5 bent 90 degrees (R 2, t 2) measures 50 and 30 outside: solve for K.
strip, legs, r, t = 76.5, (50.0, 30.0), 2.0, 2.0
allowance = strip - sum(legs) + 2 * (r + t)          # what the bend took: BA = blank - legs + 2 setbacks
k = (allowance / (math.pi / 2) - r) / t
print(round(k, 4), round(developed_length(*legs, radius=r, thickness=t, k_factor=k), 6))   # 0.4324 76.5
