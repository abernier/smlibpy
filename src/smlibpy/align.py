"""Alignment of new shapes relative to the origin."""

from __future__ import annotations

from enum import Enum
from typing import Sequence, Union

from .geometry import BoundBox, Vector

__all__ = ["Align"]


class Align(Enum):
    """How a new shape sits relative to the origin along an axis.

    ``MIN`` puts the shape's lower bound at the origin, ``CENTER`` centers it,
    ``MAX`` puts its upper bound at the origin. Constructors take one value for
    all axes or one per axis: ``Box(10, 10, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))``
    stands the box on the XY plane.
    """

    MIN = "min"
    CENTER = "center"
    MAX = "max"


AlignLike = Union[Align, str, None, Sequence[Union[Align, str, None]]]


def _one(a: Align | str | None) -> Align | None:
    if a is None or isinstance(a, Align):
        return a
    return Align(a.lower())


def alignment_offset(box: BoundBox, align: AlignLike, dims: int = 3) -> Vector:
    """Translation that aligns ``box`` as requested (axes beyond ``dims`` are left alone)."""
    if align is None:
        return Vector()
    if isinstance(align, (Align, str)):
        per_axis = [_one(align)] * dims
    else:
        per_axis = [_one(a) for a in align]
        per_axis += [None] * (3 - len(per_axis))
    out = []
    for i in range(3):
        a = per_axis[i] if i < len(per_axis) and i < dims else None
        lo, hi = box.min[i], box.max[i]
        if a is None:
            out.append(0.0)
        elif a is Align.MIN:
            out.append(-lo)
        elif a is Align.MAX:
            out.append(-hi)
        else:
            out.append(-(lo + hi) / 2.0)
    return Vector(out)
