"""Pipe flange: a revolved cross-section with a bolt circle."""

from smlibpy import *


def model() -> Part:
    # half cross-section in the front plane (x = radius, y = height), revolved about Z
    section = Polygon((25, 0), (60, 0), (60, 12), (35, 12), (35, 40), (25, 40))
    flange = section.on(Plane.front).revolve(Z)

    flange -= PolarLocations(47.5, 8) * Cylinder(5, 30)
    flange = flange.fillet(flange.edges().concave(), 4)          # neck to plate
    flange = flange.chamfer(flange.faces().top().edges().circles(), 1)
    return flange.named("flange").colored("#b08e6c")


if __name__ == "__main__":
    part = model()
    print(part, part.mass_properties(density=7.85e-3))  # steel, g/mm^3
    part.export("flange.step")
    show(part)
