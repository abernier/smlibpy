import asyncio
import base64
import os
import sys
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
    info = session.call("inspect", name="a", faces=True)
    assert info["ok"] and len(info["info"]["faces"]) == 6 and info["info"]["valid"]


def test_discovery_finds_api_and_guides():
    keys = {e.key for e in discovery.methods()}
    assert {"Box", "Part.fillet", "ShapeList.top", "import_step"} <= keys
    assert "fillet" in [e.key.split(".")[-1] for _, e in discovery.search("round the edges", 5)]
    assert discovery.guide("SKILL") is not None and discovery.guide("recipes/verification") is not None


def test_live_viewer_serves_the_scene(session):
    from smlibpy.mcp.live import LiveViewer

    session.clear()
    session.run("c = Cylinder(5, 10)")
    viewer = LiveViewer(session)
    try:
        page = urllib.request.urlopen(viewer.url, timeout=10).read()
        assert b"EventSource" in page
        glb = urllib.request.urlopen(viewer.url + "scene.glb", timeout=30).read()
        assert glb[:4] == b"glTF"
    finally:
        viewer.close()


def test_stdio_server_round_trip():
    pytest.importorskip("mcp")
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    async def go():
        params = StdioServerParameters(command=sys.executable, args=["-m", "smlibpy.mcp"],
                                       env={**os.environ, "SMLIBPY_VIEWER": "off"})
        async with stdio_client(params) as (r, w):
            async with ClientSession(r, w) as s:
                init = await s.initialize()
                assert "run_script" in (init.instructions or "")
                names = {t.name for t in (await s.list_tools()).tools}
                assert {"run_script", "snapshot", "docs", "save"} <= names
                res = await s.call_tool("run_script", {"script": "part = Box(20, 10, 5)\npart.volume"})
                text = res.content[0].text
                assert "Value: 1000" in text and "Viewer: http://127.0.0.1" in text
                shot = await s.call_tool("snapshot", {"width": 200, "height": 150})
                image = [c for c in shot.content if c.type == "image"][0]
                assert base64.b64decode(image.data)[:4] == b"\x89PNG"

    asyncio.run(go())
