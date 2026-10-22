"""``pxr.Usd``: a stage of one ``.usda`` layer, as the validator reads it."""

from __future__ import annotations

import os
from pathlib import Path

from . import _usda
from .Sdf import AttributeSpec, TypeName

#: The omniSolid schema (usd-brep), for the attributes a prim has without authoring them.
SCHEMA = Path(os.environ.get("OMNISOLID_SCHEMA", Path(__file__).resolve().parents[4] / "third_party" / "usd-brep" / "source"
                             / "schema" / "omniSolid" / "resources" / "generatedSchema.usda"))
_schema: dict | None = None


def _schema_attributes() -> dict:
    global _schema
    if _schema is None:
        root = _usda.parse(SCHEMA.read_text(encoding="utf-8"))
        _schema = {c.name: {name: a[0] for name, a in c.attrs.items()} for c in root.children}
    return _schema


def _converted(typ: str, v):
    if isinstance(v, list):
        return [_converted(typ, x) for x in v]
    if isinstance(v, tuple) and v and v[0] in ("PATH", "WORD"):
        return v[1]
    if isinstance(v, tuple):
        return tuple(_converted(typ, x) for x in v)
    if typ.startswith(("double", "float", "point", "vector", "normal", "color")) and isinstance(v, int):
        return float(v)
    return v


class TimeCode:
    @staticmethod
    def Default():
        return None


class Attribute:
    def __init__(self, prim: Prim, name: str):
        self.prim, self.name = prim, name
        self._a = prim.node.attrs.get(name)
        self._defined = self._a is not None or name in prim._schema_attributes()

    def __bool__(self) -> bool:
        return self._defined

    def IsValid(self) -> bool:
        return self._defined

    def Get(self, time=None):
        if self._a is None or not self._a[2]:
            return None
        return _converted(self._a[0], self._a[1])

    def IsAuthored(self) -> bool:
        return self._a is not None

    def HasAuthoredValue(self) -> bool:
        return self._a is not None and self._a[2]

    def GetTypeName(self) -> TypeName:
        if self._a is not None:
            return TypeName(self._a[0])
        return TypeName(self.prim._schema_attributes().get(self.name, ""))

    def GetPropertyStack(self, time=None) -> list[AttributeSpec]:
        return [AttributeSpec(self._a[0])] if self._a is not None else []

    def GetName(self) -> str:
        return self.name


class Relationship:
    def __init__(self, targets):
        self.targets = targets

    def __bool__(self) -> bool:
        return self.targets is not None

    def GetTargets(self) -> list[str]:
        return list(self.targets or [])


class Prim:
    def __init__(self, node, stage: Stage):
        self.node, self.stage = node, stage

    def __bool__(self) -> bool:
        return self.node is not None

    def IsValid(self) -> bool:
        return self.node is not None

    def GetTypeName(self) -> str:
        return self.node.typ

    def GetName(self) -> str:
        return self.node.name

    def GetPath(self) -> str:
        return self.stage._path_of(self.node)

    def GetStage(self) -> Stage:
        return self.stage

    def GetAttribute(self, name: str) -> Attribute:
        return Attribute(self, name)

    def GetRelationship(self, name: str) -> Relationship:
        return Relationship(self.node.rels.get(name))

    def GetAppliedSchemas(self) -> list[str]:
        return [x for x in self.node.meta.get("apiSchemas") or [] if isinstance(x, str)]

    def GetAllChildren(self) -> list[Prim]:
        return [Prim(c, self.stage) for c in self.node.children]

    GetChildren = GetAllChildren

    def GetPrimDefinition(self):
        return None

    def _schema_attributes(self) -> dict:
        schema = _schema_attributes()
        out = dict(schema.get("BrepArray", {}))
        for api in self.GetAppliedSchemas():
            base, _, instance = api.partition(":")
            for name, typ in schema.get(base, {}).items():
                out[name.replace("__INSTANCE_NAME__", instance)] = typ
        return out


class Stage:
    def __init__(self, root):
        self.root = root

    @staticmethod
    def Open(path) -> Stage:
        return Stage(_usda.parse(Path(path).read_text(encoding="utf-8", errors="replace")))

    def _path_of(self, node) -> str:
        parts = []
        while node is not None and node.parent is not None:
            parts.append(node.name)
            node = node.parent
        return "/" + "/".join(reversed(parts))

    def Traverse(self) -> list[Prim]:
        def walk(n):
            for c in n.children:
                yield Prim(c, self)
                yield from walk(c)

        return list(walk(self.root))

    TraverseAll = Traverse

    def GetPrimAtPath(self, path) -> Prim:
        for p in self.Traverse():
            if p.GetPath() == str(path):
                return p
        return Prim(None, self)
