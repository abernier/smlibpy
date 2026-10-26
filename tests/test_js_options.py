"""smlibwasm checks options objects as Python checks keyword arguments, against a table made from
smlibpy's signatures (js/src/_options.ts, by tools/gen_js_options.py): it must follow them.
js/test/options.test.ts checks smlibwasm's side. The same tool lists smlibpy's names
(js/test/_python_api.json), which js/test/api_forms.test.ts finds in smlibwasm."""

import importlib.util
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent


def _generator():
    spec = importlib.util.spec_from_file_location("gen_js_options", ROOT / "tools" / "gen_js_options.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.skipif(not (ROOT / "js" / "src" / "index.ts").exists(), reason="needs the repository's js/")
def test_the_js_options_follow_the_python_signatures():
    gen = _generator()
    assert gen.TARGET.read_text() == gen.render(), \
        "js/src/_options.ts is behind smlibpy's signatures: run python tools/gen_js_options.py"


@pytest.mark.skipif(not (ROOT / "js" / "src" / "index.ts").exists(), reason="needs the repository's js/")
def test_the_table_has_the_keyword_only_parameters_in_camel_case():
    table = _generator().table()
    assert table["Part.fold"] == (2, ["radius", "kFactor", "fixed", "partial"])
    assert table["Rectangle"] == (2, ["fillet", "chamfer", "rotation", "align"])
    assert table["Polyline"] == (-1, ["close"])  # (*points)
    assert table["toStl"] == (1, ["tolerance", "angle", "ascii", "maxEdge"])  # export_stl without its path
    assert table["exportGltf"][1] == ["tolerance", "angle", "edges", "edgeColor", "maxEdge"]  # (**kwargs passed on)
    assert table["Part.offset"] == (1, ["corners"])
    assert "Part.split" not in table  # (no keyword-only parameters: it takes no options)


@pytest.mark.skipif(not (ROOT / "js" / "src" / "index.ts").exists(), reason="needs the repository's js/")
def test_the_list_of_names_follows_smlibpy():
    gen = _generator()
    assert gen.API_TARGET.read_text() == gen.render_api(), \
        "js/test/_python_api.json is behind smlibpy's names: run python tools/gen_js_options.py"
    api = gen.api()
    assert {"draft", "moveFaces", "exportFile", "fuse"} <= set(api["names"]) and "export" not in api["names"]
    assert {"newSince", "atPoint", "fuse", "xor"} <= set(api["members"]["ShapeList"]) | set(api["members"]["Sketch"])
