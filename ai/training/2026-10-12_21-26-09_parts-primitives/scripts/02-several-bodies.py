a = Box(10, 10, 10)
b = Box(10, 10, 10).translate(30, 0, 0)
two = a + b
print("[02] repr:", two)
print("[02] solids:", len(two.solids()), "valid:", two.is_valid())
print("[02] volume:", round(two.volume, 6), "center:", two.center())
print("[02] info:", two.info())
for i, s in enumerate(two.solids()):
    print("[02] solid", i, round(s.volume, 3), s.bbox().min, s.bbox().max)
total = sum([Box(2, 2, 2).translate(i * 5, 0, 0) for i in range(4)])
print("[02] sum of 4 boxes:", total, "solids:", len(total.solids()))
named = two.named("pair").colored("orange")
print("[02] solids keep name/color:", [(s.name, s.color) for s in named.solids()])
# cut splits one body into two
bar = Box(40, 10, 10) - Box(4, 20, 20)
print("[02] split bar:", bar, "solids:", len(bar.solids()), "valid:", bar.is_valid())
# a solid nested in a cavity (shell inside): box minus inner box gives a hollow solid
hollow = Box(20, 20, 20) - Box(10, 10, 10)
print("[02] hollow:", hollow, "solids:", len(hollow.solids()), "faces:", len(hollow.faces()))
inner = hollow + Box(4, 4, 4)
print("[02] body in cavity:", inner, "solids:", len(inner.solids()), "valid:", inner.is_valid())
snapshot("two", two, view="iso")
snapshot("bar", bar, view="sheet")
