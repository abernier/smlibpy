s = surface([[(x, y, 5 + 0.01 * (x - 20) ** 2) for y in range(0, 31, 10)] for x in range(0, 41, 10)])
r = Box(10, 10, 30).translate(20, 15, 0) & s
print(type(r).__name__, r.volume, r.is_valid())   # Part 0.0 False
