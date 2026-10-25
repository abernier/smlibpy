import asyncio
import base64
import os
import sys
import time
import urllib.request

import pytest

from smlibpy.mcp import discovery
from smlibpy.mcp.session import Session


@pytest.fixture(scope="module")
def session():
    s = Session()
    yield s
    s.close()


def test_session_keeps_state_and_survives_errors(session):
    session.clear()
    ok = session.run("plate = Box(40, 30, 10) - Cylinder(5, 20)\nprint(round(plate.volume, 3))")
    assert ok["ok"] and ok["output"].strip() == str(round(12000 - 3.141592653589793 * 25 * 10, 3))
    bad = session.run("plate = plate.fillet(plate.edges(), 50)")
    assert not bad["ok"] and "ModelingError" in bad["error"] and "line 1" in bad["error"]
    again = session.run("plate.volume")
    assert again["ok"] and float(again["value"]) == pytest.approx(12000 - 3.141592653589793 * 250, rel=1e-6)
    assert [item["name"] for item in again["scene"]] == ["plate"]


def test_session_stops_long_scripts_and_rebuilds(session):
    session.clear()
    assert session.run("a = Box(10, 10, 10)")["ok"]
    stuck = session.run("while True:\n    pass", timeout=2)
    assert not stuck["ok"] and "1 earlier scripts ran again" in stuck["error"]
    assert session.run("a.volume")["value"].startswith("1000")


def test_checkpoints(session):
    session.clear()
    session.run("p = Box(10, 10, 10)")
    session.checkpoint("cube")
    session.run("p = p - Cylinder(2, 20)")
    assert float(session.run("p.volume")["value"]) < 1000
    note = session.restore("cube")
    assert "cube" in note
    assert float(session.run("p.volume")["value"]) == pytest.approx(1000, rel=1e-9)


def test_show_snapshot_save_inspect(session, tmp_path):
    session.clear()
    session.run("a = Box(10, 10, 10)\nb = Sphere(4).translate(20, 0, 0)\nshow(b)")
    scene = session.call("scene")
    assert [s["name"] for s in scene["scene"]] == ["b"] and scene["explicit"]
    shot = session.call("snapshot", view="sheet", size=(320, 240))
    assert shot["ok"] and shot["png"][:8] == b"\x89PNG\r\n\x1a\n"
    saved = session.call("save", format="step", path=str(tmp_path / "b.step"))
    assert saved["ok"] and os.path.getsize(saved["path"]) > 0
    saved = session.call("save", format="usd", path=str(tmp_path / "b.usda"))  # exact bodies in USD
    assert saved["ok"] and saved["shapes"] == ["b"]
    loaded = session.load(saved["path"], "b_again")
    assert loaded["ok"] and loaded["type"] == "Part" and loaded["volume"] == pytest.approx(268.083, rel=1e-5)
    assert loaded["label"] == "b"
    info = session.call("inspect", name="a", faces=True)
    assert info["ok"] and len(info["info"]["faces"]) == 6 and info["info"]["valid"]


def test_snapshot_options_frame_and_compare(session, tmp_path):
    session.clear()
    session.run("part = Box(40, 30, 10) - Cylinder(5, 20)")
    shot = session.call("snapshot", size=(300, 200), path=str(tmp_path / "a.png"), highlight=["part.faces().top()"],
                        section="Plane.XZ", markers=[{"position": [0, 0, 5], "label": "bore"}], lines=True)
    assert shot["ok"] and shot["frame"]["scale"] > 0
    drawing = session.call("snapshot", size=(400, 300), drawing="third-angle", section={"origin": [0, 0, 0],
                                                                                         "normal": [0, -1, 0]})
    assert drawing["ok"] and drawing["frame"] is None
    opened = session.call("snapshot", size=(400, 300), drawing=True, section="Plane.XZ", cap=False)
    capped = session.call("snapshot", size=(400, 300), drawing=True, section="Plane.XZ")
    assert opened["ok"] and opened["png"] != capped["png"]
    bad = session.call("snapshot", highlight="nothing_here")
    assert not bad["ok"] and "highlight 'nothing_here'" in bad["error"]
    before = session.call("snapshot", size=(300, 200), path=str(tmp_path / "before.png"))
    session.run("part = part - Cylinder(3, 20).translate(12, 0, 0)")
    after = session.call("snapshot", size=(300, 200), path=str(tmp_path / "after.png"), frame=before["frame"],
                         compare=str(tmp_path / "before.png"))
    assert after["ok"] and after["frame"] == before["frame"]
    diff = after["diff"]
    assert diff["changed"] > 50 and diff["fraction"] < 0.05 and os.path.exists(diff["path"])
    same = session.call("snapshot", size=(300, 200), frame=before["frame"], compare=str(tmp_path / "after.png"))
    assert same["diff"]["changed"] == 0


