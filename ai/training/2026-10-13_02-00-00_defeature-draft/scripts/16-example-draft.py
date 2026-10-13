core = RoundedRectangle(60, 40, 5).extrude(20, taper=3)
da = core.draft_analysis(Z, min_angle=1)
print(da)        # DraftAnalysis(direction=(0, 0, 1), min_angle=1: 9 positive, 0 insufficient, 0 vertical, 1 undercut)
wall = da.positive.filter(lambda f: f.geom_type == "plane" and f.center().z < 19).first
print(da.angles(wall))                            # (3.0..., 3.0...): the taper
print(core.draft_analysis(Z, min_angle=5).insufficient.__len__())   # 8 walls with less than 5 degrees

box = Box(40, 30, 20)
check = box.draft_analysis(Z)
print(len(check.vertical), len(check.undercut), check.ok)          # 4 1 False: the walls need draft
for fd in Sphere(10).draft_analysis(Z):
    print(fd.kind, round(fd.min_angle, 6), round(fd.max_angle, 6))  # undercut -90.0 90.0
