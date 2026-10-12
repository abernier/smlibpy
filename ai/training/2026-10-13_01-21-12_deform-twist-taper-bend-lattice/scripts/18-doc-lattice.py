block = Box(60, 40, 20)
lat = Lattice(block, 3)                              # 3 x 3 x 3 points on the block's bounding box
lat.move((1, 1, -1), (0, 0, 8))                      # lift the middle of the top layer
pillow = lat.apply(block)
print(pillow.is_valid(), round(pillow.mass_properties(accuracy=1e-10).volume, 3))
print(lat.map((0, 0, 10)))                           # the middle of the top moves 8 * 1/2 * 1/2

lat = Lattice(block, 4)
lat.move(lat.layer(Z, -1), (0, 0, 5))                # the whole top layer up
lat.scale(lat.layer(Z, -1), 1.3)                     # and wider (about its centroid)
lat.rotate(lat.layer(Z, -1), Z, 15)                  # and turned
lat.points[0, :, :, 0] -= 4                          # numpy works too: the -X layer out by 4
print(lat.apply(block).bbox())

grip = Cylinder(14, 100).rotate(Y, 90)
gl = Lattice(grip, (5, 3, 3))
gl.scale(gl.layer(X, 2), (1, 1.25, 1.25))            # thicker in the middle
handle = grip.deform(gl)                             # same as gl.apply(grip)
print(handle.bbox())
