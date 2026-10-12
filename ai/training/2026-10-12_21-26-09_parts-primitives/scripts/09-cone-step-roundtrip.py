import os, tempfile, warnings
warnings.simplefilter("always")
d = tempfile.mkdtemp()
for name, p in [("frustum", Cone(10, 4, 15)), ("point", Cone(10, 0, 15)), ("inverted", Cone(0, 10, 15))]:
    path = os.path.join(d, name + ".step")
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        export_step(p, path)
    q = import_step(path)
    print("[09]", name, "warnings:", [str(x.message) for x in w], "| vol in/out:", round(p.volume, 3), round(q.volume, 3), "valid:", q.is_valid())
    f = p.faces().filter_by(lambda f: f.geom_type == "cone").one()
    print("[09]", name, "cone face interior point:", f.interior_point())
