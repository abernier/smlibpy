import os
OUT = "ai/training/2026-10-12_21-26-31_files-exact/files"

part = (Box(60, 40, 8) - Cylinder(4, 10)).named("bracket").colored("steelblue")
part = part.fillet(part.edges().parallel_to(Z), 5)
p = os.path.join(OUT, "08-bracket.smb")
save(part, p)
back = load(p)
print("[08] type:", type(back).__name__, "valid", back.is_valid())
print("[08] volume exact:", part.volume == back.volume, part.volume - back.volume)
print("[08] faces/edges:", len(part.faces()), len(back.faces()), len(part.edges()), len(back.edges()))
print("[08] name/color:", back.name, back.color)
print("[08] size ascii:", os.path.getsize(p), "head:", open(p, "rb").read(60))
pb = os.path.join(OUT, "08-bracket-bin.smb")
save(part, pb, ascii=False)
back_b = load(pb)
print("[08] binary size:", os.path.getsize(pb), "volume exact:", back_b.volume == part.volume, "head:", open(pb, "rb").read(20))
# exactness of control points: a loft / spline surface
lf = loft([Circle(10), Rectangle(15, 15).translate(0, 0, 20)])
save(lf, os.path.join(OUT, "08-loft.smb"))
lb = load(os.path.join(OUT, "08-loft.smb"))
ls = os.path.join(OUT, "08-loft.step"); export_step(lf, ls)
lstep = import_step(ls)
print("[08] loft volume orig/smb/step:", lf.volume, lb.volume, lstep.volume)
pts = [lf.faces()[i].center().to_tuple() for i in range(len(lf.faces()))]
pts_b = [lb.faces()[i].center().to_tuple() for i in range(len(lb.faces()))]
print("[08] loft face centers identical smb:", pts == pts_b)
# what can be saved
for label, shape in [("sketch", Rectangle(20, 10)), ("face", Box(5, 5, 5).faces().top()),
                     ("surface", surface([[(x * 10, y * 10, math.sin(x)) for x in range(4)] for y in range(4)])),
                     ("hollow", Box(20, 20, 20).shell(2)),
                     ("two-solids", Box(10, 10, 10) + Box(10, 10, 10).translate(30, 0, 0)),
                     ("list-of-two", [Box(5, 5, 5), Sphere(3)]), ("list-of-one", [Box(5, 5, 5)]), ("mesh", Box(5, 5, 5).mesh())]:
    q = os.path.join(OUT, f"08-{label}.smb")
    try:
        save(shape, q)
        r = load(q)
        extra = f"volume {round(r.volume, 3)}" if isinstance(r, Part) else f"area {round(r.area, 3)}"
        print(f"[08] save {label}: back {type(r).__name__} {extra} solids={len(r.solids()) if isinstance(r, Part) else '-'}")
    except Exception as e:
        print(f"[08] save {label}: {type(e).__name__}: {e}")
