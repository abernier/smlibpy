# Getting started

## Install

```bash
pip install smlibpy
```

There are wheels for Linux (x86_64, aarch64), macOS (arm64, x86_64) and Windows, for
Python 3.10 to 3.15. Elsewhere pip builds the kernel from source, which needs CMake 3.20 or
newer and a C++17 compiler (Xcode command line tools on macOS, `build-essential` on Linux,
Visual Studio on Windows) and takes about a minute.

To work on smlibpy itself, clone it with its submodule, build in place and put `src` on the
Python path:

```bash
git clone --recursive https://github.com/awv-informatik/smlibpy
cd smlibpy
pip install pybind11 numpy
cmake -S . -B build -G Ninja -Dpybind11_DIR="$(python -m pybind11 --cmakedir)" \
      -DPython_EXECUTABLE="$(which python)"
cmake --build build
export PYTHONPATH=$PWD/src
```

## Your first part

Everything is in one namespace:

```python
from smlibpy import *
```

A part starts from a primitive or from a sketch. Here a plate with rounded corners, four
holes and a pocket:

```python
plate = Box(80, 60, 10)                                  # centered on the origin
plate = plate.fillet(plate.edges().parallel_to(Z), 8)    # round the four vertical edges
plate -= GridLocations(60, 40, 2, 2) * Cylinder(4, 10)   # subtract four cylinders
pocket = Rectangle(30, 20).on(plate.faces().top())       # a sketch on the top face
plate -= pocket.extrude(-4)                              # extruded into the plate
```

Each line returns a new part; nothing is modified in place. `plate -= tool` is short for
`plate = plate - tool`.

## Look at it

```python
show(plate)
```

opens the part in your browser. In Jupyter, `show(plate)` (or just `plate` as the last
expression of a cell) displays it inline. Drag to orbit, right-drag to pan, scroll to zoom,
press `F` to frame the model.

## Measure it

```python
print(round(plate.volume, 3))  # 43040.0
print(plate.area)
print(plate.bbox().size)       # Vector(80, 60, 10)
print(plate.is_valid())        # a closed, manifold solid with a positive volume
```

Volumes, areas and centers are integrated over the exact geometry, not a mesh, to seven
significant digits (see [Measuring](analysis.md)).

## Save it

```python
plate.export("plate.step")   # exact B-rep for any CAD system
plate.export("plate.stl")    # triangle mesh for 3D printing
plate.export("plate.glb")    # for the web, Blender, three.js
```

The file type follows the extension. See [files and viewer](files.md) for options.

## Units and conventions

- Lengths are in millimeters unless you decide otherwise; STEP export can declare other
  units.
- Angles are in degrees everywhere.
- Z points up. The front view looks along +Y, so `Plane.front` faces -Y.
- New shapes are centered on the origin; use `align=` to change that.

Next: [concepts](concepts.md).
