step = Box(40, 30, 20, align=(Align.CENTER, Align.CENTER, Align.MIN)) \
     + Box(20, 30, 10, align=(Align.MIN, Align.CENTER, Align.MIN)).translate(0, 0, 20)
print(len(step.faces().top()))                 # 1: only the face at z=30
print(len(step.faces().facing(Z)))             # 2: both upward faces (z=20 and z=30)
print(len(step.edges().top()))                 # 4: the edges of the z=30 face
right_top = step.edges().top().right()         # chain: highest, then furthest +X
print(right_top.one())                         # Edge(line, (20, -15, 30) -> (20, 15, 30))

twin = Box(10, 10, 10).translate(-20, 0, 0) + Box(10, 10, 10).translate(20, 0, 0)
print(len(twin.faces().top()))                 # 2: a tie returns both