def test_snapshot_zebra_and_curvature(session):
    session.clear()
    session.run("box = Box(40, 40, 20)\nsoft = box.fillet(box.edges().parallel_to(Z), 8, continuity='G2')\n"
                "show(soft)")
    zebra = session.call("snapshot", size=(300, 200), zebra={"stripes": 20, "direction": [0, 0, 1]},
                         highlight="soft.faces().top()", markers=[{"position": [0, 0, 10], "label": "top"}])
    curv = session.call("snapshot", size=(300, 200), curvature={"kind": "max", "range": 0.2})
    sheet = session.call("snapshot", size=(400, 300), sheet=True, curvature="mean")
    assert zebra["ok"] and curv["ok"] and sheet["ok"] and zebra["png"] != curv["png"]
    assert curv["frame"]["scale"] > 0 and sheet["frame"] is None
    bad = session.call("snapshot", curvature="sharpness")
    assert not bad["ok"] and "curvature" in bad["error"]


def test_discovery_finds_api_and_guides():
    keys = {e.key for e in discovery.methods()}
    assert {"Box", "Part.fillet", "ShapeList.top", "import_step"} <= keys
    assert "fillet" in [e.key.split(".")[-1] for _, e in discovery.search("round the edges", 5)]
    assert discovery.guide("SKILL") is not None and discovery.guide("recipes/verification") is not None


@pytest.mark.parametrize("query,expected", [
    ("ray", "analysis/raycast"),
    ("select faces with a ray", "ShapeList.hit_by"),
    ("which face does the ray hit first", "selection/hit_by"),
    ("inside outside test", "analysis/classify"),
    ("is a point inside the part", "analysis/classify"),
    ("point cloud", "surfaces/surface"),
    ("fit a surface to points", "surfaces/surface"),
    ("blend two surfaces", "surfaces/surface_fillet"),
    ("cells", "features/cells"),
    ("several materials", "features/merge"),
    ("knot removal", "curves/remove_knots"),
    ("compatible curves", "curves/make_compatible"),
    ("control points of a curve", "curves/nurbs"),
    ("usd", "files/export_usd"),
    ("omniverse", "files/import_usd"),
    ("mesh boolean", "files/Mesh"),
])
def test_search_finds_the_kernel_tools(query, expected):
    assert expected in [e.key for _, e in discovery.search(query, 5)]


KERNEL_TOOL_GUIDES = ["analysis/raycast", "analysis/classify", "selection/hit_by", "surfaces/surface", "surfaces/surface_fillet", "features/merge",
                      "features/cells", "curves/nurbs", "curves/make_compatible", "curves/remove_knots",
                      "files/export_usd", "files/import_usd", "files/Mesh"]


@pytest.mark.parametrize("key", KERNEL_TOOL_GUIDES)
def test_kernel_tool_guides_run(key, tmp_path, monkeypatch):
    import re

    monkeypatch.chdir(tmp_path)
    guide = discovery.guide(key)
    assert guide is not None and discovery.guide_for(discovery.find_method(key.split("/")[1])) is not None
    ns: dict = {}
    exec("from smlibpy import *\nimport math\nimport numpy as np", ns)
    for i, code in enumerate(re.findall(r"```python\n(.*?)```", guide.text, re.S)):
        exec(compile(code, f"{key}[{i + 1}]", "exec"), ns)


