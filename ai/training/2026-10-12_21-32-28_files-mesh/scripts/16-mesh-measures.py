cone = Cone(10, 0, 20)
m = cone.mesh(0.01)
print("[16] cone center exact:", cone.center(), "mesh center():", m.center(), "mesh bbox center:", m.bbox().center)
v = m.vertices[m.triangles]
vol6 = np.einsum("ij,ij->i", v[:, 0], np.cross(v[:, 1], v[:, 2]))
centroid = (vol6[:, None] * v.sum(axis=1)).sum(axis=0) / (4 * vol6.sum())
print("[16] mesh volume centroid (numpy):", np.round(centroid, 4))
print("[16] volume mesh/exact:", round(m.volume, 3), round(cone.volume, 3), "area:", round(m.area, 3), round(cone.area, 3))
# volume of an open mesh depends on the origin
face = Box(10, 10, 10).faces().top()
fm = tessellate(face)
fm2 = tessellate(face.translate(0, 0, 10))
print("[16] open mesh volume at z=5:", fm.volume, "at z=15:", fm2.volume)
# hand-built mesh, inward winding gives negative volume
inv = Mesh(m.vertices, m.triangles[:, ::-1])
print("[16] reversed winding volume:", round(inv.volume, 3))
print("[16] hand mesh normals:", inv.normals, "triangle_normals shape:", inv.triangle_normals.shape)
# Mesh is mutable (unlike shapes)
mm = Box(2, 2, 2).mesh()
mm.vertices += [10, 0, 0]
print("[16] vertices can be shifted in place:", mm.bbox())
try:
    mm.name = "x"
except Exception as e:
    print("[16] mesh.name:", type(e).__name__, e)
print("[16] len:", len(m), "repr:", repr(m))
# merged list
ml = tessellate(ShapeList([Box(5, 5, 5), Box(5, 5, 5).translate(10, 0, 0)]))
print("[16] tessellate(ShapeList):", ml, "volume", ml.volume, "has _poly:", ml._poly is not None)
try:
    ml - Box(1, 1, 1).mesh()
except Exception as e:
    print("[16] boolean on merged:", type(e).__name__, e)
