OUT = "ai/training/2026-10-12_21-32-28_files-mesh/files"
v = Box(5, 5, 5).vertices()[0]
e = Line((0, 0, 0), (1, 0, 0))
w = Polyline((0, 0), (1, 0), (1, 1))
for label, s in [("vertex", v), ("edge", e), ("wire", w)]:
    for fn, ext in [(export_step, "step"), (save, "smb"), (export_stl, "stl"), (export_obj, "obj"), (export_glb, "glb")]:
        try:
            fn(s, f"{OUT}/19-{label}.{ext}")
            print(f"[19] {label} -> {ext}: ok")
        except Exception as ex:
            print(f"[19] {label} -> {ext}: {type(ex).__name__}: {ex}")
    try:
        show(s, path=f"{OUT}/19-{label}.html", open_browser=False); print(f"[19] {label} -> show: ok")
    except Exception as ex:
        print(f"[19] {label} -> show: {type(ex).__name__}: {ex}")
