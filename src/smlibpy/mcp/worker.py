"""The process that runs the scripts of an MCP session.

Scripts run here and not in the server: a script that never ends, or a kernel that crashes,
costs a restart of this process and nothing else. The server talks to it over a pipe; every
request is a dict with an ``op`` and every answer a dict with ``ok``.
"""

from __future__ import annotations

import ast
import contextlib
import io
import linecache
import os
import sys
import tempfile
import traceback
from typing import Any

OUTPUT_LIMIT = 16_000
VALUE_LIMIT = 8_000


def main(conn: Any) -> None:
    # Anything the kernel or a library prints must not reach the server's stdout, which
    # carries the MCP protocol: send file descriptor 1 to stderr.
    try:
        os.dup2(2, 1)
    except OSError:
        pass
    sys.stdout = sys.stderr
    worker = _Worker()
    while True:
        try:
            request = conn.recv()
        except (EOFError, OSError):
            return
        op = request.pop("op", "")
        handler = getattr(worker, "op_" + op, None)
        try:
            answer = handler(**request) if handler else {"ok": False, "error": f"unknown request {op!r}"}
        except Exception as e:  # report, never die
            answer = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        try:
            conn.send(answer)
        except (EOFError, OSError):
            return


class _Worker:
    def __init__(self) -> None:
        import smlibpy

        self.sm = smlibpy
        self.ns: dict[str, Any] = {"__name__": "__session__", "__builtins__": __builtins__}
        exec("from smlibpy import *\nimport math\nimport numpy as np", self.ns)
        self.ns["show"] = self._show
        self.shown: list[Any] | None = None  # set by show(...); None: every part and shell
        self.count = 0

    # -- scripts ----------------------------------------------------------------
    def _show(self, *shapes: Any, **_ignored: Any) -> None:
        """In a session, show(...) chooses what the viewer and snapshots display; show()
        without arguments goes back to showing every part and shell."""
        flat: list[Any] = []
        for s in shapes:
            flat.extend(s) if isinstance(s, (list, tuple)) else flat.append(s)
        self.shown = flat or None

    def op_run(self, code: str, label: str | None = None) -> dict[str, Any]:
        self.count += 1
        filename = f"<script {self.count}>"
        linecache.cache[filename] = (len(code), None, code.splitlines(True), filename)
        out = io.StringIO()
        value: Any = None
        try:
            tree = ast.parse(code, filename, "exec")
            last = None
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                last = ast.Expression(tree.body.pop().value)
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
                exec(compile(tree, filename, "exec"), self.ns)
                if last is not None:
                    value = eval(compile(last, filename, "eval"), self.ns)
        except BaseException as e:  # SystemExit and KeyboardInterrupt too: the session goes on
            return {"ok": False, "error": _script_error(e, filename), "output": _tail(out.getvalue())}
        return {"ok": True, "output": _tail(out.getvalue()), "value": None if value is None else self._describe(value),
                "scene": self.op_scene()["scene"]}

    # -- what is on screen ----------------------------------------------------------
    def _named(self, obj: Any) -> str:
        for k, v in self.ns.items():
            if v is obj and not k.startswith("_"):
                return k
        return getattr(obj, "name", None) or type(obj).__name__

    def _items(self, names: list[str] | None = None) -> list[tuple[str, Any]]:
        from smlibpy import Mesh, Part, Shape, Shell

        if names:
            out = []
            for n in names:
                if n not in self.ns:
                    raise KeyError(f"no variable {n!r} in the session")
                out.append((n, self.ns[n]))
            return out
        if self.shown is not None:
            return [(self._named(s), s) for s in self.shown if isinstance(s, (Shape, Mesh))]
        return [(k, v) for k, v in self.ns.items()
                if not k.startswith("_") and isinstance(v, (Part, Shell)) and not isinstance(v, type)]

    def op_scene(self) -> dict[str, Any]:
        return {"ok": True, "scene": [{"name": n, **self._summary(s)} for n, s in self._items()],
                "explicit": self.shown is not None}

    def op_glb(self) -> dict[str, Any]:
        from smlibpy.viewer import _glb_bytes

        items = self._items()
        if not items:
            return {"ok": True, "glb": None, "summary": ""}
        shapes = [s.named(n) if hasattr(s, "named") and not getattr(s, "name", None) else s for n, s in items]
        glb, summary = _glb_bytes(shapes, None, 12.0, True)
        return {"ok": True, "glb": glb, "summary": summary}

    def op_snapshot(self, view: Any = "iso", size: tuple[int, int] = (1000, 750), names: list[str] | None = None,
                    edges: bool = True, path: str | None = None) -> dict[str, Any]:
        from smlibpy.render import render

        items = self._items(names)
        if not items:
            return {"ok": False, "error": "nothing to show: no part or shell yet, and show(...) chose nothing"}
        png = render(*[s for _, s in items], view=view, size=tuple(size), edges=edges, path=path)
        return {"ok": True, "png": png, "shown": [n for n, _ in items]}

    # -- looking at things ----------------------------------------------------------
    def op_vars(self) -> dict[str, Any]:
        from smlibpy import Mesh, Shape, ShapeList

        rows = []
        for k, v in self.ns.items():
            if k.startswith("_") or k in ("math", "np"):
                continue
            if isinstance(v, (Shape, ShapeList, Mesh)) and k not in _LIBRARY_NAMES:
                rows.append({"name": k, **self._summary(v)})
        return {"ok": True, "vars": rows}

    def op_inspect(self, name: str, faces: bool = False, edges: bool = False) -> dict[str, Any]:
        if name not in self.ns:
            try:
                obj = eval(name, self.ns)
            except Exception:
                return {"ok": False, "error": f"no variable {name!r} in the session"}
        else:
            obj = self.ns[name]
        info = {"name": name, **self._summary(obj, full=True)}
        if faces and hasattr(obj, "faces"):
            info["faces"] = [_face_row(i, f) for i, f in enumerate(obj.faces())]
        if edges and hasattr(obj, "edges"):
            info["edges"] = [_edge_row(i, e) for i, e in enumerate(obj.edges())]
        return {"ok": True, "info": info}

    def _summary(self, obj: Any, full: bool = False) -> dict[str, Any]:
        from smlibpy import Edge, Face, Mesh, Part, Shape, ShapeList, Shell, Sketch, Wire

        d: dict[str, Any] = {"type": type(obj).__name__}
        try:
            if isinstance(obj, ShapeList):
                d["count"] = len(obj)
                kinds: dict[str, int] = {}
                for s in obj:
                    kinds[type(s).__name__] = kinds.get(type(s).__name__, 0) + 1
                d["items"] = kinds
                return d
            if isinstance(obj, Mesh):
                d.update(triangles=len(obj.triangles), volume=_r(obj.volume))
                return d
            if not isinstance(obj, Shape):
                return d
            if getattr(obj, "name", None):
                d["label"] = obj.name
            bb = obj.bbox()
            d["bbox"] = {"min": [_r(c) for c in bb.min.to_tuple()], "max": [_r(c) for c in bb.max.to_tuple()]}
            if isinstance(obj, Part):
                d["valid"] = bool(obj.is_valid())
                d["volume"] = _r(obj.volume)
            if isinstance(obj, (Part, Shell, Sketch, Face)):
                d["area"] = _r(obj.area)
            if isinstance(obj, (Part, Shell, Sketch)):
                d["faces"] = len(obj.faces())
                d["edges"] = len(obj.edges())
            if isinstance(obj, (Edge, Wire)):
                d["length"] = _r(obj.length)
            if isinstance(obj, (Face, Edge)):
                d["geom_type"] = obj.geom_type
            if full and isinstance(obj, (Part, Shell, Sketch)):
                kinds = {}
                for f in obj.faces():
                    kinds[f.geom_type] = kinds.get(f.geom_type, 0) + 1
                d["face_types"] = kinds
                d["center"] = [_r(c) for c in obj.center().to_tuple()]
                if getattr(obj, "color", None) is not None:
                    d["color"] = str(obj.color)
        except Exception as e:  # a broken body still gets a line
            d["problem"] = f"{type(e).__name__}: {e}"
        return d

    def _describe(self, value: Any) -> str:
        from smlibpy import Mesh, Shape, ShapeList

        if isinstance(value, (Shape, ShapeList, Mesh)):
            return repr(value)[:VALUE_LIMIT]
        text = repr(value)
        return text if len(text) <= VALUE_LIMIT else text[:VALUE_LIMIT] + f" … ({len(text)} characters)"

    # -- files --------------------------------------------------------------------
    def op_save(self, format: str, path: str | None = None, names: list[str] | None = None) -> dict[str, Any]:
        items = self._items(names)
        if not items:
            return {"ok": False, "error": "nothing to save: no part or shell yet, and show(...) chose nothing"}
        ext = {"step": ".step", "stp": ".step", "stl": ".stl", "glb": ".glb", "gltf": ".gltf", "obj": ".obj",
               "smb": ".smb", "png": ".png"}.get(format.lower())
        if ext is None:
            return {"ok": False, "error": f"unknown format {format!r}: step, stl, glb, gltf, obj, smb or png"}
        if path is None:
            base = items[0][0] if len(items) == 1 else "model"
            path = os.path.join(tempfile.gettempdir(), "smlibpy-files", base + ext)
        path = os.path.abspath(os.path.expanduser(path))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        shapes = [s.named(n) if hasattr(s, "named") and not getattr(s, "name", None) else s for n, s in items]
        if ext == ".png":
            from smlibpy.render import render

            render(*shapes, path=path, size=(1200, 900))
        elif ext == ".smb":
            if len(shapes) != 1:
                return {"ok": False, "error": "an .smb file holds one body: name it with names=[...]"}
            self.sm.save(shapes[0], path)
        else:
            self.sm.export(shapes, path)
        return {"ok": True, "path": path, "bytes": os.path.getsize(path), "shapes": [n for n, _ in items]}

    def op_load(self, path: str, name: str | None = None) -> dict[str, Any]:
        path = os.path.abspath(os.path.expanduser(path))
        obj = self.sm.load(path)
        if name is None:
            stem = os.path.splitext(os.path.basename(path))[0]
            name = "".join(c if c.isalnum() else "_" for c in stem).strip("_") or "loaded"
            if name[0].isdigit():
                name = "part_" + name
        self.ns[name] = obj
        return {"ok": True, "name": name, **self._summary(obj)}

    def op_ping(self) -> dict[str, Any]:
        return {"ok": True, "pid": os.getpid()}


