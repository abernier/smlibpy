# a mirrored sketch flips its normal; which plane does a fused sketch keep?
half = Polygon((0, 0), (10, 0), (10, 4), (0, 8))
m = half.mirror(Plane.YZ)
print("[09] half.plane z:", half.plane.z_dir, "mirrored plane z:", m.plane.z_dir)
print("[09] mirrored.extrude(5) z range:", m.extrude(5).bbox().min.z, m.extrude(5).bbox().max.z)
a = half + half.mirror(Plane.YZ)
b = half.mirror(Plane.YZ) + half
print("[09] half + mirror: plane z", a.plane.z_dir, "extrude z", a.extrude(5).bbox().min.z, a.extrude(5).bbox().max.z)
print("[09] mirror + half: plane z", b.plane.z_dir, "extrude z", b.extrude(5).bbox().min.z, b.extrude(5).bbox().max.z)
# Part mirror about XY keeps outward normals
p = Box(4, 4, 4, align=Align.MIN).mirror(Plane.XY)
print("[09] part mirrored XY: bottom face normal", p.faces().bottom()[0].normal_at(), "bbox z", p.bbox().min.z, p.bbox().max.z)
# mirrored sketch on a side plane
s = Rectangle(10, 4, align=Align.MIN).on(Plane.front)
sm = s.mirror(Plane.YZ)
print("[09] front sketch mirror YZ plane z:", s.plane.z_dir, "->", sm.plane.z_dir)
