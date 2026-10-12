# Inertia about another point from the tensor about the center (parallel axis theorem).
b = Box(40, 30, 20)
mp = b.mass_properties()
p = np.array([20.0, 15.0, -10.0])            # a corner
d = p - np.array(mp.center.to_tuple())
I_p = mp.inertia + mp.mass * (d.dot(d) * np.eye(3) - np.outer(d, d))
m = mp.mass
exp_xx = m * (30**2 + 20**2) / 3              # box about an edge through a corner, along x
print("[20] Ixx about corner:", round(I_p[0][0], 6), "formula", round(exp_xx, 6))
print("[20] Ixy about corner:", round(I_p[0][1], 6), "formula -m*dx*dy", round(-m * d[0] * d[1], 6))
