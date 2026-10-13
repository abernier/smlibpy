# Part.draft_analysis: groups and angles
box = Box(40, 30, 20)
da = box.draft_analysis(Z)
print("[08] box:", da)
for fd in da:
    print("[08]   ", fd.kind, round(fd.min_angle, 9), round(fd.max_angle, 9), fd.face.center().to_tuple())
print("[08] ok:", da.ok, "| groups are ShapeLists:", type(da.vertical).__name__, len(da.vertical))
print("[08] angles(top):", da.angles(box.faces().top()[0]))
core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)
for m in (1, 3, 5):
    print(f"[08] tapered 3 deg, min_angle={m}:", core.draft_analysis(Z, min_angle=m))
walls = [fd for fd in core.draft_analysis(Z) if abs(fd.min_angle - 3) < 1e-6]
print("[08] tapered walls:", len(walls), [round(fd.min_angle, 12) for fd in walls][:3])
print("[08] -Z:", core.draft_analysis(-Z))
print("[08] side pull X:", box.draft_analysis(X))
print("[08] Axis or tuple:", box.draft_analysis((0, 0, 5)).positive[0].center().z, box.draft_analysis(Axis((0, 0, 0), (0, 0, 1))).positive[0].center().z)
tilted = box.rotate(X, 2)
print("[08] box tilted 2 deg about X:", tilted.draft_analysis(Z))
for fd in tilted.draft_analysis(Z):
    print("[08]   ", fd.kind, round(fd.min_angle, 9), round(fd.max_angle, 9))
for call in ("box.draft_analysis((0, 0, 0))", "box.draft_analysis(Z, min_angle=90)", "box.draft_analysis(Z, min_angle=-1)", "da.angles(Box(1,1,1).faces()[0])"):
    try:
        eval(call)
    except Exception as e:
        print("[08]", call, "->", type(e).__name__ + ":", e)
