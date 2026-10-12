# revolve the other way: flip the axis instead of a negative angle
prof = Rectangle(10, 10).translate(15, 0).on(Plane.front)
p = prof.revolve(Axis((0, 0, 0), (0, 0, -1)), 90)
b = p.bbox()
print("[-Z axis 90] vol", round(p.volume, 4), b.min.to_tuple(), b.max.to_tuple())
# a pulley: half profile drawn in XY with x = radius, y = height, placed on Plane.front, about Z
profile = Polygon((5, 0), (30, 0), (30, 3), (26, 6), (26, 10), (30, 13), (30, 16), (5, 16))
pulley = profile.on(Plane.front).revolve(Z)
pulley -= Cylinder(5, 40)  # nothing to cut: the bore is already open (x starts at 5)
print("[pulley] valid", pulley.is_valid(), "vol", round(pulley.volume, 3), "pappus", round(profile.area*2*math.pi*profile.center().x, 3))
bb = pulley.bbox(); print("[pulley] bbox", bb.min.to_tuple(), bb.max.to_tuple(), "faces", len(pulley.faces()))
pulley = pulley.fillet(pulley.edges().circles().filter(lambda e: abs(e.radius - 30) < 1e-6), 1)
print("[pulley fillet] valid", pulley.is_valid(), "vol", round(pulley.volume, 3))
snapshot("pulley", pulley, view="sheet")
