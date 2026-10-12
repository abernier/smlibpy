# a soft-shaped mouse body from a rounded box, and a bulged handle
body = Box(110, 64, 36)
body = body.fillet(body.edges().parallel_to(Z), 18)
body = body.fillet(body.faces().sort_by(Z)[-1].edges(), 10)
lat = Lattice(body, (4, 3, 3))
lat.move(lat.layer(Z, -1), (0, 0, 6))                 # higher top
lat.move((1, 1, -1), (0, 0, 10))                      # hump toward the back
lat.scale(lat.layer(X, -1), (1, 0.8, 1))              # narrower front
mouse = lat.apply(body)
print("[12] mouse: valid", mouse.is_valid(), "faces", len(body.faces()), "->", len(mouse.faces()),
      "volume", round(body.volume, 1), "->", round(mouse.mass_properties(accuracy=1e-10).volume, 1), "bbox", mouse.bbox())
grip = Cylinder(14, 100).rotate(Y, 90)
gl = Lattice(grip, (5, 3, 3))
gl.scale(gl.layer(X, 2), (1, 1.25, 1.25))             # thicker in the middle
handle = gl.apply(grip)
print("[12] handle: valid", handle.is_valid(), "bbox", handle.bbox())
snapshot("mouse", mouse, view="iso")
snapshot("handle", handle, view="front")
