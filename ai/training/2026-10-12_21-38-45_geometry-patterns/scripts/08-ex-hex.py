flats, wall = 8, 1.5
cells = HexLocations(flats + wall, 6, 5) * RegularPolygon(flats / 2, 6, inscribed=True, rotation=30)
plate = Box(70, 50, 4) - [c.extrude(10).translate(0, 0, -5) for c in cells]
print(len(cells), plate.is_valid())
print(round(cells[1].bbox().min.x - cells[0].bbox().max.x, 4))   # 1.5: the wall

pts = HexLocations(10, 3, 2).points
print([tuple(round(c, 3) for c in p)[:2] for p in pts])   # rows 8.66 apart, odd rows shifted 5
