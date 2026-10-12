# export() and load() by extension: .dxf, and the messages for unknown ones
import os, tempfile
os.chdir(tempfile.mkdtemp(prefix="dxf-ext-"))
try:
    export(Box(1, 1, 1), "x.iges")
except ValueError as e:
    print("[12] export:", e)
try:
    load("x.glb")
except ValueError as e:
    print("[12] load:", e)
Circle(5).export("c.dxf", unit="inch")
print("[12] Circle(5).export('c.dxf', unit='inch'):", round(load("c.dxf").bbox().size.x, 9))
try:
    Box(1, 1, 1).export("b.dxf")
except TypeError as e:
    print("[12] Part.export('.dxf'):", e)
