part = Box(40, 30, 20) - Cylinder(8, 30)
fixed = part.heal()                                     # same volume, same faces on clean parts
print(fixed.is_valid(), round(fixed.volume, 3))         # True 19978.761