def _fake_app(folder):
    """A stand-in for Buerligons' build: an index.html and one asset."""
    (folder / "assets").mkdir(parents=True, exist_ok=True)
    (folder / "index.html").write_text('<script type="module" src="/assets/app.js"></script>')
    (folder / "assets" / "app.js").write_text("console.log('app')")
    return folder


def test_buerli_scene_has_ids_loops_and_surfaces(session):
    from smlibpy.mcp.graphic import CONTAINER0, EDGES, SOLID0, STRIDE

    session.clear()
    assert session.run("plate = (Box(40, 30, 10) - Cylinder(5, 20)).colored('#d9925a')")["ok"]
    s = session.call("buerli_scene")
    assert s["ok"]
    tree = s["structure"]["tree"]
    assert s["structure"]["root"] == 2 and tree["2"]["class"] == "CC_Part" and tree["2"]["solids"] == [CONTAINER0]
    assert tree[str(SOLID0)] == {"id": SOLID0, "class": "CC_Solid", "name": "plate", "parent": 2, "flags": 0,
                                 "geometryIdList": [CONTAINER0]}
    [c] = s["graphic"]["containers"]
    assert c["owner"] == SOLID0 and c["type"] == 1 and c["properties"]["material"]["color"] == [217, 146, 90]
    assert c["properties"]["min"] == pytest.approx([-20, -15, -5]) and c["properties"]["max"] == pytest.approx([20, 15, 5])
    # one mesh per face, numbered as plate.faces(); one polyline per edge, numbered as plate.edges() (seams left out)
    assert sorted(m["id"] - STRIDE for m in c["meshes"]) == list(range(7))
    assert sorted(e["id"] - STRIDE - EDGES for e in c["edges"]) == list(range(14))
    kinds = sorted(m["properties"]["surface"]["type"] for m in c["meshes"])
    assert kinds == ["cylinder"] + ["plane"] * 6
    cyl = next(m["properties"]["surface"] for m in c["meshes"] if m["properties"]["surface"]["type"] == "cylinder")
    assert cyl["radius"] == pytest.approx(5) and cyl["height"] == pytest.approx(10)
    edge_ids = {e["id"] for e in c["edges"]}
    top = next(m for m in c["meshes"] if m["properties"]["surface"]["type"] == "plane"
               and m["properties"]["surface"]["normal"] == pytest.approx([0, 0, 1]))
    assert len(top["loops"]) == 2 and all(i in edge_ids for loop in top["loops"] for i in loop)
    assert all(len(m["normals"]) == len(m["vertices"]) and m["indices"] for m in c["meshes"])
    # what the user picks leads back to the session, and expressions lead to what to select
    j = next(m["id"] for m in c["meshes"] if m["properties"]["surface"]["type"] == "cylinder") - STRIDE
    picks = session.call("picks", items=[{"kind": "face", "objectId": SOLID0, "containerId": CONTAINER0,
                                          "graphicId": STRIDE + j}])["picks"]
    assert picks[0]["expr"] == f"plate.faces()[{j}]" and picks[0]["type"] == "cylinder" and picks[0]["radius"] == 5
    t = session.call("targets", expressions=["plate.faces().top()", "plate.edges()[3]", "Box(1, 1, 1)"])
    assert t["targets"][0]["containerId"] == CONTAINER0 and t["targets"][1]["graphicId"] == STRIDE + EDGES + 3
    assert len(t["missing"]) == 1


def test_picks_and_inspect_read_zeros_not_float_noise(session):
    session.clear()
    assert session.run("block = Box(40, 30, 10) - Box(20, 10, 4).translate(0, 0, 3) - Cylinder(3, 20)")["ok"]
    assert session.call("buerli_scene")["ok"]
    t = session.call("targets", expressions=["block.faces().facing(Z).bottom()", "block.faces().cylinders()"])
    floor, bore = session.call("picks", items=[{"kind": "face", **target} for target in t["targets"]])["picks"]
    # as get_selection prints them: the pocket's floor and the bore sit on the z axis (the kernel says
    # 1e-16 there) and the floor faces up (the kernel says -0.0, -0.0, 1.0)
    assert str(floor["center"]) == "[0.0, 0.0, 1.0]" and str(floor["normal"]) == "[0.0, 0.0, 1.0]"
    assert str(bore["center"]) == "[0.0, 0.0, -2.0]"
    [row] = session.call("inspect", name="block.faces().facing(Z).bottom()", faces=True)["info"]["faces"]
    assert str(row["center"]) == "[0.0, 0.0, 1.0]" and str(row["normal"]) == "[0.0, 0.0, 1.0]"


