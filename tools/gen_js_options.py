"""Generate js/src/_options.ts, the option keys smlibwasm accepts, from smlibpy's signatures, and
js/test/_python_api.json, the names smlibwasm must have.

smlibwasm takes Python's keyword-only parameters as a trailing options object with camelCase keys
(js/PORTING.md), and checks its keys against this table as Python checks keyword arguments. The
table covers the package's exports (js/src/index.ts) and the methods of its classes. The list of
names holds smlibpy's exports and the methods and properties of the classes the MCP lists,
camelCase (``RENAMES``: where smlibwasm spells one otherwise); js/test/api_forms.test.ts checks
that smlibwasm has each. Run this after changing a public name or signature;
tests/test_js_options.py fails while either file is behind:

    python tools/gen_js_options.py           # write the files
    python tools/gen_js_options.py --check   # exit 1 if one is behind
"""

from __future__ import annotations

import enum
import inspect
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGET = ROOT / "js" / "src" / "_options.ts"
API_TARGET = ROOT / "js" / "test" / "_python_api.json"
INDEX = ROOT / "js" / "src" / "index.ts"

# smlibpy's names that smlibwasm spells otherwise (js/PORTING.md): `export` cannot name a function,
# an Array's `at` takes an index, `new` names no method well, a JavaScript tuple is an array.
RENAMES = {"export": "exportFile", "ShapeList.at": "atPoint", "ShapeList.new": "newSince", "Vector.to_tuple": "toArray"}

# smlibwasm's names that differ from Python's: `export` cannot name a function, and the files in
# memory (toStep, fromStep, ...) take the options of Python's functions for files (toStep without
# their path), which Python's own (to_step, from_step, ...) take too.
ALIASES = {
    "exportFile": "export",
    "toStep": "export_step",
    "toStl": "export_stl",
    "toGlb": "export_glb",
    "toGltf": "export_gltf",
    "toObj": "export_obj",
    "toSmb": "save",
    "toDxf": "export_dxf",
    "toUsd": "export_usd",
    "toSvg": "export_svg",
    "fromStep": "import_step",
    "fromStepModel": "read_step",
    "fromDxf": "import_dxf",
    "fromDxfWires": "import_dxf_wires",
    "fromIges": "import_iges",
}

# Functions whose **kwargs Python passes on to another function, which checks them.
FORWARDS: dict[str, str] = {}

# Options only smlibwasm has (none now: fromUsd's resolve is from_usd's too).
JS_ONLY: dict[str, list[str]] = {}

HEADER = """\
// Generated from smlibpy's signatures by tools/gen_js_options.py: do not edit. Run it after
// changing a public signature (tests/test_js_options.py fails while this file is behind).
//
// The options of each function and method of the package that takes some: Python's keyword-only
// parameters, camelCase, under the name here (`Class.method` for a method, under the class that
// defines it in Python), with the number of positional parameters (-1: any number, Python's
// *args). `_opts` (kernel.ts) checks options objects against it, as Python checks keywords.
export const OPTIONS: Record<string, readonly [number, readonly string[]]> = {
"""


def camel(name: str) -> str:
    """`k_factor` -> `kFactor` (a leading underscore stays)."""
    lead = len(name) - len(name.lstrip("_"))
    head, *rest = name[lead:].split("_")
    return "_" * lead + head + "".join(w[:1].upper() + w[1:] for w in rest)


def snake(name: str) -> str:
    """`flatPattern` -> `flat_pattern`; class names stay."""
    if name[:1].isupper():
        return name
    return re.sub(r"(?<=[a-z0-9])([A-Z])", lambda m: "_" + m.group(1).lower(), name)


def exports() -> list[str]:
    """The names js/src/index.ts exports (types left out)."""
    text = INDEX.read_text()
    names: list[str] = []
    for block in re.findall(r"export\s*\{([^}]*)\}", text):
        for item in block.split(","):
            item = item.strip()
            if item and not item.startswith("type "):
                names.append(item.split(" as ")[-1].strip())
    return names


def python_object(name: str) -> object | None:
    """The Python counterpart of an export of smlibwasm, or None."""
    import importlib
    import pkgutil

    import smlibpy

    py = ALIASES.get(name, snake(name))
    if py in smlibpy.__all__:
        return getattr(smlibpy, py)
    for mod in pkgutil.iter_modules(smlibpy.__path__):
        if mod.name.startswith("_") or mod.name == "mcp":
            continue
        module = importlib.import_module(f"smlibpy.{mod.name}")
        if py in getattr(module, "__all__", ()):
            return getattr(module, py)
    return None


def entry(fn: object) -> tuple[int, list[str]] | None:
    """(positional parameters, option keys) of a function with keyword-only parameters, or None."""
    import importlib

    try:
        sig = inspect.signature(fn)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    params = [p for p in sig.parameters.values() if p.name not in ("self", "cls")]
    keys = [camel(p.name) for p in params if p.kind == p.KEYWORD_ONLY]
    forward = FORWARDS.get(getattr(fn, "__name__", ""))
    if forward is not None:
        module, _, name = forward.rpartition(".")
        target = inspect.signature(getattr(importlib.import_module(module), name))
        keys += [camel(p.name) for p in target.parameters.values() if p.kind == p.KEYWORD_ONLY]
    if not keys:
        return None
    if any(p.kind == p.VAR_POSITIONAL for p in params):
        return -1, keys
    return sum(p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD) for p in params), keys


