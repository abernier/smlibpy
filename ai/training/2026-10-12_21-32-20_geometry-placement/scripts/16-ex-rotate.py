bar = Box(10, 2, 2, align=(Align.MIN, Align.CENTER, Align.CENTER))   # x 0..10
print(bar.rotate(Z, 90).bbox())       # y 0..10: +X turns to +Y
print(bar.rotate(Z, -90).bbox())      # y -10..0
print(bar.rotate(Axis((10, 0, 0), (0, 0, 1)), 90).bbox())   # about x = 10: x 9..11, y -10..0

post = Box(2, 2, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))  # z 0..10
print(post.rotate(X, 90).bbox())      # lies along -Y
print(post.rotate(Y, 90).bbox())      # lies along +X

part = Box(20, 10, 5).translate(30, 0, 0)
spun = part.rotate(Axis(part.center(), (0, 0, 1)), 30)   # about its own vertical axis
print(spun.center())                  # still Vector(30, 0, 0)