def test_app_session_answers_like_a_classcad_server(session, tmp_path, monkeypatch):
    import json
    import urllib.error

    pytest.importorskip("websockets")  # (the live view's server: of the mcp extra)
    from websockets.sync.client import connect

    from smlibpy.mcp.buerli import BuerliHost
    from smlibpy.mcp.graphic import CONTAINER0, STRIDE

    monkeypatch.setenv("SMLIBPY_APP_DIR", str(_fake_app(tmp_path / "app")))
    session.clear()
    assert session.run("c = Cylinder(5, 10)")["ok"]
    host = BuerliHost(session)
    try:
        url = host.url
        port = url.split(":")[2].split("/")[0]
        assert b"/assets/app.js" in urllib.request.urlopen(url, timeout=10).read()
        assert b"console.log" in urllib.request.urlopen(f"http://127.0.0.1:{port}/assets/app.js", timeout=10).read()
        for bad in (f"http://127.0.0.1:{port}/", f"http://127.0.0.1:{port}/?invite=wrong"):
            with pytest.raises(urllib.error.HTTPError) as e:
                urllib.request.urlopen(bad, timeout=10)
            assert e.value.code == 403
        with pytest.raises(urllib.error.HTTPError) as e:  # another site's page cannot reach it
            urllib.request.urlopen(urllib.request.Request(url, headers={"Host": "example.com"}), timeout=10)
        assert e.value.code == 403

        with connect(f"ws://127.0.0.1:{port}/session/?invite={host.token}") as ws:
            def ask(frame):
                ws.send(json.dumps({**frame, "commandVersion": "v1", "transactionID": "t" + frame["command"]}))
                while True:
                    reply = json.loads(ws.recv(timeout=60))
                    if reply.get("_transactionID_") == "t" + frame["command"]:
                        return reply

            joined = json.loads(ws.recv(timeout=10))
            assert joined == {"command": "SessionJoined", "role": "view", "inviteName": "smlibpy"}
            offered = json.loads(ws.recv(timeout=10))
            assert offered["channel"] == "config"
            assert offered["data"] == {"saveFormats": ["STP", "STL", "GLB", "OBJ", "USDA", "SMB"]}
            config = ask({"command": "SetEmissionConfig", "config": {"sendStructure_Patch": True, "bogus": 1}})
            assert config["result"]["sendStructure"] is True and config["result"]["sendStructure_Patch"] is True
            assert "bogus" not in config["result"]
            tree = ask({"command": "GetTree"})
            assert tree["structure"]["currentProduct"] == 2 and tree["result"] == tree["structure"]
            [c] = tree["graphic"]["containers"]
            assert len(c["meshes"]) == 3 and c["id"] == CONTAINER0
            settings = ask({"command": "Execute", "task": [{"v1.common.setDatabaseSettings": [{"isGraphicEnabled": True}]}]})
            assert settings["result"] is None and "messages" not in settings
            box = ask({"command": "Execute", "task": [{"v1.part.box": [{"id": 2}]}]})
            assert box["maxLevel"] == 51 and "not available" in box["messages"][0]["message"]
            assert ask({"command": "StoreState"})["maxLevel"] == 51
            saved = ask({"command": "Execute", "task": [{"v1.common.save": [{"format": "STP", "encoding": "base64"}]}]})
            assert base64.b64decode(saved["result"]["content"]).startswith(b"ISO-10303-21;")
            saved = ask({"command": "Execute", "task": [{"v1.common.save": [{"format": "GLB", "encoding": "base64"}]}]})
            assert base64.b64decode(saved["result"]["content"])[:4] == b"glTF"
            saved = ask({"command": "Execute", "task": [{"v1.common.save": [{"format": "USDA", "encoding": "base64"}]}]})
            assert base64.b64decode(saved["result"]["content"]).startswith(b"#usda 1.0")

            # what the user selects is kept until the model changes; the change reaches the app without
            # being asked for, after a request that clears the app's selection (its ids would now name
            # other faces)
            ws.send(json.dumps({"command": "Presence", "channel": "selection", "data": {"total": 1, "items": [
                {"kind": "face", "objectId": 1000, "containerId": CONTAINER0, "graphicId": STRIDE}]}}))
            deadline = time.time() + 10
            while not host.selection and time.time() < deadline:
                time.sleep(0.02)
            assert host.selection[0]["graphicId"] == STRIDE
            assert session.run("c = Box(10, 20, 30)")["ok"]
            seen = []
            while True:
                pushed = json.loads(ws.recv(timeout=60))
                seen.append(pushed)
                if pushed.get("_from_") == "GetTree":
                    break
            clear = [f["data"] for f in seen if f.get("channel") == "select"]
            assert clear[0]["items"] == [] and clear[0]["replace"] is True and clear[1]["done"] is True
            assert len(pushed["graphic"]["containers"][0]["meshes"]) == 6
            assert host.selection == []
            # the agent's selection reaches the app as a request, then its end
            assert host.select([{"containerId": CONTAINER0, "graphicId": STRIDE + 1}]) == 1
            request = json.loads(ws.recv(timeout=10))
            assert request["channel"] == "select" and request["data"]["items"][0]["graphicId"] == STRIDE + 1
            assert json.loads(ws.recv(timeout=10))["data"]["done"] is True
    finally:
        host.close()


