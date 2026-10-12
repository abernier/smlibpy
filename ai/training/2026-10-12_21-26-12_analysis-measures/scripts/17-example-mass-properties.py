shaft = Cylinder(10, 100)
mp = shaft.mass_properties(density=7.85e-3)     # steel, g/mm^3 -> grams
m = 7.85e-3 * math.pi * 10**2 * 100
print(round(mp.mass, 3), round(m, 3))           # 246.615 246.615
print(mp.center)                                # about (0, 0, 0), off by up to 3e-6
izz = mp.inertia[2][2]                          # g*mm^2, about the center of mass
print(abs(izz - m * 10**2 / 2) / izz < 1e-6)    # True
print(mp.principal_moments)                     # ascending: about (12330.8, 211678, 211678)

precise = shaft.mass_properties(accuracy=1e-10)
print(precise.volume)                           # 31415.9265...
