# partial=True: a tab cut free by two relief slots
blank = Box(100, 40, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
try:
    bend(blank, Line((25, -10, 2), (25, 10, 2)), 90, radius=2, partial=True)
except ModelingError as e:
    print("[04] no reliefs:", e)
slots = Box(31, 1, 10).translate(35, 10.5, 0) + Box(31, 1, 10).translate(35, -10.5, 0)
slotted = blank - slots
tab = bend(slotted, Line((25, -10, 2), (25, 10, 2)), 90, radius=2, partial=True)
print("[04] tab valid:", tab.is_valid(), "bbox:", tab.bbox(), "bends:", tab.bends())
print("[04] unfold volume:", round(unfold(tab).volume, 9), "slotted:", round(slotted.volume, 9))
try:
    bend(blank, Axis((20, 0, 2), (0, 1, 0)), 90, radius=2, partial=True)
except ValueError as e:
    print("[04] axis with partial:", e)
snapshot("tab", tab, view="iso")
