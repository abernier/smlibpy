"""Bridge to the compiled SMLib bindings.

Kernel objects are not garbage collected by the bindings themselves. smlibpy wraps
every Brep and standalone curve it creates in a handle that frees the kernel object
when the last Python reference disappears. Shapes that refer into a Brep (faces,
edges, vertices) keep its handle alive.
"""

from __future__ import annotations

import contextlib
import re
from typing import Iterator

from . import _core as k

ext = k.ext

__all__ = ["k", "ext", "BrepHandle", "CurveHandle", "KernelError", "kernel_call"]


class KernelError(RuntimeError):
    """An SMLib operation failed.

    ``operation`` names the smlibpy call, ``status`` the kernel status code
    (e.g. ``SM_ERR_INVALID_INPUT``) and ``hint`` a suggestion when one is known.
    """

    def __init__(self, operation: str, detail: str, status: str | None = None, hint: str | None = None):
        self.operation = operation
        self.status = status
        self.detail = detail
        self.hint = hint
        msg = f"{operation} failed"
        if status:
            msg += f" ({status})"
        if hint:
            msg += f": {hint}"
        super().__init__(msg)


_STATUS_RE = re.compile(r"(SM_[A-Z0-9_]+)")


@contextlib.contextmanager
def kernel_call(operation: str, hint: str | None = None) -> Iterator[None]:
    """Turn kernel ``RuntimeError``\\ s into :class:`KernelError` with context."""
    try:
        yield
    except KernelError:
        raise
    except RuntimeError as e:
        text = str(e)
        m = _STATUS_RE.search(text)
        raise KernelError(operation, text, m.group(1) if m else None, hint) from e


class BrepHandle:
    """Owns one kernel Brep and frees it with the last reference."""

    __slots__ = ("brep", "__weakref__")

    def __init__(self, brep: "k.Brep"):
        if brep is None:
            raise KernelError("kernel", "operation returned no body")
        self.brep = brep

    def __del__(self) -> None:
        b, self.brep = self.brep, None
        if b is not None and ext is not None:
            try:
                ext.delete_brep(b)
            except Exception:  # pragma: no cover - interpreter shutdown
                pass


class CurveHandle:
    """Owns one standalone kernel curve."""

    __slots__ = ("curve", "__weakref__")

    def __init__(self, curve: "k.Curve"):
        if curve is None:
            raise KernelError("kernel", "operation returned no curve")
        self.curve = curve

    def __del__(self) -> None:
        c, self.curve = self.curve, None
        if c is not None and ext is not None:
            try:
                ext.delete_curve(c)
            except Exception:  # pragma: no cover
                pass


class SurfaceHandle:
    """Owns one standalone kernel surface."""

    __slots__ = ("surface", "__weakref__")

    def __init__(self, surface: "k.Surface"):
        if surface is None:
            raise KernelError("kernel", "operation returned no surface")
        self.surface = surface

    def __del__(self) -> None:
        s, self.surface = self.surface, None
        if s is not None and ext is not None:
            try:
                ext.delete_surface(s)
            except Exception:  # pragma: no cover
                pass


class PolyHandle:
    """Owns one kernel PolyBrep (triangle mesh)."""

    __slots__ = ("poly", "__weakref__")

    def __init__(self, poly: "k.PolyBrep"):
        self.poly = poly

    def __del__(self) -> None:
        p, self.poly = self.poly, None
        if p is not None and ext is not None:
            try:
                ext.delete_polybrep(p)
            except Exception:  # pragma: no cover
                pass
