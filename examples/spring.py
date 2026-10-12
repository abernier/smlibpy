"""Compression spring: a circle swept along a helix, with ground ends."""

from smlibpy import *


def model() -> Part:
    coil = sweep(Circle(1.2), Helix(pitch=6, height=48, radius=10))
    coil = coil.split(Plane.XY.offset(1.2)).split(Plane.XY.offset(48 - 1.2), keep="below")
    return coil.named("spring").colored("#9d87c7")


if __name__ == "__main__":
    part = model()
    print(part)
    part.export("spring.step")
    show(part)