def test_app_comes_with_the_package(tmp_path, monkeypatch):
    from smlibpy.mcp import app

    monkeypatch.setenv("SMLIBPY_APP_DIR", str(_fake_app(tmp_path / "own")))
    assert app.app_dir() == tmp_path / "own"
    monkeypatch.delenv("SMLIBPY_APP_DIR")
    monkeypatch.setattr(app, "PACKAGED", _fake_app(tmp_path / "packaged"))
    assert app.app_dir() == tmp_path / "packaged"
    monkeypatch.setattr(app, "PACKAGED", tmp_path / "not-built")
    with pytest.raises(app.AppUnavailable, match="no index.html"):
        app.app_dir()


def test_stdio_server_round_trip(tmp_path):
    pytest.importorskip("mcp")
    app_dir = _fake_app(tmp_path / "app")
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    async def go():
        params = StdioServerParameters(command=sys.executable, args=["-m", "smlibpy.mcp"],
                                       env={**os.environ, "SMLIBPY_VIEWER": "off", "SMLIBPY_APP_DIR": str(app_dir)})
        async with stdio_client(params) as (r, w):
            async with ClientSession(r, w) as s:
                init = await s.initialize()
                assert "run_script" in (init.instructions or "")
                names = {t.name for t in (await s.list_tools()).tools}
                assert {"run_script", "snapshot", "docs", "save", "get_selection", "set_selection"} <= names
                res = await s.call_tool("run_script", {"session": "new", "script": "part = Box(20, 10, 5)\npart.volume"})
                text = res.content[0].text
                assert "Value: 1000" in text and "Viewer: http://127.0.0.1" in text and "?invite=" in text
                sid = _opened(text)
                shot = await s.call_tool("snapshot", {"session": sid, "width": 200, "height": 150})
                image = [c for c in shot.content if c.type == "image"][0]
                assert base64.b64decode(image.data)[:4] == b"\x89PNG"
                note = [c for c in shot.content if c.type == "text"][0].text
                assert "frame: {" in note
                drawing = await s.call_tool("snapshot", {"session": sid, "width": 400, "height": 300, "drawing": True,
                                                         "highlight": "part.faces().top()",
                                                         "view": {"azimuth": 30, "elevation": 20}})
                assert [c.type for c in drawing.content] == ["image", "text"]
                assert "frame:" not in drawing.content[1].text
                stripes = await s.call_tool("snapshot", {"session": sid, "width": 300, "height": 200, "zebra": True,
                                                         "curvature": None})
                assert stripes.content[0].type == "image"
                curv = await s.call_tool("snapshot", {"session": sid, "width": 300, "height": 200,
                                                      "curvature": {"kind": "gaussian", "range": 0.01}})
                assert curv.content[0].type == "image"
                # the kernel tools, as an agent uses them: a script, then a USD file out and back in
                res = await s.call_tool("run_script", {"session": sid, "script": (
                    "cloud = np.random.default_rng(2).uniform(-10, 10, (300, 2))\n"
                    "skin = surface(np.column_stack([cloud, 0.02 * (cloud ** 2).sum(axis=1)]))\n"
                    "hits = part.raycast((0, 0, 50), (0, 0, -1))\n"
                    "cells = part.merge(Box(4, 4, 20)).cells()\n"
                    "print(len(hits), len(cells), skin.faces()[0].geom_type)")})
                assert "2 4 bspline" in res.content[0].text  # (the pin through the box: 3 pieces of it, and the box)
                usd = str(tmp_path / "part.usda")
                saved = await s.call_tool("save", {"session": sid, "format": "usd", "path": usd, "names": ["part"]})
                assert saved.content[0].text.startswith(f"Wrote {usd}")
                loaded = await s.call_tool("load", {"session": sid, "path": usd, "name": "again"})
                assert "Loaded" in loaded.content[0].text and "volume 1000" in loaded.content[0].text

    asyncio.run(go())


