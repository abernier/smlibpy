def check(part, expected_volume, rel=1e-5):
    assert part.is_valid(), "not a closed manifold solid"
    assert len(part.solids()) == 1, f"{len(part.solids())} solids"
    v = part.volume
    assert v > 0 and abs(v - expected_volume) <= rel * expected_volume, f"volume {v}"
    return part.info()

print(check(Box(10, 20, 30), 6000))
# {'type': 'Part', 'faces': 6, 'edges': 12, 'vertices': 8, 'bbox': ((-5.0, -10.0, -15.0), (5.0, 10.0, 15.0))}

bad = Rectangle(10, 10).revolve(Axis((0, 0, 0), (0, 1, 0)))   # profile crosses the axis
print(bad.is_valid(), bad.volume)                              # True, about 0: is_valid misses it

edge_touch = Box(10, 10, 10) + Box(10, 10, 10).translate(10, 10, 0)
print(edge_touch.is_valid())                                   # False: the boxes share only an edge
