box = Box(80, 50, 30)
tray = box.shell(2.5, box.faces().top())                # open top, walls grow inward
print(round(tray.volume, 1))                            # 27187.5 = 80*50*30 - 75*45*27.5
case = box.shell(2.5)                                   # closed, hollow inside
sleeve = box.shell(2.5, box.faces().top() + box.faces().bottom())  # two openings
lining = box.shell(2.5, box.faces().top(), outward=True)  # outside grows to 85 x 55, edges rounded r2.5
print(lining.bbox().size.to_tuple(), round(lining.volume, 1))  # (85.0, 55.0, 32.5) 31398.0

cup = Cylinder(20, 30).shell(2, Cylinder(20, 30).faces().top())

# rounded box: fillet first with radius > wall, then shell; the inner corners get r - t
body = Box(60, 40, 20)
body = body.fillet(body.edges(), 5)
shelled = body.shell(2, body.faces().planar().top())   # the flat top face, inside the rounds
print(shelled.is_valid(), round(shelled.volume, 1))     # True 11134.4