def _opened(text):
    import re

    found = re.search(r'Session "(s-[a-z0-9]{8})" is new', text)
    assert found, text
    return found.group(1)


def test_conversations_on_one_connection_keep_their_own_sessions(tmp_path):
    """What the Claude desktop chat app does: one server process, every conversation's calls on its one
    connection. Each conversation works in a session of its own, and one with an engine awake at a time
    puts the other's to sleep and wakes it with its variables."""
    pytest.importorskip("mcp")
    app_dir = _fake_app(tmp_path / "app")
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    async def go():
        params = StdioServerParameters(command=sys.executable, args=["-m", "smlibpy.mcp"],
                                       env={**os.environ, "SMLIBPY_VIEWER": "off", "SMLIBPY_APP_DIR": str(app_dir),
                                            "SMLIBPY_SESSIONS_AWAKE": "1"})
        async with stdio_client(params) as (r, w):
            async with ClientSession(r, w) as s:
                await s.initialize()
                schema = {t.name: getattr(t, "input_schema", None) or t.inputSchema for t in (await s.list_tools()).tools}
                assert "session" in schema["run_script"]["required"]
                assert "session" not in (schema["docs"].get("properties") or {})

                async def text(name, args):
                    res = await s.call_tool(name, args)
                    error = getattr(res, "is_error", None)
                    return res.isError if error is None else error, "\n".join(c.text for c in res.content if c.type == "text")

                # the same variable name in two conversations
                _, a = await text("run_script", {"session": "new", "script": "part = Box(20, 10, 5)\npart.volume"})
                _, b = await text("run_script", {"session": "new", "script": "part = Box(1, 1, 1)\npart.volume"})
                A, B = _opened(a), _opened(b)
                assert A != B
                _, va = await text("run_script", {"session": A, "script": "part.volume"})
                assert "Value: 1000" in va, va
                # B starts over: A keeps its part; checkpoints are a session's own
                _, cleared = await text("clear", {"session": B})
                assert cleared == "The session is empty."
                await text("checkpoint", {"session": B, "label": "b"})
                _, restored = await text("restore", {"session": A, "label": "b"})
                assert "no checkpoint" in restored
                _, va = await text("run_script", {"session": A, "script": "part.volume"})
                assert "Value: 1000" in va, va
                # what cannot reach a session changes nothing
                err, missing = await text("clear", {})
                assert err
                err, made_up = await text("clear", {"session": "s-aaaaaaaa"})
                assert err and 'No session "s-aaaaaaaa"' in made_up
                _, scene = await text("scene", {"session": A})
                assert "part: Part, volume 1000" in scene and "Scripts in this session: 3" in scene
                # each has its own live view
                _, view_a = await text("view", {"session": A})
                _, view_b = await text("view", {"session": B})
                assert view_a.startswith("Viewer: http://127.0.0.1") and view_a != view_b
                # one awake at a time: B went to sleep when A ran, and wakes with its scripts run again
                _, vb = await text("run_script", {"session": B, "script": "q = Box(2, 2, 2)\nq.volume"})
                assert "Value: 8" in vb, vb
                _, va = await text("run_script", {"session": A, "script": "part.volume"})
                assert "Value: 1000" in va and "put aside" not in va, va

    asyncio.run(go())


