# Cone with equal radii: what geom_type?
c = Cone(5, 5, 10)
print("[32] Cone(5,5,10) faces:", sorted(f.geom_type for f in c.faces()), " volume:", round(c.volume, 3))
print("[32] Ellipse sketch edges:", [e.geom_type for e in Ellipse(6, 3).edges()])