def table() -> dict[str, tuple[int, list[str]]]:
    out: dict[str, tuple[int, list[str]]] = {}
    for name in exports():
        obj = python_object(name)
        if obj is None or isinstance(obj, enum.EnumMeta):  # (Python 3.10 gives an enum the signature of
            continue                                      # Enum's functional API: module, qualname, ...)
        if not inspect.isclass(obj):
            e = entry(obj)
            if e is not None:
                if name in ALIASES and name.startswith("to"):
                    e = (e[0] - 1, e[1])  # (no path)
                out[name] = (e[0], e[1] + JS_ONLY.get(name, []))
            continue
        e = entry(obj)
        if e is not None:
            out[name] = e
        # its methods, under the class that defines each (Python's qualname)
        for cls in obj.__mro__:
            if not cls.__module__.startswith("smlibpy"):
                continue
            for attr, value in vars(cls).items():
                if attr.startswith("_"):
                    continue
                if isinstance(value, (staticmethod, classmethod)):
                    value = value.__func__
                if not inspect.isfunction(value):
                    continue
                e = entry(value)
                if e is not None:
                    owner, _, method = value.__qualname__.rpartition(".")
                    out[f"{owner}.{camel(method)}"] = e
    return dict(sorted(out.items()))


def render() -> str:
    lines = [HEADER]
    for name, (positional, keys) in table().items():
        key = name if re.fullmatch(r"[A-Za-z_$][\w$]*", name) else f"'{name}'"
        lines.append(f"  {key}: [{positional}, [{', '.join(repr(k) for k in keys)}]],\n")
    lines.append("}\n")
    return "".join(lines)


def deprecations() -> dict[str, dict[str, object]]:
    """The old forms Python still takes for a release (smlibpy/_renamed.py), where smlibwasm must take
    them too (js/src/_renamed.ts), under the table's names, camelCase: keyword-only parameters that were
    renamed ({old option: new option}), and parameters that were positional before they became
    keyword-only (options)."""
    renamed: dict[str, dict[str, str]] = {}
    positional: dict[str, list[str]] = {}

    def visit(name: str, fn: object) -> None:
        try:
            params = inspect.signature(fn).parameters  # type: ignore[arg-type]
        except (TypeError, ValueError):  # (a constant)
            return
        options = {camel(old): camel(new) for old, new in getattr(fn, "__renamed__", {}).items()
                   if new in params and params[new].kind == params[new].KEYWORD_ONLY}
        if options:
            renamed[name] = options
        if getattr(fn, "__keyword_only__", ()):
            positional[name] = [camel(p) for p in fn.__keyword_only__]  # type: ignore[attr-defined]

    for name in exports():
        obj = python_object(name)
        if obj is None or isinstance(obj, enum.EnumMeta):
            continue
        if not inspect.isclass(obj):
            visit(name, obj)
            continue
        for cls in obj.__mro__:
            if not cls.__module__.startswith("smlibpy"):
                continue
            for attr, value in vars(cls).items():
                if isinstance(value, (staticmethod, classmethod)):
                    value = value.__func__
                if not attr.startswith("_") and inspect.isfunction(value):
                    owner, _, method = value.__qualname__.rpartition(".")
                    visit(f"{owner}.{camel(method)}", value)
    return {"renamed": dict(sorted(renamed.items())), "positional": dict(sorted(positional.items()))}


def api() -> dict[str, object]:
    """The names smlibwasm must have: smlibpy's exports, and the methods and properties of the classes
    the MCP lists (its method index), camelCase; and the old forms it must still take
    (:func:`deprecations`)."""
    import smlibpy
    from smlibpy.mcp import discovery

    names = sorted(RENAMES.get(n, camel(n)) for n in smlibpy.__all__)
    members: dict[str, set[str]] = {}
    for entry in discovery.methods():
        if entry.kind in ("method", "property") and "." in entry.key:
            cls, name = entry.key.split(".", 1)
            members.setdefault(cls, set()).add(RENAMES.get(entry.key, camel(name)))
    return {"names": names, "members": {c: sorted(m) for c, m in sorted(members.items())}, **deprecations()}


def render_api() -> str:
    import json

    return json.dumps(api(), indent=1) + "\n"


def main() -> int:
    files = {TARGET: render(), API_TARGET: render_api()}
    if "--check" in sys.argv[1:]:
        behind = [path for path, text in files.items() if path.read_text() != text]
        for path in behind:
            print(f"{path.relative_to(ROOT)} is behind smlibpy: run python tools/gen_js_options.py")
        return 1 if behind else 0
    for path, text in files.items():
        path.write_text(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
