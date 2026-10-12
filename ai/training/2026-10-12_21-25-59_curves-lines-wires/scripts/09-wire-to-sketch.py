# From wires to sketches: make_face with holes, to_sketch, plane of the sketch, extrude
outline = Polyline((0, 0), (50, 0), (50, 10), (20, 30), (0, 30), close=True)
bolt_hole = Wire([CenterArc((12, 12), 4, 0, 360)])
bracket = make_face(outline, bolt_hole)
print("[09] bracket area:", round(bracket.area, 6), "expected", round(50 * 10 + 20 * 20 + 0.5 * 30 * 20 - math.pi * 16, 6))
print("[09] faces/holes:", len(bracket.faces()), len(bracket.faces()[0].inner_wires()))
part = bracket.extrude(5)
print("[09] extrude: volume", round(part.volume, 4), "bbox", part.bbox().min, part.bbox().max)
# hole given as an Edge, not a Wire
b2 = make_face(outline, CenterArc((12, 12), 4, 0, 360))
print("[09] hole as edge area:", round(b2.area, 6))
# a single closed edge as outline
c = make_face(CenterArc((0, 0), 10, 0, 360))
print("[09] circle edge face area:", round(c.area, 6), "expected", round(math.pi * 100, 6))
# clockwise outline gives the same sketch, normal +Z
cw = outline.reversed()
s = make_face(cw)
print("[09] clockwise outline area", round(s.area, 6), "plane z", s.plane.z_dir, "extrude(5) zmax", s.extrude(5).bbox().max.z)
# wire drawn on XZ (front)
front = Polyline((0, 0), (20, 0), (20, 10), (0, 10), close=True).on(Plane.XZ)
print("[09] wire on XZ:", front.bbox().min, front.bbox().max)
sf = front.to_sketch()
print("[09] sketch on XZ plane: origin", sf.plane.origin, "z", sf.plane.z_dir, "x", sf.plane.x_dir)
pf = sf.extrude(5)
print("[09] extrude of XZ sketch bbox:", pf.bbox().min, pf.bbox().max)
# same rectangle, opposite direction of travel
front_r = front.reversed()
sfr = front_r.to_sketch()
print("[09] reversed XZ: z", sfr.plane.z_dir, "extrude bbox", sfr.extrude(5).bbox().min, sfr.extrude(5).bbox().max)
# wire on YZ
side = Polyline((0, 0), (20, 0), (20, 10), (0, 10), close=True).on(Plane.YZ).to_sketch()
print("[09] YZ sketch z:", side.plane.z_dir)
# a wire on a tilted plane
tilt = Polyline((0, 0), (20, 0), (20, 10), (0, 10), close=True).on(Plane.XY.rotated(x=30))
st = tilt.to_sketch()
print("[09] tilted z:", st.plane.z_dir)
# non-planar closed wire
np_w = Polyline((0, 0, 0), (10, 0, 0), (10, 10, 5), (0, 10, 0), close=True)
try:
    make_face(np_w)
except Exception as ex:
    print("[09] non-planar ->", type(ex).__name__, ex)
# self-crossing (figure eight)
eight = Polyline((0, 0), (10, 10), (10, 0), (0, 10), close=True)
try:
    e8 = make_face(eight)
    print("[09] figure eight area:", e8.area, len(e8.faces()))
except Exception as ex:
    print("[09] figure eight ->", type(ex).__name__, ex)
# a hole that crosses the outline
try:
    hx = make_face(outline, Wire([CenterArc((0, 0), 5, 0, 360)]))
    print("[09] hole crossing outline area:", round(hx.area, 4), "expected", round(1400 - 25 * math.pi / 4, 4))
except Exception as ex:
    print("[09] hole crossing outline ->", type(ex).__name__, ex)
# a hole outside the outline
hx2 = make_face(outline, Wire([CenterArc((100, 0), 5, 0, 360)]))
print("[09] hole outside: area", round(hx2.area, 4))
snapshot("bracket", part, view="iso")
snapshot("front", pf, view="sheet")
