def rep(tag, p):
    b = p.bbox()
    print(f"[{tag}] {type(p).__name__} valid={p.is_valid()} vol={p.volume:.4f} min={tuple(round(v,3) for v in b.min.to_tuple())} max={tuple(round(v,3) for v in b.max.to_tuple())} faces={len(p.faces())}")

def frustum(a0, a1, h):
    return h/3*(a0+a1+math.sqrt(a0*a1))
# similar sections -> exact frustum expected for a ruled loft
sq = loft([Rectangle(20, 20), Rectangle(10, 10).translate(0, 0, 30)])
rep("square frustum", sq)
print("frustum", frustum(400, 100, 30))
cone = loft([Circle(10), Circle(5).translate(0, 0, 20)])
rep("cone frustum", cone)
print("cone", math.pi*20/3*(100+25+50))
transition = loft([Rectangle(30, 30), Circle(12).translate(0, 0, 25)])
rep("rect->circle", transition)
# 3 sections smooth vs ruled vs smooth=False
secs = [Circle(15), Circle(25).translate(0, 0, 30), Circle(10).translate(0, 0, 60)]
vs = loft(secs)
rep("vase smooth", vs)
vr = loft(secs, ruled=True)
rep("vase ruled", vr)
print("ruled expected", math.pi*30/3*(225+625+375) + math.pi*30/3*(625+100+250))
vq = loft(secs, smooth=False)
rep("vase quadratic", vq)
# radius at mid heights
for tag, p in (("smooth", vs), ("ruled", vr), ("quad", vq)):
    s = p.section(Plane.XY.offset(15))
    print(f"[{tag}] r at z=15:", round(math.sqrt(s.area/math.pi), 4), " z=30:", round(math.sqrt(p.section(Plane.XY.offset(30)).area/math.pi), 4))
snapshot("vases", vs.translate(-60, 0, 0), vr, vq.translate(60, 0, 0), view="front")
snapshot("transition", transition)
