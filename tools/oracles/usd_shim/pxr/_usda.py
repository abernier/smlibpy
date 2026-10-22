"""A reader of ``.usda`` text for the shim: prims (with their specifier, type and name), their
metadata (``apiSchemas``), attributes (type, value, whether one is authored) and relationships."""

from __future__ import annotations

import re

_TOKEN = re.compile(r'''\s*(?:(\#[^\n]*)|("""(?:.|\n)*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(@[^@]*@)|(<[^>]*>)|([\[\](){}=,;])|([^\s\[\](){}=,;"'<@#]+))''')
_COMMENT, _STRING, _ASSET, _PATH, _PUNCT, _WORD = range(1, 7)


class Node:
    """A prim: ``spec`` def, over or class; ``typ`` its type ('' for none)."""

    def __init__(self, spec: str, typ: str, name: str, parent: Node | None):
        self.spec, self.typ, self.name, self.parent = spec, typ, name, parent
        self.meta: dict = {}
        self.attrs: dict = {}  # name -> (type, value, authored, uniform)
        self.rels: dict = {}  # name -> [target paths]
        self.children: list[Node] = []


def _tokens(text: str) -> list[tuple[int, str]]:
    out, pos = [], 0
    while pos < len(text):
        m = _TOKEN.match(text, pos)
        if not m or m.end() == pos:
            if not text[pos:].strip():
                break
            raise ValueError(f"cannot read the .usda text at {pos}: {text[pos:pos + 30]!r}")
        pos = m.end()
        for group in range(_STRING, _WORD + 1):
            if m.group(group) is not None:
                out.append((group, m.group(group)))
                break
    return out


class _Parser:
    def __init__(self, text: str):
        self.t = _tokens(text)
        self.i = 0

    def peek(self) -> str | None:
        return self.t[self.i][1] if self.i < len(self.t) else None

    def kind(self) -> int | None:
        return self.t[self.i][0] if self.i < len(self.t) else None

    def next(self) -> str:
        v = self.t[self.i][1]
        self.i += 1
        return v

    def expect(self, v: str) -> None:
        got = self.next()
        if got != v:
            raise ValueError(f"expected {v!r}, found {got!r} (token {self.i})")

    def value(self):
        kind, v = self.kind(), self.peek()
        if v in ("[", "("):
            close = "]" if v == "[" else ")"
            self.next()
            items = []
            while self.peek() != close:
                items.append(self.value())
                if self.peek() == ",":
                    self.next()
            self.next()
            return items if close == "]" else tuple(items)
        if v == "{":
            self.skip_group()
            return {}
        self.next()
        if kind == _STRING:
            body = v[3:-3] if v.startswith('"""') else v[1:-1]
            text = bytes(body, "utf-8").decode("unicode_escape")
            try:
                return text.encode("latin-1").decode("utf-8")  # (unicode_escape read the UTF-8 bytes one by one)
            except UnicodeError:
                return text
        if kind in (_ASSET, _PATH):
            return ("PATH", v[1:-1])
        if re.fullmatch(r"[-+]?\d+", v):
            return int(v)
        try:
            return float(v)
        except ValueError:
            return ("WORD", v)

    def skip_group(self) -> None:
        depth = 0
        while True:
            v = self.next()
            if v in ("(", "[", "{"):
                depth += 1
            elif v in (")", "]", "}"):
                depth -= 1
                if depth == 0:
                    return

    def metadata(self, node: Node | None) -> None:
        self.expect("(")
        while self.peek() != ")":
            word = self.next()
            key = self.next() if word in ("prepend", "append", "add", "delete", "reorder") else word
            if self.peek() == "=":
                self.next()
                value = self.value()
                if node is not None:
                    node.meta[key] = value
            elif self.kind() == _STRING:  # (a doc string alone)
                self.value()
        self.next()

    def layer(self) -> Node:
        root = Node("def", "", "", None)
        if self.peek() == "(":
            self.metadata(root)
        while self.peek() is not None:
            self.prim(root)
        return root

    def prim(self, parent: Node) -> Node:
        spec = self.next()
        if spec not in ("def", "over", "class"):
            raise ValueError(f"a prim was expected, found {spec!r}")
        typ = self.next() if self.kind() != _STRING else ""
        node = Node(spec, typ, self.value(), parent)
        parent.children.append(node)
        if self.peek() == "(":
            self.metadata(node)
        self.expect("{")
        while self.peek() != "}":
            word = self.peek()
            if word in ("def", "over", "class"):
                self.prim(node)
            elif word == "variantSet":
                self.next()
                self.value()
                self.expect("=")
                self.skip_group()
            else:
                self.prop(node)
        self.next()
        return node

    def prop(self, node: Node) -> None:
        quals = []
        while self.peek() in ("custom", "uniform", "varying", "prepend", "append", "delete", "add", "reorder", "config"):
            quals.append(self.next())
        if self.peek() == "rel":
            self.next()
            name, value = self.next(), None
            if self.peek() == "=":
                self.next()
                value = self.value()
            if self.peek() == "(":
                self.metadata(None)
            items = value if isinstance(value, list) else [value]
            node.rels[name] = [x[1] for x in items if isinstance(x, tuple) and len(x) == 2 and x[0] == "PATH"]
            return
        typ = self.next()
        if self.peek() == "[":
            self.next()
            self.expect("]")
            typ += "[]"
        name = self.next()
        value, authored = None, False
        if self.peek() == "=":
            self.next()
            value, authored = self.value(), True
        if self.peek() == "(":
            self.metadata(None)
        if ".connect" in name or ".timeSamples" in name:
            return
        node.attrs[name] = (typ, value, authored, "uniform" in quals)


def parse(text: str) -> Node:
    """The root of the layer: its prims are the root's children."""
    return _Parser(text).layer()