def test_a_sleeping_session_wakes_with_its_variables_and_says_what_did_not_come_back(tmp_path):
    s = Session()
    try:
        assert s.run("a = Box(10, 10, 10)")["ok"]
        from test_step_import import _tool_with_supplemental_geometry

        step = str(tmp_path / "part.step")  # written here: a script that wrote it would write it again
        (tmp_path / "part.step").write_text(_tool_with_supplemental_geometry())
        assert s.load(step, "loaded")["ok"]
        assert s.sleep() and not s.awake
        assert s.run("a.volume")["value"].startswith("1000") and s.awake
        assert s.take_notice() is None, "every script ran again"
        # a file the session read is gone when it wakes: it says so
        os.remove(step)
        assert s.sleep()
        r = s.run("a.volume")
        assert r["value"].startswith("1000")
        notice = s.take_notice()
        assert notice and "put aside" in notice and "failed" in notice, notice
        assert s.take_notice() is None
    finally:
        s.close()


def test_viewer_shows_a_read_step_file_and_imported_assemblies(session, tmp_path):
    from test_step_import import _tool_with_supplemental_geometry

    path = tmp_path / "tool.step"
    path.write_text(_tool_with_supplemental_geometry())
    session.clear()
    r = session.run(f"tool = read_step({str(path)!r})\nparts = tool.bodies")
    assert r["ok"], r.get("error")
    # shown without show(): the read file, and the list of its bodies
    assert [item["name"] for item in r["scene"]] == ["tool", "parts[0]"]
    assert r["scene"][0]["frames"] == ["MCS (TOOL)"]
    s = session.call("buerli_scene")
    tree = s["structure"]["tree"]
    names = [tree[str(i)]["name"] for i in tree["2"]["children"]]
    assert names.count("cylinder") == 2 and {"CUTTING EDGE LINE", "ARC", "PATH"} <= set(names)
    line = next(c for c in s["graphic"]["containers"] if tree[str(c["owner"])]["name"] == "CUTTING EDGE LINE")
    assert line["properties"]["material"]["color"] == [255, 0, 0] and not line["meshes"] and line["edges"]
    assert s["index"][line["id"]]["expr"].startswith("tool.curves[")
    assert max(c["properties"]["max"][2] for c in s["graphic"]["containers"]) <= 120 + 1e-6
    assert session.call("snapshot", size=(300, 200))["ok"]


@pytest.mark.parametrize("name", ["ShapeList.new", "ShapeList.derived_from", "ShapeList.shared", "ShapeList.g1",
                                  "ShapeList.g2", "Part.voids", "Part.shells", "Part.sources", "Part.from_mesh",
                                  "Part.raycast_many", "Sketch.flipped", "Face.cells", "to_step", "from_step", "to_file",
                                  "from_file", "Edge.min_radius_at", "Edge.param_at_point", "Shell.from_nurbs"])
def test_describe_method_finds_a_guide_for_names_without_one_of_their_own(name):
    # The guides are found by file name: the methods a guide of another name describes (history,
    # shells, files in memory, ...) came without one in describe_method.
    entry = discovery.find_method(name)
    assert entry is not None, name
    guide = discovery.guide_for(entry)
    assert guide is not None and name.split(".")[-1] in guide.text, (name, guide and guide.key)
