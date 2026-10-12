blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
slots = Box(31, 1, 10).translate(35, 10.5, 0) + Box(31, 1, 10).translate(35, -10.5, 0)   # reliefs x 19.5..50.5
tab = bend(blank - slots, Line((25, -10, 2), (25, 10, 2)), 90, radius=2, partial=True)
print(tab.is_valid(), tab.bbox().max, tab.bends())
