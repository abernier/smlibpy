ball = Sphere(10)
cut_plane = Rectangle(40, 40).on(Plane.XY.offset(6))      # a plane as a body: a large sketch
pieces = ball.intersection_curves(cut_plane)
print(len(pieces), [e.geom_type for e in pieces])          # 2 ['circle', 'circle']: split at the seam
print(round(sum(e.length for e in pieces), 6))             # 50.265482 = 2*pi*8
print(pieces[0].radius, pieces[0].arc_center)              # 8.0 Vector(0, 0, 6)

ring = Wire(pieces)                                        # join the pieces
print(ring.is_closed, round(ring.length, 6))               # True 50.265482

try:
    Box(20, 20, 20).intersection_curves(Box(5, 5, 5).translate(50, 0, 0))
except KernelError as e:
    print(e)                                               # intersection curves failed (SM_ERR)
