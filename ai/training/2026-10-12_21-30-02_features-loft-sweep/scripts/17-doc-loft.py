vase = loft([Circle(15), Circle(25).translate(0, 0, 30), Circle(10).translate(0, 0, 60)])
print(vase.is_valid(), vase.bbox().max.x)               # True 25.047: overshoots the 25 section

cone = loft([Circle(10), Circle(5).translate(0, 0, 20)])  # two sections: straight sides
print(round(cone.volume, 3))                            # 3665.192 = exact frustum

# square to circle: turn the circle so its seam suits the square (45 for a centered Rectangle)
duct = loft([Rectangle(30, 30), Circle(12).rotate(Z, 45).translate(0, 0, 25)])
print(round(duct.section(Plane.XY.offset(12.5)).area, 1))  # 660.2 (unturned circle: 565.9)

# square to hexagon: draw the hexagon as a closed Polyline that starts near the square's start
hexagon = Polyline(*[(10 * math.cos(math.radians(120 + 60 * i)), 10 * math.sin(math.radians(120 + 60 * i)), 20)
                     for i in range(6)], close=True)
prism = loft([Rectangle(20, 20), hexagon], ruled=True)
print(round(prism.volume, 1))                           # 6512.7 (RegularPolygon(10, 6): 2284.7, pinched)

# pick the best seam angle by measuring the middle section
base = Rectangle(30, 30)
best = max(range(0, 360, 15), key=lambda a: loft([base, Circle(12).rotate(Z, a).translate(0, 0, 20)]).section(Plane.XY.offset(10)).area)
print(best)                                             # 45

sheet = loft([Line((0, 0, 0), (10, 0, 0)), Line((0, 10, 5), (10, 10, 5))])  # open curves -> Shell
print(type(sheet).__name__, round(sheet.area, 3))       # Shell 111.803
