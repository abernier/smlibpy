# limits: radius too small, full turns, overlapping legs, shells
for label, make in [("radius 4", lambda: Box(100, 10, 10).bend(90, radius=4)),
                    ("whole bar 300 deg", lambda: Box(10, 10, 10).bend(300)),
                    ("360", lambda: Box(100, 10, 10).bend(360)),
                    ("radius, start and end", lambda: Box(100, 10, 10).bend(90, radius=10, start=0, end=5)),
                    ("outside the part", lambda: Box(100, 10, 10).bend(90, radius=10, start=60))]:
    try:
        make()
        print("[09]", label, "-> no error")
    except Exception as e:
        print("[09]", label, "->", type(e).__name__ + ":", e)
over = Box(200, 10, 10).bend(270, radius=10)
print("[09] 270 with long legs: valid", over.is_valid(), "volume", round(over.mass_properties(accuracy=1e-10).volume, 3), "(legs cross!)")
sheet = bend(Rectangle(100, 20), 120)
print("[09] sketch -> ", type(sheet).__name__, "area", round(sheet.area, 6))
snapshot("overlap", over, view="front")
