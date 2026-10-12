def rep(name, p):
    try:
        ns = len(p.solids())
    except Exception as e:
        ns = f"{type(e).__name__}"
    print(f"[03] {name}: faces {len(p.faces())}, vol {round(p.volume, 4)}, valid {p.is_valid()}, solids {ns}")

a = Box(10, 10, 10)
# shared face (touching boxes): one solid? coplanar faces merged?
rep("fuse face-to-face", a + Box(10, 10, 10).translate(10, 0, 0))
rep("fuse face-to-face, offset half", a + Box(10, 10, 10).translate(10, 5, 0))
rep("fuse smaller box on top face", a + Box(4, 4, 4).translate(0, 0, 7))
rep("fuse edge contact", a + Box(10, 10, 10).translate(10, 10, 0))
rep("fuse point contact", a + Box(10, 10, 10).translate(10, 10, 10))
rep("fuse overlapping coplanar tops", a + Box(10, 10, 10).translate(5, 0, 0))
rep("fuse identical", a + Box(10, 10, 10))
rep("cut identical", a - Box(10, 10, 10))
rep("intersect identical", a & Box(10, 10, 10))
rep("cut flush top (tool top = part top)", a - Box(4, 4, 5, align=(Align.CENTER, Align.CENTER, Align.MAX)).translate(0, 0, 5))
rep("cut flush side (tool side on part side)", a - Box(4, 10, 4))
rep("cut tool touching only (outside, face contact)", a - Box(10, 10, 10).translate(10, 0, 0))
rep("cut tool missing", a - Box(2, 2, 2).translate(50, 0, 0))
rep("cut everything (tool bigger)", a - Box(20, 20, 20))
rep("intersect disjoint", a & Box(2, 2, 2).translate(50, 0, 0))
rep("intersect face contact", a & Box(10, 10, 10).translate(10, 0, 0))
rep("cut inner cavity (tool fully inside)", a - Box(4, 4, 4))
