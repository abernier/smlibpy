def frustum(a0, a1, h):
    return h/3*(a0+a1+math.sqrt(a0*a1))
def rep(tag, p, mid):
    print(f"[{tag}] valid={p.is_valid()} vol={p.volume:.3f} area@mid={p.section(Plane.XY.offset(mid)).area:.3f} faces={len(p.faces())}")

t0 = loft([Rectangle(30, 30), Circle(12).translate(0, 0, 25)])
rep("rect->circle as is", t0, 12.5)
t1 = loft([Rectangle(30, 30), Circle(12).rotate(Z, 135).translate(0, 0, 25)])
rep("rect->circle seam at 135", t1, 12.5)
print("mean area estimate", (900 + math.pi*144)/2)
# hexagon drawn as a polyline that starts at 120 deg (near the rectangle's start corner at 135)
hexagon = Polyline(*[(10*math.cos(math.radians(120 + 60*i)), 10*math.sin(math.radians(120 + 60*i)), 20) for i in range(6)], close=True)
h0 = loft([Rectangle(20, 20), RegularPolygon(10, 6).translate(0, 0, 20)], ruled=True)
rep("rect->hex as is", h0, 10)
h1 = loft([Rectangle(20, 20), hexagon], ruled=True)
rep("rect->hex aligned", h1, 10)
print("frustum estimate", frustum(400, 259.81, 20))
# triangle -> circle
c0 = loft([RegularPolygon(10, 3), Circle(8).translate(0, 0, 20)])
rep("tri->circle as is", c0, 10)
c1 = loft([RegularPolygon(10, 3), Circle(8).rotate(Z, 240).translate(0, 0, 20)])
rep("tri->circle seam at 240", c1, 10)
# rounded rectangle starts at (11,-10): angle -42
r1 = loft([RoundedRectangle(30, 20, 4), Circle(8).rotate(Z, math.degrees(math.atan2(-10, 11))).translate(0, 0, 20)])
rep("rrect->circle aligned", r1, 10)
snapshot("aligned", t1, h1.translate(40, 0, 0), c1.translate(80, 0, 0), r1.translate(120, 0, 0))
