"""Kernel steps in a process of their own: a crash or a loop there leaves this process alone.

SMLib can crash (read or write memory it has freed) or loop on some inputs, and it has no way to
stop a call from outside: a kernel call cannot be interrupted, not even by Ctrl-C, which Python
handles only once the call has returned. :func:`isolated` runs a step in another process and
waits for it there, at most ``smlibpy.defeature.GUARD_SECONDS``; a step that crashes or does not
finish there is a ``ModelingError`` here, and Ctrl-C stops it. The bodies (kernel Breps) the step
returns come back as exact copies (binary ``.smb``, the kernel's own format), anything else it
returns pickled; this process never runs the step itself.

Two ways to get the other process (``smlibpy.defeature.GUARD_PROCESS``):

* ``"fork"``: a forked copy of this process per step (Linux, macOS). It starts with this process's
  memory, so the step's inputs need no copying; a fork costs about 1.5 ms.
* ``"helper"``: one helper process (``python -c "from smlibpy._guard import _serve; _serve()"``)
  for the session, started with the first step and again after a step crashed it or ran too
  long. The step's bodies go to it as ``.smb`` files, its faces, edges and vertices as their
  indices in their body; the step must be a function of a module (not a lambda or a closure).
  For Windows, which has no fork, and for processes that must not fork.

``"auto"`` (the default) forks where the system can, and uses the helper elsewhere. Where neither
works (a frozen application, a helper that does not start), and with ``GUARD_SECONDS = 0``, the
step runs in this process.
"""

from __future__ import annotations

import atexit
import builtins
import importlib
import os
import pickle
import queue
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
import warnings
from typing import Any, Callable, TypeVar

from ._kernel import KernelError, ModelingError, ext, k

R = TypeVar("R")

#: Seconds a new helper process may take to start (import smlibpy and load the kernel).
_START_SECONDS = 30.0


class _KernelFault(ModelingError):
    """The kernel crashed or did not finish in the other process; ``reason`` says which."""

    def __init__(self, what: str, reason: str, hint: str):
        self.reason = reason
        super().__init__(f"{what}: {reason}; {hint}")


def _settings() -> tuple[float, str]:
    from . import defeature

    return float(defeature.GUARD_SECONDS), str(defeature.GUARD_PROCESS)


def _how(process: str) -> str:
    """How a step runs: "fork", "helper" or "here"."""
    if process not in ("auto", "fork", "helper"):
        raise ValueError(f"smlibpy.defeature.GUARD_PROCESS must be 'auto', 'fork' or 'helper', not {process!r}")
    if process == "fork" or (process == "auto" and hasattr(os, "fork")):
        return "fork" if hasattr(os, "fork") else "here"
    return "here" if _no_helper() is not None else "helper"


def isolated(what: str, fn: Callable[..., R], *args: Any) -> R:
    """``fn(*args)``, run in another process (see the module's notes); the kernel Breps in what
    it returns (also in lists, tuples and dicts) are exact copies, owned by the caller. A step
    that crashes the kernel there or does not finish within ``GUARD_SECONDS`` is a _KernelFault
    (a ``ModelingError``); an error it raises there is raised here (a KernelError with its
    fields, a built-in exception as itself, a ``ModelingError`` with its message), and so are its
    warnings. With the helper process, ``fn`` must be a function of a module, and ``args`` may
    hold kernel Breps, faces, edges and vertices, plain data and lists, tuples and dicts of
    these."""
    limit, process = _settings()
    if not limit > 0:
        return fn(*args)
    how = _how(process)
    if how == "fork":
        return _forked(what, fn, args, limit)
    if how == "helper":
        helper = _helper()
        if helper is not None:
            return helper.call(what, fn, args, limit)
    return fn(*args)


# =============================================================================
# What crosses: bodies as .smb files, the rest pickled
# =============================================================================
class _Ref:
    """A kernel object in a message: a Brep (``kind`` "brep"), or a face, edge or vertex of one
    (``index``: its index there); ``body`` is the Brep's number among the message's files."""

    __slots__ = ("kind", "body", "index")

    def __init__(self, kind: str, body: int, index: int = -1):
        self.kind, self.body, self.index = kind, body, index

    def __getstate__(self) -> tuple[str, int, int]:
        return self.kind, self.body, self.index

    def __setstate__(self, state: tuple[str, int, int]) -> None:
        self.kind, self.body, self.index = state


_TOPOLOGY = {"face": (k.Face, ext.face_indices, "faces"), "edge": (k.Edge, ext.edge_indices, "edges"),
             "vertex": (k.Vertex, ext.vertex_indices, "vertices")}