_LIBRARY_NAMES = {"X", "Y", "Z"}


def _r(v: float) -> float:
    return float(f"{float(v):.6g}")


def _face_row(i: int, f: Any) -> dict[str, Any]:
    row: dict[str, Any] = {"i": i, "type": f.geom_type, "area": _r(f.area),
                           "center": [_r(c) for c in f.center().to_tuple()]}
    try:
        if f.geom_type == "plane":
            row["normal"] = [_r(c) for c in f.normal_at().to_tuple()]
        elif f.geom_type in ("cylinder", "cone", "sphere", "torus"):
            r = f.radius
            if r is not None:
                row["radius"] = _r(r)
    except Exception:
        pass
    return row


def _edge_row(i: int, e: Any) -> dict[str, Any]:
    row: dict[str, Any] = {"i": i, "type": e.geom_type, "length": _r(e.length),
                           "center": [_r(c) for c in e.center().to_tuple()]}
    try:
        if e.geom_type == "circle":
            row["radius"] = _r(e.radius)
    except Exception:
        pass
    return row


def _tail(text: str) -> str:
    if len(text) <= OUTPUT_LIMIT:
        return text
    return f"… ({len(text) - OUTPUT_LIMIT} characters left out)\n" + text[-OUTPUT_LIMIT:]


def _script_error(e: BaseException, filename: str) -> str:
    """The error with the lines of the script that led to it (library frames left out)."""
    if isinstance(e, SyntaxError):
        line = (e.text or "").rstrip()
        return f"SyntaxError: {e.msg} (line {e.lineno})\n    {line}"
    frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == filename]
    lines = [f"line {f.lineno}: {(f.line or '').strip()}" for f in frames]
    message = "".join(traceback.format_exception_only(type(e), e)).strip()
    return "\n".join(lines + [message]) if lines else message
