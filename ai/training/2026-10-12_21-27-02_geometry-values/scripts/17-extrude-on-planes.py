# which way does an extrusion from each named plane grow?
for n in ["XY", "XZ", "YZ", "front", "back", "left", "right", "bottom"]:
    pr = Rectangle(10, 10).on(getattr(Plane, n)).extrude(5)
    print(f"[17] extrude on {n:6s} bbox", pr.bbox())