class _Packer:
    """Replaces the kernel objects of a value with _Refs, writing their Breps to ``folder``."""

    def __init__(self, folder: str, prefix: str):
        self.folder, self.prefix = folder, prefix
        self.files: list[str] = []
        self.breps: list[Any] = []
        self._numbers: dict[int, int] = {}  # id of a Brep -> its number

    def body(self, brep: Any) -> int:
        key = id(brep)
        if key not in self._numbers:
            path = os.path.join(self.folder, f"{self.prefix}{len(self.files)}.smb")
            brep.write_to_file(path, False)
            self._numbers[key] = len(self.files)
            self.files.append(path)
            self.breps.append(brep)
        return self._numbers[key]

    def pack(self, value: Any) -> Any:
        if isinstance(value, k.Brep):
            return _Ref("brep", self.body(value))
        for kind, (cls, indices, _) in _TOPOLOGY.items():
            if isinstance(value, cls):
                brep = value.brep()
                return _Ref(kind, self.body(brep), int(indices(brep, [value])[0]))
        if isinstance(value, list):
            return [self.pack(v) for v in value]
        if isinstance(value, tuple):
            return tuple(self.pack(v) for v in value)
        if isinstance(value, dict):
            return {key: self.pack(v) for key, v in value.items()}
        return value


def _unpack(value: Any, files: list[str], loaded: dict[int, Any]) -> Any:
    """``value`` with its _Refs read back: Breps from ``files``, each once (into ``loaded``)."""
    if isinstance(value, _Ref):
        if value.body not in loaded:
            loaded[value.body] = k.read_brep_from_file(files[value.body], None, False)
        brep = loaded[value.body]
        if value.kind == "brep":
            return brep
        return getattr(brep, _TOPOLOGY[value.kind][2])()[value.index]
    if isinstance(value, list):
        return [_unpack(v, files, loaded) for v in value]
    if isinstance(value, tuple):
        return tuple(_unpack(v, files, loaded) for v in value)
    if isinstance(value, dict):
        return {key: _unpack(v, files, loaded) for key, v in value.items()}
    return value


def _result(packed: Any, files: list[str], loaded: dict[int, Any] | None = None) -> Any:
    """A value that crossed, its Breps read back (and freed again if that fails)."""
    loaded = {} if loaded is None else loaded
    try:
        return _unpack(packed, files, loaded)
    except BaseException:
        for b in loaded.values():
            ext.delete_brep(b)
        loaded.clear()
        raise


def _error(e: BaseException) -> dict[str, Any]:
    """An error of the other process, as it crosses (with the kernel's trace: KernelError.trace)."""
    if isinstance(e, KernelError):
        return {"kernel": [e.operation, e.detail, e.status, e.hint], "trace": list(e.trace)}
    sent = {"type": type(e).__name__, "builtin": type(e) is getattr(builtins, type(e).__name__, None),
            "modeling": isinstance(e, ModelingError), "text": str(e)}
    if type(e) is RuntimeError:  # (a kernel function's failure, which kernel_call turns into a KernelError)
        sent["trace"] = list(ext.kernel_trace()[0])
    return sent


def _raise(what: str, where: str, sent: dict[str, Any]) -> None:
    """Raises the error of the other process here."""
    if "kernel" in sent:
        error = KernelError(*sent["kernel"])
        error.trace = tuple(sent.get("trace", ()))
        raise error
    if sent["modeling"]:
        raise ModelingError(sent["text"])
    error = getattr(builtins, sent["type"], None) if sent["builtin"] else None
    if isinstance(error, type) and issubclass(error, Exception):
        raised = error(sent["text"])
        if "trace" in sent:
            raised._kernel_trace = sent["trace"]  # type: ignore[attr-defined]
        raise raised
    raise ModelingError(f"{what}: {sent['type']} in {where}: {sent['text']}")


def _rewarn(said: list[tuple[str, str]]) -> None:
    """Warns here of what the step warned of there."""
    for name, text in said:
        category = getattr(builtins, name, None)
        if not (isinstance(category, type) and issubclass(category, Warning)):
            category = RuntimeWarning
        warnings.warn(text, category, stacklevel=4)


def _run(fn: Callable[..., Any], args: Any, folder: str, made: list[Any]) -> tuple[str, Any, list[str], list[Any]]:
    """Runs a step in the other process: ("ok", its value packed, the value's files, its warnings)
    or ("error", the error, [], its warnings). The Breps of the value go into ``made``."""
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        try:
            packer = _Packer(folder, "out")
            value = packer.pack(fn(*args))
            made.extend(packer.breps)
            answer: tuple[str, Any, list[str]] = ("ok", value, packer.files)
        except BaseException as e:  # (KeyboardInterrupt too: the caller stops waiting)
            answer = ("error", _error(e), [])
        said = [(type(w.message).__name__, str(w.message)) for w in caught]
    return (*answer, said)


