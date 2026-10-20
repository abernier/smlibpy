"""Buerligons, the ClassCAD app, as the viewer of an MCP session.

The app is ``app/`` in the repository: a page that joins the session at ``/session`` on the address it was loaded
from, with Buerligons from the npm package ``@buerli.io/buerligons``. A release builds it into ``smlibpy/mcp/app/``
and ships it inside the package, so nothing is downloaded. ``SMLIBPY_APP_DIR`` points to another build instead (an
``index.html`` and its ``assets``).
"""

from __future__ import annotations

import os
from pathlib import Path

PACKAGED = Path(__file__).with_name("app")


class AppUnavailable(Exception):
    pass


def app_dir() -> Path:
    """The folder with the app: ``SMLIBPY_APP_DIR``, or the build that came with the package."""
    own = os.environ.get("SMLIBPY_APP_DIR")
    folder = Path(own) if own else PACKAGED
    if not (folder / "index.html").is_file():
        where = f"SMLIBPY_APP_DIR={folder}" if own else f"{folder} (a checkout builds it: npm run build in app/)"
        raise AppUnavailable(f"{where} has no index.html")
    return folder
