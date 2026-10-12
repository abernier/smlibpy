L = Box(20, 10, 10, align=Align.MIN) + Box(10, 10, 20, align=Align.MIN)
print(len(L.edges().convex()), len(L.edges().concave()))   # 17 1
inner = L.edges().concave().one()
print(inner.convexity, inner.is_convex())                  # concave False
L2 = L.fillet(L.edges().concave(), 2)                      # adds material in the corner
print(round(L2.volume - L.volume, 3), len(L2.edges().smooth()))   # 8.584 2