# =============================================================================
# A forked copy per step
# =============================================================================
def _forked(what: str, fn: Callable[..., R], args: tuple[Any, ...], limit: float) -> R:
    folder = tempfile.mkdtemp(prefix="smlibpy-")
    answer = os.path.join(folder, "answer.pickle")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)  # forking a process with threads
            pid = os.fork()
        if pid == 0:  # pragma: no cover - the child
            code = 3
            try:
                message = _run(fn, args, folder, [])
                with open(answer, "wb") as f:
                    pickle.dump(message, f)
                code = 0
            except BaseException:  # (a value that does not pickle)
                try:
                    with open(answer, "wb") as f:
                        pickle.dump(("error", {"type": "TypeError", "builtin": True, "modeling": False,
                                               "text": f"{what}: the step's result cannot cross processes"},
                                     [], []), f)
                    code = 0
                except BaseException:
                    pass
            os._exit(code)
        _wait(what, pid, limit)
        try:
            with open(answer, "rb") as f:
                kind, value, files, said = pickle.load(f)
        except (OSError, EOFError, pickle.UnpicklingError):
            raise ModelingError(f"{what}: the kernel step failed in a copy of this process") from None
        _rewarn(said)
        if kind == "error":
            _raise(what, "a copy of this process", value)
        return _result(value, files)  # type: ignore[no-any-return]
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def _wait(what: str, pid: int, limit: float) -> int:
    """The exit code of the forked copy ``pid``; a _KernelFault if it crashed or did not finish
    within ``limit`` seconds (it is stopped then). Ctrl-C stops it too."""
    deadline = time.monotonic() + limit
    pause = 0.001
    while True:
        try:
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                break
            if time.monotonic() > deadline:
                raise _KernelFault(what, f"the kernel did not finish within {limit:g} s",
                                   "smlibpy.defeature.GUARD_SECONDS sets the limit")
            time.sleep(pause)
        except BaseException:  # (also Ctrl-C, which stops the copy)
            os.kill(pid, 9)
            os.waitpid(pid, 0)
            raise
        pause = min(pause * 2, 0.05)
    if os.WIFSIGNALED(status):
        raise _KernelFault(what, f"the kernel crashed (signal {os.WTERMSIG(status)}, in a copy of this process)",
                           "this process is fine")
    return os.WEXITSTATUS(status)


# =============================================================================
# The helper process
# =============================================================================
def _send(stream: Any, message: Any) -> None:
    data = pickle.dumps(message, protocol=pickle.HIGHEST_PROTOCOL)
    stream.write(struct.pack(">Q", len(data)) + data)
    stream.flush()


def _receive(stream: Any) -> Any:
    """The next message, or None at the end of the stream."""
    head = _read(stream, 8)
    if head is None:
        return None
    data = _read(stream, struct.unpack(">Q", head)[0])
    return None if data is None else pickle.loads(data)


def _read(stream: Any, n: int) -> bytes | None:
    chunks, got = [], 0
    while got < n:
        chunk = stream.read(n - got)
        if not chunk:
            return None
        chunks.append(chunk)
        got += len(chunk)
    return b"".join(chunks)


def _serve() -> None:  # pragma: no cover - runs in the helper process
    """The helper process: runs the steps it is sent, one after the other, until its input ends."""
    try:
        signal.signal(signal.SIGINT, signal.SIG_IGN)  # (Ctrl-C is the caller's: it stops this process)
    except (ValueError, OSError):
        pass
    # The answers go through a copy of stdout; what the kernel prints goes to stderr.
    answers = os.fdopen(os.dup(1), "wb")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    requests = sys.stdin.buffer
    _send(answers, ("ready", os.getpid()))
    while True:
        request = _receive(requests)
        if request is None:
            return
        folder, (module, name), files, args = request
        loaded: dict[int, Any] = {}
        made: list[Any] = []
        try:
            fn: Any = importlib.import_module(module)
            for part in name.split("."):
                fn = getattr(fn, part)
            answer = _run(fn, _result(args, files, loaded), folder, made)
        except BaseException as e:
            answer = ("error", _error(e), [], [])
        _send(answers, answer)
        # (the helper lives on: the step's bodies are freed, each once)
        freed: set[int] = set()
        for b in [*loaded.values(), *made]:
            if id(b) not in freed:
                freed.add(id(b))
                ext.delete_brep(b)


