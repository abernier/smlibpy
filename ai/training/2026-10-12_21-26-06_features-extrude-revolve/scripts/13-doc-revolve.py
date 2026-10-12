profile = Polygon((5, 0), (30, 0), (30, 3), (26, 6), (26, 10), (30, 13), (30, 16), (5, 16))
pulley = profile.on(Plane.front).revolve(Z)             # x = radius, y = height
print(pulley.is_valid(), round(pulley.volume, 3))       # True 39006.014

quarter = profile.on(Plane.front).revolve(Z, 90)        # from +X towards +Y
other = profile.on(Plane.front).revolve(Axis((0, 0, 0), (0, 0, -1)), 90)  # from +X towards -Y

tube = Rectangle(10, 20).translate(15, 0).on(Plane.front).revolve(Z)
print(round(tube.volume, 3))                            # 18849.557 = pi*(20^2-10^2)*20

donut = (Circle(5) - Circle(2)).translate(20, 0).on(Plane.front).revolve(Z)
print(round(donut.volume, 3))                           # 8290.468

wrong = Rectangle(10, 20).translate(15, 0).on(Plane.front).revolve()   # default axis: through the sketch origin (15, 0)!
print(wrong.is_valid(), round(wrong.volume, 3))         # True, but the volume is nonsense

dome = revolve(CenterArc((0, 0), 10, -90, 180, plane=Plane.front), Z)  # open curve -> Shell
print(type(dome).__name__, round(dome.area, 2), quarter.bbox().min.to_tuple(), other.bbox().max.to_tuple())
