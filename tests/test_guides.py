"""Every feature is a guide of the skill (AGENTS.md, "Every feature is a guide of the MCP").

The MCP lists the package's functions and classes and the methods of its classes
(``describe_method``, ``list_methods``), and finds each one's guide (``guide_for``: the file of
its name, or the one ``GUIDE_NAMES`` gives). Each must have a guide that names it, and each
guide's Python blocks must run: in order, in one namespace per guide, in a folder of their own,
with ``show`` doing nothing. A block whose first line is ``# not run`` (it needs a file of the
user's, say which) is skipped.

What a guide says its code prints is what it prints: a comment after a ``print(...)`` that starts
with a value (a number, ``True``, a bracket, or the printed text's first word) shows the output,
and its values are compared with the printed ones, to the comment's precision. The output ends at
``" = "``, ``": "``, ``"; "`` or ``...``, and words in parentheses explain; a comment that starts
with a word is a description.
"""

import ast
import io
import math
import re
import sys
import tokenize
import warnings
from collections import defaultdict

import pytest

from smlibpy.mcp import discovery

GUIDES = [g for g in discovery.guides() if "```python" in g.text]

NUMBER = r"[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?"
VALUE = re.compile(rf"(?<![\w.]){NUMBER}(?![\w.])|\b(?:True|False|None)\b")
WORDS_IN_PARENTHESES = re.compile(r"\([^()]*[A-Za-z]{2,}[^()]*\)")


def test_every_function_method_class_and_property_has_a_guide_that_names_it():
    missing = []
    for entry in discovery.methods():
        if entry.kind not in ("function", "method", "class", "property"):
            continue
        guide = discovery.guide_for(entry)
        name = entry.key.split(".")[-1]
        if guide is None or name not in guide.text:
            missing.append(f"{entry.key} ({guide.key if guide else 'no guide'})")
    assert not missing, ("these have no guide that names them; write one (src/smlibpy/skill/references/<domain>/"
                         "<name>.md) or name the guide that describes them in discovery.GUIDE_NAMES: "
                         + ", ".join(missing))


@pytest.mark.parametrize("guide", GUIDES, ids=[g.key for g in GUIDES])
def test_every_guide_runs(guide, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    for name, module in list(sys.modules.items()):  # (guides set smlibpy.defeature.GUARD_BOOLEANS and the like)
        if name.startswith("smlibpy"):
            for key, value in list(vars(module).items()):
                if key.isupper():
                    monkeypatch.setattr(module, key, value)
    ns: dict = {}
    exec("from smlibpy import *\nimport math\nimport numpy as np", ns)
    ns["show"] = lambda *a, **k: None
    wrong = []
    for i, code in enumerate(re.findall(r"```python\n(.*?)```", guide.text, re.S)):
        if code.lstrip().startswith("# not run"):
            continue
        block = f"{guide.key}[block {i + 1}]"
        printed: dict[int, list[str]] = defaultdict(list)

        def _print(*args, sep=" ", end="\n", file=None, flush=False, _block=block, _printed=printed):
            caller = sys._getframe(1)
            if caller.f_code.co_filename == _block and file is None:
                _printed[caller.f_lineno].append(sep.join(map(str, args)))
            print(*args, sep=sep, end=end, file=file, flush=flush)

        ns["print"] = _print
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # (guides that show a warning)
            exec(compile(code, block, "exec"), ns)
        for line, comment in _commented_prints(code).items():
            out = " ".join(printed.get(line, []))
            if _shows_output(out, comment) and (line not in printed or not _same_values(out, comment)):
                wrong.append(f"{block}, line {line}: prints {out[:200]!r}, the comment says # {comment[:200]}")
    assert not wrong, "what these guides say they print is not what they print:\n" + "\n".join(wrong)


def _commented_prints(code: str) -> dict[int, str]:
    """{the line a print(...) starts on: the comment at the end of its last line}"""
    comments = {t.start[0]: t.string[1:].strip()
                for t in tokenize.generate_tokens(io.StringIO(code).readline) if t.type == tokenize.COMMENT}
    return {node.lineno: comments[node.end_lineno] for node in ast.walk(ast.parse(code))
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "print"
            and node.end_lineno in comments}


def _shows_output(printed: str, comment: str) -> bool:
    if not comment:
        return False
    if comment[0] in "0123456789-+.([{'\"":
        return True
    first = re.match(r"[\w.]+", comment)
    return bool(first) and (first.group() in ("True", "False", "None")
                            or printed.split("(")[0].split()[:1] == [first.group()])


def _same_values(printed: str, comment: str) -> bool:
    shown = WORDS_IN_PARENTHESES.sub(" ", re.split(r"\.\.\.|…| = |: |; ", comment)[0])
    for got, said in zip(VALUE.findall(WORDS_IN_PARENTHESES.sub(" ", printed)), VALUE.findall(shown)):
        if not (got[0].isalpha() or said[0].isalpha()):
            mantissa = said.lower().split("e")[0]
            digits = len(mantissa.split(".")[1]) if "." in mantissa else 0
            if "e" in said.lower():
                if math.isclose(float(got), float(said), rel_tol=1.5 * 10 ** -digits):
                    continue
            elif math.isclose(float(got), float(said), rel_tol=1e-6, abs_tol=1.5 * 10 ** -digits):
                continue
        elif got == said:
            continue
        return False
    return True