class _Helper:
    """The helper process and the thread that reads its answers."""

    def __init__(self) -> None:
        env = dict(os.environ)
        # (the modules of this process, smlibpy's first: the helper imports the steps' modules)
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        env["PYTHONPATH"] = os.pathsep.join(dict.fromkeys([root] + [p for p in sys.path if p and os.path.isdir(p)]))
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self.process = subprocess.Popen(
            [sys.executable, "-c", "from smlibpy._guard import _serve; _serve()"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env, creationflags=flags)
        self.answers: queue.Queue[Any] = queue.Queue()
        self.busy = threading.Lock()  # (one step at a time)
        threading.Thread(target=self._listen, args=(self.process.stdout, self.answers), daemon=True,
                         name="smlibpy-guard").start()
        message = self._next(time.monotonic() + _START_SECONDS)
        if not (isinstance(message, tuple) and message and message[0] == "ready"):
            self.stop()
            raise OSError("the helper process did not start" if message is _TIMEOUT
                          else f"the helper process ended as it started (exit code {self.process.returncode})")

    @staticmethod
    def _listen(stream: Any, answers: queue.Queue[Any]) -> None:
        while True:
            try:
                message = _receive(stream)
            except Exception:
                message = None
            answers.put(message)
            if message is None:
                return

    def _next(self, deadline: float) -> Any:
        """The next answer; _TIMEOUT once the deadline has passed (Ctrl-C comes through)."""
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                return _TIMEOUT
            try:
                return self.answers.get(timeout=min(left, 0.1))
            except queue.Empty:
                continue

    def alive(self) -> bool:
        return self.process.poll() is None

    def stop(self) -> None:
        if self.process.poll() is None:
            self.process.kill()
        try:
            self.process.wait(5)
        except subprocess.TimeoutExpired:  # pragma: no cover
            pass
        for stream in (self.process.stdin, self.process.stdout):
            try:
                stream.close()  # type: ignore[union-attr]
            except OSError:  # pragma: no cover
                pass

    def call(self, what: str, fn: Callable[..., R], args: tuple[Any, ...], limit: float) -> R:
        module, name = getattr(fn, "__module__", None), getattr(fn, "__qualname__", "")
        if not module or "<" in name:
            raise TypeError(f"{what}: the helper process runs functions of modules, not {fn!r}")
        with self.busy:
            return self._call(what, module, name, args, limit)

    def _call(self, what: str, module: str, name: str, args: tuple[Any, ...], limit: float) -> Any:
        folder = tempfile.mkdtemp(prefix="smlibpy-")
        try:
            packer = _Packer(folder, "in")
            request = (folder, (module, name), packer.files, packer.pack(tuple(args)))
            try:
                _send(self.process.stdin, request)
                answer = self._next(time.monotonic() + limit)
            except BaseException:  # (Ctrl-C: the step stops with the helper)
                _drop(self)
                raise
            if answer is _TIMEOUT:
                _drop(self)
                raise _KernelFault(what, f"the kernel did not finish within {limit:g} s",
                                   "smlibpy.defeature.GUARD_SECONDS sets the limit")
            if answer is None:  # the helper ended: the kernel crashed it
                _drop(self)
                code = self.process.returncode
                how = f"signal {-code}" if code is not None and code < 0 else f"exit code {code}"
                raise _KernelFault(what, f"the kernel crashed ({how}, in smlibpy's helper process)",
                                   "this process is fine")
            kind, value, files, said = answer
            _rewarn(said)
            if kind == "error":
                _raise(what, "smlibpy's helper process", value)
            return _result(value, files)
        finally:
            shutil.rmtree(folder, ignore_errors=True)


_TIMEOUT = object()
_lock = threading.RLock()
_current: _Helper | None = None
_why_not: str | None = None  # why no helper process can run here, once known


def _no_helper() -> str | None:
    """Why no helper process can run here (None: it can, or it is not known yet)."""
    if _why_not is None and getattr(sys, "frozen", False):
        return "a frozen application has no Python to start the helper process with"
    return _why_not


def _helper() -> _Helper | None:
    """The helper process, started on first use; None where it cannot run (said once)."""
    global _current, _why_not
    with _lock:
        if _current is not None and _current.alive():
            return _current
        _current = None
        if _no_helper() is not None:
            return None
        try:
            _current = _Helper()
        except (OSError, ValueError) as e:
            _why_not = str(e)
            warnings.warn(f"smlibpy: {e}; kernel steps that can crash run in this process from now on",
                          RuntimeWarning, stacklevel=4)
            return None
        return _current


def _drop(helper: _Helper) -> None:
    """Ends a helper that crashed, ran too long or was stopped: the next step starts a new one."""
    global _current
    with _lock:
        helper.stop()
        if _current is helper:
            _current = None


@atexit.register
def _stop_helper() -> None:
    with _lock:
        if _current is not None:
            _drop(_current)
