res = {}
for name, base in [("rect", Rectangle(30, 30)), ("tri", RegularPolygon(10, 3)), ("square-as-polyline-from-(15,-15)", Polyline((15, -15), (15, 15), (-15, 15), (-15, -15), close=True))]:
    row = []
    for a in range(0, 360, 15):
        try:
            p = loft([base, Circle(8 if name == "tri" else 12).rotate(Z, a).translate(0, 0, 20)])
            row.append((a, round(p.section(Plane.XY.offset(10)).area, 1)))
        except Exception as e:
            row.append((a, str(e)[:30]))
    res[name] = row
    best = max((r for r in row if isinstance(r[1], float)), key=lambda r: r[1])
    print(f"[{name}] best seam angle {best[0]} area {best[1]}; at 0: {row[0][1]}")
    print("   ", row)
filewrite(res, "scan")
