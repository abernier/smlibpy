"""What every test runs with: no test opens a browser.

The guides' code ends with ``show()`` here and there, which in plain Python
(``from smlibpy import *``) is ``smlibpy.viewer.show``: it writes a page and opens it in the
default browser. An MCP session opens its live view there too (``SMLIBPY_VIEWER`` is "browser"
by default). On a Windows runner that browser is Edge, which draws the page's WebGL without a
GPU from then on: in the release builds of 0.5.0 it and the window manager kept the cores busy
after ``test_lane_FO``'s fillet guide, and every test after it ran about eleven times slower
(a runner's first run got Edge's welcome page instead, so only the second slowed down).
"""

import webbrowser

import pytest


@pytest.fixture(autouse=True, scope="session")
def _no_browser():
    patch = pytest.MonkeyPatch()
    for name in ("open", "open_new", "open_new_tab"):
        patch.setattr(webbrowser, name, lambda *args, **kwargs: True)
    yield
    patch.undo()
