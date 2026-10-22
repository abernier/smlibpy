"""Bridge to the compiled SMLib bindings.

Kernel objects are not garbage collected by the bindings themselves. smlibpy wraps
every Brep and standalone curve it creates in a handle that frees the kernel object
when the last Python reference disappears. Shapes that refer into a Brep (faces,
edges, vertices) keep its handle alive.
"""

from __future__ import annotations

import contextlib
import re
from typing import Any, Iterator

from . import _core as k

ext = k.ext

__all__ = ["k", "ext", "BrepHandle", "CurveHandle", "ModelingError", "KernelError", "kernel_call"]


class ModelingError(RuntimeError):
    """A modeling operation cannot be done (for example a fillet radius that does not fit)."""


class KernelError(ModelingError):
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
    """Owns one kernel Brep and frees it with the last reference. ``sound`` records how far
    the body was found a sound solid (0: not checked; the levels are in shapes.py),
    ``props`` its integrated mass properties, ``meshes`` the meshes rays are cast against (by
    purpose), ``tags`` the tags of its faces and edges (``ext.topology_tags``) and ``shells`` its
    shells (``ext.brep_shells``), each read once. A body made by
    ``Part.merge`` (or a copy of one) has ``merged``: the parts it was merged from, the placement
    it was moved by since, and its cells' sources once found; a cell of one has ``sources``: the
    parts it lies in (kernel plan B15).

    No operation changes a body's faces, edges and vertices or their geometry once it is wrapped,
    but measuring it stores refitted trim curves in its Brep (the first area, volume or tight box
    of a face): later measures can differ from the first in the last digits, and a ``.smb`` file
    written after a measure from one written before (kernel plan T6). So caches hold what was
    measured first, and a body scaled differently along its axes gets its analytic faces back before
    anything measures it. ``named()`` and ``colored()`` wrap the same handle (kernel plan T8): its
    caches serve both bodies, and a measure of one stores its trims for both."""

    __slots__ = ("brep", "sound", "props", "meshes", "tags", "shells", "merged", "sources", "__weakref__")

    def __init__(self, brep: "k.Brep"):
        if brep is None:
            raise KernelError("kernel", "operation returned no body")
        self.brep = brep
        self.sound = 0
        self.props = None
        self.meshes: dict[str, Any] = {}
        self.tags = None
        self.shells = None
        self.merged = None
        self.sources = None

    def __del__(self) -> None:
        b, self.brep = getattr(self, "brep", None), None  # (none: __init__ raised)
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
        c, self.curve = getattr(self, "curve", None), None  # (none: __init__ raised)
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
        s, self.surface = getattr(self, "surface", None), None  # (none: __init__ raised)
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

    def dispose(self) -> None:
        """Free the PolyBrep now (it is freed with the last reference otherwise)."""
        p, self.poly = self.poly, None
        if p is not None:
            ext.delete_polybrep(p)

    def __del__(self) -> None:
        p, self.poly = self.poly, None
        if p is not None and ext is not None:
            try:
                ext.delete_polybrep(p)
            except Exception:  # pragma: no cover
                pass
